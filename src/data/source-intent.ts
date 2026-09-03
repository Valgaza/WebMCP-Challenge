import type { AssetRecord } from "../domain/asset";

/**
 * The recovery record that makes import and relink atomic across two stores.
 *
 * IndexedDB and the origin private file system cannot join one native transaction, so the
 * only way to keep them consistent is to write down what is about to happen, do it in a
 * fixed order, and be able to finish or undo it after a crash. Every field here exists so
 * that startup recovery can complete the operation without the original File object, which
 * a browser will never hand back after a reload.
 *
 * The three states are ordered and the order matters:
 *
 * - `prepared` — bytes are staged and verified, the project does not reference them yet.
 *   Recovery discards the staged bytes; nothing observable was changed.
 * - `projectCommitted` — the project revision now references the asset. Recovery must finish
 *   the runtime side, because rolling the revision back would rewrite the user's history.
 * - `finalized` — nothing left to do. The row is deleted rather than kept in this state; the
 *   value exists so a partially written row is never mistaken for outstanding work.
 */
export type SourceIntentState = "prepared" | "projectCommitted" | "finalized";

export interface SourceIntentRecord {
  id: string;
  kind: "import" | "relink";
  assetId: string;
  projectId: string;
  /** The staged source key, or null when the source is a handle or session-only. */
  stagedKey: string | null;
  /**
   * The key this operation supersedes. It is released only after the new runtime record is
   * durable, so a failure mid-relink always leaves the previous source usable.
   */
  previousKey: string | null;
  /** The runtime record to write once the project revision is committed. */
  record: AssetRecord;
  /** Whether a file handle was supplied; the handle itself cannot survive a reload. */
  hadHandle: boolean;
  state: SourceIntentState;
  createdAt: number;
}

/**
 * One asset carried over from the pre-v9 storage layout, where originals lived in the
 * derived cache and could be evicted like a thumbnail.
 *
 * The bytes cannot be moved inside a Dexie upgrade because neither the cache nor the origin
 * private file system is reachable from an upgrade transaction, so the upgrade records the
 * work and startup reconciliation performs it. Re-running reconciliation on an already
 * migrated row is a no-op, which is what makes an interrupted migration safe to resume.
 */
export interface SourceMigrationRecord {
  assetId: string;
  projectId: string;
  /** Where the bytes were in the old layout. */
  legacyCacheKey: string;
  /** Where they must end up. */
  targetKey: string;
  fileName: string;
  mediaType: string;
  byteSize: number;
  sourceRevision: number;
  state: "pending" | "done" | "failed";
  reason: string | null;
  createdAt: number;
}
