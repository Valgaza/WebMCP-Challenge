import { ProjectError, toProjectError } from "../domain/project-error";
import { reserveStorage, type StorageReservation } from "./storage-quota";

/**
 * Durable storage for original imported media.
 *
 * This store is deliberately separate from `DerivedCache`. Derivatives are reproducible and
 * may be evicted under quota pressure; originals are not reproducible and must never be. A
 * missing derivative is a cache miss. A missing original is offline media, and the two are
 * never allowed to look the same.
 *
 * Ownership is by reference list rather than by a single project ID. Duplicating a project
 * must not copy gigabytes, and deleting either copy afterwards must not strand the other, so
 * the bytes belong to the set of projects that reference them and are removed only when that
 * set empties.
 */
export interface SourceStoreEntry {
  key: string;
  assetId: string;
  /** The project that first imported these bytes. Kept for reporting, not for ownership. */
  projectId: string;
  /** Every project currently referencing these bytes. Bytes die when this empties. */
  projectIds: string[];
  byteSize: number;
  mediaType: string;
  /** `staging` bytes exist but no project revision points at them yet. */
  state: "staging" | "committed";
  createdAt: number;
  sourceRevision: number;
}

export interface SourceStore {
  available: boolean;
  /** Writes the bytes and records a staging entry. The project must not reference it yet. */
  stage: (input: {
    key: string;
    assetId: string;
    projectId: string;
    blob: Blob;
    mediaType: string;
    sourceRevision: number;
  }) => Promise<SourceStoreEntry>;
  /** Reads the bytes back to prove the original is really there before committing. */
  verify: (key: string) => Promise<{ ok: boolean; byteSize: number }>;
  commit: (key: string) => Promise<SourceStoreEntry>;
  /** Removes a staged write whose import failed before the project revision was committed. */
  discard: (key: string) => Promise<void>;
  /**
   * Restores index entries after a reload without touching the stored bytes.
   *
   * Re-staging a committed source to rebuild the index would write over the original with
   * whatever placeholder the caller passed, which is exactly the kind of silent data loss
   * this store exists to prevent.
   */
  hydrateIndex: (entries: readonly SourceStoreEntry[]) => void;
  /** Adds a project to the reference list. Used by Duplicate and Save As. */
  addReference: (key: string, projectId: string) => Promise<SourceStoreEntry | null>;
  /**
   * Drops one project's claim. The bytes are deleted only when no project is left, which is
   * what stops deleting one copy of a project from breaking the other.
   */
  releaseReference: (key: string, projectId: string) => Promise<{ removed: boolean; entry: SourceStoreEntry | null }>;
  entry: (key: string) => SourceStoreEntry | null;
  read: (key: string) => Promise<Blob | null>;
  /** Unconditional removal. Only for staged bytes and explicit lifecycle cleanup. */
  remove: (key: string) => Promise<void>;
  list: (projectId?: string) => Promise<SourceStoreEntry[]>;
  totalBytes: () => Promise<number>;
  reserve: (bytes: number) => Promise<StorageReservation>;
}

/** Keys become filenames, so they are constrained rather than trusted. */
export function sourceStoreKey(assetId: string, sourceRevision: number): string {
  const safeAsset = assetId.replace(/[^a-z0-9_-]/gi, "").slice(0, 64);
  if (!safeAsset) throw new ProjectError("INVALID_INPUT", "A source key needs a usable asset ID.", { fieldPath: "assetId" });
  return `src_${safeAsset}_r${Math.max(1, Math.floor(sourceRevision))}`;
}

const SOURCE_DIRECTORY = "estro-sources";

function withReference(entry: SourceStoreEntry, projectId: string): SourceStoreEntry {
  return entry.projectIds.includes(projectId)
    ? entry
    : { ...entry, projectIds: [...entry.projectIds, projectId] };
}

/**
 * Backed by the origin private file system. The index is held in memory here and mirrored
 * into IndexedDB by `AssetService`, so a reload rebuilds it from durable records rather than
 * from a directory scan that could not tell staging from committed bytes.
 */
