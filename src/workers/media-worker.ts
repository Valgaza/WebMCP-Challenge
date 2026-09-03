/// <reference lib="webworker" />
import {
  WORKER_PROTOCOL_VERSION,
  type EncodeWavTaskPayload,
  type EncodeWavTaskResult,
  type HashTaskPayload,
  type HashTaskResult,
  type HistogramTaskPayload,
  type HistogramTaskResult,
  type RasterizeTaskPayload,
  type RasterizeTaskResult,
  type ResampleAlgorithm,
  type ResampleTaskPayload,
  type ResampleTaskResult,
  type WaveformTaskPayload,
  type WaveformTaskResult,
  type WaveformTier,
  type WorkerRequest,
  type WorkerResponse,
  type WorkerTaskEnvelope,
} from "./worker-protocol";
import { computeHistogram } from "../render/histogram";

/**
 * Estro's media worker.
 *
 * Everything expensive that does not need the DOM runs here: hashing, downscaling,
 * resampling, waveform peak pyramids, histograms, and PCM encoding. Cancellation is checked
 * between units of work, so stopping a job actually stops the decode loop rather than only
 * updating a record on the main thread.
 */

const scope = self as unknown as DedicatedWorkerGlobalScope;
const cancelled = new Set<string>();

function post(message: WorkerResponse, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}

function progress(taskId: string, stage: string, completedUnits: number | null = null, totalUnits: number | null = null): void {
  post({ type: "progress", taskId, stage, completedUnits, totalUnits });
}

function isCancelled(taskId: string): boolean {
  return cancelled.has(taskId);
}

class WorkerTaskError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

/* --------------------------------- hashing --------------------------------- */

async function runHash(taskId: string, payload: HashTaskPayload): Promise<HashTaskResult> {
  progress(taskId, "Fingerprinting the file");
  if (typeof crypto === "undefined" || typeof crypto.subtle?.digest !== "function") {
    throw new WorkerTaskError("CAPABILITY_UNAVAILABLE", "This browser cannot compute a content hash for imported media.");
  }
  const digest = await crypto.subtle.digest("SHA-256", payload.bytes);
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return { contentHash: hex };
}

/* ------------------------------- image decode ------------------------------ */

async function decode(blob: Blob): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== "function") {
    throw new WorkerTaskError("CAPABILITY_UNAVAILABLE", "This worker cannot decode images.");
  }
  try {
    return await createImageBitmap(blob);
  } catch (error) {
    throw new WorkerTaskError("MEDIA_DECODE_FAILED", `This image could not be decoded in a worker: ${(error as Error)?.message ?? "unknown reason"}.`);
  }
}

function makeCanvas(width: number, height: number): OffscreenCanvas {
  if (typeof OffscreenCanvas !== "function") {
    throw new WorkerTaskError("CAPABILITY_UNAVAILABLE", "This browser cannot render images off the main thread.");
  }
  return new OffscreenCanvas(width, height);
}

async function encodeCanvas(
  canvas: OffscreenCanvas,
  preferredType: string,
  quality: number,
): Promise<{ blob: Blob; substituted: boolean }> {
  try {
    const blob = await canvas.convertToBlob({ type: preferredType, quality });
    return { blob, substituted: blob.type !== preferredType };
  } catch {
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return { blob, substituted: true };
  }
}

function fitWithin(widthPx: number, heightPx: number, maxEdge: number): { width: number; height: number } {
  if (maxEdge <= 0) return { width: widthPx, height: heightPx };
  const longest = Math.max(widthPx, heightPx);
  if (longest <= maxEdge) return { width: widthPx, height: heightPx };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(widthPx * scale)), height: Math.max(1, Math.round(heightPx * scale)) };
}

