/**
 * The message contract between the main thread and Estro's media worker.
 *
 * Every request carries a stable task ID, the operation kind, a typed payload, the capability
 * profile the caller believes the worker has, and enough provenance to attribute the result.
 * Cancellation is a first-class message rather than an abandoned promise, so a stopped job
 * really stops decoding instead of finishing invisibly.
 */

export const WORKER_PROTOCOL_VERSION = 1 as const;

export type WorkerTaskKind =
  | "hash"
  | "rasterize"
  | "resample"
  | "waveform"
  | "histogram"
  | "encode_wav";

export interface WorkerCapabilityProfile {
  offscreenCanvas: boolean;
  imageBitmap: boolean;
  subtleCrypto: boolean;
  webAudio: boolean;
}

export interface WorkerTaskEnvelope<Payload = unknown> {
  protocolVersion: typeof WORKER_PROTOCOL_VERSION;
  type: "task";
  taskId: string;
  jobId: string | null;
  projectId: string | null;
  sourceRevision: number | null;
  kind: WorkerTaskKind;
  payload: Payload;
  capabilities: WorkerCapabilityProfile;
}

export interface WorkerCancelEnvelope {
  protocolVersion: typeof WORKER_PROTOCOL_VERSION;
  type: "cancel";
  taskId: string;
}

export type WorkerRequest = WorkerTaskEnvelope | WorkerCancelEnvelope;

export interface WorkerProgressMessage {
  type: "progress";
  taskId: string;
  stage: string;
  completedUnits: number | null;
  totalUnits: number | null;
}

export interface WorkerWarningMessage {
  type: "warning";
  taskId: string;
  message: string;
}

export interface WorkerResultMessage<Result = unknown> {
  type: "result";
  taskId: string;
  result: Result;
}

export interface WorkerFailureMessage {
  type: "failure";
  taskId: string;
  code: string;
  message: string;
}

export interface WorkerCancelledMessage {
  type: "cancelled";
  taskId: string;
}

export type WorkerResponse =
  | WorkerProgressMessage
  | WorkerWarningMessage
  | WorkerResultMessage
  | WorkerFailureMessage
  | WorkerCancelledMessage;

/* ------------------------------- task payloads ------------------------------- */

export interface HashTaskPayload {
  /** Sampled bytes for large files; the caller decides how much identity it needs. */
  bytes: ArrayBuffer;
  declaredByteSize: number;
}

export interface HashTaskResult {
  contentHash: string;
}

export interface RasterizeTaskPayload {
  blob: Blob;
  maxEdgePx: number;
  preferredType: string;
  quality: number;
}

export interface RasterizeTaskResult {
  blob: Blob;
  widthPx: number;
  heightPx: number;
  mediaType: string;
  substituted: boolean;
}

/** Resampling algorithms Estro will actually perform, rather than leaving to canvas defaults. */
export const RESAMPLE_ALGORITHMS = ["nearest", "bilinear", "lanczos3", "browser-smooth"] as const;
export type ResampleAlgorithm = (typeof RESAMPLE_ALGORITHMS)[number];

export interface ResampleTaskPayload {
  blob: Blob;
  targetWidthPx: number;
  targetHeightPx: number;
  algorithm: ResampleAlgorithm;
  outputType: string;
  quality: number;
}

export interface ResampleTaskResult {
  blob: Blob;
  widthPx: number;
  heightPx: number;
  mediaType: string;
  algorithm: ResampleAlgorithm;
  substituted: boolean;
}

export interface WaveformTaskPayload {
  /** Already-decoded interleaved peaks are not enough; the worker needs the raw samples. */
  channelData: Float32Array[];
  sampleRateHz: number;
  /** Bucket counts, coarsest first, so the timeline can pick a tier per zoom level. */
  tiers: number[];
}

export interface WaveformTier {
  buckets: number;
  /** Min and max per bucket, per channel: [channel][bucket * 2] = min, +1 = max. */
  peaks: number[][];
}

export interface WaveformTaskResult {
  tiers: WaveformTier[];
  sampleRateHz: number;
  channels: number;
  durationSeconds: number;
}

export interface HistogramTaskPayload {
  pixels: Uint8ClampedArray;
  widthPx: number;
  heightPx: number;
}

export interface HistogramTaskResult {
  /** The same `Histogram` shape the main-thread path produces, so neither can drift. */
  histogram: import("../render/histogram").Histogram;
}

export interface EncodeWavTaskPayload {
  channelData: Float32Array[];
  sampleRateHz: number;
  bitDepth: 16 | 24 | 32;
}

export interface EncodeWavTaskResult {
  blob: Blob;
  byteSize: number;
  durationSeconds: number;
  channels: number;
  sampleRateHz: number;
}

export function currentWorkerCapabilities(scope: {
  OffscreenCanvas?: unknown;
  createImageBitmap?: unknown;
  crypto?: { subtle?: unknown };
  AudioContext?: unknown;
  OfflineAudioContext?: unknown;
} = globalThis as never): WorkerCapabilityProfile {
  return {
    offscreenCanvas: typeof scope.OffscreenCanvas === "function",
    imageBitmap: typeof scope.createImageBitmap === "function",
    subtleCrypto: typeof scope.crypto?.subtle === "object" && scope.crypto?.subtle !== null,
    webAudio: typeof scope.AudioContext === "function" || typeof scope.OfflineAudioContext === "function",
  };
}
