import type { EstroDatabase } from "../data/estro-database";
import {
  ASSET_SCHEMA_VERSION,
  assetRecordSchema,
  assetSearchSchema,
  describeActiveFilters,
  describeReplacementLosses,
  hasProxy,
  isDurableLocator,
  matchedFields,
  searchAssetRecords,
  type AssetRecord,
  type AssetReference,
  type AssetSearch,
  type DerivativeRef,
  type SourceLocator,
} from "../domain/asset";
import { ProjectError, toProjectError } from "../domain/project-error";
import { sanitizeAssetName, type ImageProbeDeps } from "../media/image-probe";
import {
  classifyEditability, hashSampleFor, probeMedia, type TimedMediaProbeDeps,
} from "../media/media-probe";
import {
  THUMBNAIL_EDGE_PX, proxyEdgeFor, rasterizeDownscaled,
  type PreviewQuality, type RasterizeDeps,
} from "../media/image-derivatives";
import type { ResampleAlgorithm } from "../workers/worker-protocol";
import {
  createOpfsDerivedCache, derivedCacheKey, type DerivedCache, type DerivedCacheEntry,
} from "../data/derived-cache";
import {
  createOpfsSourceStore, sourceStoreKey, type SourceStore,
} from "../data/source-store";
import { formatBytes } from "../data/storage-quota";
import type { SourceIntentRecord, SourceMigrationRecord } from "../data/source-intent";
import { createUnavailableWorkerClient, type MediaWorkerClient } from "../media/worker-client";
import type {
  HashTaskResult, RasterizeTaskResult, ResampleTaskResult, WaveformTaskResult,
} from "../workers/worker-protocol";
import type { ProjectMutationResult, ProjectService, ProjectCommandContext } from "./project-service";
import type { JobContext, JobService } from "./job-service";

export interface AssetImportRequest {
  file: File;
  handle?: FileSystemFileHandle | null;
  /** Relative folder captured during a folder import; organization only, never a real path. */
  importPath?: string | null;
  /** Set when the user has deliberately chosen not to make a durable copy. */
  sessionOnly?: boolean;
}

export interface AssetImportOutcome {
  assetId: string | null;
  name: string;
  imported: boolean;
  durability: SourceLocator["locatorType"];
  editability: AssetRecord["editability"];
  warnings: string[];
  reason?: string;
}

/**
 * Handle persistence is the one part of the asset path that depends on a browser-only
 * structured-cloneable type. Isolating it keeps the rest of the service testable and makes
 * the storage assumption explicit rather than buried in a table write.
 */
export interface AssetSourceStore {
  put: (assetId: string, projectId: string, handle: FileSystemFileHandle | null) => Promise<void>;
  get: (assetId: string) => Promise<FileSystemFileHandle | null>;
  delete: (assetId: string) => Promise<void>;
}

export interface AssetServiceOptions {
  now?: () => Date;
  createAssetId?: () => string;
  probeDeps?: ImageProbeDeps;
  timedProbeDeps?: TimedMediaProbeDeps;
  handleStore?: AssetSourceStore;
  /** Legacy alias kept so existing composition and tests keep working. */
  sourceStore?: AssetSourceStore;
  originalStore?: SourceStore;
  derivedCache?: DerivedCache;
  rasterizeDeps?: RasterizeDeps;
  worker?: MediaWorkerClient;
}

export interface AssetSearchResult {
  records: AssetRecord[];
  totalCount: number;
  matchedCount: number;
  activeFilters: string[];
  matches: Record<string, string[]>;
}

/** Peak pyramids are cached as JSON in the derived store, keyed by source revision. */
export interface WaveformData {
  tiers: { buckets: number; peaks: number[][] }[];
  sampleRateHz: number;
  channels: number;
  durationSeconds: number;
  sourceRevision: number;
}

const WAVEFORM_TIERS = [256, 2048, 16384];

/** How many unfinished imports keep their chosen files available for a retry. */
const MAX_PENDING_IMPORTS = 16;

/** Keyed by algorithm and target size, so two different choices never share one derivative. */
function resampleKey(
  assetId: string,
  sourceRevision: number,
  options: { targetWidthPx: number; targetHeightPx: number; algorithm: ResampleAlgorithm },
): string {
  return derivedCacheKey("preview", assetId, `resample_${options.algorithm}_${options.targetWidthPx}x${options.targetHeightPx}_r${sourceRevision}`);
}

/** Transient import inputs a browser will not give back after a reload. */
type PendingImport =
  | { kind: "files"; projectId: string; requests: AssetImportRequest[]; context: ProjectCommandContext }
  | { kind: "folder"; projectId: string; directory: FileSystemDirectoryHandle; maxDepth: number; context: ProjectCommandContext };

/**
 * Owns asset identity, durability, and availability.
 *
 * Ingestion is staged: the original bytes are written and read back before any project
 * revision points at them, so history can never reference media that is not there. Originals
 * live in their own durable store, derivatives in a quota-bounded cache, and the two never
 * share a key — which is what stops an imported file from being evicted like a thumbnail.
 */
export class AssetService {
  private readonly now: () => Date;
  private readonly createAssetId: () => string;
  private readonly probeDeps?: ImageProbeDeps;
  private readonly timedProbeDeps?: TimedMediaProbeDeps;
  private readonly handles: AssetSourceStore;
  private readonly originals: SourceStore;
  private readonly cache: DerivedCache;
  private readonly rasterizeDeps?: RasterizeDeps;
  private readonly worker: MediaWorkerClient;
  private readonly listeners = new Map<string, Set<() => void>>();
  /**
   * Files and directory handles an import is holding, keyed by the work ID recorded in the
   * job's intent rather than by job kind. Keying by kind is what let a second import replace
   * the runner a first import would retry with.
   */
  private readonly pendingImports = new Map<string, PendingImport>();
  private indexHydrated = false;

