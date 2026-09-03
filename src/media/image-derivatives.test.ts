import { describe, expect, it, vi } from "vitest";
import { fitWithin, proxyEdgeFor, rasterizeDownscaled, type RasterizeDeps } from "./image-derivatives";

describe("fitWithin", () => {
  it("preserves aspect ratio while bounding the longest edge", () => {
    expect(fitWithin(1920, 1080, 640)).toEqual({ width: 640, height: 360 });
    expect(fitWithin(1080, 1920, 640)).toEqual({ width: 360, height: 640 });
    expect(fitWithin(1000, 1000, 500)).toEqual({ width: 500, height: 500 });
  });

  it("never upscales", () => {
    expect(fitWithin(320, 240, 640)).toEqual({ width: 320, height: 240 });
  });

  it("treats a zero edge as full resolution", () => {
    expect(fitWithin(4000, 3000, 0)).toEqual({ width: 4000, height: 3000 });
    expect(proxyEdgeFor("full")).toBe(0);
    expect(proxyEdgeFor("draft")).toBeLessThan(proxyEdgeFor("balanced"));
  });

  it("keeps at least one pixel on an extreme ratio", () => {
    expect(fitWithin(10000, 2, 100)).toEqual({ width: 100, height: 1 });
  });
});

describe("rasterizeDownscaled", () => {
  function deps(convert: (options: { type: string }) => Promise<Blob>): RasterizeDeps {
    const close = vi.fn();
    return {
      decode: async () => ({ width: 1920, height: 1080, close }) as unknown as ImageBitmap,
      createCanvas: (width, height) => ({
        width, height,
        getContext: () => ({ drawImage: vi.fn() }),
        convertToBlob: convert,
      }) as unknown as OffscreenCanvas,
    };
  }

  it("downscales and reports the type the browser actually produced", async () => {
    const result = await rasterizeDownscaled(
      new Blob([new Uint8Array(4)]),
      640,
      deps(async ({ type }) => new Blob([new Uint8Array(2)], { type })),
    );
    expect(result).toMatchObject({ width: 640, height: 360, mediaType: "image/webp" });
  });

  it("falls back to PNG when the browser cannot encode WebP", async () => {
    const result = await rasterizeDownscaled(
      new Blob([new Uint8Array(4)]),
      640,
      deps(async ({ type }) => {
        if (type === "image/webp") throw new Error("unsupported");
        return new Blob([new Uint8Array(2)], { type: "image/png" });
      }),
    );
    expect(result.mediaType).toBe("image/png");
  });

  it("surfaces a structured cause when no drawing context exists", async () => {
    const broken: RasterizeDeps = {
      decode: async () => ({ width: 10, height: 10, close: vi.fn() }) as unknown as ImageBitmap,
      createCanvas: () => ({ getContext: () => null }) as unknown as OffscreenCanvas,
    };
    await expect(rasterizeDownscaled(new Blob([new Uint8Array(1)]), 100, broken))
      .rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });
  });
});