async function runRasterize(taskId: string, payload: RasterizeTaskPayload): Promise<RasterizeTaskResult> {
  progress(taskId, "Decoding");
  const bitmap = await decode(payload.blob);
  try {
    if (isCancelled(taskId)) throw new WorkerTaskError("CANCELLED", "Cancelled.");
    const size = fitWithin(bitmap.width, bitmap.height, payload.maxEdgePx);
    progress(taskId, `Resizing to ${size.width} × ${size.height}`);
    const canvas = makeCanvas(size.width, size.height);
    const context = canvas.getContext("2d");
    if (!context) throw new WorkerTaskError("CAPABILITY_UNAVAILABLE", "This worker did not provide a 2D drawing context.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    progress(taskId, "Encoding");
    const encoded = await encodeCanvas(canvas, payload.preferredType, payload.quality);
    return {
      blob: encoded.blob, widthPx: size.width, heightPx: size.height,
      mediaType: encoded.blob.type || payload.preferredType, substituted: encoded.substituted,
    };
  } finally {
    bitmap.close?.();
  }
}

/* -------------------------------- resampling ------------------------------- */

/** Lanczos-3 kernel. Sharper than bilinear on downscale and well defined on upscale. */
function lanczos(x: number, a = 3): number {
  if (x === 0) return 1;
  if (Math.abs(x) >= a) return 0;
  const piX = Math.PI * x;
  return (a * Math.sin(piX) * Math.sin(piX / a)) / (piX * piX);
}

/**
 * Separable resampling over raw RGBA. Doing the arithmetic explicitly is the point: canvas
 * scaling gives whatever the browser feels like, which cannot be reported to a user as a
 * chosen algorithm.
 */
function resamplePixels(
  source: ImageData,
  targetWidth: number,
  targetHeight: number,
  algorithm: Exclude<ResampleAlgorithm, "browser-smooth">,
): ImageData {
  const { width: sourceWidth, height: sourceHeight, data: sourceData } = source;
  const horizontal = new Float32Array(targetWidth * sourceHeight * 4);
  const scaleX = targetWidth / sourceWidth;
  const scaleY = targetHeight / sourceHeight;
  const radiusX = algorithm === "lanczos3" ? 3 / Math.min(1, scaleX) : algorithm === "bilinear" ? 1 / Math.min(1, scaleX) : 0.5;
  const radiusY = algorithm === "lanczos3" ? 3 / Math.min(1, scaleY) : algorithm === "bilinear" ? 1 / Math.min(1, scaleY) : 0.5;

  const weight = (distance: number, scale: number): number => {
    if (algorithm === "nearest") return Math.abs(distance) <= 0.5 ? 1 : 0;
    const normalized = distance * Math.min(1, scale);
    if (algorithm === "bilinear") return Math.max(0, 1 - Math.abs(normalized));
    return lanczos(normalized);
  };

  for (let x = 0; x < targetWidth; x += 1) {
    const center = (x + 0.5) / scaleX - 0.5;
    const first = Math.max(0, Math.floor(center - radiusX));
    const last = Math.min(sourceWidth - 1, Math.ceil(center + radiusX));
    const weights: number[] = [];
    let total = 0;
    for (let sx = first; sx <= last; sx += 1) {
      const w = weight(sx - center, scaleX);
      weights.push(w);
      total += w;
    }
    if (total === 0) total = 1;

    for (let y = 0; y < sourceHeight; y += 1) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let index = 0; index < weights.length; index += 1) {
        const sx = first + index;
        const offset = (y * sourceWidth + sx) * 4;
        const w = weights[index];
        r += sourceData[offset] * w;
        g += sourceData[offset + 1] * w;
        b += sourceData[offset + 2] * w;
        a += sourceData[offset + 3] * w;
      }
      const target = (y * targetWidth + x) * 4;
      horizontal[target] = r / total;
      horizontal[target + 1] = g / total;
      horizontal[target + 2] = b / total;
      horizontal[target + 3] = a / total;
    }
  }

  const output = new Uint8ClampedArray(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y += 1) {
    const center = (y + 0.5) / scaleY - 0.5;
    const first = Math.max(0, Math.floor(center - radiusY));
    const last = Math.min(sourceHeight - 1, Math.ceil(center + radiusY));
    const weights: number[] = [];
    let total = 0;
    for (let sy = first; sy <= last; sy += 1) {
      const w = weight(sy - center, scaleY);
      weights.push(w);
      total += w;
    }
    if (total === 0) total = 1;

    for (let x = 0; x < targetWidth; x += 1) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let index = 0; index < weights.length; index += 1) {
        const sy = first + index;
        const offset = (sy * targetWidth + x) * 4;
        const w = weights[index];
        r += horizontal[offset] * w;
        g += horizontal[offset + 1] * w;
        b += horizontal[offset + 2] * w;
        a += horizontal[offset + 3] * w;
      }
      const target = (y * targetWidth + x) * 4;
      output[target] = r / total;
      output[target + 1] = g / total;
      output[target + 2] = b / total;
      output[target + 3] = a / total;
    }
  }

  return new ImageData(output, targetWidth, targetHeight);
}

