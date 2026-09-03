import { ProjectError } from "../domain/project-error";
import { decodeImageBlob } from "./decode-image";

/** Preview tiers trade fidelity for responsiveness. Bound to workspace state, never to a revision. */
export const PREVIEW_QUALITIES = ["draft", "balanced", "full"] as const;
export type PreviewQuality = (typeof PREVIEW_QUALITIES)[number];

export const THUMBNAIL_EDGE_PX = 256;

export const PROXY_EDGE_PX: Record<PreviewQuality, number> = {
  draft: 640,
  balanced: 1600,
  full: 0, // 0 means the original is used rather than a proxy.
};

export function proxyEdgeFor(quality: PreviewQuality): number {
  return PROXY_EDGE_PX[quality];
}

/** Preserves aspect ratio and never upscales, so a proxy is always cheaper than its original. */
export function fitWithin(widthPx: number, heightPx: number, maxEdge: number): { width: number; height: number } {
  if (maxEdge <= 0) return { width: widthPx, height: heightPx };
  const longest = Math.max(widthPx, heightPx);
  if (longest <= maxEdge) return { width: widthPx, height: heightPx };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(widthPx * scale)), height: Math.max(1, Math.round(heightPx * scale)) };
}

export interface RasterizeDeps {
  decode: (blob: Blob) => Promise<ImageBitmap>;
  createCanvas: (width: number, height: number) => OffscreenCanvas;
}

const defaultDeps: RasterizeDeps = {
  decode: decodeImageBlob,
  createCanvas: (width, height) => {
    if (typeof OffscreenCanvas !== "function") {
      throw new ProjectError("CAPABILITY_UNAVAILABLE", "This browser cannot render previews off the main thread.");
    }
    return new OffscreenCanvas(width, height);
  },
};

/**
 * Produces a downscaled copy of an image. Output is WebP when the browser can encode it and
 * PNG otherwise, and the actual returned type is reported so nothing downstream assumes a
 * format the runtime did not produce.
 */
export async function rasterizeDownscaled(
  file: Blob,
  maxEdge: number,
  deps: RasterizeDeps = defaultDeps,
): Promise<{ blob: Blob; width: number; height: number; mediaType: string }> {
  const bitmap = await deps.decode(file);
  try {
    const size = fitWithin(bitmap.width, bitmap.height, maxEdge);
    const canvas = deps.createCanvas(size.width, size.height);
    const context = canvas.getContext("2d");
    if (!context) throw new ProjectError("CAPABILITY_UNAVAILABLE", "This browser did not provide a 2D drawing context.");
    context.drawImage(bitmap, 0, 0, size.width, size.height);

    let blob: Blob;
    try {
      blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.82 });
    } catch {
      blob = await canvas.convertToBlob({ type: "image/png" });
    }
    return { blob, width: size.width, height: size.height, mediaType: blob.type };
  } finally {
    bitmap.close?.();
  }
}
