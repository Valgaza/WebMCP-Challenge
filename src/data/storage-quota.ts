import { ProjectError } from "../domain/project-error";

/**
 * Storage headroom is measured from the browser rather than assumed from a developer
 * machine. `navigator.storage.estimate` is advisory, so a reservation is a check plus a
 * documented safety margin, never a promise the browser has actually made.
 */
export interface StorageReservation {
  granted: boolean;
  requestedBytes: number;
  availableBytes: number | null;
  quotaBytes: number | null;
  usageBytes: number | null;
  reason: string | null;
}

/** Never fill the last slice of quota: eviction there takes the whole origin with it. */
export const QUOTA_SAFETY_MARGIN = 0.9;

export async function estimateStorage(): Promise<{ usage: number | null; quota: number | null }> {
  if (typeof navigator === "undefined" || typeof navigator.storage?.estimate !== "function") {
    return { usage: null, quota: null };
  }
  try {
    const estimate = await navigator.storage.estimate();
    return { usage: estimate.usage ?? null, quota: estimate.quota ?? null };
  } catch {
    return { usage: null, quota: null };
  }
}

/**
 * Asks whether `bytes` can plausibly be written. A runtime that reports no estimate is
 * granted optimistically — refusing there would block import in browsers that simply do not
 * implement the API — but the caller still handles a real write failure.
 */
export async function reserveStorage(bytes: number): Promise<StorageReservation> {
  const { usage, quota } = await estimateStorage();
  if (quota === null) {
    return { granted: true, requestedBytes: bytes, availableBytes: null, quotaBytes: null, usageBytes: usage, reason: null };
  }
  const available = Math.max(0, Math.floor(quota * QUOTA_SAFETY_MARGIN) - (usage ?? 0));
  if (bytes > available) {
    return {
      granted: false,
      requestedBytes: bytes,
      availableBytes: available,
      quotaBytes: quota,
      usageBytes: usage,
      reason: `This file needs ${formatBytes(bytes)} but only ${formatBytes(available)} of browser storage is usable. Free space, or import it for this session only.`,
    };
  }
  return { granted: true, requestedBytes: bytes, availableBytes: available, quotaBytes: quota, usageBytes: usage, reason: null };
}

export function quotaError(reservation: StorageReservation): ProjectError {
  return new ProjectError("STORAGE_QUOTA_EXCEEDED", reservation.reason ?? "Browser storage is full.");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Asks the browser to make this origin's storage exempt from routine eviction. */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || typeof navigator.storage?.persist !== "function") return false;
  try {
    if (typeof navigator.storage.persisted === "function" && (await navigator.storage.persisted())) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
