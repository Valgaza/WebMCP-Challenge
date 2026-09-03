import { ProjectError } from "../domain/project-error";
import {
  WORKER_PROTOCOL_VERSION,
  currentWorkerCapabilities,
  type WorkerCapabilityProfile,
  type WorkerRequest,
  type WorkerResponse,
  type WorkerTaskKind,
} from "../workers/worker-protocol";

export interface WorkerTaskOptions {
  jobId?: string | null;
  projectId?: string | null;
  sourceRevision?: number | null;
  onProgress?: (stage: string, completedUnits: number | null, totalUnits: number | null) => void;
  onWarning?: (message: string) => void;
  /** Aborting reaches the worker as a real cancel message, not just an abandoned promise. */
  signal?: AbortSignal;
  transfer?: Transferable[];
}

export interface MediaWorkerClient {
  available: boolean;
  capabilities: WorkerCapabilityProfile;
  run: <Result>(kind: WorkerTaskKind, payload: unknown, options?: WorkerTaskOptions) => Promise<Result>;
  /** Number of tasks currently in flight, used by the job scheduler to pace work. */
  inFlight: () => number;
  dispose: () => void;
}

interface PendingTask {
  resolve: (value: never) => void;
  reject: (error: unknown) => void;
  options: WorkerTaskOptions;
}

/**
 * Talks to `media-worker.ts` over the typed protocol.
 *
 * A single worker is enough: the tasks it runs are already chunked and cancellable, and a
 * pool would mostly compete for the same decoder. What matters is that this work is off the
 * interaction thread and can be stopped.
 */
export function createMediaWorkerClient(): MediaWorkerClient {
  const pending = new Map<string, PendingTask>();
  let worker: Worker | null = null;
  let failedToStart = false;

  function ensureWorker(): Worker | null {
    if (worker || failedToStart) return worker;
    if (typeof Worker !== "function") { failedToStart = true; return null; }
    try {
      worker = new Worker(new URL("../workers/media-worker.ts", import.meta.url), { type: "module" });
      worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
        const message = event.data;
        const task = pending.get(message.taskId);
        if (!task) return;
        if (message.type === "progress") {
          task.options.onProgress?.(message.stage, message.completedUnits, message.totalUnits);
          return;
        }
        if (message.type === "warning") {
          task.options.onWarning?.(message.message);
          return;
        }
        pending.delete(message.taskId);
        if (message.type === "result") { task.resolve(message.result as never); return; }
        if (message.type === "cancelled") {
          task.reject(new ProjectError("JOB_FAILED", "The task was cancelled before it finished."));
          return;
        }
        task.reject(new ProjectError(
          message.code === "CAPABILITY_UNAVAILABLE" ? "CAPABILITY_UNAVAILABLE"
            : message.code === "MEDIA_DECODE_FAILED" ? "MEDIA_DECODE_FAILED"
            : message.code === "INVALID_INPUT" ? "INVALID_INPUT"
            : "JOB_FAILED",
          message.message,
        ));
      });
      worker.addEventListener("error", () => {
        // A worker that dies takes every in-flight task with it; failing them explicitly is
        // better than leaving promises that never settle.
        for (const [taskId, task] of pending) {
          pending.delete(taskId);
          task.reject(new ProjectError("JOB_FAILED", "The media worker stopped unexpectedly."));
        }
        worker?.terminate();
        worker = null;
      });
    } catch {
      failedToStart = true;
      worker = null;
    }
    return worker;
  }

  const capabilities = currentWorkerCapabilities();

  return {
    get available() { return typeof Worker === "function" && !failedToStart; },
    capabilities,
    inFlight: () => pending.size,

    run: <Result>(kind: WorkerTaskKind, payload: unknown, options: WorkerTaskOptions = {}): Promise<Result> => {
      const active = ensureWorker();
      if (!active) {
        return Promise.reject(new ProjectError("CAPABILITY_UNAVAILABLE", "This browser cannot run Estro's media worker."));
      }
      const taskId = crypto.randomUUID();
      const request: WorkerRequest = {
        protocolVersion: WORKER_PROTOCOL_VERSION,
        type: "task",
        taskId,
        jobId: options.jobId ?? null,
        projectId: options.projectId ?? null,
        sourceRevision: options.sourceRevision ?? null,
        kind,
        payload,
        capabilities,
      };

      return new Promise<Result>((resolve, reject) => {
        pending.set(taskId, { resolve: resolve as (value: never) => void, reject, options });

        const abort = () => {
          active.postMessage({ protocolVersion: WORKER_PROTOCOL_VERSION, type: "cancel", taskId } satisfies WorkerRequest);
        };
        if (options.signal) {
          if (options.signal.aborted) { abort(); }
          else options.signal.addEventListener("abort", abort, { once: true });
        }

        try {
          active.postMessage(request, options.transfer ?? []);
        } catch (error) {
          pending.delete(taskId);
          reject(new ProjectError("JOB_FAILED", "The media worker rejected that task's payload.", { cause: error }));
        }
      });
    },

    dispose: () => {
      worker?.terminate();
      worker = null;
      pending.clear();
    },
  };
}

/**
 * A client that reports itself unavailable. Used in tests and in runtimes without workers,
 * so callers take their documented main-thread fallback rather than hanging.
 */
export function createUnavailableWorkerClient(): MediaWorkerClient {
  return {
    available: false,
    capabilities: { offscreenCanvas: false, imageBitmap: false, subtleCrypto: false, webAudio: false },
    run: () => Promise.reject(new ProjectError("CAPABILITY_UNAVAILABLE", "No media worker is available in this runtime.")),
    inFlight: () => 0,
    dispose: () => undefined,
  };
}

let shared: MediaWorkerClient | null = null;

export function sharedMediaWorker(): MediaWorkerClient {
  if (!shared) shared = createMediaWorkerClient();
  return shared;
}