  constructor(
    private readonly database: EstroDatabase,
    private readonly projects: ProjectService,
    private readonly jobs: JobService,
    options: AssetServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.createAssetId = options.createAssetId ?? (() => crypto.randomUUID());
    this.probeDeps = options.probeDeps;
    this.timedProbeDeps = options.timedProbeDeps;
    this.handles = options.handleStore ?? options.sourceStore ?? createIndexedDbHandleStore(database);
    this.originals = options.originalStore ?? createOpfsSourceStore();
    this.cache = options.derivedCache ?? createOpfsDerivedCache();
    this.rasterizeDeps = options.rasterizeDeps;
    this.worker = options.worker ?? createUnavailableWorkerClient();

    // The derived index is persisted so eviction and staleness survive a reload rather than
    // being rebuilt from a directory listing that cannot tell one revision from another.
    this.cache.onIndexChange((entries) => {
      void this.database.derivedIndex.bulkPut(entries).catch(() => undefined);
    });

    // History decides which assets exist; this service knows whether their bytes are
    // reachable. Registering here keeps the dependency one-way — the project layer never
    // imports this one — while still letting Undo, Redo, and Duplicate stay honest.
    this.projects.registerSourceReconciler({
      reconcile: (projectId) => this.reconcile(projectId),
      cloneAssets: (fromProjectId, toProjectId) => this.cloneAssetsForProject(fromProjectId, toProjectId),
      releaseSources: (projectId) => this.releaseProjectSources(projectId),
    });

    this.registerJobRunners();
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

  /**
   * Restores the derived index and finishes whatever a crash left half-done.
   *
   * Order matters. The source index is re-seated first so recovery can see which bytes
   * really exist; outstanding intents are then finished or undone; only after that are
   * unreferenced staged bytes swept, because an intent that is about to be finished still
   * needs its staged source.
   */
  async hydrate(): Promise<{
    recoveredDerivatives: number;
    discardedStagedSources: number;
    finishedImports: number;
    rolledBackImports: number;
    migratedSources: number;
    offlineAfterMigration: number;
  }> {
    if (this.indexHydrated) {
      return {
        recoveredDerivatives: 0, discardedStagedSources: 0, finishedImports: 0,
        rolledBackImports: 0, migratedSources: 0, offlineAfterMigration: 0,
      };
    }
    this.indexHydrated = true;

    const entries = await this.database.derivedIndex.toArray().catch<DerivedCacheEntry[]>(() => []);
    this.cache.hydrate(entries);

    // Re-seat the in-memory index from the durable records, staged rows included: an
    // interrupted import's bytes are still on disk and its intent may need them. Only the
    // index is restored; the bytes themselves must never be rewritten from here.
    const allSources = await this.database.sourceIndex.toArray().catch(() => []);
    this.originals.hydrateIndex(allSources.map((entry) => ({ ...entry, projectIds: entry.projectIds ?? [entry.projectId] })));

    const recovery = await this.recoverIntents();
    const migration = await this.migrateLegacySources();

    // Whatever is still staged after recovery is debris from an import that never reached a
    // project commit. Removing it is safe precisely because nothing in history points at it.
    const staged = await this.database.sourceIndex.where("state").equals("staging").toArray().catch(() => []);
    for (const entry of staged) {
      await this.originals.discard(entry.key).catch(() => undefined);
      await this.database.sourceIndex.delete(entry.key).catch(() => undefined);
    }

    return {
      recoveredDerivatives: entries.length,
      discardedStagedSources: staged.length,
      finishedImports: recovery.finished,
      rolledBackImports: recovery.rolledBack,
      migratedSources: migration.migrated,
      offlineAfterMigration: migration.offline,
    };
  }

  /* ---------------------------- crash recovery ----------------------------- */

  /**
   * Finishes or undoes every import and relink that was in flight when the tab closed.
   *
   * The decision is made entirely from the recorded state, never from guesswork about what
   * the bytes look like. Before the project commit nothing was observable, so the staged
   * source is discarded. After it, history already references the asset, so rolling back
   * would rewrite the user's own edit; the runtime side is completed instead.
   */
  private async recoverIntents(): Promise<{ finished: number; rolledBack: number }> {
    const intents = await this.database.sourceIntents.toArray().catch<SourceIntentRecord[]>(() => []);
    let finished = 0;
    let rolledBack = 0;

    for (const intent of intents) {
      if (intent.state === "prepared") {
        if (intent.stagedKey) {
          await this.originals.discard(intent.stagedKey).catch(() => undefined);
          await this.database.sourceIndex.delete(intent.stagedKey).catch(() => undefined);
        }
        await this.database.sourceIntents.delete(intent.id).catch(() => undefined);
        rolledBack += 1;
        continue;
      }
      // A handle cannot survive a reload, so a handle-backed asset comes back needing
      // permission rather than pretending the file is still open.
      await this.finalizeIntent(intent, null).catch(() => undefined);
      finished += 1;
    }
    return { finished, rolledBack };
  }

  /**
   * Completes the runtime half of an import or relink. Written to be idempotent so that
   * running it during recovery produces exactly the state a successful first run would.
   */
  private async finalizeIntent(intent: SourceIntentRecord, handle: FileSystemFileHandle | null): Promise<void> {
    let record = intent.record;

    if (intent.stagedKey) {
      const verified = await this.originals.verify(intent.stagedKey);
      if (verified.ok) {
        await this.originals.commit(intent.stagedKey).catch(() => undefined);
        await this.database.sourceIndex.update(intent.stagedKey, { state: "committed" }).catch(() => undefined);
      } else {
        // The revision is already committed, so the asset stays registered — but it is
        // reported offline and relinkable rather than claimed as available.
        record = {
          ...record,
          locator: { locatorType: "unavailable", fileName: record.reference.name },
          availability: "missing",
          availabilityReason: "The copy of this file was interrupted, so it needs relinking.",
        };
        await this.database.sourceIndex.delete(intent.stagedKey).catch(() => undefined);
      }
    } else if (intent.hadHandle && !handle) {
      record = {
        ...record,
        availability: "permission_required",
        availabilityReason: "Estro needs permission to read this file again after reloading.",
      };
    }

    await this.database.assetRecords.put(record);
    if (handle !== null || !intent.hadHandle) {
      await this.handles.put(intent.assetId, intent.projectId, handle).catch(() => undefined);
    }

    // Only now that the new record is durable may the superseded source be released.
    if (intent.previousKey && intent.previousKey !== intent.stagedKey) {
      const released = await this.originals.releaseReference(intent.previousKey, intent.projectId);
      if (released.removed) {
        await this.database.sourceIndex.delete(intent.previousKey).catch(() => undefined);
      } else if (released.entry) {
        await this.database.sourceIndex.update(intent.previousKey, { projectIds: released.entry.projectIds }).catch(() => undefined);
      }
    }

    await this.database.sourceIntents.delete(intent.id).catch(() => undefined);
    this.notify(intent.projectId);
  }

  /**
   * Moves originals out of the pre-v9 layout, where they shared the derived cache with
   * thumbnails and could be evicted like one.
   *
   * The bytes are copied, read back, and indexed before the asset is allowed to call itself
   * available. An asset whose legacy bytes have already been evicted becomes honestly
   * offline with a reason the user can act on, which is the correct outcome rather than a
   * locator pointing at nothing.
   */
  private async migrateLegacySources(): Promise<{ migrated: number; offline: number }> {
    const pending = await this.database.sourceMigrations
      .where("state").equals("pending").toArray()
      .catch<SourceMigrationRecord[]>(() => []);
    let migrated = 0;
    let offline = 0;

    for (const row of pending) {
      const record = await this.database.assetRecords.get([row.projectId, row.assetId]);
      if (!record) {
        await this.database.sourceMigrations.update(row.assetId, { state: "done", reason: "The asset is no longer registered." });
        continue;
      }
      // Already migrated by an earlier interrupted run: finishing is a no-op.
      const existing = this.originals.entry(row.targetKey);
      const blob = existing ? null : await this.cache.readBlob(row.legacyCacheKey).catch(() => null);

      if (!existing && !blob) {
        await this.database.sourceMigrations.update(row.assetId, {
          state: "failed",
          reason: "The original file was not found in the old storage location.",
        });
        await this.database.assetRecords.put({
          ...record,
          locator: { locatorType: "unavailable", fileName: row.fileName },
          availability: "missing",
          availabilityReason:
            "This file was stored in an older layout that no longer holds it. Relink it to continue editing.",
        });
        offline += 1;
        continue;
      }

      try {
        if (blob) {
          if (blob.size !== row.byteSize && row.byteSize > 0) {
            throw new ProjectError("STORAGE_WRITE_FAILED", "The stored copy no longer matches the recorded file size.");
          }
          await this.originals.stage({
            key: row.targetKey, assetId: row.assetId, projectId: row.projectId, blob,
            mediaType: row.mediaType, sourceRevision: row.sourceRevision,
          });
          const verified = await this.originals.verify(row.targetKey);
          if (!verified.ok) throw new ProjectError("STORAGE_WRITE_FAILED", "The moved file could not be read back.");
          await this.originals.commit(row.targetKey);
        }
        await this.database.sourceIndex.put({
          key: row.targetKey, assetId: row.assetId, projectId: row.projectId,
          projectIds: [row.projectId], byteSize: row.byteSize || (blob?.size ?? 0),
          mediaType: row.mediaType, state: "committed", createdAt: Date.now(),
          sourceRevision: row.sourceRevision,
        });
        await this.database.assetRecords.put({
          ...record,
          locator: { locatorType: "opfs-copy", fileName: row.fileName, sourceKey: row.targetKey },
          availability: "available",
          availabilityReason: null,
        });
        await this.database.sourceMigrations.update(row.assetId, { state: "done", reason: null });
        // The old copy goes only after the new one is proven readable and indexed.
        await this.cache.remove(row.legacyCacheKey).catch(() => undefined);
        migrated += 1;
      } catch (error) {
        await this.originals.discard(row.targetKey).catch(() => undefined);
        await this.database.sourceMigrations.update(row.assetId, {
          state: "failed",
          reason: error instanceof Error ? error.message : "The file could not be moved.",
        });
        offline += 1;
      }
    }
    return { migrated, offline };
  }

  /**
   * Brings runtime asset records back in step with project history.
   *
   * Undo, Redo, and durable-revision restore rewrite which assets a project references, but
   * they never touch bytes — and they must not, because the next Redo may need them. This
   * walks the restored head revision and makes every referenced asset resolve honestly:
   * available where its source is present, offline where it is not, and rebuilt from the
   * source index where the runtime record itself went missing.
   */
  async reconcile(projectId: string): Promise<{ repaired: string[]; offline: string[] }> {
    const history = await this.projects.getProjectHistory(projectId);
    const referenced = history.headRevision.state.assets ?? [];
    const records = await this.database.assetRecords.where("projectId").equals(projectId).toArray();
    const byId = new Map(records.map((record) => [record.id, record]));
    const sources = await this.database.sourceIndex.where("assetId").anyOf(referenced.map((asset) => asset.id)).toArray().catch(() => []);
    const repaired: string[] = [];
    const offline: string[] = [];
    const timestamp = this.now().toISOString();

    for (const reference of referenced) {
      const existing = byId.get(reference.id);
      const source = sources.find(
        (entry) => entry.assetId === reference.id && entry.sourceRevision === reference.sourceRevision && entry.state === "committed",
      );

      if (!existing) {
        // History knows about an asset this browser has no runtime record for. Rebuilding it
        // from the source index is what makes an undone removal show up in the library again.
        const editability = classifyEditability(reference.mediaType, reference.kind);
        await this.database.assetRecords.put(
          assetRecordSchema.parse({
            id: reference.id, schemaVersion: ASSET_SCHEMA_VERSION, projectId, reference,
            locator: source
              ? { locatorType: "opfs-copy", fileName: reference.name, sourceKey: source.key }
              : { locatorType: "unavailable", fileName: reference.name },
            availability: source ? "available" : "missing",
            availabilityReason: source ? null : "This file is not available in this browser. Relink it to continue editing.",
            editability: editability.editability,
            editabilityReason: editability.reason,
            derivatives: [], thumbnailCacheKey: null, proxyCacheKey: null,
            importPath: null, binId: null, tags: [], updatedAt: timestamp,
          }),
        );
        (source ? repaired : offline).push(reference.id);
        continue;
      }

      // Undo can move an asset back to an earlier source revision. The runtime record has to
      // follow it, or preview and export would read the newer bytes the user just undid.
      if (existing.reference.sourceRevision !== reference.sourceRevision || existing.reference.contentHash !== reference.contentHash) {
        const locator: SourceLocator = source
          ? { locatorType: "opfs-copy", fileName: reference.name, sourceKey: source.key }
          : existing.locator.locatorType === "file-system-handle"
            ? existing.locator
            : { locatorType: "unavailable", fileName: reference.name };
        await this.database.assetRecords.put({
          ...existing,
          reference,
          locator,
          availability: locator.locatorType === "unavailable" ? "missing" : existing.availability,
          availabilityReason: locator.locatorType === "unavailable"
            ? "The file behind this version of the asset is not stored in this browser. Relink it to continue editing."
            : existing.availabilityReason,
          // Derivatives made from the superseded revision are not evidence about this one.
          derivatives: existing.derivatives.filter((entry) => entry.sourceRevision === reference.sourceRevision),
          thumbnailCacheKey: null,
          proxyCacheKey: null,
          updatedAt: timestamp,
        });
        (locator.locatorType === "unavailable" ? offline : repaired).push(reference.id);
      }
    }

    if (repaired.length || offline.length) this.notify(projectId);
    return { repaired, offline };
  }

  /**
   * Gives a copied project its own runtime asset records pointing at the same originals.
   *
   * Duplicate and Save As must produce an independently openable project without copying
   * gigabytes, so the records are cloned and the source bytes gain a reference rather than a
   * duplicate. Deleting either project later releases only its own claim.
   */
  async cloneAssetsForProject(fromProjectId: string, toProjectId: string): Promise<{ cloned: number; warnings: string[] }> {
    const records = await this.database.assetRecords.where("projectId").equals(fromProjectId).toArray();
    const warnings: string[] = [];
    const timestamp = this.now().toISOString();
    const clones: AssetRecord[] = [];

    for (const record of records) {
      if (record.locator.locatorType === "opfs-copy") {
        const entry = await this.originals.addReference(record.locator.sourceKey, toProjectId);
        if (entry) {
          await this.database.sourceIndex.update(record.locator.sourceKey, { projectIds: entry.projectIds }).catch(() => undefined);
        }
      }
      if (record.locator.locatorType === "session-only") {
        warnings.push(`“${record.reference.name}” was held for this session only, so the copy will need it relinked.`);
      }
      if (record.locator.locatorType === "file-system-handle") {
        warnings.push(`“${record.reference.name}” is linked to a file on disk, so the copy will ask for permission the first time it reads it.`);
      }

      clones.push({
        ...record,
        projectId: toProjectId,
        // A session-only source cannot follow a copy, so the clone says so up front.
        locator: record.locator.locatorType === "session-only"
          ? { locatorType: "unavailable", fileName: record.locator.fileName }
          : record.locator,
        availability: record.locator.locatorType === "session-only" ? "missing" : record.availability,
        availabilityReason: record.locator.locatorType === "session-only"
          ? "This file was held for the original project's session only. Relink it to use it here."
          : record.availabilityReason,
        updatedAt: timestamp,
      });
    }

    if (clones.length) await this.database.assetRecords.bulkPut(clones);

    // The handle itself is shared: it is the same file on disk, and permission is re-checked
    // per read anyway, so the copy asks for access rather than silently inheriting it.
    for (const record of records) {
      const handle = await this.handles.get(record.id).catch(() => null);
      if (handle) await this.handles.put(record.id, toProjectId, handle).catch(() => undefined);
    }

    if (clones.length) this.notify(toProjectId);
    return { cloned: clones.length, warnings };
  }

  /**
   * Releases this project's claim on every original it references and drops its runtime
   * records. Bytes are deleted only when no other project still references them, which is
   * what stops discarding one copy of a project from breaking another.
   */
  async releaseProjectSources(projectId: string): Promise<{ released: number; deleted: number }> {
    const records = await this.database.assetRecords.where("projectId").equals(projectId).toArray();
    let released = 0;
    let deleted = 0;
    for (const record of records) {
      if (record.locator.locatorType !== "opfs-copy") continue;
      const result = await this.originals.releaseReference(record.locator.sourceKey, projectId);
      released += 1;
      if (result.removed) {
        deleted += 1;
        await this.database.sourceIndex.delete(record.locator.sourceKey).catch(() => undefined);
      } else if (result.entry) {
        await this.database.sourceIndex.update(record.locator.sourceKey, { projectIds: result.entry.projectIds }).catch(() => undefined);
      }
    }
    await this.database.assetRecords.bulkDelete(records.map((record) => [record.projectId, record.id]) as unknown as string[]).catch(() => undefined);
    return { released, deleted };
  }

  /**
   * Project history decides which assets exist; the assets table only holds runtime facts
   * about them. Joining the two means an undone removal restores the asset to the library,
   * and a record left behind by a removal stays hidden until history brings it back.
   */
  async listAssets(projectId: string, search: AssetSearch = {}): Promise<AssetRecord[]> {
    return (await this.searchAssets(projectId, search)).records;
  }

  /** The same query the Media Library filters use, with the counts an interface needs. */
  async searchAssets(projectId: string, search: AssetSearch = {}): Promise<AssetSearchResult> {
    const [records, history] = await Promise.all([
      this.database.assetRecords.where("projectId").equals(projectId).toArray(),
      this.projects.getProjectHistory(projectId),
    ]);
    const registered = new Set((history.headRevision.state.assets ?? []).map((asset) => asset.id));
    const binItems = history.headRevision.state.binItems ?? [];

    const visible = records
      .filter((record) => registered.has(record.id))
      .map((record) => {
        // Bin membership is project state, so the runtime record mirrors it for filtering.
        const item = binItems.find((entry) => entry.itemType === "asset" && entry.itemId === record.id);
        return item && item.binId !== record.binId ? { ...record, binId: item.binId } : record;
      });

    const parsed = assetSearchSchema.parse(search);
    const matched = searchAssetRecords(visible, parsed);
    const needle = parsed.query.trim().toLocaleLowerCase();

    return {
      records: matched,
      totalCount: visible.length,
      matchedCount: matched.length,
      activeFilters: describeActiveFilters(parsed),
      matches: Object.fromEntries(matched.map((record) => [record.id, matchedFields(record, needle)])),
    };
  }

  /**
   * Reads one runtime record. Records are per project, so a caller that knows which project
   * it is working in should say so; without it the first record for that asset is returned,
   * which resolves to the same original bytes in every copy of a duplicated project.
   */
  async getAsset(assetId: string, projectId?: string): Promise<AssetRecord> {
    const asset = projectId
      ? await this.database.assetRecords.get([projectId, assetId])
      : await this.database.assetRecords.where("id").equals(assetId).first();
    if (!asset) throw new ProjectError("ASSET_NOT_FOUND", "That asset is not registered in this browser.");
    return asset;
  }

  /* ------------------------------- ingestion ------------------------------- */

  /**
   * Imports run as one cancellable job over many files. A file that cannot be decoded is
   * recorded as a warning and skipped so one bad file never discards a whole import.
   */
  async startImportJob(
    projectId: string,
    requests: AssetImportRequest[],
    context: ProjectCommandContext = {},
  ): Promise<{ jobId: string }> {
    if (!requests.length) {
      throw new ProjectError("INVALID_INPUT", "Choose at least one file to import.", { fieldPath: "files" });
    }
    // The `File` objects cannot be persisted, so they are filed under a work ID that lives in
    // the job's own intent. A retry copies that intent and therefore finds exactly this
    // import's files — never a later import's, which is what a runner registered by kind
    // used to do. After a reload the entry is gone and the job says so honestly.
    const workId = `import_${this.createAssetId()}`;
    this.rememberPendingImport(workId, { projectId, requests, context, kind: "files" });

    const job = await this.jobs.startJob({
      projectId,
      kind: "asset_import",
      label: requests.length === 1 ? `Import ${sanitizeAssetName(requests[0].file.name)}` : `Import ${requests.length} files`,
      stage: "Reading files",
      priority: "user",
      intent: {
        kind: "asset_import",
        payloadVersion: 1,
        payload: {
          workId,
          fileNames: requests.map((request) => sanitizeAssetName(request.file.name)),
          requiresUserFiles: true,
        },
      },
      totalUnits: requests.length,
    });
    return { jobId: job.id };
  }

  /**
   * Walks a chosen directory and imports every supported file it finds. Recursion is depth
   * bounded so a deep or cyclic tree cannot stall the browser, and unsupported files are
   * reported rather than silently dropped.
   */
  async startFolderImportJob(
    projectId: string,
    directory: FileSystemDirectoryHandle,
    context: ProjectCommandContext = {},
    maxDepth = 4,
  ): Promise<{ jobId: string }> {
    const workId = `folder_${this.createAssetId()}`;
    this.rememberPendingImport(workId, { projectId, directory, maxDepth, context, kind: "folder" });

    const job = await this.jobs.startJob({
      projectId, kind: "asset_import", label: `Import folder ${directory.name}`, stage: "Scanning folder",
      priority: "user",
      intent: {
        kind: "asset_import",
        payloadVersion: 1,
        payload: { workId, folderName: directory.name, requiresUserFiles: true },
      },
    });
    return { jobId: job.id };
  }

  /**
   * Holds an import's inputs for as long as a retry could still use them, bounded so a run
   * of failed imports cannot pin every chosen file in memory for the life of the session.
   */
  private rememberPendingImport(workId: string, work: PendingImport): void {
    this.pendingImports.set(workId, work);
    while (this.pendingImports.size > MAX_PENDING_IMPORTS) {
      const oldest = this.pendingImports.keys().next().value;
      if (oldest === undefined) break;
      this.pendingImports.delete(oldest);
    }
  }

  /** Imports the files an in-session work entry is holding. */
  private async runFileImport(
    work: Extract<PendingImport, { kind: "files" }>,
    jobContext: JobContext,
  ): Promise<{ outputIds: string[]; derivativeIds: string[] }> {
    const { projectId, requests, context } = work;
    const outputIds: string[] = [];
    const derivativeIds: string[] = [];
    let completed = 0;

    for (const request of requests) {
      if (jobContext.isCancelled()) break;
      const name = sanitizeAssetName(request.file.name);
      await jobContext.report({ stage: `Reading ${name}`, completedUnits: completed });
      try {
        const outcome = await this.ingest(projectId, request, context, jobContext);
        if (outcome.assetId) {
          outputIds.push(outcome.assetId);
          for (const warning of outcome.warnings) await jobContext.warn(`${name}: ${warning}`);
          const keys = await this.generateInitialDerivatives(outcome.assetId, request.file, jobContext.signal)
            .catch(async (error) => {
              await jobContext.warn(`${name}: preview unavailable. ${toProjectError(error).message}`);
              return [] as string[];
            });
          derivativeIds.push(...keys);
          await jobContext.recordDerivatives(keys);
        }
      } catch (error) {
        // One unreadable file must not discard the rest of the import.
        await jobContext.warn(`${name}: ${toProjectError(error).message}`);
      }
      completed += 1;
      await jobContext.report({ stage: `Imported ${completed} of ${requests.length}`, completedUnits: completed });
    }
    this.notify(projectId);
    return { outputIds, derivativeIds };
  }

  /** Walks a directory handle and imports what it holds. */
  private async runFolderImport(
    work: Extract<PendingImport, { kind: "folder" }>,
    jobContext: JobContext,
  ): Promise<{ outputIds: string[]; derivativeIds: string[] }> {
    const { projectId, directory, maxDepth, context } = work;
    const found: { file: File; handle: FileSystemFileHandle; importPath: string }[] = [];

    const walk = async (folder: FileSystemDirectoryHandle, depth: number, path: string): Promise<void> => {
      if (depth > maxDepth || jobContext.isCancelled()) return;
      for await (const entry of (folder as unknown as { values: () => AsyncIterable<FileSystemHandle> }).values()) {
        if (jobContext.isCancelled()) return;
        if (entry.kind === "directory") {
          await walk(entry as FileSystemDirectoryHandle, depth + 1, `${path}${entry.name}/`);
          continue;
        }
        const handle = entry as FileSystemFileHandle;
        const file = await handle.getFile().catch(() => null);
        if (!file) continue;
        // Relative organization is preserved as metadata; the path is never trusted as a
        // filesystem location, only as a label.
        found.push({ file, handle, importPath: path });
        await jobContext.report({ stage: `Found ${found.length} file(s)` });
      }
    };

    await walk(directory, 0, "");
    if (!found.length) {
      await jobContext.warn("No readable files were found in that folder.");
      return { outputIds: [], derivativeIds: [] };
    }

    const outputIds: string[] = [];
    const derivativeIds: string[] = [];
    let completed = 0;
    let skipped = 0;
    for (const candidate of found) {
      if (jobContext.isCancelled()) break;
      const name = sanitizeAssetName(candidate.file.name);
      try {
        const outcome = await this.ingest(
          projectId,
          { file: candidate.file, handle: candidate.handle, importPath: candidate.importPath },
          context,
          jobContext,
        );
        if (outcome.assetId) {
          outputIds.push(outcome.assetId);
          const keys = await this.generateInitialDerivatives(outcome.assetId, candidate.file, jobContext.signal).catch(() => [] as string[]);
          derivativeIds.push(...keys);
        }
      } catch (error) {
        skipped += 1;
        await jobContext.warn(`${name}: ${toProjectError(error).message}`);
      }
      completed += 1;
      await jobContext.report({ stage: `Imported ${completed - skipped} of ${found.length}`, completedUnits: completed, totalUnits: found.length });
    }
    this.notify(projectId);
    return { outputIds, derivativeIds };
  }

  /** Single-file registration, shared by the job runner and by direct calls. */
  async registerOne(
    projectId: string,
    request: AssetImportRequest,
    context: ProjectCommandContext = {},
  ): Promise<AssetImportOutcome> {
    const outcome = await this.ingest(projectId, request, context);
    if (outcome.assetId) {
      // The batch import path builds a thumbnail and a waveform; this one did not, so a file
      // brought in singly — which is every import an agent triggers and every file dropped on
      // its own — showed a generic icon in the library for ever. Best-effort on purpose: an
      // asset whose preview could not be built is still imported, and says so in its record.
      await this.generateInitialDerivatives(outcome.assetId, request.file).catch(() => undefined);
    }
    return outcome;
  }

  /**
   * The staged ingestion pipeline.
   *
   * Order matters and is the whole point: validate, reserve, write, read back, probe, and
   * only then commit the project revision. If anything fails before the commit the staged
   * bytes are discarded, so history never gains a reference to media that is not there.
   */
  /**
   * Writes the original bytes, proves they can be read back, and reports how durable the
   * result actually is. Shared by import and relink so both make the same promise.
   */
  private async stageSource(input: {
    assetId: string;
    projectId: string;
    name: string;
    file: File;
    mediaType: string;
    sourceRevision: number;
    handle: FileSystemFileHandle | null;
    sessionOnly: boolean;
    report?: (progress: { stage: string }) => Promise<void>;
  }): Promise<{ locator: SourceLocator; stagedKey: string | null; warnings: string[] }> {
    const warnings: string[] = [];

    if (input.sessionOnly) {
      warnings.push("You chose to keep this file for this session only, so it will need relinking after a reload.");
      return { locator: { locatorType: "session-only", fileName: input.name }, stagedKey: null, warnings };
    }
    if (!this.originals.available) {
      warnings.push("This browser provides no durable private storage, so this file is held for this session only and will need relinking after a reload.");
      return { locator: { locatorType: "session-only", fileName: input.name }, stagedKey: null, warnings };
    }

    /*
     * A handle is kept when we have one, but it is never the only copy.
     *
     * A handle always reflects the file as it is on disk, which is genuinely better than a
     * copy — but it needs a user gesture to re-authorise after every reload, and a file the
     * person moves or deletes is simply gone. Relying on it alone meant every file chosen
     * through the picker came back needing a relink on the next visit, while the same file
     * dragged onto the window survived, which is an absurd difference for a person to hit.
     * So the bytes are always copied, and the handle rides along as a freshness optimisation.
     */
    await input.report?.({ stage: `Storing ${input.name}` });
    const key = sourceStoreKey(input.assetId, input.sourceRevision);
    const reservation = await this.originals.reserve(input.file.size);
    if (!reservation.granted) {
      warnings.push(
        reservation.reason
          ?? `There is not enough durable storage for ${formatBytes(input.file.size)}, so this file is held for this session only.`,
      );
      return { locator: { locatorType: "session-only", fileName: input.name }, stagedKey: null, warnings };
    }

    await this.originals.stage({
      key, assetId: input.assetId, projectId: input.projectId, blob: input.file,
      mediaType: input.mediaType, sourceRevision: input.sourceRevision,
    });
    await this.database.sourceIndex.put({
      key, assetId: input.assetId, projectId: input.projectId, projectIds: [input.projectId],
      byteSize: input.file.size, mediaType: input.mediaType,
      state: "staging", createdAt: Date.now(), sourceRevision: input.sourceRevision,
    });

    // Read back before anything is allowed to call this durable. A write that cannot be
    // read is cleaned up here, where the key is known, rather than being left for a caller
    // that has not been handed it yet.
    const verified = await this.originals.verify(key);
    if (!verified.ok) {
      await this.originals.discard(key).catch(() => undefined);
      await this.database.sourceIndex.delete(key).catch(() => undefined);
      throw new ProjectError(
        "STORAGE_WRITE_FAILED",
        `“${input.name}” was written to private storage but could not be read back, so it was not imported.`,
      );
    }
    return { locator: { locatorType: "opfs-copy", fileName: input.name, sourceKey: key }, stagedKey: key, warnings };
  }

  /**
   * Imports one file as a recoverable transaction across two stores.
   *
   * IndexedDB and the origin private file system cannot share a native transaction, so the
   * operation is written down before it starts and finished in a fixed order: stage and
   * verify the bytes, record the intent, commit the project revision, then complete the
   * runtime record. A crash at any point leaves exactly one of two honest outcomes — no
   * asset at all, or an asset whose runtime state startup recovery finishes.
   */
  private async ingest(
    projectId: string,
    request: AssetImportRequest,
    context: ProjectCommandContext,
    jobContext?: { report: (progress: { stage: string }) => Promise<void>; signal: AbortSignal },
  ): Promise<AssetImportOutcome> {
    const name = sanitizeAssetName(request.file.name);
    const assetId = this.createAssetId();
    const warnings: string[] = [];
    let stagedKey: string | null = null;
    let intentId: string | null = null;
    let projectCommitted = false;

    try {
      // 1. Validate the declared file against what it really contains.
      await jobContext?.report({ stage: `Inspecting ${name}` });
      const probed = await probeMedia(request.file, { image: this.probeDeps, timed: this.timedProbeDeps });
      warnings.push(...probed.warnings);

      // 2-4. Reserve, write, and read the original back.
      const staged = await this.stageSource({
        assetId, projectId, name, file: request.file, mediaType: probed.mediaType,
        sourceRevision: 1, handle: request.handle ?? null, sessionOnly: request.sessionOnly ?? false,
        report: jobContext?.report,
      });
      stagedKey = staged.stagedKey;
      warnings.push(...staged.warnings);

      // 5. Hash off the interaction thread where a worker exists.
      const contentHash = await this.hashOffThread(request.file, probed.contentHash, jobContext?.signal);

      const timestamp = this.now().toISOString();
      const reference: AssetReference = {
        id: assetId,
        schemaVersion: ASSET_SCHEMA_VERSION,
        name,
        mediaType: probed.mediaType,
        byteSize: probed.byteSize,
        widthPx: probed.widthPx,
        heightPx: probed.heightPx,
        contentHash,
        sourceRevision: 1,
        addedAt: timestamp,
        kind: probed.kind,
        durationSeconds: probed.durationSeconds,
        frameRate: probed.frameRate,
        hasAudio: probed.hasAudio,
        hasVideo: probed.hasVideo,
        streams: probed.streams,
      };

      const editability = classifyEditability(probed.mediaType, probed.kind);
      if (editability.reason) warnings.push(editability.reason);

      const record = assetRecordSchema.parse({
        id: assetId,
        schemaVersion: ASSET_SCHEMA_VERSION,
        projectId,
        reference,
        locator: staged.locator,
        availability: editability.editability === "unsupported" ? "unsupported" : "available",
        availabilityReason: editability.editability === "unsupported" ? editability.reason : null,
        editability: editability.editability,
        editabilityReason: editability.reason,
        derivatives: [],
        thumbnailCacheKey: null,
        proxyCacheKey: null,
        importPath: request.importPath ?? null,
        binId: null,
        tags: [],
        updatedAt: timestamp,
      });

      // 6. Write the recovery record before the first observable change.
      intentId = `intent_import_${assetId}`;
      const intent: SourceIntentRecord = {
        id: intentId, kind: "import", assetId, projectId, stagedKey,
        previousKey: null, record, hadHandle: Boolean(request.handle),
        state: "prepared", createdAt: Date.now(),
      };
      await this.database.sourceIntents.put(intent);

      // 7. Commit the project revision now that the source is proven readable.
      await this.projects.registerAsset({ projectId, asset: reference }, context);
      projectCommitted = true;
      await this.database.sourceIntents.update(intentId, { state: "projectCommitted" });

      // 8. Complete the runtime half. Idempotent, so recovery repeats it safely.
      await this.finalizeIntent({ ...intent, state: "projectCommitted" }, request.handle ?? null);

      const finished = await this.database.assetRecords.get([projectId, assetId]);
      const durability = finished?.locator.locatorType ?? staged.locator.locatorType;
      if (durability === "unavailable") {
        warnings.push("The stored copy could not be confirmed, so this file needs relinking before it can be edited.");
      }

      this.notify(projectId);
      return {
        assetId, name, imported: true, warnings,
        durability, editability: editability.editability,
      };
    } catch (error) {
      // A failure before the project commit leaves nothing behind: no staged bytes, no
      // ghost asset, no intent. After it, the intent stays so recovery can finish the job
      // rather than a rollback rewriting history the user can see.
      if (!projectCommitted) {
        if (stagedKey) {
          await this.originals.discard(stagedKey).catch(() => undefined);
          await this.database.sourceIndex.delete(stagedKey).catch(() => undefined);
        }
        if (intentId) await this.database.sourceIntents.delete(intentId).catch(() => undefined);
      }
      throw toProjectError(error);
    }
  }

  private async hashOffThread(file: File, fallback: string, signal?: AbortSignal): Promise<string> {
    if (!this.worker.available) return fallback;
    try {
      const bytes = await hashSampleFor(file);
      const result = await this.worker.run<HashTaskResult>("hash", { bytes, declaredByteSize: file.size }, {
        signal, transfer: [bytes],
      });
      return result.contentHash;
    } catch {
      return fallback;
    }
  }

  /* ------------------------------ availability ----------------------------- */

  /**
   * Re-checks whether each source can still be read. A durable copy or a permission-backed
   * handle survives a reload; a deliberately session-only reference does not, and says so.
   */
  async refreshAvailability(projectId: string): Promise<AssetRecord[]> {
    await this.hydrate();
    const records = await this.listAssets(projectId, { limit: 500 });
    const updated: AssetRecord[] = [];

    for (const record of records) {
      const next = await this.evaluateAvailability(record, await this.handles.get(record.id));
      if (next.availability !== record.availability || next.availabilityReason !== record.availabilityReason) {
        const stored = assetRecordSchema.parse({ ...record, ...next, updatedAt: this.now().toISOString() });
        await this.database.assetRecords.put(stored);
        updated.push(stored);
      }
    }

    if (updated.length) this.notify(projectId);
    return updated;
  }

  private async evaluateAvailability(
    record: AssetRecord,
    handle: FileSystemFileHandle | null,
  ): Promise<Pick<AssetRecord, "availability" | "availabilityReason">> {
    if (record.editability === "unsupported") {
      return { availability: "unsupported", availabilityReason: record.editabilityReason };
    }

    /*
     * A handle is the better answer when it works, and never the last word when it does not.
     *
     * After a reload a stored handle reverts to needing permission, so asking it first and
     * reporting whatever it says would mark a file offline that is sitting in private storage
     * a few lines below. The handle is tried; anything short of success is remembered and the
     * durable copy is consulted, which is the whole reason the copy exists.
     */
    let permissionBlocked = false;
    if (handle) {
      try {
        const permission = await handle.queryPermission?.({ mode: "read" });
        if (permission === "denied") {
          permissionBlocked = true;
        } else {
          await handle.getFile();
          return { availability: "available", availabilityReason: null };
        }
      } catch (error) {
        permissionBlocked = toProjectError(error).code === "ASSET_PERMISSION_REQUIRED";
      }
    }

    if (record.locator.locatorType === "opfs-copy") {
      const copy = await this.originals.read(record.locator.sourceKey);
      if (copy) return { availability: "available", availabilityReason: null };
      return {
        availability: "missing",
        availabilityReason: "The durable copy of this file is no longer in private storage. Relink it to continue.",
      };
    }

    // Only now, with no copy to fall back on, does a blocked handle decide the answer: the
    // file is not gone, it is unreadable until the person grants access again.
    if (permissionBlocked) {
      return { availability: "permission_required", availabilityReason: "Estro needs permission to read this file again." };
    }

    if (record.locator.locatorType === "remote") {
      return { availability: "missing", availabilityReason: "Estro cannot read remote sources yet. Relink this asset to a local file." };
    }

    return {
      availability: "missing",
      availabilityReason: record.locator.locatorType === "session-only"
        ? "This file was kept for one session only, so Estro cannot reopen it after a reload. Relink it to continue."
        : "The original file could not be found at its saved location.",
    };
  }

  /* --------------------------- relink and replace -------------------------- */

  /**
   * Points an existing logical asset at new bytes without disturbing anything referencing it.
   *
   * The old source is kept until the replacement is durably committed, and only derivatives
   * belonging to the superseded revision are invalidated — a newer preview is not thrown away
   * because an older one went stale.
   */
  /**
   * Points an asset at different bytes without ever being without a usable source.
   *
   * The order is the whole point: the replacement is written and read back, the intent is
   * recorded, the revision is committed, the runtime record is written, and only then is the
   * previous source released. A failure anywhere before that last step leaves the previous
   * revision and the previous file exactly as they were.
   */
  async relinkAsset(
    assetId: string,
    request: AssetImportRequest,
    context: ProjectCommandContext = {},
  ): Promise<{ result: ProjectMutationResult; losses: string[]; durability: SourceLocator["locatorType"]; invalidatedDerivatives: string[] }> {
    const record = await this.getAsset(assetId);
    const probed = await probeMedia(request.file, { image: this.probeDeps, timed: this.timedProbeDeps });
    const timestamp = this.now().toISOString();
    const nextRevision = record.reference.sourceRevision + 1;
    const name = sanitizeAssetName(request.file.name);
    const warnings: string[] = [...probed.warnings];
    let stagedKey: string | null = null;
    let intentId: string | null = null;
    let projectCommitted = false;

    try {
      const staged = await this.stageSource({
        assetId, projectId: record.projectId, name, file: request.file,
        mediaType: probed.mediaType, sourceRevision: nextRevision,
        handle: request.handle ?? null, sessionOnly: request.sessionOnly ?? false,
      });
      stagedKey = staged.stagedKey;
      warnings.push(...staged.warnings.map((warning) => warning.replace("this file", "this replacement")));

      const contentHash = await this.hashOffThread(request.file, probed.contentHash);
      const next: AssetReference = {
        ...record.reference,
        name,
        mediaType: probed.mediaType,
        byteSize: probed.byteSize,
        widthPx: probed.widthPx,
        heightPx: probed.heightPx,
        contentHash,
        sourceRevision: nextRevision,
        kind: probed.kind,
        durationSeconds: probed.durationSeconds,
        frameRate: probed.frameRate,
        hasAudio: probed.hasAudio,
        hasVideo: probed.hasVideo,
        streams: probed.streams,
      };
      const losses = describeReplacementLosses(record.reference, next);
      const editability = classifyEditability(probed.mediaType, probed.kind);

      const nextRecord = assetRecordSchema.parse({
        ...record,
        reference: next,
        locator: staged.locator,
        availability: editability.editability === "unsupported" ? "unsupported" : "available",
        availabilityReason: editability.editability === "unsupported" ? editability.reason : null,
        editability: editability.editability,
        editabilityReason: editability.reason,
        // Derivatives made from the superseded bytes are stale by definition.
        derivatives: record.derivatives.filter((entry) => entry.sourceRevision >= nextRevision),
        thumbnailCacheKey: null,
        proxyCacheKey: null,
        updatedAt: timestamp,
      });

      intentId = `intent_relink_${assetId}_r${nextRevision}`;
      const intent: SourceIntentRecord = {
        id: intentId, kind: "relink", assetId, projectId: record.projectId, stagedKey,
        previousKey: record.locator.locatorType === "opfs-copy" && record.locator.sourceKey !== stagedKey
          ? record.locator.sourceKey
          : null,
        record: nextRecord, hadHandle: Boolean(request.handle),
        state: "prepared", createdAt: Date.now(),
      };
      await this.database.sourceIntents.put(intent);

      const result = await this.projects.replaceAssetSource(
        { projectId: record.projectId, fromAsset: record.reference, toAsset: next, warnings: [...losses, ...warnings] },
        context,
      );
      projectCommitted = true;
      await this.database.sourceIntents.update(intentId, { state: "projectCommitted" });

      // Writes the new record, then — and only then — releases the old source.
      await this.finalizeIntent({ ...intent, state: "projectCommitted" }, request.handle ?? null);

      const invalidated = await this.cache.invalidateAsset(assetId, nextRevision);
      // Rebuilding a thumbnail immediately keeps the library readable after a relink.
      await this.generateInitialDerivatives(assetId, request.file).catch(() => undefined);

      const finished = await this.database.assetRecords.get([record.projectId, assetId]);
      this.notify(record.projectId);
      return {
        result,
        losses: [...losses, ...warnings],
        durability: finished?.locator.locatorType ?? staged.locator.locatorType,
        invalidatedDerivatives: invalidated,
      };
    } catch (error) {
      if (!projectCommitted) {
        if (stagedKey) {
          await this.originals.discard(stagedKey).catch(() => undefined);
          await this.database.sourceIndex.delete(stagedKey).catch(() => undefined);
        }
        if (intentId) await this.database.sourceIntents.delete(intentId).catch(() => undefined);
      }
      throw toProjectError(error);
    }
  }

  /**
   * Reports what a replacement would change without doing it, so a lossy swap can be
   * confirmed against real numbers rather than accepted blind.
   */
  async proposeReplacement(assetId: string, file: File): Promise<{
    assetId: string;
    current: AssetReference;
    proposed: Omit<AssetReference, "id" | "schemaVersion" | "addedAt">;
    losses: string[];
    affectedLayerIds: string[];
    warnings: string[];
  }> {
    const record = await this.getAsset(assetId);
    const probed = await probeMedia(file, { image: this.probeDeps, timed: this.timedProbeDeps });
    const proposed = {
      name: sanitizeAssetName(file.name),
      mediaType: probed.mediaType,
      byteSize: probed.byteSize,
      widthPx: probed.widthPx,
      heightPx: probed.heightPx,
      contentHash: probed.contentHash,
      sourceRevision: record.reference.sourceRevision + 1,
      kind: probed.kind,
      durationSeconds: probed.durationSeconds,
      frameRate: probed.frameRate,
      hasAudio: probed.hasAudio,
      hasVideo: probed.hasVideo,
      streams: probed.streams,
    };
    const usage = await this.findUsages(record.projectId, assetId);
    return {
      assetId,
      current: record.reference,
      proposed,
      losses: describeReplacementLosses(record.reference, { ...record.reference, ...proposed } as AssetReference),
      affectedLayerIds: usage.layerIds,
      warnings: probed.warnings,
    };
  }

  /** Everywhere in the project that points at this asset. */
  async findUsages(projectId: string, assetId: string): Promise<{ layerIds: string[] }> {
    const history = await this.projects.getProjectHistory(projectId);
    const state = history.headRevision.state;

    const layerIds: string[] = [];
    const walk = (layers: readonly { id: string; kind: string; assetId?: string; children?: unknown[] }[]) => {
      for (const layer of layers) {
        if (layer.kind === "image" && layer.assetId === assetId) layerIds.push(layer.id);
        if (layer.kind === "group") walk((layer.children ?? []) as never);
      }
    };
    walk((state.photoDocument?.layers ?? []) as never);

    return { layerIds };
  }

  async removeAsset(assetId: string, context: ProjectCommandContext = {}): Promise<ProjectMutationResult> {
    const record = await this.getAsset(assetId);
    const result = await this.projects.removeAsset({ projectId: record.projectId, asset: record.reference }, context);
    // The record, its handle, and its original bytes are deliberately kept so Undo can
    // restore a working asset rather than a reference with no readable source.
    this.notify(record.projectId);
    return result;
  }

  async updateTags(assetId: string, tags: string[]): Promise<AssetRecord> {
    const record = await this.getAsset(assetId);
    const next = assetRecordSchema.parse({
      ...record,
      tags: [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 32),
      updatedAt: this.now().toISOString(),
    });
    await this.database.assetRecords.put(next);
    this.notify(record.projectId);
    return next;
  }

  /** Returns the live File for an available asset, or a structured reason it cannot be read. */
  async readAssetFile(assetId: string): Promise<File> {
    const record = await this.getAsset(assetId);
    const handle = await this.handles.get(assetId);
    if (handle) {
      try {
        return await handle.getFile();
      } catch (error) {
        throw toProjectError(error);
      }
    }
    if (record.locator.locatorType === "opfs-copy") {
      const copy = await this.originals.read(record.locator.sourceKey);
      if (copy) return new File([copy], record.locator.fileName, { type: record.reference.mediaType });
    }
    throw new ProjectError(
      "ASSET_SOURCE_UNAVAILABLE",
      record.availabilityReason ?? "This asset's original file is not available. Relink it to continue.",
    );
  }

  /* ------------------------------ derivatives ------------------------------ */

  private async recordDerivative(assetId: string, derivative: DerivativeRef): Promise<void> {
    const record = await this.getAsset(assetId);
    const derivatives = [
      ...record.derivatives.filter((entry) => !(entry.kind === derivative.kind && entry.settings === derivative.settings)),
      derivative,
    ].slice(-64);
    await this.database.assetRecords.put(assetRecordSchema.parse({
      ...record,
      derivatives,
      thumbnailCacheKey: derivative.kind === "thumbnail" ? derivative.key : record.thumbnailCacheKey,
      proxyCacheKey: derivative.kind === "proxy" ? derivative.key : record.proxyCacheKey,
      updatedAt: this.now().toISOString(),
    }));
    this.notify(record.projectId);
  }

  /** Downscales in the worker where one exists, and on the main thread only as a fallback. */
  private async rasterize(
    blob: Blob,
    maxEdgePx: number,
    signal?: AbortSignal,
  ): Promise<{ blob: Blob; width: number; height: number; mediaType: string; ranInWorker: boolean }> {
    if (this.worker.available) {
      try {
        const result = await this.worker.run<RasterizeTaskResult>(
          "rasterize",
          { blob, maxEdgePx, preferredType: "image/webp", quality: 0.82 },
          { signal },
        );
        return { blob: result.blob, width: result.widthPx, height: result.heightPx, mediaType: result.mediaType, ranInWorker: true };
      } catch (error) {
        if (toProjectError(error).code !== "CAPABILITY_UNAVAILABLE") throw error;
      }
    }
    const rendered = await rasterizeDownscaled(blob, maxEdgePx, this.rasterizeDeps);
    return { ...rendered, ranInWorker: false };
  }

  /** Thumbnail now, plus a waveform for anything with audio. Both are reproducible. */
  private async generateInitialDerivatives(assetId: string, source: Blob, signal?: AbortSignal): Promise<string[]> {
    const record = await this.getAsset(assetId);
    const keys: string[] = [];

    if (record.reference.kind === "image" && record.editability !== "unsupported") {
      const key = await this.buildThumbnailFrom(assetId, source, signal);
      if (key) keys.push(key);
    }
    if (record.reference.hasAudio) {
      const key = await this.buildWaveformFrom(assetId, source, signal).catch(() => null);
      if (key) keys.push(key);
    }
    return keys;
  }


  /** Renders and stores a thumbnail from bytes already in hand. */
  private async buildThumbnailFrom(assetId: string, source: Blob, signal?: AbortSignal): Promise<string | null> {
    const record = await this.getAsset(assetId);
    const settings = `edge=${THUMBNAIL_EDGE_PX}`;
    const key = derivedCacheKey("thumbnail", assetId, `${THUMBNAIL_EDGE_PX}r${record.reference.sourceRevision}`);
    const rendered = await this.rasterize(source, THUMBNAIL_EDGE_PX, signal);
    await this.cache.write({
      key, blob: rendered.blob, kind: "thumbnail", assetId, projectId: record.projectId,
      sourceRevision: record.reference.sourceRevision, settings,
      widthPx: rendered.width, heightPx: rendered.height,
    });
    await this.recordDerivative(assetId, { key, kind: "thumbnail", sourceRevision: record.reference.sourceRevision, settings });
    return key;
  }

  /**
   * An asset's audio as raw samples, for anything that has to measure it.
   *
   * Public because loudness, beat detection, and synchronisation all need the same thing and
   * none of them should decode a file a second way. Decoding stays on the main thread because
   * `decodeAudioData` needs an AudioContext; the callers do their own work off it.
   */
  async readAudioSamples(
    assetId: string,
    projectId?: string,
  ): Promise<{ channels: Float32Array[]; sampleRateHz: number; durationSeconds: number }> {
    const record = await this.getAsset(assetId, projectId);
    const AudioContextCtor = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      throw new ProjectError("CAPABILITY_UNAVAILABLE", "This browser cannot decode audio, so it cannot be measured.");
    }
    if (record.reference.streams?.audioPresence === "absent") {
      throw new ProjectError(
        "INVALID_INPUT",
        `“${record.reference.name}” has no audio track, so there is nothing to measure.`,
        { fieldPath: "assetId" },
      );
    }

    const source = await this.readAssetFile(assetId);
    const context = new AudioContextCtor();
    try {
      const decoded = await context.decodeAudioData(await source.arrayBuffer());
      const channels: Float32Array[] = [];
      for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
        channels.push(decoded.getChannelData(channel).slice());
      }
      return { channels, sampleRateHz: decoded.sampleRate, durationSeconds: decoded.duration };
    } catch (error) {
      throw new ProjectError("MEDIA_DECODE_FAILED", `“${record.reference.name}” could not be decoded as audio.`, { cause: error });
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  /**
   * Decodes audio and builds a multiresolution peak pyramid in the worker.
   *
   * Decoding must happen on the main thread because `decodeAudioData` needs an AudioContext,
   * but the pyramid — the part that is O(samples) — is handed straight to the worker.
   */
  private async buildWaveformFrom(assetId: string, source: Blob, signal?: AbortSignal): Promise<string | null> {
    const record = await this.getAsset(assetId);
    const AudioContextCtor = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      throw new ProjectError("CAPABILITY_UNAVAILABLE", "This browser cannot decode audio, so no waveform is available.");
    }

    const context = new AudioContextCtor();
    let decoded: AudioBuffer;
    try {
      decoded = await context.decodeAudioData(await source.arrayBuffer());
    } catch (error) {
      throw new ProjectError("MEDIA_DECODE_FAILED", `“${record.reference.name}” could not be decoded as audio.`, { cause: error });
    } finally {
      await context.close().catch(() => undefined);
    }

    const channelData: Float32Array[] = [];
    for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
      channelData.push(decoded.getChannelData(channel).slice());
    }

