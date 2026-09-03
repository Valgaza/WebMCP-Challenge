import { describe, expect, it, vi } from "vitest";
import { MAX_ASSET_BYTES } from "../domain/asset";
import type { ImageProbeDeps } from "./image-probe";
import { probeMedia, type TimedMediaProbeDeps } from "./media-probe";

function fileOf(name: string, type: string, size = 4096): File {
  const file = new File([new Uint8Array(4)], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

const imageDeps: ImageProbeDeps = {
  decodeSize: async () => ({ width: 1920, height: 1080 }),
  hash: async () => "image-hash-aaaa",
};

function timedDeps(overrides: Partial<Awaited<ReturnType<TimedMediaProbeDeps["probeTimed"]>>> = {}): TimedMediaProbeDeps {
  return {
    probeTimed: async () => ({
      durationSeconds: 12.5, widthPx: 1920, heightPx: 1080, hasVideo: true, hasAudio: true,
      audioChannels: 2, audioSampleRateHz: 48000, frameRate: null, detectionNotes: [],
      ...overrides,
    }),
    hash: async () => "timed-hash-bbbb",
  };
}

describe("probeMedia", () => {
  it("probes an image and reports no duration", async () => {
    const result = await probeMedia(fileOf("photo.jpg", "image/jpeg"), { image: imageDeps });
    expect(result).toMatchObject({
      kind: "image", widthPx: 1920, heightPx: 1080,
      durationSeconds: null, hasVideo: false, hasAudio: false,
    });
  });

  it("probes video and reports its streams and duration", async () => {
    const result = await probeMedia(fileOf("take.mp4", "video/mp4", 50_000_000), { timed: timedDeps() });
    expect(result).toMatchObject({
      kind: "video", mediaType: "video/mp4", durationSeconds: 12.5,
      widthPx: 1920, heightPx: 1080, hasVideo: true, hasAudio: true,
    });
    // The browser cannot report a container's frame rate, so it is left null rather than guessed.
    expect(result.frameRate).toBeNull();
    expect(result.warnings.join(" ")).toContain("native frame rate");
  });

  it("gives audio a nominal size so the shared reference schema still holds", async () => {
    const result = await probeMedia(
      fileOf("music.wav", "audio/wav"),
      { timed: timedDeps({ widthPx: 0, heightPx: 0, hasVideo: false }) },
    );
    expect(result).toMatchObject({ kind: "audio", widthPx: 1, heightPx: 1, hasVideo: false, hasAudio: true });
  });

  it("refuses a type Estro does not handle and names what it does", async () => {
    await expect(probeMedia(fileOf("archive.zip", "application/zip"), {}))
      .rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });
    await expect(probeMedia(fileOf("scan.tiff", "image/tiff"), {}))
      .rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });
  });

  it("rejects timed media with no usable duration rather than importing a broken clip", async () => {
    await expect(probeMedia(fileOf("broken.mp4", "video/mp4"), { timed: timedDeps({ durationSeconds: 0 }) }))
      .rejects.toMatchObject({ code: "MEDIA_DECODE_FAILED" });
  });

  it("rejects an empty file and one beyond the import limit", async () => {
    await expect(probeMedia(fileOf("empty.mp4", "video/mp4", 0), { timed: timedDeps() }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(probeMedia(fileOf("huge.mp4", "video/mp4", MAX_ASSET_BYTES + 1), { timed: timedDeps() }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects media longer than the documented limit", async () => {
    await expect(probeMedia(fileOf("long.mp4", "video/mp4"), { timed: timedDeps({ durationSeconds: 60 * 60 * 5 }) }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects dimensions beyond the per-axis limit", async () => {
    await expect(probeMedia(fileOf("wide.mp4", "video/mp4"), { timed: timedDeps({ widthPx: 40000 }) }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  /**
   * Hashing a whole video would pull gigabytes into memory, so only the head, the tail, and
   * the exact length are hashed — enough to notice a changed source, which is all it is for.
   */
  it("hashes large timed media from samples rather than the whole file", async () => {
    const hash = vi.fn(async () => "sampled-hash");
    const big = fileOf("big.mp4", "video/mp4", 200_000_000);
    const slice = vi.fn(() => new File([new Uint8Array(8)], "part"));
    Object.defineProperty(big, "slice", { value: slice });
    const arrayBuffer = vi.fn();
    Object.defineProperty(big, "arrayBuffer", { value: arrayBuffer });

    // The container probe is stubbed so this stays a test about hashing rather than about
    // how many ranges track discovery reads.
    await probeMedia(big, {
      timed: {
        probeTimed: timedDeps().probeTimed,
        hash,
        probeContainer: async () => ({ container: "mp4" as const, tracks: [], video: "present" as const, audio: "present" as const, notes: [] }),
      },
    });

    expect(slice).toHaveBeenCalledTimes(2);
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(hash).toHaveBeenCalledTimes(1);
  });

  it("hashes a small file whole", async () => {
    const hash = vi.fn(async () => "whole-hash");
    await probeMedia(fileOf("small.wav", "audio/wav", 1024), {
      timed: { probeTimed: timedDeps({ widthPx: 0, heightPx: 0, hasVideo: false }).probeTimed, hash },
    });
    expect(hash).toHaveBeenCalledTimes(1);
  });
});