async function runResample(taskId: string, payload: ResampleTaskPayload): Promise<ResampleTaskResult> {
  progress(taskId, "Decoding");
  const bitmap = await decode(payload.blob);
  try {
    const sourceCanvas = makeCanvas(bitmap.width, bitmap.height);
    const sourceContext = sourceCanvas.getContext("2d");
    if (!sourceContext) throw new WorkerTaskError("CAPABILITY_UNAVAILABLE", "This worker did not provide a 2D drawing context.");
    sourceContext.drawImage(bitmap, 0, 0);

    const target = makeCanvas(payload.targetWidthPx, payload.targetHeightPx);
    const targetContext = target.getContext("2d");
    if (!targetContext) throw new WorkerTaskError("CAPABILITY_UNAVAILABLE", "This worker did not provide a 2D drawing context.");

    if (payload.algorithm === "browser-smooth") {
      progress(taskId, "Scaling with the browser's own filter");
      targetContext.imageSmoothingEnabled = true;
      targetContext.imageSmoothingQuality = "high";
      targetContext.drawImage(bitmap, 0, 0, payload.targetWidthPx, payload.targetHeightPx);
    } else {
      progress(taskId, `Resampling with ${payload.algorithm}`);
      const source = sourceContext.getImageData(0, 0, bitmap.width, bitmap.height);
      if (isCancelled(taskId)) throw new WorkerTaskError("CANCELLED", "Cancelled.");
      const resampled = resamplePixels(source, payload.targetWidthPx, payload.targetHeightPx, payload.algorithm);
      targetContext.putImageData(resampled, 0, 0);
    }

    progress(taskId, "Encoding");
    const encoded = await encodeCanvas(target, payload.outputType, payload.quality);
    return {
      blob: encoded.blob,
      widthPx: payload.targetWidthPx,
      heightPx: payload.targetHeightPx,
      mediaType: encoded.blob.type || payload.outputType,
      algorithm: payload.algorithm,
      substituted: encoded.substituted,
    };
  } finally {
    bitmap.close?.();
  }
}

/* --------------------------------- waveform -------------------------------- */

/**
 * Builds a min/max peak pyramid. One resolution is not enough: a timeline zoomed out needs
 * coarse buckets to draw at all, and zoomed in needs fine ones to be truthful.
 */
function buildTier(channelData: Float32Array[], buckets: number): WaveformTier {
  const peaks: number[][] = [];
  for (const channel of channelData) {
    const perBucket = Math.max(1, Math.floor(channel.length / buckets));
    const values = new Array<number>(buckets * 2).fill(0);
    for (let index = 0; index < buckets; index += 1) {
      const start = index * perBucket;
      const end = Math.min(channel.length, start + perBucket);
      let min = 0;
      let max = 0;
      for (let offset = start; offset < end; offset += 1) {
        const value = channel[offset];
        if (value < min) min = value;
        if (value > max) max = value;
      }
      values[index * 2] = min;
      values[index * 2 + 1] = max;
    }
    peaks.push(values);
  }
  return { buckets, peaks };
}

async function runWaveform(taskId: string, payload: WaveformTaskPayload): Promise<WaveformTaskResult> {
  const channels = payload.channelData.length;
  if (!channels) throw new WorkerTaskError("MEDIA_DECODE_FAILED", "That audio decoded to no channels.");
  const frames = payload.channelData[0].length;
  const tiers: WaveformTier[] = [];
  const sorted = [...payload.tiers].sort((a, b) => a - b);

  for (let index = 0; index < sorted.length; index += 1) {
    if (isCancelled(taskId)) throw new WorkerTaskError("CANCELLED", "Cancelled.");
    progress(taskId, `Building waveform tier ${index + 1} of ${sorted.length}`, index, sorted.length);
    tiers.push(buildTier(payload.channelData, Math.min(sorted[index], Math.max(1, frames))));
  }

  return {
    tiers,
    sampleRateHz: payload.sampleRateHz,
    channels,
    durationSeconds: frames / Math.max(1, payload.sampleRateHz),
  };
}

