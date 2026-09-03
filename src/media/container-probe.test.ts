import { describe, expect, it } from "vitest";
import { probeContainer } from "./container-probe";
import { probeMedia, type TimedProbeResult } from "./media-probe";

/* ------------------------------- MP4 builders ------------------------------- */

function box(type: string, payload: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(8 + payload.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length);
  for (let index = 0; index < 4; index += 1) bytes[4 + index] = type.charCodeAt(index);
  bytes.set(payload, 8);
  return bytes;
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

function u16(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value);
  return bytes;
}

function hdlr(handler: string): Uint8Array {
  const payload = new Uint8Array(24);
  for (let index = 0; index < 4; index += 1) payload[8 + index] = handler.charCodeAt(index);
  return box("hdlr", payload);
}

function mdhd(timescale: number, duration: number): Uint8Array {
  // version 0: [version+flags][created][modified][timescale][duration]…
  return box("mdhd", concat([u32(0), u32(0), u32(0), u32(timescale), u32(duration), u32(0)]));
}

function videoTrack(width: number, height: number, timescale = 30000, frameDelta = 1001): Uint8Array {
  // Real VisualSampleEntry layout: 8-byte SampleEntry header, 16 bytes of pre-defined and
  // reserved fields, then width and height.
  const visualEntry = box("avc1", concat([
    new Uint8Array(6), u16(1), // reserved + data reference index
    new Uint8Array(16), // pre-defined, reserved, pre-defined[3]
    u16(width), u16(height),
    new Uint8Array(50),
  ]));
  const stsd = box("stsd", concat([u32(0), u32(1), visualEntry]));
  // one entry: sample count then per-sample delta
  const stts = box("stts", concat([u32(0), u32(1), u32(300), u32(frameDelta)]));
  const stbl = box("stbl", concat([stsd, stts]));
  const minf = box("minf", stbl);
  const mdia = box("mdia", concat([mdhd(timescale, timescale * 10), hdlr("vide"), minf]));
  return box("trak", mdia);
}

function audioTrack(channels: number, sampleRate: number): Uint8Array {
  // Real AudioSampleEntry layout: SampleEntry header, 8 reserved bytes, channel count,
  // sample size, pre-defined, reserved, then the 16.16 sample rate.
  const soundEntry = box("mp4a", concat([
    new Uint8Array(6), u16(1), // reserved + data reference index
    new Uint8Array(8), // reserved
    u16(channels), u16(16), u16(0), u16(0),
    u16(sampleRate), u16(0),
  ]));
  const stsd = box("stsd", concat([u32(0), u32(1), soundEntry]));
  const stbl = box("stbl", stsd);
  const minf = box("minf", stbl);
  const mdia = box("mdia", concat([mdhd(sampleRate, sampleRate * 10), hdlr("soun"), minf]));
  return box("trak", mdia);
}

function mp4(tracks: Uint8Array[], { moovAtEnd = false, padBytes = 0 } = {}): File {
  const ftyp = box("ftyp", concat([
    new Uint8Array([0x69, 0x73, 0x6f, 0x6d]), u32(512),
    new Uint8Array([0x69, 0x73, 0x6f, 0x6d]),
  ]));
  const mvhd = box("mvhd", concat([u32(0), u32(0), u32(0), u32(1000), u32(10000), new Uint8Array(80)]));
  const moov = box("moov", concat([mvhd, ...tracks]));
  const mdat = box("mdat", new Uint8Array(padBytes));
  const parts = moovAtEnd ? [ftyp, mdat, moov] : [ftyp, moov, mdat];
  return new File([concat(parts)], "clip.mp4", { type: "video/mp4" });
}

/* ----------------------------- Matroska builders ---------------------------- */

