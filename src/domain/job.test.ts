import { describe, expect, it } from "vitest";
import { canTransition, createQueuedJob, isTerminalJobStatus, jobRecordSchema, summarizeJob } from "./job";

const base = {
  id: "job-1", projectId: "project-1", kind: "asset_import" as const,
  label: "Import 3 images", stage: "Reading files",
  // Intent is what makes a record retryable after a reload, so every job carries one.
  intent: { kind: "asset_import" as const, payloadVersion: 1, payload: {} },
  createdAt: "2026-09-02T10:00:00.000Z",
};

describe("job domain", () => {
  it("queues an indeterminate job when the unit count is unknown", () => {
    const job = createQueuedJob(base);
    expect(job).toMatchObject({ status: "queued", cancellable: true, startedAt: null, endedAt: null });
    expect(job.progress).toMatchObject({ determinate: false, completedUnits: null, totalUnits: null });
  });

  it("queues a determinate job when the unit count is known", () => {
    const job = createQueuedJob({ ...base, totalUnits: 3, intent: { kind: "asset_import", payloadVersion: 1, payload: {} } });
    expect(job.progress).toMatchObject({ determinate: true, completedUnits: 0, totalUnits: 3 });
  });

  it("rejects a record whose stage or label is empty", () => {
    const job = createQueuedJob(base);
    expect(jobRecordSchema.safeParse({ ...job, label: "" }).success).toBe(false);
    expect(jobRecordSchema.safeParse({ ...job, progress: { ...job.progress, stage: "" } }).success).toBe(false);
  });

  it("never leaves a terminal status", () => {
    for (const terminal of ["complete", "failed", "cancelled", "interrupted"] as const) {
      expect(isTerminalJobStatus(terminal)).toBe(true);
      expect(canTransition(terminal, "running")).toBe(false);
      expect(canTransition(terminal, "complete")).toBe(false);
    }
  });

  it("allows only forward movement out of queued and running", () => {
    expect(canTransition("queued", "running")).toBe(true);
    expect(canTransition("queued", "cancelled")).toBe(true);
    expect(canTransition("queued", "complete")).toBe(false);
    expect(canTransition("running", "complete")).toBe(true);
    expect(canTransition("running", "cancelled")).toBe(true);
    // Repeated running transitions carry progress updates, so they stay legal.
    expect(canTransition("running", "running")).toBe(true);
    expect(canTransition("queued", "queued")).toBe(false);
    // Cancelling reaches a worker, so a job can sit in "cancelling" before it settles.
    expect(canTransition("running", "cancelling")).toBe(true);
    expect(canTransition("cancelling", "cancelled")).toBe(true);
    expect(canTransition("cancelling", "complete")).toBe(true);
    // A reload leaves work nothing is executing; that becomes interrupted, never running.
    expect(canTransition("running", "interrupted")).toBe(true);
    expect(canTransition("interrupted", "running")).toBe(false);
  });

  it("summarizes without inventing a percentage", () => {
    const indeterminate = { ...createQueuedJob(base), status: "running" as const };
    expect(summarizeJob(indeterminate)).toBe("Import 3 images: Reading files.");

    const determinate = { ...createQueuedJob({ ...base, totalUnits: 3, intent: { kind: "asset_import", payloadVersion: 1, payload: {} } }), status: "running" as const };
    expect(summarizeJob({ ...determinate, progress: { ...determinate.progress, completedUnits: 2 } }))
      .toBe("Import 3 images: Reading files (2 of 3).");

    expect(summarizeJob({ ...createQueuedJob(base), status: "cancelled" })).toBe("Import 3 images was cancelled.");
    expect(summarizeJob({ ...createQueuedJob(base), status: "failed", failureMessage: "Storage is full." }))
      .toBe("Import 3 images failed. Storage is full.");
    expect(summarizeJob({ ...createQueuedJob(base), status: "interrupted" }))
      .toBe("Import 3 images was interrupted before it finished. It can be started again.");
  });
});
