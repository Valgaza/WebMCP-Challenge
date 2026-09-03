import type { EstroDatabase } from "../data/estro-database";
import { ProjectError, toProjectError } from "../domain/project-error";
import {
  JOB_PRIORITY_ORDER,
  canTransition,
  createQueuedJob,
  isTerminalJobStatus,
  jobRecordSchema,
  jobIntentSchema,
  type JobIntent,
  type JobKind,
  type JobPriority,
  type JobProgress,
  type JobRecord,
} from "../domain/job";

export interface JobContext {
  jobId: string;
  /** Resolves true once the user has cancelled, so long work can stop at a safe point. */
  isCancelled: () => boolean;
  /** Aborts when the job is cancelled, so a worker task really stops decoding. */
  signal: AbortSignal;
  report: (progress: Partial<JobProgress>) => Promise<void>;
  warn: (message: string) => Promise<void>;
  /** Records generated derivatives so a completed job explains what it produced. */
  recordDerivatives: (keys: string[]) => Promise<void>;
}

export interface JobRunResult {
  outputIds?: string[];
  derivativeIds?: string[];
  ranInWorker?: boolean;
}

export type JobRunner = (context: JobContext, intent: JobIntent) => Promise<JobRunResult>;

export interface StartJobInput {
  projectId: string;
  kind: JobKind;
  label: string;
  stage: string;
  /** Serializable arguments; this is what makes the job retryable after a reload. */
  intent: JobIntent;
  priority?: JobPriority;
  targetIds?: string[];
  sourceRevisionId?: string | null;
  totalUnits?: number | null;
  cancellable?: boolean;
  retryOfJobId?: string | null;
  /**
   * Lets a caller mint the ID before starting, so per-job transient state (the `File`
   * objects behind an import, say) can be filed under it with no window in which the runner
   * could look for it and not find it.
   */
  id?: string;
  /** Marks work that cannot be reconstructed later, with the reason the user will read. */
  notRetryableReason?: string | null;
}

export interface JobServiceOptions {
  now?: () => Date;
  createJobId?: () => string;
  /** How many jobs may execute at once. Interactive work always jumps the queue. */
  maxConcurrent?: number;
}

interface QueueEntry {
  jobId: string;
  priority: JobPriority;
  sequence: number;
  start: () => void;
}

/**
 * Owns the lifecycle of everything slow.
 *
 * Two rules make this a real execution boundary rather than a status board. First, work is
 * described by a persisted intent, so a job survives reload as a truthful `interrupted`
 * record that can be started again. Second, cancellation aborts a signal the runner passes
 * to the worker, so stopping a job stops the decoding, not just the progress bar.
 */
export class JobService {
  private readonly now: () => Date;
  private readonly createJobId: () => string;
  private readonly maxConcurrent: number;
  private readonly aborts = new Map<string, AbortController>();
  private readonly running = new Map<string, Promise<JobRecord>>();
  private readonly runners = new Map<JobKind, JobRunner>();
  private readonly listeners = new Set<(job: JobRecord) => void>();
  private readonly queue: QueueEntry[] = [];
  private sequenceCounter = 0;
  private active = 0;

