import { describe, expect, it, vi } from "vitest";
import { MAX_ASSET_BYTES } from "../domain/asset";
import { probeImage, sanitizeAssetName, type ImageProbeDeps } from "./image-probe";

function fileOf(name: string, type: string, size = 1024): File {
  const file = new File([new Uint8Array(Math.min(size, 4))], name, { type });
  // Size is faked so the byte-limit branch can be exercised without allocating 512 MB.
  Object.defineProperty(file, "size", { value: size });
  return file;
}

const deps: ImageProbeDeps = {
  decodeSize: async () => ({ width: 1920, height: 1080 }),
  hash: async () => "0123456789abcdef",
};

describe("probeImage", () => {
  it("returns validated technical metadata for a decodable image", async () => {
    await expect(probeImage(fileOf("beach.jpg", "image/jpeg", 2048), deps)).resolves.toEqual({
      mediaType: "image/jpeg", widthPx: 1920, heightPx: 1080, byteSize: 2048, contentHash: "0123456789abcdef",
    });
  });

  it("rejects an empty file", async () => {
    await expect(probeImage(fileOf("empty.png", "image/png", 0), deps)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects a file beyond the import limit", async () => {
    await expect(probeImage(fileOf("huge.png", "image/png", MAX_ASSET_BYTES + 1), deps))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("refuses a type Estro does not decode instead of guessing", async () => {
    await expect(probeImage(fileOf("scan.tiff", "image/tiff", 100), deps))
      .rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });
    await expect(probeImage(fileOf("mystery", "", 100), deps))
      .rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });
  });

  it("does not trust a declared type that will not decode", async () => {
    const failing: ImageProbeDeps = { ...deps, decodeSize: vi.fn(async () => { throw new Error("not an image"); }) };
    await expect(probeImage(fileOf("fake.png", "image/png", 100), failing))
      .rejects.toMatchObject({ code: "MEDIA_DECODE_FAILED" });
  });

  it("rejects dimensions beyond the declared per-axis limit", async () => {
    const oversized: ImageProbeDeps = { ...deps, decodeSize: async () => ({ width: 40000, height: 10 }) };
    await expect(probeImage(fileOf("wide.png", "image/png", 100), oversized))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("sanitizeAssetName", () => {
  it("strips directory components and traversal", () => {
    expect(sanitizeAssetName("/etc/passwd")).toBe("passwd");
    expect(sanitizeAssetName("../../secret.png")).toBe("secret.png");
    expect(sanitizeAssetName("C:\\Users\\me\\photo.jpg")).toBe("photo.jpg");
    expect(sanitizeAssetName("..")).toBe("Untitled image");
    expect(sanitizeAssetName("")).toBe("Untitled image");
  });

  it("removes control characters and bounds the length", () => {
    expect(sanitizeAssetName("na\u0000me\u001f.png")).toBe("name.png");
    expect(sanitizeAssetName(`${"a".repeat(400)}.png`).length).toBe(260);
  });

  it("keeps ordinary names untouched", () => {
    expect(sanitizeAssetName("Beach day 2026.jpeg")).toBe("Beach day 2026.jpeg");
  });
});
