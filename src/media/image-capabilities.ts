import { SUPPORTED_IMAGE_TYPES, type SupportedImageType } from "../domain/asset";
import { decodeImageBlob } from "./decode-image";

export interface ImageFormatSupport {
  mediaType: SupportedImageType;
  decode: boolean;
  encode: boolean;
}

export interface MediaCapabilityReport {
  imageBitmap: boolean;
  offscreenCanvas: boolean;
  fileSystemAccess: boolean;
  originPrivateFileSystem: boolean;
  webWorkers: boolean;
  subtleCrypto: boolean;
  formats: ImageFormatSupport[];
}

/**
 * One-pixel samples of each format. Attempting a real decode is the only trustworthy test:
 * AVIF and WebP support varies by browser build, and a MIME-type guess would let Estro
 * register capability it does not have.
 */
const FORMAT_PROBES: Record<SupportedImageType, string> = {
  "image/jpeg":
    "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "image/png":
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "image/webp": "data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=",
  "image/avif":
    "data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAEAAAABAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQAMAAAAABNjb2xybmNseAACAAIABoAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgABogQEDQgMgkQAAAAB8dSLfI=",
  "image/gif": "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
};

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const [header, base64] = dataUrl.split(",");
  const mediaType = header.slice(header.indexOf(":") + 1, header.indexOf(";"));
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mediaType });
}

async function canDecode(mediaType: SupportedImageType): Promise<boolean> {
  try {
    // Probe through the same decoder the import path uses, so the report matches reality.
    const bitmap = await decodeImageBlob(await dataUrlToBlob(FORMAT_PROBES[mediaType]));
    bitmap.close?.();
    return true;
  } catch {
    return false;
  }
}

async function canEncode(mediaType: SupportedImageType): Promise<boolean> {
  if (typeof OffscreenCanvas !== "function") return false;
  try {
    const canvas = new OffscreenCanvas(1, 1);
    const context = canvas.getContext("2d");
    if (!context) return false;
    const blob = await canvas.convertToBlob({ type: mediaType });
    // A browser that cannot encode the requested type silently substitutes PNG, so the
    // returned type must be checked rather than trusted.
    return blob.type === mediaType;
  } catch {
    return false;
  }
}

let cached: MediaCapabilityReport | null = null;

/**
 * Probes once per session. Capability discovery must reflect what this runtime can really
 * do, so the result is measured rather than assumed, then reused.
 */
export async function detectMediaCapabilities(force = false): Promise<MediaCapabilityReport> {
  if (cached && !force) return cached;

  const formats: ImageFormatSupport[] = [];
  for (const mediaType of SUPPORTED_IMAGE_TYPES) {
    formats.push({ mediaType, decode: await canDecode(mediaType), encode: await canEncode(mediaType) });
  }

  cached = {
    imageBitmap: typeof createImageBitmap === "function",
    offscreenCanvas: typeof OffscreenCanvas === "function",
    fileSystemAccess: typeof (globalThis as { showOpenFilePicker?: unknown }).showOpenFilePicker === "function",
    originPrivateFileSystem: typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function",
    webWorkers: typeof Worker === "function",
    subtleCrypto: typeof crypto !== "undefined" && typeof crypto.subtle?.digest === "function",
    formats,
  };
  return cached;
}

export function resetMediaCapabilityCache(): void {
  cached = null;
}

export function decodableTypes(report: MediaCapabilityReport): SupportedImageType[] {
  return report.formats.filter((format) => format.decode).map((format) => format.mediaType);
}

export function encodableTypes(report: MediaCapabilityReport): SupportedImageType[] {
  return report.formats.filter((format) => format.encode).map((format) => format.mediaType);
}
