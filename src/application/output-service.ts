import type { EstroDatabase } from "../data/estro-database";
import { createOpfsOutputStore, outputStoreKey, type OutputStore } from "../data/output-store";
import { ProjectError } from "../domain/project-error";
import { outputRecordSchema, type OutputRecord } from "../domain/output";

export interface OutputServiceOptions {
  now?: () => Date;
  createOutputId?: () => string;
  store?: OutputStore;
}

/**
 * Owns finished deliveries.
 *
 * A completed render used to live in one in-memory `lastOutput` slot, which meant a reload
 * threw away work that had already been done. Outputs are durable records with their own
 * bytes, so they can be listed, re-downloaded, and explained long after the job ended.
 */
export class OutputService {
  private readonly now: () => Date;
  private readonly createOutputId: () => string;
  private readonly store: OutputStore;
  private readonly listeners = new Map<string, Set<() => void>>();

  constructor(private readonly database: EstroDatabase, options: OutputServiceOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.createOutputId = options.createOutputId ?? (() => crypto.randomUUID());
    this.store = options.store ?? createOpfsOutputStore();
  }

  subscribe(projectId: string, listener: () => void): () => void {
    const listeners = this.listeners.get(projectId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(projectId, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(projectId);
    };
  }

  async listOutputs(projectId: string, limit = 50): Promise<OutputRecord[]> {
    const records = await this.database.outputs.where("projectId").equals(projectId).toArray();
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }

  async getOutput(outputId: string): Promise<OutputRecord> {
    const record = await this.database.outputs.get(outputId);
    if (!record) throw new ProjectError("INVALID_INPUT", "That output is not available in this browser.", { fieldPath: "outputId" });
    return record;
  }

  /** Writes the bytes first, then the record, so a listed output is always readable. */
  async saveOutput(
    input: Omit<OutputRecord, "id" | "schemaVersion" | "storageKey" | "available" | "createdAt" | "byteSize">
      & { blob: Blob },
  ): Promise<OutputRecord> {
    const id = this.createOutputId();
    const storageKey = outputStoreKey(id);
    const written = await this.store.write(storageKey, input.blob);

    const record = outputRecordSchema.parse({
      ...input,
      id,
      schemaVersion: 1,
      byteSize: written.byteSize,
      storageKey,
      available: true,
      warnings: written.durable
        ? input.warnings
        : [...input.warnings, "This output is held in memory only because durable storage was unavailable. Download it before reloading."],
      createdAt: this.now().toISOString(),
    });

    await this.database.outputs.put(record);
    this.notify(record.projectId);
    return record;
  }

  async readOutput(outputId: string): Promise<Blob> {
    const record = await this.getOutput(outputId);
    const blob = await this.store.read(record.storageKey);
    if (!blob) {
      await this.database.outputs.put({ ...record, available: false });
      this.notify(record.projectId);
      throw new ProjectError("ASSET_SOURCE_UNAVAILABLE", "That output's file is no longer stored in this browser. Render it again.");
    }
    return blob;
  }

  async deleteOutput(outputId: string): Promise<void> {
    const record = await this.getOutput(outputId);
    await this.store.remove(record.storageKey);
    await this.database.outputs.delete(outputId);
    this.notify(record.projectId);
  }

  /** Marks outputs whose bytes have gone, so a stale list never offers a broken download. */
  async refreshAvailability(projectId: string): Promise<OutputRecord[]> {
    const records = await this.listOutputs(projectId, 200);
    const updated: OutputRecord[] = [];
    for (const record of records) {
      const present = Boolean(await this.store.read(record.storageKey));
      if (present !== record.available) {
        const next = { ...record, available: present };
        await this.database.outputs.put(next);
        updated.push(next);
      }
    }
    if (updated.length) this.notify(projectId);
    return updated;
  }

  async totalBytes(): Promise<number> {
    return this.store.totalBytes();
  }

  private notify(projectId: string): void {
    this.listeners.get(projectId)?.forEach((listener) => listener());
  }
}