function vint(value: number): Uint8Array {
  let length = 1;
  while (length <= 8 && value >= 2 ** (7 * length) - 1) length += 1;
  const bytes = new Uint8Array(length);
  let remaining = value;
  for (let index = length - 1; index >= 0; index -= 1) {
    bytes[index] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  bytes[0] |= 1 << (8 - length);
  return bytes;
}

function element(id: number[], payload: Uint8Array): Uint8Array {
  return concat([new Uint8Array(id), vint(payload.length), payload]);
}

function uintPayload(value: number): Uint8Array {
  if (value === 0) return new Uint8Array([0]);
  const bytes: number[] = [];
  let remaining = value;
  while (remaining > 0) { bytes.unshift(remaining & 0xff); remaining = Math.floor(remaining / 256); }
  return new Uint8Array(bytes);
}

function floatPayload(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setFloat32(0, value);
  return bytes;
}

function matroska(options: { video?: boolean; audio?: boolean }): File {
  const entries: Uint8Array[] = [];
  if (options.video) {
    entries.push(element([0xae], concat([
      element([0x83], uintPayload(1)),
      element([0x86], new Uint8Array([...("V_VP9")].map((character) => character.charCodeAt(0)))),
      element([0xe0], concat([
        element([0xb0], uintPayload(1280)),
        element([0xba], uintPayload(720)),
      ])),
    ])));
  }
  if (options.audio) {
    entries.push(element([0xae], concat([
      element([0x83], uintPayload(2)),
      element([0x86], new Uint8Array([...("A_OPUS")].map((character) => character.charCodeAt(0)))),
      element([0xe1], concat([
        element([0xb5], floatPayload(48000)),
        element([0x9f], uintPayload(2)),
      ])),
    ])));
  }
  const info = element([0x15, 0x49, 0xa9, 0x66], concat([
    element([0x2a, 0xd7, 0xb1], uintPayload(1_000_000)),
    element([0x44, 0x89], floatPayload(5000)),
  ]));
  const tracks = element([0x16, 0x54, 0xae, 0x6b], concat(entries));
  const segment = element([0x18, 0x53, 0x80, 0x67], concat([info, tracks]));
  const header = element([0x1a, 0x45, 0xdf, 0xa3], element([0x42, 0x82], new Uint8Array([...("webm")].map((c) => c.charCodeAt(0)))));
  return new File([concat([header, segment])], "clip.webm", { type: "video/webm" });
}

/* ----------------------------------- tests ---------------------------------- */

describe("probeContainer", () => {
  it("reads video and audio tracks from an MP4 moov", async () => {
    const result = await probeContainer(mp4([videoTrack(1920, 1080), audioTrack(2, 48000)]));
    expect(result.container).toBe("mp4");
    expect(result.video).toBe("present");
    expect(result.audio).toBe("present");
    expect(result.tracks).toHaveLength(2);
    expect(result.tracks[0]).toMatchObject({ kind: "video", codec: "avc1", widthPx: 1920, heightPx: 1080 });
    expect(result.tracks[0].frameRate).toEqual({ numerator: 30000, denominator: 1001 });
    expect(result.tracks[1]).toMatchObject({ kind: "audio", codec: "mp4a", channels: 2, sampleRateHz: 48000 });
  });

  it("reports a silent video as having no audio rather than as unknown", async () => {
    const result = await probeContainer(mp4([videoTrack(640, 480)]));
    expect(result.video).toBe("present");
    expect(result.audio).toBe("absent");
  });

  /**
   * The defect this covers: audio was inferred by decoding a 4 MB head slice. A file whose
   * `moov` sits after the media data — the normal layout for camera and non-faststart
   * exports — decoded to nothing there and was recorded as silent.
   */
  it("finds tracks when the header is written after the media data", async () => {
    const file = mp4([videoTrack(1920, 1080), audioTrack(2, 48000)], { moovAtEnd: true, padBytes: 3_000_000 });
    const result = await probeContainer(file);
    expect(result.audio).toBe("present");
    expect(result.video).toBe("present");
  });

  it("reads Matroska track types, codecs, and audio parameters", async () => {
    const result = await probeContainer(matroska({ video: true, audio: true }));
    expect(result.container).toBe("matroska");
    expect(result.video).toBe("present");
    expect(result.audio).toBe("present");
    expect(result.tracks.map((track) => track.codec)).toEqual(["V_VP9", "A_OPUS"]);
    expect(result.tracks[1]).toMatchObject({ kind: "audio", channels: 2, sampleRateHz: 48000 });
    expect(result.tracks[0].durationSeconds).toBeCloseTo(5, 3);
  });

  it("reports a Matroska file with no audio track as having none", async () => {
    const result = await probeContainer(matroska({ video: true }));
    expect(result.audio).toBe("absent");
  });

  it("says unknown rather than guessing when the container is unreadable", async () => {
    const result = await probeContainer(new File([new Uint8Array(64)], "mystery.mp4", { type: "video/mp4" }));
    expect(result.video).toBe("unknown");
    expect(result.audio).toBe("unknown");
    expect(result.notes.join(" ")).toContain("unknown");
  });
});

describe("probeMedia stream states", () => {
  const timed = (overrides: Partial<TimedProbeResult> = {}) => ({
    probeTimed: async (): Promise<TimedProbeResult> => ({
      durationSeconds: 5, widthPx: 1920, heightPx: 1080, hasVideo: true,
      hasAudio: null, audioChannels: null, audioSampleRateHz: null, frameRate: null,
      detectionNotes: [], ...overrides,
    }),
    hash: async () => "hash-container-test",
  });

  it("prefers the container over the browser's own answer", async () => {
    const probed = await probeMedia(mp4([videoTrack(1920, 1080), audioTrack(2, 48000)]), {
      // The element claims no audio; the container declares one, and the container wins.
      timed: timed({ hasAudio: false }),
    });
    expect(probed.streams.audioPresence).toBe("present");
    expect(probed.streams.presenceSource).toBe("container");
    expect(probed.hasAudio).toBe(true);
    expect(probed.streams.audio).toMatchObject({ channels: 2, sampleRateHz: 48000, codec: "mp4a" });
  });

  /**
   * A stream the container declares but this browser refuses to decode is neither present
   * and usable nor absent. It imports without sound and says exactly why.
   */
  it("distinguishes an undecodable audio stream from a missing one", async () => {
    const probed = await probeMedia(mp4([videoTrack(1920, 1080), audioTrack(2, 48000)]), {
      timed: timed({ hasAudio: null, audioUndecodable: true }),
    });
    expect(probed.streams.audioPresence).toBe("undecodable");
    expect(probed.hasAudio).toBe(false);
    expect(probed.warnings.join(" ")).toContain("cannot decode");
    // The stream details survive so the reason can still be shown.
    expect(probed.streams.audio).not.toBeNull();
  });

  it("keeps a silent video silent and says so definitively", async () => {
    const probed = await probeMedia(mp4([videoTrack(640, 480)]), { timed: timed({ hasAudio: null }) });
    expect(probed.streams.audioPresence).toBe("absent");
    expect(probed.hasAudio).toBe(false);
    expect(probed.warnings.join(" ")).not.toContain("cannot decode");
  });

  it("falls back to the browser's answer when the container cannot be read", async () => {
    const mystery = new File([new Uint8Array(64)], "mystery.mp4", { type: "video/mp4" });
    const probed = await probeMedia(mystery, { timed: timed({ hasAudio: true, audioChannels: 1, audioSampleRateHz: 44100 }) });
    expect(probed.streams.presenceSource).toBe("element");
    expect(probed.streams.audioPresence).toBe("present");
    expect(probed.streams.audio).toMatchObject({ channels: 1, sampleRateHz: 44100 });
  });

  it("reports unknown audio as unknown rather than as silence", async () => {
    const mystery = new File([new Uint8Array(64)], "mystery.mp4", { type: "video/mp4" });
    const probed = await probeMedia(mystery, { timed: timed({ hasAudio: null }) });
    expect(probed.streams.audioPresence).toBe("unknown");
    expect(probed.warnings.join(" ")).toContain("could not tell");
  });
});
