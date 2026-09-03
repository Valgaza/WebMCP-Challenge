import { ProjectError, toProjectError } from "../domain/project-error";
import { reserveStorage } from "./storage-quota";

/**
 * Durable storage for finished deliveries.
 *
 * Outputs are neither project state nor cache. They persist until explicitly deleted, so a
 * completed render can still be downloaded after a reload rather than living in one
 * in-memory `lastOutput` slot that any refresh discards.
 */
export interface OutputStore {
  available: boolean;
  write: (key: string, blob: Blob) => Promise<{ byteSize: number; durable: boolean }>;
  read: (key: string) => Promise<Blob | null>;
  remove: (key: string) => Promise<void>;
  totalBytes: () => Promise<number>;
}

const OUTPUT_DIRECTORY = "estro-outputs";

export function outputStoreKey(outputId: string): string {
  const safe = outputId.replace(/[^a-z0-9_-]/gi, "").slice(0, 64);
  if (!safe) throw new ProjectError("INVALID_INPUT", "An output key needs a usable output ID.", { fieldPath: "outputId" });
  return `out_${safe}`;
}

export function createOpfsOutputStore(): OutputStore {
  const sizes = new Map<string, number>();
  const memoryFallback = new Map<string, Blob>();
  const available = typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function";

  async function directory(): Promise<FileSystemDirectoryHandle> {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(OUTPUT_DIRECTORY, { create: true });
  }

  return {
    available,
    write: async (key, blob) => {
      if (!available) {
        // Held in memory so the download still works this session, and reported as
        // non-durable so the interface can say the file will not survive a reload.
        memoryFallback.set(key, blob);
        sizes.set(key, blob.size);
        return { byteSize: blob.size, durable: false };
      }
      const reservation = await reserveStorage(blob.size);
      if (!reservation.granted) {
        memoryFallback.set(key, blob);
        sizes.set(key, blob.size);
        return { byteSize: blob.size, durable: false };
      }
      try {
        const handle = await (await directory()).getFileHandle(key, { create: true });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        sizes.set(key, blob.size);
        return { byteSize: blob.size, durable: true };
      } catch (error) {
        const parsed = toProjectError(error);
        if (parsed.code === "STORAGE_QUOTA_EXCEEDED") {
          memoryFallback.set(key, blob);
          sizes.set(key, blob.size);
          return { byteSize: blob.size, durable: false };
        }
        throw parsed;
      }
    },
    read: async (key) => {
      if (memoryFallback.has(key)) return memoryFallback.get(key) ?? null;
      if (!available) return null;
      try {
        const handle = await (await directory()).getFileHandle(key);
        return await handle.getFile();
      } catch {
        return null;
      }
    },
    remove: async (key) => {
      memoryFallback.delete(key);
      sizes.delete(key);
      if (!available) return;
      await (await directory()).removeEntry(key).catch(() => undefined);
    },
    totalBytes: async () => [...sizes.values()].reduce((total, size) => total + size, 0),
  };
}

export function createMemoryOutputStore(): OutputStore {
  const files = new Map<string, Blob>();
  return {
    available: true,
    write: async (key, blob) => { files.set(key, blob); return { byteSize: blob.size, durable: false }; },
    read: async (key) => files.get(key) ?? null,
    remove: async (key) => { files.delete(key); },
    totalBytes: async () => [...files.values()].reduce((total, blob) => total + blob.size, 0),
  };
}