export function createOpfsSourceStore(): SourceStore {
  const index = new Map<string, SourceStoreEntry>();
  const available = typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function";

  async function directory(): Promise<FileSystemDirectoryHandle> {
    if (!available) {
      throw new ProjectError("STORAGE_UNAVAILABLE", "This browser does not provide durable private storage for original media.");
    }
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(SOURCE_DIRECTORY, { create: true });
  }

  async function erase(key: string): Promise<void> {
    index.delete(key);
    if (!available) return;
    await (await directory()).removeEntry(key).catch(() => undefined);
  }

  return {
    available,
    reserve: reserveStorage,
    hydrateIndex: (entries) => {
      entries.forEach((entry) => index.set(entry.key, { ...entry, projectIds: [...entry.projectIds] }));
    },
    entry: (key) => index.get(key) ?? null,

    stage: async ({ key, assetId, projectId, blob, mediaType, sourceRevision }) => {
      const reservation = await reserveStorage(blob.size);
      if (!reservation.granted) {
        throw new ProjectError("STORAGE_QUOTA_EXCEEDED", reservation.reason ?? "Browser storage is full.");
      }
      try {
        const handle = await (await directory()).getFileHandle(key, { create: true });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } catch (error) {
        // A partial write must not be left behind pretending to be a usable original.
        await (await directory()).removeEntry(key).catch(() => undefined);
        throw toProjectError(error);
      }
      const entry: SourceStoreEntry = {
        key, assetId, projectId, projectIds: [projectId], byteSize: blob.size, mediaType,
        state: "staging", createdAt: Date.now(), sourceRevision,
      };
      index.set(key, entry);
      return entry;
    },

    verify: async (key) => {
      try {
        const handle = await (await directory()).getFileHandle(key);
        const file = await handle.getFile();
        const expected = index.get(key)?.byteSize;
        return { ok: expected === undefined ? file.size > 0 : file.size === expected, byteSize: file.size };
      } catch {
        return { ok: false, byteSize: 0 };
      }
    },

    commit: async (key) => {
      const entry = index.get(key);
      if (!entry) throw new ProjectError("STORAGE_WRITE_FAILED", "That staged source is no longer available to commit.");
      const committed: SourceStoreEntry = { ...entry, state: "committed" };
      index.set(key, committed);
      return committed;
    },

    discard: async (key) => { await erase(key); },

    addReference: async (key, projectId) => {
      const entry = index.get(key);
      if (!entry) return null;
      const next = withReference(entry, projectId);
      index.set(key, next);
      return next;
    },

    releaseReference: async (key, projectId) => {
      const entry = index.get(key);
      if (!entry) return { removed: false, entry: null };
      const projectIds = entry.projectIds.filter((id) => id !== projectId);
      if (projectIds.length > 0) {
        const next = { ...entry, projectIds };
        index.set(key, next);
        return { removed: false, entry: next };
      }
      await erase(key);
      return { removed: true, entry: null };
    },

    read: async (key) => {
      if (!available) return null;
      try {
        const handle = await (await directory()).getFileHandle(key);
        return await handle.getFile();
      } catch {
        return null;
      }
    },

    remove: async (key) => { await erase(key); },

    list: async (projectId) =>
      [...index.values()].filter((entry) => !projectId || entry.projectIds.includes(projectId)),
    totalBytes: async () => [...index.values()].reduce((total, entry) => total + entry.byteSize, 0),
  };
}

/** Used by tests and wherever the origin private file system is unavailable. */
export function createMemorySourceStore(): SourceStore {
  const files = new Map<string, Blob>();
  const index = new Map<string, SourceStoreEntry>();

  const erase = (key: string) => { files.delete(key); index.delete(key); };

  return {
    available: true,
    reserve: async (bytes) => ({ granted: true, requestedBytes: bytes, availableBytes: null, quotaBytes: null, usageBytes: null, reason: null }),
    hydrateIndex: (entries) => {
      entries.forEach((entry) => index.set(entry.key, { ...entry, projectIds: [...entry.projectIds] }));
    },
    entry: (key) => index.get(key) ?? null,
    stage: async ({ key, assetId, projectId, blob, mediaType, sourceRevision }) => {
      files.set(key, blob);
      const entry: SourceStoreEntry = {
        key, assetId, projectId, projectIds: [projectId], byteSize: blob.size, mediaType,
        state: "staging", createdAt: Date.now(), sourceRevision,
      };
      index.set(key, entry);
      return entry;
    },
    verify: async (key) => {
      const blob = files.get(key);
      return { ok: Boolean(blob), byteSize: blob?.size ?? 0 };
    },
    commit: async (key) => {
      const entry = index.get(key);
      if (!entry) throw new ProjectError("STORAGE_WRITE_FAILED", "That staged source is no longer available to commit.");
      const committed: SourceStoreEntry = { ...entry, state: "committed" };
      index.set(key, committed);
      return committed;
    },
    discard: async (key) => { erase(key); },
    addReference: async (key, projectId) => {
      const entry = index.get(key);
      if (!entry) return null;
      const next = withReference(entry, projectId);
      index.set(key, next);
      return next;
    },
    releaseReference: async (key, projectId) => {
      const entry = index.get(key);
      if (!entry) return { removed: false, entry: null };
      const projectIds = entry.projectIds.filter((id) => id !== projectId);
      if (projectIds.length > 0) {
        const next = { ...entry, projectIds };
        index.set(key, next);
        return { removed: false, entry: next };
      }
      erase(key);
      return { removed: true, entry: null };
    },
    read: async (key) => files.get(key) ?? null,
    remove: async (key) => { erase(key); },
    list: async (projectId) =>
      [...index.values()].filter((entry) => !projectId || entry.projectIds.includes(projectId)),
    totalBytes: async () => [...files.values()].reduce((total, blob) => total + blob.size, 0),
  };
}
