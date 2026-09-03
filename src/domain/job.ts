import { z } from "zod";

export const JOB_SCHEMA_VERSION = 2 as const;

/**
 * Jobs move forward only. A terminal status is never left, which lets the UI and WebMCP
 * report a stable outcome without re-reading a moving target.
 *
 * `interrupted` exists because a page reload kills in-flight work: a job left as `running`
 * after a reload would be a lie. `cancelling` exists because cancellation now has to reach a
 * worker, which takes a moment the interface should show rather than hide.
 */
export const jobStatusSchema = z.enum([
  "queued", "running", "cancelling", "complete", "failed", "cancelled", "interrupted",
]);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ["complete", "failed", "cancelled", "interrupted"];

export function isTerminalJobStatus(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status);
}

export const jobKindSchema = z.enum([
  "asset_import", "asset_probe", "thumbnail", "proxy", "waveform",
  "preview_render", "image_resample", "sequence_render", "export", "audio_export",
]);
export type JobKind = z.infer<typeof jobKindSchema>;

/**
 * Interaction beats user-requested work, which beats background derivatives. Without this a
 * batch of proxy builds starves the preview the user is actually looking at.
 */
export const jobPrioritySchema = z.enum(["interactive", "user", "background"]);
export type JobPriority = z.infer<typeof jobPrioritySchema>;

export const JOB_PRIORITY_ORDER: Record<JobPriority, number> = { interactive: 0, user: 1, background: 2 };

/**
 * Progress is optional on purpose. The blueprint forbids fake percentages, so a job that
 * cannot measure itself reports its stage and processed units instead of inventing a ratio.
 */
export const jobProgressSchema = z.object({
  stage: z.string().min(1).max(80),
  determinate: z.boolean(),
  completedUnits: z.number().int().min(0).nullable(),
  totalUnits: z.number().int().min(0).nullable(),
});
export type JobProgress = z.infer<typeof jobProgressSchema>;

/**
 * What the job was asked to do, in a form that survives a reload.
 *
 * A retry closure held in memory is not a retryable job: the closure dies with the page, and
 * the record left behind claims a retry that cannot happen. Persisting the intent instead
 * means a runner registered for the kind can pick the work up again from the record alone.
 */
export const jobIntentSchema = z.object({
  kind: jobKindSchema,
  payloadVersion: z.number().int().min(1).default(1),
  /** Serializable arguments only; never handles, closures, or DOM references. */
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type JobIntent = z.infer<typeof jobIntentSchema>;

export const jobRecordSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(JOB_SCHEMA_VERSION),
  projectId: z.string().min(1),
  kind: jobKindSchema,
  status: jobStatusSchema,
  priority: jobPrioritySchema.default("user"),
  label: z.string().min(1).max(120),
  progress: jobProgressSchema,
  intent: jobIntentSchema,
  /** IDs of the target objects, so a caller can relate a job to what it is changing. */
  targetIds: z.array(z.string().min(1)).max(64).default([]),
  /** The project revision the job was compiled against. */
  sourceRevisionId: z.string().min(1).nullable().default(null),
  outputIds: z.array(z.string().min(1)).max(512),
  derivativeIds: z.array(z.string().min(1)).max(512).default([]),
  warnings: z.array(z.string().min(1)).max(32),
  failureCode: z.string().min(1).nullable(),
  failureMessage: z.string().min(1).nullable(),
  retryable: z.boolean().default(false),
  /** Why a retry is refused, in the words the user will read. Null when it is offered. */
  retryReason: z.string().min(1).max(300).nullable().default(null),
  retryOfJobId: z.string().min(1).nullable(),
  cancellable: z.boolean(),
  /** True once the interface has asked for cancellation but the worker has not stopped yet. */
  cancelRequested: z.boolean().default(false),
  ranInWorker: z.boolean().default(false),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  endedAt: z.string().datetime().nullable(),
});
export type JobRecord = z.infer<typeof jobRecordSchema>;

export function createQueuedJob(input: {
  id: string;
  projectId: string;
  kind: JobKind;
  label: string;
  stage: string;
  intent: JobIntent;
  priority?: JobPriority;
  targetIds?: string[];
  sourceRevisionId?: string | null;
  totalUnits?: number | null;
  cancellable?: boolean;
  retryOfJobId?: string | null;
  createdAt: string;
}): JobRecord {
  const totalUnits = input.totalUnits ?? null;
  return jobRecordSchema.parse({
    id: input.id,
    schemaVersion: JOB_SCHEMA_VERSION,
    projectId: input.projectId,
    kind: input.kind,
    status: "queued",
    priority: input.priority ?? "user",
    label: input.label,
    progress: {
      stage: input.stage,
      determinate: totalUnits !== null,
      completedUnits: totalUnits === null ? null : 0,
      totalUnits,
    },
    intent: jobIntentSchema.parse(input.intent),
    targetIds: input.targetIds ?? [],
    sourceRevisionId: input.sourceRevisionId ?? null,
    outputIds: [],
    derivativeIds: [],
    warnings: [],
    failureCode: null,
    failureMessage: null,
    retryable: false,
    retryReason: null,
    retryOfJobId: input.retryOfJobId ?? null,
    cancellable: input.cancellable ?? true,
    cancelRequested: false,
    ranInWorker: false,
    createdAt: input.createdAt,
    startedAt: null,
    endedAt: null,
  });
}

/**
 * Guards the one rule the whole job contract rests on: a job that has finished stays
 * finished. Without this a late worker message could resurrect a cancelled job and
 * silently continue work the user already stopped.
 */
export function canTransition(from: JobStatus, to: JobStatus): boolean {
  if (isTerminalJobStatus(from)) return false;
  if (from === to) return to === "running";
  if (from === "queued") return to === "running" || to === "cancelled" || to === "failed" || to === "interrupted";
  if (from === "running") {
    return to === "cancelling" || to === "complete" || to === "failed" || to === "cancelled" || to === "interrupted";
  }
  // Cancelling can still finish: work that completed before the stop signal landed is real.
  return to === "cancelled" || to === "failed" || to === "complete" || to === "interrupted";
}

export function summarizeJob(job: JobRecord): string {
  const { progress } = job;
  if (job.status === "complete") return `${job.label} finished.`;
  if (job.status === "failed") return `${job.label} failed. ${job.failureMessage ?? "No further detail is available."}`;
  if (job.status === "cancelled") return `${job.label} was cancelled.`;
  if (job.status === "interrupted") return `${job.label} was interrupted before it finished. It can be started again.`;
  if (job.status === "cancelling") return `${job.label} is stopping.`;
  if (job.status === "queued") return `${job.label} is waiting to start.`;
  if (progress.determinate && progress.totalUnits) {
    return `${job.label}: ${progress.stage} (${progress.completedUnits ?? 0} of ${progress.totalUnits}).`;
  }
  return `${job.label}: ${progress.stage}.`;
}

/** Human wording for the lifecycle, shared by the Job Center and WebMCP summaries. */
export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  queued: "Queued",
  running: "Running",
  cancelling: "Stopping",
  complete: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
};