/* -------------------------------- histogram -------------------------------- */

/**
 * The binning itself lives in `render/histogram` so the worker and the main-thread fallback
 * cannot drift apart. Only the loop's cost moves off the interaction thread.
 */
async function runHistogram(taskId: string, payload: HistogramTaskPayload): Promise<HistogramTaskResult> {
  progress(taskId, "Measuring tones");
  return { histogram: computeHistogram(payload.pixels) };
}

/* ------------------------------- WAV encoding ------------------------------ */

/**
 * Linear PCM is the one audio format a browser can be made to produce with certainty, so it
 * is written by hand here rather than advertised through an encoder that may not exist.
 */
function encodeWav(channelData: Float32Array[], sampleRateHz: number, bitDepth: 16 | 24 | 32): Blob {
  const channels = channelData.length;
  const frames = channelData[0]?.length ?? 0;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = channels * bytesPerSample;
  const dataBytes = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeText = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  // Format 3 is IEEE float; 32-bit output stays float to avoid a second quantization step.
  view.setUint16(20, bitDepth === 32 ? 3 : 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(28, sampleRateHz * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeText(36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channelData[channel][frame] ?? 0));
      if (bitDepth === 16) {
        view.setInt16(offset, Math.round(sample * 32767), true);
        offset += 2;
      } else if (bitDepth === 24) {
        const value = Math.round(sample * 8388607);
        view.setUint8(offset, value & 0xff);
        view.setUint8(offset + 1, (value >> 8) & 0xff);
        view.setUint8(offset + 2, (value >> 16) & 0xff);
        offset += 3;
      } else {
        view.setFloat32(offset, sample, true);
        offset += 4;
      }
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

async function runEncodeWav(taskId: string, payload: EncodeWavTaskPayload): Promise<EncodeWavTaskResult> {
  progress(taskId, "Writing PCM");
  const blob = encodeWav(payload.channelData, payload.sampleRateHz, payload.bitDepth);
  const frames = payload.channelData[0]?.length ?? 0;
  return {
    blob,
    byteSize: blob.size,
    durationSeconds: frames / Math.max(1, payload.sampleRateHz),
    channels: payload.channelData.length,
    sampleRateHz: payload.sampleRateHz,
  };
}

/* --------------------------------- dispatch -------------------------------- */

async function runTask(envelope: WorkerTaskEnvelope): Promise<unknown> {
  switch (envelope.kind) {
    case "hash": return runHash(envelope.taskId, envelope.payload as HashTaskPayload);
    case "rasterize": return runRasterize(envelope.taskId, envelope.payload as RasterizeTaskPayload);
    case "resample": return runResample(envelope.taskId, envelope.payload as ResampleTaskPayload);
    case "waveform": return runWaveform(envelope.taskId, envelope.payload as WaveformTaskPayload);
    case "histogram": return runHistogram(envelope.taskId, envelope.payload as HistogramTaskPayload);
    case "encode_wav": return runEncodeWav(envelope.taskId, envelope.payload as EncodeWavTaskPayload);
    default:
      throw new WorkerTaskError("INVALID_INPUT", `The media worker does not implement “${String(envelope.kind)}”.`);
  }
}

scope.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (!request || request.protocolVersion !== WORKER_PROTOCOL_VERSION) return;

  if (request.type === "cancel") {
    cancelled.add(request.taskId);
    return;
  }

  void (async () => {
    try {
      const result = await runTask(request);
      if (isCancelled(request.taskId)) {
        post({ type: "cancelled", taskId: request.taskId });
        return;
      }
      post({ type: "result", taskId: request.taskId, result });
    } catch (error) {
      if (isCancelled(request.taskId) || (error instanceof WorkerTaskError && error.code === "CANCELLED")) {
        post({ type: "cancelled", taskId: request.taskId });
        return;
      }
      const code = error instanceof WorkerTaskError ? error.code : "JOB_FAILED";
      const message = error instanceof Error ? error.message : "The media worker stopped unexpectedly.";
      post({ type: "failure", taskId: request.taskId, code, message });
    } finally {
      cancelled.delete(request.taskId);
    }
  })();
});