    let result: WaveformTaskResult;
    if (this.worker.available) {
      result = await this.worker.run<WaveformTaskResult>(
        "waveform",
        { channelData, sampleRateHz: decoded.sampleRate, tiers: WAVEFORM_TIERS },
        { signal, transfer: channelData.map((data) => data.buffer) },
      );
    } else {
      result = buildWaveformOnMainThread(channelData, decoded.sampleRate, WAVEFORM_TIERS);
    }

    const settings = `tiers=${WAVEFORM_TIERS.join("-")}`;
    const key = derivedCacheKey("waveform", assetId, `peaks_r${record.reference.sourceRevision}`);
    const payload: WaveformData = { ...result, sourceRevision: record.reference.sourceRevision };
    await this.cache.write({
      key, blob: new Blob([JSON.stringify(payload)], { type: "application/json" }),
      kind: "waveform", assetId, projectId: record.projectId,
      sourceRevision: record.reference.sourceRevision, settings,
      durationSeconds: result.durationSeconds, channels: result.channels,
    });
    await this.recordDerivative(assetId, { key, kind: "waveform", sourceRevision: record.reference.sourceRevision, settings });
    return key;
  }

  /** Reads a cached waveform, returning null on a cache miss rather than rebuilding blindly. */
  async readWaveform(assetId: string): Promise<WaveformData | null> {
    const record = await this.getAsset(assetId);
    const key = derivedCacheKey("waveform", assetId, `peaks_r${record.reference.sourceRevision}`);
    const hit = await this.cache.read(key);
    if (!hit) return null;
    try {
      const parsed = JSON.parse(await hit.blob.text()) as WaveformData;
      return parsed.sourceRevision === record.reference.sourceRevision ? parsed : null;
    } catch {
      return null;
    }
  }

  async startWaveformJob(assetId: string): Promise<{ jobId: string }> {
    const record = await this.getAsset(assetId);
    const job = await this.jobs.startJob({
      projectId: record.projectId, kind: "waveform",
      label: `Build waveform for ${record.reference.name}`, stage: "Decoding audio",
      priority: "background", targetIds: [assetId],
      intent: { kind: "waveform", payloadVersion: 1, payload: { assetId } },
    });
    return { jobId: job.id };
  }

  async startThumbnailJob(assetId: string): Promise<{ jobId: string }> {
    const record = await this.getAsset(assetId);
    // Audio has no picture to make one from. Video does, through the poster path the runner
    // chooses by kind; refusing audio here is what stops a job that can only fail.
    if (record.reference.kind === "audio") {
      throw new ProjectError("INVALID_INPUT", `“${record.reference.name}” is audio and has no picture to make a thumbnail from. Generate a waveform instead.`, { fieldPath: "assetId" });
    }
    if (record.editability === "unsupported") {
      throw new ProjectError("CAPABILITY_UNAVAILABLE", `This browser cannot decode “${record.reference.name}”, so no thumbnail can be made from it.`);
    }
    const job = await this.jobs.startJob({
      projectId: record.projectId, kind: "thumbnail",
      label: `Build thumbnail for ${record.reference.name}`, stage: "Decoding",
      priority: "background", targetIds: [assetId],
      intent: { kind: "thumbnail", payloadVersion: 1, payload: { assetId } },
    });
    return { jobId: job.id };
  }

  /** Generates an optimized copy sized for the requested preview tier. */
  /**
   * Queues a real resampling pass.
   *
   * Image resize used to scale a layer's transform and describe that as resampling with a
   * chosen algorithm. It was not: the pixels were never touched and the algorithm was never
   * recorded. This runs the interpolation the user asked for over the original bytes and
   * stores the result as a reproducible derivative keyed by algorithm and target size.
   */
  async startResampleJob(
    assetId: string,
    options: { targetWidthPx: number; targetHeightPx: number; algorithm: ResampleAlgorithm },
  ): Promise<{ jobId: string }> {
    const record = await this.getAsset(assetId);
    if (record.reference.kind !== "image") {
      throw new ProjectError("INVALID_INPUT", "Only an image can be resampled.", { fieldPath: "assetId" });
    }
    const job = await this.jobs.startJob({
      projectId: record.projectId, kind: "image_resample",
      label: `Resample ${record.reference.name} to ${options.targetWidthPx} × ${options.targetHeightPx}`,
      stage: "Reading the original",
      priority: "background", targetIds: [assetId],
      sourceRevisionId: String(record.reference.sourceRevision),
      intent: {
        kind: "image_resample", payloadVersion: 1,
        payload: { assetId, ...options },
      },
    });
    return { jobId: job.id };
  }

  /** The resampled derivative for a target size, when one has been generated. */
  async readResampled(
    assetId: string,
    options: { targetWidthPx: number; targetHeightPx: number; algorithm: ResampleAlgorithm },
  ): Promise<Blob | null> {
    const record = await this.getAsset(assetId).catch(() => null);
    if (!record) return null;
    return this.cache.readBlob(resampleKey(assetId, record.reference.sourceRevision, options));
  }

  async startProxyJob(assetId: string, quality: PreviewQuality): Promise<{ jobId: string }> {
    const record = await this.getAsset(assetId);
    const edge = proxyEdgeFor(quality);
    if (edge === 0) {
      throw new ProjectError("INVALID_INPUT", "Full quality uses the original file and needs no proxy.", { fieldPath: "quality" });
    }
    const job = await this.jobs.startJob({
      projectId: record.projectId, kind: "proxy",
      label: `Generate ${quality} proxy for ${record.reference.name}`, stage: "Decoding",
      priority: "background", targetIds: [assetId],
      intent: { kind: "proxy", payloadVersion: 1, payload: { assetId, quality } },
    });
    return { jobId: job.id };
  }

  /**
   * Registers the executors for every derivative job kind.
   *
   * Registration by kind is what makes retry and reload recovery real: a job record carries
   * its arguments, and the runner is found here rather than in a closure that died with the
   * previous page.
   */
  private registerJobRunners(): void {
    this.jobs.registerRunner("thumbnail", async (context, intent) => {
      const assetId = String(intent.payload.assetId ?? "");
      const record = await this.getAsset(assetId);
      const file = await this.readAssetFile(assetId);
      if (context.isCancelled()) return {};
      await context.report({ stage: "Resizing" });
      const key = await this.buildThumbnailFrom(assetId, file, context.signal);
      return { derivativeIds: key ? [key] : [], ranInWorker: this.worker.available };
    });

    /**
     * A larger preview for a photograph.
     *
     * Kept as a job rather than done inline because resampling a 24-megapixel image is real
     * work, and a job can report progress and be cancelled. It writes a thumbnail-kind
     * derivative at a bigger edge: there is one kind of preview for a photograph, and calling
     * the larger one something else would only invite two code paths for one idea.
     */
    this.jobs.registerRunner("proxy", async (context, intent) => {
      const assetId = String(intent.payload.assetId ?? "");
      const quality = String(intent.payload.quality ?? "balanced") as PreviewQuality;
      const record = await this.getAsset(assetId);
      const edge = proxyEdgeFor(quality);
      const file = await this.readAssetFile(assetId);
      if (context.isCancelled()) return {};

      await context.report({ stage: `Building a ${edge}px preview` });
      const settings = `quality=${quality};edge=${edge}`;
      const key = derivedCacheKey("thumbnail", assetId, `${quality}_r${record.reference.sourceRevision}`);
      const rendered = await this.rasterize(file, edge, context.signal);
      if (context.isCancelled()) return {};

      await this.cache.write({
        key, blob: rendered.blob, kind: "thumbnail", assetId, projectId: record.projectId,
        sourceRevision: record.reference.sourceRevision, settings,
        widthPx: rendered.width, heightPx: rendered.height,
      });
      await this.recordDerivative(assetId, { key, kind: "thumbnail", sourceRevision: record.reference.sourceRevision, settings });
      return { derivativeIds: [key], ranInWorker: rendered.ranInWorker };
    });

    this.jobs.registerRunner("waveform", async (context, intent) => {
      const assetId = String(intent.payload.assetId ?? "");
      const file = await this.readAssetFile(assetId);
      if (context.isCancelled()) return {};
      await context.report({ stage: "Building peaks" });
      const key = await this.buildWaveformFrom(assetId, file, context.signal);
      return { derivativeIds: key ? [key] : [], ranInWorker: this.worker.available };
    });

    // Import needs the user's own File objects, which cannot be persisted. The runner exists
    // so the record is legible, but it refuses honestly instead of pretending to retry.
    // One runner for every import, registered once. It finds its inputs through the work ID
    // in the job's own intent, so a retry repeats that job's files and no other's.
    this.jobs.registerRunner("asset_import", async (jobContext, intent) => {
      const workId = typeof intent.payload.workId === "string" ? intent.payload.workId : null;
      const work = workId ? this.pendingImports.get(workId) : undefined;
      if (!work) {
        throw new ProjectError(
          "JOB_NOT_RETRYABLE",
          "This import needs the files you chose, and a browser only grants file access from a fresh user action. Choose them again to continue.",
        );
      }
      const result = work.kind === "files"
        ? await this.runFileImport(work, jobContext)
        : await this.runFolderImport(work, jobContext);
      // The entry is released only once the work is genuinely finished. A failed or
      // cancelled import keeps its files so Retry repeats that import rather than refusing
      // it while the chosen files are still in memory.
      if (workId && !jobContext.isCancelled()) this.pendingImports.delete(workId);
      return result;
    });
  }

  /** Convenience for the UI: wait for an import job it started and read the outcome. */
  async waitForImport(jobId: string) {
    return this.jobs.waitForJob(jobId);
  }

  /**
   * Renders a bounded preview of one asset at a named quality.
   *
   * A cache hit returns the derivative's own dimensions, never the original's. Reporting the
   * source size for a 640px proxy is how a caller ends up compositing against a frame that
   * does not exist.
   */
  async renderPreview(assetId: string, quality: PreviewQuality): Promise<{
    key: string;
    width: number; height: number;
    mediaType: string; revisionId: string; byteSize: number;
    sourceRevision: number;
    fromCache: boolean;
    usedProxy: boolean;
    requestedQuality: PreviewQuality;
    effectiveQuality: PreviewQuality;
    warnings: string[];
  }> {
    const record = await this.getAsset(assetId);
    const history = await this.projects.getProjectHistory(record.projectId);
    const edge = proxyEdgeFor(quality);
    const settings = `quality=${quality};edge=${edge}`;
    const key = derivedCacheKey("preview", assetId, `${quality}_r${record.reference.sourceRevision}`);
    const warnings: string[] = [];

    const cached = await this.cache.read(key);
    if (cached && cached.entry.sourceRevision === record.reference.sourceRevision) {
      return {
        key,
        // Actual derivative dimensions, recorded when it was written.
        width: cached.entry.widthPx ?? record.reference.widthPx,
        height: cached.entry.heightPx ?? record.reference.heightPx,
        mediaType: cached.entry.mediaType,
        revisionId: history.headRevision.id,
        byteSize: cached.entry.byteSize,
        sourceRevision: cached.entry.sourceRevision,
        fromCache: true,
        usedProxy: edge > 0,
        requestedQuality: quality,
        effectiveQuality: quality,
        warnings,
      };
    }

    if (record.availability !== "available") {
      throw new ProjectError("ASSET_SOURCE_UNAVAILABLE", record.availabilityReason ?? "This asset's source is not available.");
    }

    const file = await this.readAssetFile(assetId);
    const rendered = await this.rasterize(file, edge);
    if (!rendered.ranInWorker && quality === "full") {
      warnings.push("This browser has no media worker, so the full-quality preview was rendered on the interface thread.");
    }
    await this.cache.write({
      key, blob: rendered.blob, kind: "preview", assetId, projectId: record.projectId,
      sourceRevision: record.reference.sourceRevision, settings,
      widthPx: rendered.width, heightPx: rendered.height,
    });
    await this.recordDerivative(assetId, { key, kind: "preview", sourceRevision: record.reference.sourceRevision, settings });

    return {
      key, width: rendered.width, height: rendered.height, mediaType: rendered.mediaType,
      revisionId: history.headRevision.id, byteSize: rendered.blob.size,
      sourceRevision: record.reference.sourceRevision,
      fromCache: false, usedProxy: edge > 0,
      requestedQuality: quality, effectiveQuality: quality, warnings,
    };
  }

  async readDerived(key: string): Promise<Blob | null> {
    return this.cache.readBlob(key);
  }

  async derivedEntry(key: string): Promise<DerivedCacheEntry | null> {
    return this.cache.entry(key);
  }

  /** Storage the project is using, split by lifecycle so the numbers mean something. */
  async storageReport(projectId: string): Promise<{
    originalBytes: number; derivedBytes: number; derivedBudgetBytes: number;
    durableAssets: number; sessionOnlyAssets: number; derivativeCount: number;
  }> {
    const records = await this.database.assetRecords.where("projectId").equals(projectId).toArray();
    const derived = await this.cache.list();
    return {
      originalBytes: await this.originals.totalBytes(),
      derivedBytes: derived.reduce((total, entry) => total + entry.byteSize, 0),
      derivedBudgetBytes: this.cache.budgetBytes,
      durableAssets: records.filter((record) => isDurableLocator(record.locator)).length,
      sessionOnlyAssets: records.filter((record) => record.locator.locatorType === "session-only").length,
      derivativeCount: derived.length,
    };
  }

  get derivedCacheAvailable(): boolean {
    return this.cache.available;
  }

  get durableSourceStorageAvailable(): boolean {
    return this.originals.available;
  }

  get workerAvailable(): boolean {
    return this.worker.available;
  }

  hasProxyFor(record: AssetRecord): boolean {
    return hasProxy(record);
  }

  private notify(projectId: string): void {
    this.listeners.get(projectId)?.forEach((listener) => listener());
  }
}