  constructor(private readonly database: EstroDatabase, options: JobServiceOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.createJobId = options.createJobId ?? (() => crypto.randomUUID());
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? 3);
  }

  subscribe(listener: (job: JobRecord) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Registers the executor for a job kind. Retry and reload recovery go through this map, so
   * a job's ability to run again does not depend on a closure that died with the page.
   */
  registerRunner(kind: JobKind, runner: JobRunner): void {
    this.runners.set(kind, runner);
  }

  hasRunner(kind: JobKind): boolean {
    return this.runners.has(kind);
  }

  async listJobs(projectId: string, limit = 25): Promise<JobRecord[]> {
    const jobs = await this.database.jobs.where("projectId").equals(projectId).toArray();
    return jobs
      .map((job) => this.normalize(job))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async getJob(jobId: string): Promise<JobRecord> {
    const job = await this.database.jobs.get(jobId);
    if (!job) throw new ProjectError("JOB_NOT_FOUND", "That job is not available in this browser.");
    return this.normalize(job);
  }

  /**
   * A record written before a reload cannot still be running: nothing is executing it. Left
   * alone it would claim progress forever, so it is reconciled into `interrupted`, which is
   * both truthful and retryable.
   */
  async reconcileInterruptedJobs(projectId?: string): Promise<JobRecord[]> {
    const all = projectId
      ? await this.database.jobs.where("projectId").equals(projectId).toArray()
      : await this.database.jobs.toArray();

    const recovered: JobRecord[] = [];
    for (const stored of all) {
      const job = this.normalize(stored);
      if (isTerminalJobStatus(job.status)) continue;
      if (this.running.has(job.id) || this.queue.some((entry) => entry.jobId === job.id)) continue;

      // A browser will not hand back a `File` the user chose in a previous session, so an
      // import that stopped mid-way is honestly not repeatable on its own. Saying so is the
      // point: a retry button that can only fail again is worse than none.
      const needsUserFiles = job.intent.payload?.requiresUserFiles === true;
      const next = jobRecordSchema.parse({
        ...job,
        status: "interrupted",
        progress: { ...job.progress, stage: "Interrupted before finishing" },
        retryable: !needsUserFiles && this.runners.has(job.kind),
        retryReason: needsUserFiles
          ? "This import needs the files you chose, and a browser cannot reopen them after a reload. Choose them again to continue."
          : this.runners.has(job.kind)
            ? null
            : `Estro has no runner for “${job.kind}” work in this session.`,
        failureCode: "JOB_INTERRUPTED",
        failureMessage: "This job stopped when the page closed. Start it again to finish the work.",
        endedAt: this.now().toISOString(),
      });
      await this.database.jobs.put(next);
      this.notify(next);
      recovered.push(next);
    }
    return recovered;
  }

  /**
   * Returns as soon as the job is queued. The caller gets an ID to watch rather than a
   * promise that blocks the interface until the work finishes.
   */
  /**
   * Queues one job.
   *
   * There is deliberately no runner argument. An earlier version accepted an inline closure
   * and filed it under the job's *kind*, so importing a second file replaced the runner the
   * first import would retry with — retrying job A could run job B's captured file. Runners
   * are registered once per kind during composition and read everything they need from the
   * job's own persisted intent, which is the only thing that still exists after a reload.
   */
  async startJob(input: StartJobInput): Promise<JobRecord> {
    try {
      const executor = this.runners.get(input.kind);
      if (!executor) {
        throw new ProjectError("INVALID_INPUT", `No runner is registered for “${input.kind}” work.`, { fieldPath: "kind" });
      }

      const job = createQueuedJob({
        id: input.id ?? this.createJobId(),
        projectId: input.projectId,
        kind: input.kind,
        label: input.label,
        stage: input.stage,
        intent: input.intent,
        priority: input.priority ?? "user",
        targetIds: input.targetIds ?? [],
        sourceRevisionId: input.sourceRevisionId ?? null,
        totalUnits: input.totalUnits ?? null,
        cancellable: input.cancellable ?? true,
        retryOfJobId: input.retryOfJobId ?? null,
        createdAt: this.now().toISOString(),
      });
      const stored: JobRecord = input.notRetryableReason
        ? { ...job, retryable: false, retryReason: input.notRetryableReason }
        : job;
      await this.database.jobs.put(stored);
      this.notify(stored);
      this.enqueue(stored, executor);
      return stored;
    } catch (error) {
      throw toProjectError(error);
    }
  }

  /** Resolves once the job reaches a terminal status. Used by tests and by tools that must wait. */
  async waitForJob(jobId: string): Promise<JobRecord> {
    // A queued job has no promise yet, so wait for it to become one before awaiting.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const pending = this.running.get(jobId);
      if (pending) { await pending.catch(() => undefined); break; }
      const queued = this.queue.some((entry) => entry.jobId === jobId);
      if (!queued) break;
      await new Promise<void>((resolve) => { queueMicrotask(resolve); });
    }
    const pending = this.running.get(jobId);
    if (pending) await pending.catch(() => undefined);
    return this.getJob(jobId);
  }

  /**
   * Idempotent by contract: cancelling twice, or cancelling work that already finished,
   * reports what actually happened instead of failing.
   */
  async cancelJob(jobId: string): Promise<{ job: JobRecord; accepted: boolean; reason: string }> {
    const job = await this.getJob(jobId);
    if (isTerminalJobStatus(job.status)) {
      return { job, accepted: false, reason: `This job already ${job.status === "complete" ? "finished" : job.status}.` };
    }
    if (!job.cancellable) {
      return { job, accepted: false, reason: "This job cannot be cancelled once it has started." };
    }

    this.aborts.get(jobId)?.abort();

    const queuedIndex = this.queue.findIndex((entry) => entry.jobId === jobId);
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1);
      const stopped = await this.transition(jobId, "cancelled", { stage: "Cancelled before starting" }, { cancelRequested: true });
      return { job: stopped, accepted: true, reason: "The job was cancelled before it started." };
    }

    const stopping = await this.transition(jobId, "cancelling", { stage: "Stopping" }, { cancelRequested: true });
    return { job: stopping, accepted: true, reason: "Cancellation reached the worker and will stop at the next safe point." };
  }

  /**
   * Re-runs a finished job from its persisted intent as a new record, so the original
   * outcome stays inspectable and the retry does not depend on anything held in memory.
   */
  /**
   * Runs a finished job's own recorded work again.
   *
   * Everything comes from the persisted record: the same intent, the same targets, the same
   * source revision. Nothing is read from whatever happens to be registered or selected
   * right now, which is what stops a retry from quietly operating on a different file than
   * the job it claims to repeat.
   */
  async retryJob(jobId: string): Promise<JobRecord> {
    const job = await this.getJob(jobId);
    if (!isTerminalJobStatus(job.status)) {
      throw new ProjectError("INVALID_INPUT", "Only a finished job can be retried.", { fieldPath: "jobId" });
    }
    if (job.status === "complete") {
      throw new ProjectError("INVALID_INPUT", "This job already completed successfully.", { fieldPath: "jobId" });
    }
    if (job.retryReason) {
      throw new ProjectError("JOB_NOT_RETRYABLE", job.retryReason);
    }
    if (!this.runners.has(job.kind)) {
      throw new ProjectError("JOB_NOT_RETRYABLE", `Estro has no runner for “${job.kind}” work in this session. Start the work again from its own control.`);
    }

    // The stored payload is revalidated rather than trusted: a record written by an older
    // schema, or edited in the database, must fail here rather than inside the runner.
    let intent: JobIntent;
    try {
      intent = jobIntentSchema.parse(job.intent);
    } catch {
      throw new ProjectError("JOB_NOT_RETRYABLE", "This job's saved details are no longer readable, so it cannot be repeated automatically.");
    }
    if (intent.kind !== job.kind) {
      throw new ProjectError("JOB_NOT_RETRYABLE", "This job's saved details do not match the work it recorded, so it cannot be repeated safely.");
    }

    return this.startJob({
      projectId: job.projectId,
      kind: job.kind,
      label: job.label,
      stage: "Retrying",
      intent,
      priority: job.priority,
      targetIds: job.targetIds,
      sourceRevisionId: job.sourceRevisionId,
      totalUnits: job.progress.totalUnits,
      cancellable: job.cancellable,
      retryOfJobId: jobId,
    });
  }

  /* ------------------------------ scheduling ------------------------------ */

  private enqueue(job: JobRecord, runner: JobRunner): void {
    this.queue.push({
      jobId: job.id,
      priority: job.priority,
      sequence: (this.sequenceCounter += 1),
      start: () => { this.running.set(job.id, this.run(job.id, runner)); },
    });
    this.pump();
  }

  private pump(): void {
    while (this.active < this.maxConcurrent && this.queue.length) {
      this.queue.sort((a, b) => JOB_PRIORITY_ORDER[a.priority] - JOB_PRIORITY_ORDER[b.priority] || a.sequence - b.sequence);
      const next = this.queue.shift();
      if (!next) return;
      this.active += 1;
      next.start();
    }
  }

  private async run(jobId: string, runner: JobRunner): Promise<JobRecord> {
    const controller = new AbortController();
    this.aborts.set(jobId, controller);

    try {
      const queued = await this.getJob(jobId);
      if (queued.cancelRequested || controller.signal.aborted) {
        return await this.transition(jobId, "cancelled", { stage: "Cancelled before starting" });
      }
      await this.transition(jobId, "running", { stage: queued.progress.stage });

      const context: JobContext = {
        jobId,
        isCancelled: () => controller.signal.aborted,
        signal: controller.signal,
        report: async (progress) => {
          if (controller.signal.aborted) return;
          await this.transition(jobId, "running", progress);
        },
        warn: async (message) => {
          const current = await this.getJob(jobId);
          if (isTerminalJobStatus(current.status)) return;
          const next = jobRecordSchema.parse({ ...current, warnings: [...current.warnings, message].slice(0, 32) });
          await this.database.jobs.put(next);
          this.notify(next);
        },
        recordDerivatives: async (keys) => {
          if (!keys.length) return;
          const current = await this.getJob(jobId);
          const next = jobRecordSchema.parse({
            ...current,
            derivativeIds: [...new Set([...current.derivativeIds, ...keys])].slice(0, 512),
          });
          await this.database.jobs.put(next);
          this.notify(next);
        },
      };

      try {
        const result = await runner(context, queued.intent);
        if (controller.signal.aborted) {
          return await this.transition(jobId, "cancelled", { stage: "Cancelled" }, {
            outputIds: result.outputIds, derivativeIds: result.derivativeIds,
          });
        }
        return await this.transition(jobId, "complete", { stage: "Finished" }, {
          outputIds: result.outputIds,
          derivativeIds: result.derivativeIds,
          ranInWorker: result.ranInWorker,
        });
      } catch (error) {
        if (controller.signal.aborted) return await this.transition(jobId, "cancelled", { stage: "Cancelled" });
        const parsed = this.classifyFailure(error);
        // Neither a missing capability nor work whose inputs no longer exist becomes
        // possible on a second attempt, so both are refused with their own reason rather
        // than offering a retry button that can only fail again.
        const permanent = parsed.code === "CAPABILITY_UNAVAILABLE" || parsed.code === "JOB_NOT_RETRYABLE";
        return await this.transition(jobId, "failed", { stage: "Failed" }, {
          failureCode: parsed.code,
          failureMessage: parsed.message,
          retryable: !permanent && this.runners.has(queued.kind),
          retryReason: permanent ? parsed.message : null,
        });
      }
    } finally {
      this.running.delete(jobId);
      this.aborts.delete(jobId);
      this.active = Math.max(0, this.active - 1);
      this.pump();
    }
  }

  /**
   * `toProjectError` defaults unknown failures to a storage-write code, which is right for
   * a persistence call and wrong for a job. An unclassified runner failure reports
   * JOB_FAILED with the runner's own message rather than blaming project storage.
   */
  private classifyFailure(error: unknown): ProjectError {
    if (error instanceof ProjectError) return error;
    const parsed = toProjectError(error);
    if (parsed.code !== "UNEXPECTED_FAILURE") return parsed;
    const message = error instanceof Error && error.message ? error.message : "The job stopped before finishing.";
    return new ProjectError("JOB_FAILED", message, { cause: error });
  }

  private async transition(
    jobId: string,
    status: JobRecord["status"],
    progress: Partial<JobProgress>,
    extra: {
      outputIds?: string[];
      derivativeIds?: string[];
      failureCode?: string;
      failureMessage?: string;
      retryable?: boolean;
      retryReason?: string | null;
      cancelRequested?: boolean;
      ranInWorker?: boolean;
    } = {},
  ): Promise<JobRecord> {
    const current = await this.getJob(jobId);
    if (!canTransition(current.status, status)) return current;

    const timestamp = this.now().toISOString();
    const nextProgress = { ...current.progress, ...progress };
    // Progress is monotonic: a late message must never walk a completed count backwards.
    const completedUnits = nextProgress.completedUnits === null || nextProgress.completedUnits === undefined
      ? current.progress.completedUnits
      : Math.max(current.progress.completedUnits ?? 0, nextProgress.completedUnits);

    const next = jobRecordSchema.parse({
      ...current,
      status,
      progress: {
        ...nextProgress,
        completedUnits,
        // Progress can only be determinate when a real total exists; never fabricate a ratio.
        determinate: nextProgress.totalUnits !== null && nextProgress.totalUnits !== undefined,
      },
      outputIds: extra.outputIds ?? current.outputIds,
      derivativeIds: extra.derivativeIds
        ? [...new Set([...current.derivativeIds, ...extra.derivativeIds])].slice(0, 512)
        : current.derivativeIds,
      failureCode: extra.failureCode ?? current.failureCode,
      failureMessage: extra.failureMessage ?? current.failureMessage,
      retryable: extra.retryable ?? current.retryable,
      retryReason: extra.retryReason !== undefined ? extra.retryReason : current.retryReason,
      cancelRequested: extra.cancelRequested ?? current.cancelRequested,
      ranInWorker: extra.ranInWorker ?? current.ranInWorker,
      startedAt: status === "running" ? current.startedAt ?? timestamp : current.startedAt,
      endedAt: isTerminalJobStatus(status) ? timestamp : current.endedAt,
    });
    await this.database.jobs.put(next);
    this.notify(next);
    return next;
  }

  /** Accepts a record written by an older schema so a reload never loses job history. */
  private normalize(job: JobRecord | Record<string, unknown>): JobRecord {
    const candidate = job as Record<string, unknown>;
    if (candidate.schemaVersion === 2) return job as JobRecord;
    return jobRecordSchema.parse({
      ...candidate,
      schemaVersion: 2,
      priority: candidate.priority ?? "user",
      intent: candidate.intent ?? { kind: candidate.kind, payloadVersion: 1, payload: {} },
      targetIds: candidate.targetIds ?? [],
      sourceRevisionId: candidate.sourceRevisionId ?? null,
      derivativeIds: candidate.derivativeIds ?? [],
      retryable: candidate.retryable ?? false,
      cancelRequested: candidate.cancelRequested ?? false,
      ranInWorker: candidate.ranInWorker ?? false,
    });
  }

  private notify(job: JobRecord): void {
    this.listeners.forEach((listener) => listener(job));
  }
}
