import { ProjectError } from "../domain/project-error";

/**
 * `createImageBitmap` is the fast path, but it does not accept every format the browser can
 * actually render — Chrome 152 rejects AVIF blobs here while `<img>` decodes them fine.
 * Falling back to an image element means capability follows what the browser can really do
 * rather than what one API happens to accept.
 *
 * The fallback needs a DOM, so it is unavailable inside a worker. Callers there get the
 * structured capability error instead of a silent failure.
 */
export async function decodeImageBlob(blob: Blob): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== "function") {
    throw new ProjectError("CAPABILITY_UNAVAILABLE", "This browser cannot decode images off the main thread.");
  }

  try {
    return await createImageBitmap(blob);
  } catch (bitmapError) {
    if (typeof document === "undefined" || typeof Image !== "function" || typeof URL.createObjectURL !== "function") {
      throw new ProjectError("MEDIA_DECODE_FAILED", "This image could not be decoded in the current runtime.", { cause: bitmapError });
    }

    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.decoding = "async";
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new ProjectError("MEDIA_DECODE_FAILED", "This image could not be decoded."));
        image.src = url;
      });
      if (!image.naturalWidth || !image.naturalHeight) {
        throw new ProjectError("MEDIA_DECODE_FAILED", "This image reported no usable dimensions.");
      }

      // `createImageBitmap` refuses the loaded element too for these formats, but drawing it
      // onto a canvas works, so the canvas becomes the bitmap source.
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new ProjectError("CAPABILITY_UNAVAILABLE", "This browser did not provide a 2D drawing context.");
      }
      context.drawImage(image, 0, 0);
      return await createImageBitmap(canvas);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export async function decodeImageSize(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await decodeImageBlob(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close?.();
  return size;
}
