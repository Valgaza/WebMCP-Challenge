import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeImageBlob, decodeImageSize } from "./decode-image";

const originalCreateImageBitmap = globalThis.createImageBitmap;

afterEach(() => {
  globalThis.createImageBitmap = originalCreateImageBitmap;
  vi.restoreAllMocks();
});

function bitmap(width: number, height: number) {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap;
}

describe("decodeImageBlob", () => {
  it("uses the direct bitmap path when the browser accepts the blob", async () => {
    const direct = vi.fn(async () => bitmap(1920, 1080));
    globalThis.createImageBitmap = direct as unknown as typeof createImageBitmap;

    await expect(decodeImageSize(new Blob([new Uint8Array(2)]))).resolves.toEqual({ width: 1920, height: 1080 });
    expect(direct).toHaveBeenCalledTimes(1);
  });

  /**
   * Chrome 152 loads AVIF into an <img> but refuses createImageBitmap for both the blob and
   * the loaded element, so the canvas hop is the only route that works. Without it Estro
   * rejected AVIF files the browser could actually read.
   */
  it("falls back through an image element and a canvas when the blob is refused", async () => {
    const calls: string[] = [];
    globalThis.createImageBitmap = (async (source: unknown) => {
      if (source instanceof Blob) { calls.push("blob"); throw new Error("The source image could not be decoded."); }
      calls.push("canvas");
      return bitmap(640, 480);
    }) as unknown as typeof createImageBitmap;

    const context = { drawImage: vi.fn() };
    const originalCreateElement = Document.prototype.createElement;
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      if (tag !== "canvas") return originalCreateElement.call(document, tag);
      return { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
    }) as typeof document.createElement);

    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    Object.defineProperty(Image.prototype, "src", {
      configurable: true,
      set(this: HTMLImageElement) {
        Object.defineProperty(this, "naturalWidth", { value: 640, configurable: true });
        Object.defineProperty(this, "naturalHeight", { value: 480, configurable: true });
        queueMicrotask(() => this.onload?.(new Event("load")));
      },
    });

    const result = await decodeImageBlob(new Blob([new Uint8Array(2)]));
    expect(result.width).toBe(640);
    expect(calls).toEqual(["blob", "canvas"]);
    expect(context.drawImage).toHaveBeenCalled();
  });

  it("reports a structured cause when the image cannot load at all", async () => {
    globalThis.createImageBitmap = (async () => { throw new Error("nope"); }) as unknown as typeof createImageBitmap;
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    Object.defineProperty(Image.prototype, "src", {
      configurable: true,
      set(this: HTMLImageElement) { queueMicrotask(() => this.onerror?.(new Event("error"))); },
    });

    await expect(decodeImageBlob(new Blob([new Uint8Array(2)]))).rejects.toMatchObject({ code: "MEDIA_DECODE_FAILED" });
  });

  it("reports a capability error when no decoder exists at all", async () => {
    // @ts-expect-error removing the API is the condition under test
    globalThis.createImageBitmap = undefined;
    await expect(decodeImageBlob(new Blob([new Uint8Array(2)]))).rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });
  });
});
