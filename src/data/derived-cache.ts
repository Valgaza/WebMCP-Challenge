import { ProjectError, toProjectError } from "../domain/project-error";
import type { DerivativeKind } from "../domain/asset";
import { reserveStorage } from "./storage-quota";

/**
 * One generated artefact and everything needed to decide whether it is still valid.
 *
 * Provenance is recorded rather than inferred: without the source revision and the settings
 * that produced it, a cache hit cannot be distinguished from a stale render of media that
 * has since been replaced.
 */
export interface DerivedCacheEntry {
  key: string;
  kind: DerivativeKind;
  assetId: string | null;
  projectId: string | null;
  /** The asset source revision this artefact was generated from. */
  sourceRevision: number;
  /** Serialized generation settings, e.g. "edge=640;q=draft". */
  settings: string;
  mediaType: string;
  widthPx: number | null;
  heightPx: number | null;
  durationSeconds: number | null;
  channels: number | null;
  byteSize: number;
  complete: boolean;
  location: "opfs" | "memory";
  createdAt: number;
  lastUsedAt: number;
}

export interface DerivedWriteInput {
  key: string;
  blob: Blob;
  kind: DerivativeKind;
  assetId?: string | null;
  projectId?: string | null;
  sourceRevision: number;
  settings: string;
  widthPx?: number | null;
  heightPx?: number | null;
  durationSeconds?: number | null;
  channels?: number | null;
}

export interface DerivedReadResult {
  blob: Blob;
  entry: DerivedCacheEntry;
}

/**
 * Derived data — thumbnails, proxies, preview renders, waveform peaks — is reproducible, so
 * it lives outside the project document under a quota with least-recently-used eviction.
 * Losing it costs time, never work. No original-source key may ever enter this cache.
 */
export interface DerivedCache {
  available: boolean;
  /** Returns the blob together with the provenance recorded when it was written. */
  read: (key: string) => Promise<DerivedReadResult | null>;
  /** Convenience for callers that only need the bytes. */
  readBlob: (key: string) => Promise<Blob | null>;
  entry: (key: string) => DerivedCacheEntry | null;
  write: (input: DerivedWriteInput) => Promise<DerivedCacheEntry>;
  remove: (key: string) => Promise<void>;
  /** Drops every derivative of an asset, optionally only those older than a source revision. */
  invalidateAsset: (assetId: string, beforeSourceRevision?: number) => Promise<string[]>;
  list: () => Promise<DerivedCacheEntry[]>;
  totalBytes: () => Promise<number>;
  budgetBytes: number;
  /** Restores the index after reload so eviction and staleness stay correct. */
  hydrate: (entries: DerivedCacheEntry[]) => void;
  /** Called whenever the index changes so the caller can persist it. */
  onIndexChange: (listener: (entries: DerivedCacheEntry[]) => void) => () => void;
}

export const DEFAULT_CACHE_BUDGET_BYTES = 256 * 1024 * 1024;

/** Keys are used as filenames, so they are constrained rather than trusted. */
export function derivedCacheKey(kind: DerivativeKind, assetId: string, variant: string): string {
  const safeVariant = variant.replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "default";
  const safeAsset = assetId.replace(/[^a-z0-9_-]/gi, "").slice(0, 64);
  if (!safeAsset) throw new ProjectError("INVALID_INPUT", "A derived cache key needs a usable asset ID.", { fieldPath: "assetId" });
  return `${kind}_${safeAsset}_${safeVariant}`;
}

/** Preview renders are keyed by everything that changes the picture, not by asset alone. */
export function previewCacheKey(input: {
  scope: "document" | "sequence" | "asset";
  targetId: string;
  revisionId: string;
  quality: string;
  variant?: string;
}): string {
  const clean = (value: string) => value.replace(/[^a-z0-9_-]/gi, "").slice(0, 40);
  return [
    "preview",
    clean(input.scope),
    clean(input.targetId),
    clean(input.revisionId),
    clean(input.quality),
    clean(input.variant ?? "d"),
  ].join("_");
}

function baseEntry(input: DerivedWriteInput, location: "opfs" | "memory", clock: number): DerivedCacheEntry {
  return {
    key: input.key,
    kind: input.kind,
    assetId: input.assetId ?? null,
    projectId: input.projectId ?? null,
    sourceRevision: input.sourceRevision,
    settings: input.settings,
    mediaType: input.blob.type || "application/octet-stream",
    widthPx: input.widthPx ?? null,
    heightPx: input.heightPx ?? null,
    durationSeconds: input.durationSeconds ?? null,
    channels: input.channels ?? null,
    byteSize: input.blob.size,
    complete: true,
    location,
    createdAt: clock,
    lastUsedAt: clock,
  };
}

/**
 * Backed by the origin private file system when the browser provides it. The caller is told
 * through `available` rather than discovering failure later, so preview quality can degrade
 * deliberately instead of erroring.
 */
