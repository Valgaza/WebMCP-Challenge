import { MAX_ASSET_BYTES, MAX_ASSET_PIXELS_PER_AXIS, isDecodableImageType, type SupportedImageType } from "../domain/asset";
import { ProjectError } from "../domain/project-error";
import { decodeImageSize } from "./decode-image";

export interface ProbedImage {
  mediaType: SupportedImageType;
  widthPx: number;
  heightPx: number;
  byteSize: number;
  contentHash: string;
}

/**
 * Injected so the probe can be tested without a real image decoder, and so a worker or a
 * future codec path can be substituted without changing callers.
 */
export interface ImageProbeDeps {
  decodeSize: (blob: Blob) => Promise<{ width: number; height: number }>;
  hash: (bytes: ArrayBuffer) => Promise<string>;
}

async function defaultDecodeSize(blob: Blob): Promise<{ width: number; height: number }> {
  return decodeImageSize(blob);
}

async function defaultHash(bytes: ArrayBuffer): Promise<string> {
  if (typeof crypto === "undefined" || typeof crypto.subtle?.digest !== "function") {
    throw new ProjectError("CAPABILITY_UNAVAILABLE", "This browser cannot compute a content hash for imported media.");
  }
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const defaultImageProbeDeps: ImageProbeDeps = { decodeSize: defaultDecodeSize, hash: defaultHash };

/**
 * Validates untrusted media before anything else touches it. Type, size, and dimensions are
 * all checked against declared bounds, and the reported MIME type is never trusted on its
 * own — a file that will not decode is rejected regardless of what it claims to be.
 */
export async function probeImage(file: File, deps: ImageProbeDeps = defaultImageProbeDeps): Promise<ProbedImage> {
  if (file.size === 0) {
    throw new ProjectError("INVALID_INPUT", `“${file.name}” is empty.`, { fieldPath: "file" });
  }
  if (file.size > MAX_ASSET_BYTES) {
    throw new ProjectError("INVALID_INPUT", `“${file.name}” is larger than the ${Math.round(MAX_ASSET_BYTES / (1024 * 1024))} MB import limit.`, { fieldPath: "file" });
  }
  if (!isDecodableImageType(file.type)) {
    throw new ProjectError(
      "CAPABILITY_UNAVAILABLE",
      `“${file.name}” is ${file.type || "an unrecognized type"}. Estro imports JPEG, PNG, WebP, AVIF, and GIF images.`,
      { fieldPath: "file" },
    );
  }

  let size: { width: number; height: number };
  try {
    size = await deps.decodeSize(file);
  } catch (error) {
    if (error instanceof ProjectError) throw error;
    throw new ProjectError("MEDIA_DECODE_FAILED", `“${file.name}” could not be decoded as ${file.type}.`, { cause: error });
  }

  if (size.width < 1 || size.height < 1) {
    throw new ProjectError("MEDIA_DECODE_FAILED", `“${file.name}” reported no usable dimensions.`);
  }
  if (size.width > MAX_ASSET_PIXELS_PER_AXIS || size.height > MAX_ASSET_PIXELS_PER_AXIS) {
    throw new ProjectError(
      "INVALID_INPUT",
      `“${file.name}” is ${size.width} × ${size.height} pixels, beyond the ${MAX_ASSET_PIXELS_PER_AXIS} pixel limit per axis.`,
      { fieldPath: "file" },
    );
  }

  return {
    mediaType: file.type,
    widthPx: size.width,
    heightPx: size.height,
    byteSize: file.size,
    contentHash: await deps.hash(await file.arrayBuffer()),
  };
}

/**
 * Filenames arrive from the filesystem and from WebMCP callers, so they are treated as
 * untrusted text: no path separators, no traversal, no control characters.
 */
export function sanitizeAssetName(rawName: string): string {
  const withoutPath = rawName.split(/[/\\]/).pop() ?? rawName;
  const cleaned = withoutPath.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return "Untitled image";
  return cleaned.slice(0, 260);
}