/** Main-thread peak pyramid, used only where no worker exists. */
function buildWaveformOnMainThread(
  channelData: Float32Array[],
  sampleRateHz: number,
  tiers: number[],
): WaveformTaskResult {
  const frames = channelData[0]?.length ?? 0;
  return {
    tiers: tiers.map((buckets) => ({
      buckets,
      peaks: channelData.map((channel) => {
        const perBucket = Math.max(1, Math.floor(channel.length / buckets));
        const values = new Array<number>(buckets * 2).fill(0);
        for (let index = 0; index < buckets; index += 1) {
          const start = index * perBucket;
          const end = Math.min(channel.length, start + perBucket);
          let min = 0;
          let max = 0;
          for (let offset = start; offset < end; offset += 1) {
            const value = channel[offset];
            if (value < min) min = value;
            if (value > max) max = value;
          }
          values[index * 2] = min;
          values[index * 2 + 1] = max;
        }
        return values;
      }),
    })),
    sampleRateHz,
    channels: channelData.length,
    durationSeconds: frames / Math.max(1, sampleRateHz),
  };
}

/**
 * Real `FileSystemFileHandle` values are structured-cloneable, so IndexedDB is their natural
 * home. Tests substitute an in-memory store because a hand-written stub is not cloneable.
 */
export function createIndexedDbHandleStore(database: EstroDatabase): AssetSourceStore {
  return {
    put: async (assetId, projectId, handle) => { await database.assetSources.put({ assetId, projectId, handle }); },
    get: async (assetId) => (await database.assetSources.get(assetId))?.handle ?? null,
    delete: async (assetId) => { await database.assetSources.delete(assetId); },
  };
}

export const createIndexedDbSourceStore = createIndexedDbHandleStore;

export function createMemorySourceStore(): AssetSourceStore {
  const handles = new Map<string, FileSystemFileHandle | null>();
  return {
    put: async (assetId, _projectId, handle) => { handles.set(assetId, handle); },
    get: async (assetId) => handles.get(assetId) ?? null,
    delete: async (assetId) => { handles.delete(assetId); },
  };
}