export function createOpfsDerivedCache(budgetBytes = DEFAULT_CACHE_BUDGET_BYTES): DerivedCache {
  const usage = new Map<string, DerivedCacheEntry>();
  const listeners = new Set<(entries: DerivedCacheEntry[]) => void>();
  const available = typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function";

  function publish(): void {
    const entries = [...usage.values()];
    listeners.forEach((listener) => listener(entries));
  }

  async function directory(): Promise<FileSystemDirectoryHandle> {
    if (!available) {
      throw new ProjectError("CAPABILITY_UNAVAILABLE", "This browser does not provide private storage for generated previews.");
    }
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle("estro-derived", { create: true });
  }

  async function evictTo(limit: number): Promise<void> {
    let total = [...usage.values()].reduce((sum, entry) => sum + entry.byteSize, 0);
    if (total <= limit) return;
    const ordered = [...usage.values()].sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    const folder = await directory();
    for (const entry of ordered) {
      if (total <= limit) break;
      await folder.removeEntry(entry.key).catch(() => undefined);
      usage.delete(entry.key);
      total -= entry.byteSize;
    }
    publish();
  }

  const cache: DerivedCache = {
    available,
    budgetBytes,
    entry: (key) => usage.get(key) ?? null,
    hydrate: (entries) => { entries.forEach((entry) => usage.set(entry.key, entry)); },
    onIndexChange: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },

    read: async (key) => {
      if (!available) return null;
      try {
        const handle = await (await directory()).getFileHandle(key);
        const file = await handle.getFile();
        const existing = usage.get(key);
        if (!existing) {
          // The file survived a reload without its index record. It is still usable bytes,
          // but its provenance is unknown, so it is reported as revision 0 — never a hit for
          // a caller that asked for a specific source revision.
          const recovered: DerivedCacheEntry = {
            key, kind: "preview", assetId: null, projectId: null, sourceRevision: 0,
            settings: "", mediaType: file.type || "application/octet-stream",
            widthPx: null, heightPx: null, durationSeconds: null, channels: null,
            byteSize: file.size, complete: true, location: "opfs",
            createdAt: Date.now(), lastUsedAt: Date.now(),
          };
          usage.set(key, recovered);
          publish();
          return { blob: file, entry: recovered };
        }
        existing.lastUsedAt = Date.now();
        return { blob: file, entry: existing };
      } catch {
        return null;
      }
    },

    readBlob: async (key) => (await cache.read(key))?.blob ?? null,

    write: async (input) => {
      const entry = baseEntry(input, "opfs", Date.now());
      if (!available) {
        // Nothing is written, and the caller is told through `complete: false` rather than
        // being left to assume a silent success.
        return { ...entry, complete: false, byteSize: 0 };
      }
      const reservation = await reserveStorage(input.blob.size);
      if (!reservation.granted) {
        await evictTo(Math.floor(budgetBytes / 2));
        const retry = await reserveStorage(input.blob.size);
        if (!retry.granted) {
          throw new ProjectError("STORAGE_QUOTA_EXCEEDED", retry.reason ?? "Browser storage is full for generated previews.");
        }
      }
      try {
        const handle = await (await directory()).getFileHandle(input.key, { create: true });
        const writable = await handle.createWritable();
        await writable.write(input.blob);
        await writable.close();
        usage.set(input.key, entry);
        publish();
        await evictTo(budgetBytes);
        return entry;
      } catch (error) {
        const parsed = toProjectError(error);
        if (parsed.code === "STORAGE_QUOTA_EXCEEDED") {
          await evictTo(Math.floor(budgetBytes / 2));
          throw parsed;
        }
        throw parsed;
      }
    },

    remove: async (key) => {
      usage.delete(key);
      publish();
      if (!available) return;
      await (await directory()).removeEntry(key).catch(() => undefined);
    },

    invalidateAsset: async (assetId, beforeSourceRevision) => {
      const doomed = [...usage.values()].filter(
        (entry) => entry.assetId === assetId
          && (beforeSourceRevision === undefined || entry.sourceRevision < beforeSourceRevision),
      );
      for (const entry of doomed) await cache.remove(entry.key);
      return doomed.map((entry) => entry.key);
    },

    list: async () => [...usage.values()],
    totalBytes: async () => [...usage.values()].reduce((sum, entry) => sum + entry.byteSize, 0),
  };

  return cache;
}

/** Used in tests and wherever the origin private file system is unavailable. */
export function createMemoryDerivedCache(budgetBytes = DEFAULT_CACHE_BUDGET_BYTES): DerivedCache {
  const store = new Map<string, { blob: Blob; entry: DerivedCacheEntry }>();
  const listeners = new Set<(entries: DerivedCacheEntry[]) => void>();
  let clock = 0;

  function publish(): void {
    const entries = [...store.values()].map((item) => item.entry);
    listeners.forEach((listener) => listener(entries));
  }

  function evict(): void {
    let total = [...store.values()].reduce((sum, item) => sum + item.entry.byteSize, 0);
    if (total <= budgetBytes) return;
    const ordered = [...store.values()].sort((a, b) => a.entry.lastUsedAt - b.entry.lastUsedAt);
    for (const item of ordered) {
      if (total <= budgetBytes) break;
      store.delete(item.entry.key);
      total -= item.entry.byteSize;
    }
    publish();
  }

  const cache: DerivedCache = {
    available: true,
    budgetBytes,
    entry: (key) => store.get(key)?.entry ?? null,
    hydrate: () => undefined,
    onIndexChange: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },

    read: async (key) => {
      const item = store.get(key);
      if (!item) return null;
      item.entry.lastUsedAt = (clock += 1);
      return { blob: item.blob, entry: item.entry };
    },
    readBlob: async (key) => store.get(key)?.blob ?? null,
    write: async (input) => {
      const entry = baseEntry(input, "memory", (clock += 1));
      store.set(input.key, { blob: input.blob, entry });
      evict();
      publish();
      return entry;
    },
    remove: async (key) => { store.delete(key); publish(); },
    invalidateAsset: async (assetId, beforeSourceRevision) => {
      const doomed = [...store.values()]
        .map((item) => item.entry)
        .filter((entry) => entry.assetId === assetId
          && (beforeSourceRevision === undefined || entry.sourceRevision < beforeSourceRevision));
      doomed.forEach((entry) => store.delete(entry.key));
      publish();
      return doomed.map((entry) => entry.key);
    },
    list: async () => [...store.values()].map((item) => item.entry),
    totalBytes: async () => [...store.values()].reduce((sum, item) => sum + item.entry.byteSize, 0),
  };

  return cache;
}
