import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EstroDatabase } from "../data/estro-database";
import { ProjectError } from "../domain/project-error";
import { JobService, type JobRunner } from "./job-service";

const projectId = "project-1";

describe("JobService", () => {
  let database: EstroDatabase;
  let jobs: JobService;

  beforeEach(() => {
    database = new EstroDatabase(`estro-jobs-${crypto.randomUUID()}`);
    jobs = new JobService(database);
  });

  afterEach(async () => database.delete());

  it("queues, runs, and completes a job with real progress", async () => {
    const seen: string[] = [];
    jobs.subscribe((job) => seen.push(`${job.status}:${job.progress.completedUnits ?? "-"}`));

    jobs.registerRunner("asset_import", async (context) => {
      await context.report({ stage: "Decoding", completedUnits: 1 });
      await context.report({ stage: "Decoding", completedUnits: 2 });
      return { outputIds: ["asset-a", "asset-b"] };
    });
    const started = await jobs.startJob({
      projectId, kind: "asset_import", label: "Import 2 images", stage: "Reading", totalUnits: 2,
      intent: { kind: "asset_import", payloadVersion: 1, payload: {} },
    });
    expect(started.status).toBe("queued");

    const finished = await jobs.waitForJob(started.id);
    expect(finished).toMatchObject({ status: "complete", outputIds: ["asset-a", "asset-b"] });
    expect(finished.progress.determinate).toBe(true);
    expect(finished.startedAt).not.toBeNull();
    expect(finished.endedAt).not.toBeNull();
    expect(seen).toContain("running:1");
    expect(seen).toContain("complete:2");
  });

  it("keeps progress indeterminate when no total is known", async () => {
    jobs.registerRunner("thumbnail", async (context) => { await context.report({ stage: "Encoding" }); return {}; });
    const started = await jobs.startJob({
      projectId, kind: "thumbnail", label: "Build thumbnail", stage: "Decoding",
      intent: { kind: "thumbnail", payloadVersion: 1, payload: {} },
    });
    const finished = await jobs.waitForJob(started.id);
    expect(finished.progress.determinate).toBe(false);
    expect(finished.progress.completedUnits).toBeNull();
  });

  it("stops at the next safe point when cancelled and reports partial output", async () => {
    let processed = 0;
    let startedId = "";
    jobs.registerRunner("asset_import", async (context) => {
      const outputIds: string[] = [];
      for (let index = 0; index < 5; index += 1) {
        if (context.isCancelled()) break;
        processed += 1;
        outputIds.push(`asset-${index}`);
        if (index === 1) await jobs.cancelJob(startedId);
        await context.report({ completedUnits: processed });
      }
      return { outputIds };
    });
    const started = await jobs.startJob({
      projectId, kind: "asset_import", label: "Import many", stage: "Reading", totalUnits: 5,
      intent: { kind: "asset_import", payloadVersion: 1, payload: {} },
    });
    startedId = started.id;

    const finished = await jobs.waitForJob(started.id);
    expect(finished.status).toBe("cancelled");
    expect(processed).toBeLessThan(5);
    expect(finished.outputIds.length).toBeGreaterThan(0);
  });

  it("treats cancellation as idempotent and never resurrects a finished job", async () => {
    jobs.registerRunner("thumbnail", async () => ({}));
    const started = await jobs.startJob({
      projectId, kind: "thumbnail", label: "Quick job", stage: "Working",
      intent: { kind: "thumbnail", payloadVersion: 1, payload: {} },
    });
    await jobs.waitForJob(started.id);

    const first = await jobs.cancelJob(started.id);
    expect(first).toMatchObject({ accepted: false });
    expect(first.reason).toContain("already");

    const second = await jobs.cancelJob(started.id);
    expect(second.accepted).toBe(false);
    expect((await jobs.getJob(started.id)).status).toBe("complete");
  });

  it("records failure with a structured code and message", async () => {
    jobs.registerRunner("proxy", async () => { throw new Error("decoder unavailable"); });
    const started = await jobs.startJob({
      projectId, kind: "proxy", label: "Generate proxy", stage: "Decoding",
      intent: { kind: "proxy", payloadVersion: 1, payload: {} },
    });
    const finished = await jobs.waitForJob(started.id);
    // A job failure must not be reported as a project-storage failure.
    expect(finished).toMatchObject({ status: "failed", failureCode: "JOB_FAILED", failureMessage: "decoder unavailable" });
  });

  it("preserves a structured cause raised by the runner", async () => {
    jobs.registerRunner("proxy", async () => { throw new ProjectError("CAPABILITY_UNAVAILABLE", "This browser cannot decode AVIF."); });
    const started = await jobs.startJob({
      projectId, kind: "proxy", label: "Generate proxy", stage: "Decoding",
      intent: { kind: "proxy", payloadVersion: 1, payload: {} },
    });
    const finished = await jobs.waitForJob(started.id);
    expect(finished).toMatchObject({ status: "failed", failureCode: "CAPABILITY_UNAVAILABLE", failureMessage: "This browser cannot decode AVIF." });
    // A capability that is absent now will still be absent on a second attempt.
    expect(finished.retryable).toBe(false);
    expect(finished.retryReason).toBe("This browser cannot decode AVIF.");
  });

  it("retries a failed job as a new record and preserves the original outcome", async () => {
    let attempts = 0;
    jobs.registerRunner("proxy", async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("transient");
      return { outputIds: ["proxy-1"] };
    });
    const started = await jobs.startJob({
      projectId, kind: "proxy", label: "Generate proxy", stage: "Decoding",
      intent: { kind: "proxy", payloadVersion: 1, payload: {} },
    });
    await jobs.waitForJob(started.id);

    const retried = await jobs.retryJob(started.id);
    expect(retried.retryOfJobId).toBe(started.id);
    expect(retried.id).not.toBe(started.id);

    const finished = await jobs.waitForJob(retried.id);
    expect(finished).toMatchObject({ status: "complete", outputIds: ["proxy-1"] });
    expect((await jobs.getJob(started.id)).status).toBe("failed");
  });

  /**
   * The defect this covers: `startJob` used to accept an inline runner and file it under the
   * job's *kind*, so starting a second job of the same kind replaced the runner the first
   * would retry with. Retrying job A then ran job B's work against B's captured inputs.
   */
  it("retries each job against its own persisted intent, not the newest job of that kind", async () => {
    const ran: string[] = [];
    jobs.registerRunner("proxy", async (_context, intent) => {
      const asset = String(intent.payload.assetId);
      ran.push(asset);
      // Only the first attempt of each fails, so a retry that reaches the right target wins.
      if (ran.filter((entry) => entry === asset).length === 1) throw new Error(`no decoder for ${asset}`);
      return { outputIds: [`proxy-of-${asset}`] };
    });

    const first = await jobs.startJob({
      projectId, kind: "proxy", label: "Proxy A", stage: "Decoding", targetIds: ["asset-a"],
      intent: { kind: "proxy", payloadVersion: 1, payload: { assetId: "asset-a" } },
    });
    await jobs.waitForJob(first.id);

    const second = await jobs.startJob({
      projectId, kind: "proxy", label: "Proxy B", stage: "Decoding", targetIds: ["asset-b"],
      intent: { kind: "proxy", payloadVersion: 1, payload: { assetId: "asset-b" } },
    });
    await jobs.waitForJob(second.id);

    // Retrying the older job must still be about asset A, even though job B started later.
    const retriedFirst = await jobs.waitForJob((await jobs.retryJob(first.id)).id);
    expect(retriedFirst.outputIds).toEqual(["proxy-of-asset-a"]);
    expect(retriedFirst.intent.payload).toEqual({ assetId: "asset-a" });
    expect(retriedFirst.targetIds).toEqual(["asset-a"]);

    const retriedSecond = await jobs.waitForJob((await jobs.retryJob(second.id)).id);
    expect(retriedSecond.outputIds).toEqual(["proxy-of-asset-b"]);
    expect(retriedSecond.intent.payload).toEqual({ assetId: "asset-b" });

    expect(ran).toEqual(["asset-a", "asset-b", "asset-a", "asset-b"]);
  });

  it("refuses a retry whose stored details no longer match the recorded work", async () => {
    jobs.registerRunner("proxy", async () => { throw new Error("nope"); });
    const started = await jobs.startJob({
      projectId, kind: "proxy", label: "Proxy", stage: "Decoding",
      intent: { kind: "proxy", payloadVersion: 1, payload: {} },
    });
    await jobs.waitForJob(started.id);

    // Something wrote a mismatched payload into the record; the retry must refuse rather
    // than hand it to a runner that would act on the wrong kind of work.
    const stored = await database.jobs.get(started.id);
    await database.jobs.put({ ...stored!, intent: { kind: "waveform", payloadVersion: 1, payload: {} } });

    await expect(jobs.retryJob(started.id)).rejects.toMatchObject({ code: "JOB_NOT_RETRYABLE" });
  });

  it("refuses to retry work that has not finished or that succeeded", async () => {
    jobs.registerRunner("thumbnail", async () => ({}));
    const started = await jobs.startJob({
      projectId, kind: "thumbnail", label: "Job", stage: "Working",
      intent: { kind: "thumbnail", payloadVersion: 1, payload: {} },
    });
    await jobs.waitForJob(started.id);
    await expect(jobs.retryJob(started.id)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(jobs.getJob("missing")).rejects.toMatchObject({ code: "JOB_NOT_FOUND" });
  });

  it("refuses to start work for a kind that has no registered runner", async () => {
    await expect(
      jobs.startJob({
        projectId, kind: "waveform", label: "Peaks", stage: "Reading",
        intent: { kind: "waveform", payloadVersion: 1, payload: {} },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  /**
   * A reload cannot give back a `File` the user chose, so an interrupted import says so
   * instead of offering a retry that could only fail again.
   */
  it("reports honest resumability for work interrupted by a reload", async () => {
    const resumable: JobRunner = async () => ({});
    jobs.registerRunner("proxy", resumable);
    jobs.registerRunner("asset_import", resumable);

    const now = new Date().toISOString();
    const base = {
      schemaVersion: 2 as const, projectId, status: "running" as const, priority: "user" as const,
      progress: { stage: "Working", determinate: false, completedUnits: null, totalUnits: null },
      targetIds: [], sourceRevisionId: null, outputIds: [], derivativeIds: [], warnings: [],
      failureCode: null, failureMessage: null, retryable: false, retryReason: null,
      retryOfJobId: null, cancellable: true, cancelRequested: false, ranInWorker: false,
      createdAt: now, startedAt: now, endedAt: null,
    };
    await database.jobs.bulkPut([
      { ...base, id: "job-proxy", kind: "proxy", label: "Proxy", intent: { kind: "proxy", payloadVersion: 1, payload: { assetId: "a" } } },
      { ...base, id: "job-import", kind: "asset_import", label: "Import", intent: { kind: "asset_import", payloadVersion: 1, payload: { requiresUserFiles: true } } },
    ]);

    const recovered = await jobs.reconcileInterruptedJobs(projectId);
    expect(recovered.every((job) => job.status === "interrupted")).toBe(true);

    const proxy = await jobs.getJob("job-proxy");
    expect(proxy.retryable).toBe(true);
    expect(proxy.retryReason).toBeNull();

    const importJob = await jobs.getJob("job-import");
    expect(importJob.retryable).toBe(false);
    expect(importJob.retryReason).toContain("Choose them again");
    await expect(jobs.retryJob("job-import")).rejects.toMatchObject({ code: "JOB_NOT_RETRYABLE" });
  });

  it("collects warnings without failing the job", async () => {
    jobs.registerRunner("asset_import", async (context) => {
      await context.warn("One file used an unsupported format.");
      return {};
    });
    const started = await jobs.startJob({
      projectId, kind: "asset_import", label: "Import", stage: "Reading",
      intent: { kind: "asset_import", payloadVersion: 1, payload: {} },
    });
    const finished = await jobs.waitForJob(started.id);
    expect(finished.status).toBe("complete");
    expect(finished.warnings).toEqual(["One file used an unsupported format."]);
  });

  it("lists a project's jobs newest first", async () => {
    jobs.registerRunner("thumbnail", async () => ({}));
    for (const label of ["First", "Second", "Third"]) {
      const job = await jobs.startJob({
        projectId, kind: "thumbnail", label, stage: "Working",
        intent: { kind: "thumbnail", payloadVersion: 1, payload: {} },
      });
      await jobs.waitForJob(job.id);
    }
    const listed = await jobs.listJobs(projectId);
    expect(listed).toHaveLength(3);
    expect(listed.map((job) => job.label)).toEqual(["Third", "Second", "First"]);
  });
});
