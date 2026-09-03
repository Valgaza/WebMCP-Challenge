/**
 * Reads track information straight out of the container.
 *
 * The reason this exists: every browser signal for "does this file have audio" is either
 * absent, browser-specific, or only meaningful after decoding has begun. Falling back to
 * "decode a slice and see" turns two different facts into one value — a file with no audio
 * and a file whose audio this browser cannot decode both come back as `false`, and the
 * second one is then silently dropped from the mix.
 *
 * The container knows. An MP4 declares its tracks in `moov`; a Matroska file declares them
 * in `Tracks`. Both are read here without decoding a single sample, so stream discovery is a
 * fact rather than an inference, and decode support becomes a separate question with its own
 * answer.
 *
 * Only the parts needed to enumerate tracks are parsed. Anything unrecognised produces
 * `unknown`, never a guess.
 */

/**
 * Four distinct answers, kept distinct all the way to the interface.
 *
 * - `present` — the container declares the stream.
 * - `absent` — the container was read and declares no such stream.
 * - `undecodable` — the stream is declared but this runtime cannot decode it.
 * - `unknown` — the container could not be read, so nothing is claimed either way.
 */
export type StreamPresence = "present" | "absent" | "unknown" | "undecodable";

export interface ContainerTrack {
  kind: "video" | "audio";
  /** A codec string where the container gives one, for capability checks. */
  codec: string | null;
  widthPx: number | null;
  heightPx: number | null;
  channels: number | null;
  sampleRateHz: number | null;
  /** Seconds, where the container carries a per-track duration. */
  durationSeconds: number | null;
  frameRate: { numerator: number; denominator: number } | null;
}

export interface ContainerProbeResult {
  /** The container Estro recognised, or null when it could not read one. */
  container: "mp4" | "matroska" | null;
  tracks: ContainerTrack[];
  video: StreamPresence;
  audio: StreamPresence;
  notes: string[];
}

const UNREADABLE: ContainerProbeResult = {
  container: null, tracks: [], video: "unknown", audio: "unknown",
  notes: ["Estro could not read this file's track list, so its streams are reported as unknown rather than guessed."],
};

/** How much of the file to read looking for the header. A `moov` can sit at either end. */
const HEAD_BYTES = 2 * 1024 * 1024;
const TAIL_BYTES = 4 * 1024 * 1024;

export async function probeContainer(file: File): Promise<ContainerProbeResult> {
  try {
    const head = new Uint8Array(await file.slice(0, Math.min(file.size, HEAD_BYTES)).arrayBuffer());
    if (isMatroska(head)) return readMatroska(head);
    if (isIsoBmff(head)) {
      const fromHead = readIsoBmff(head);
      if (fromHead.tracks.length) return fromHead;
      // A `moov` written after the media data — the default for a file straight out of a
      // camera or a non-faststart export — is at the end, so look there before giving up.
      if (file.size > HEAD_BYTES) {
        const tail = new Uint8Array(await file.slice(Math.max(0, file.size - TAIL_BYTES)).arrayBuffer());
        const fromTail = readIsoBmff(tail);
        if (fromTail.tracks.length) return fromTail;
      }
      return {
        ...fromHead,
        video: "unknown",
        audio: "unknown",
        notes: ["This file's track list was not found in the part Estro read, so its streams are reported as unknown."],
      };
    }
    return UNREADABLE;
  } catch {
    return UNREADABLE;
  }
}

/* ------------------------------- ISO base media ------------------------------ */

function isIsoBmff(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const type = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
  return type === "ftyp" || type === "moov" || type === "styp" || type === "free" || type === "skip" || type === "mdat";
}

function readUint(bytes: Uint8Array, offset: number, length: number): number {
  let value = 0;
  for (let index = 0; index < length; index += 1) value = value * 256 + bytes[offset + index];
  return value;
}

function fourcc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

interface Box { type: string; start: number; end: number; }

/** Walks the boxes directly inside [from, to). Sizes are validated, never trusted. */
function boxes(bytes: Uint8Array, from: number, to: number): Box[] {
  const found: Box[] = [];
  let offset = from;
  while (offset + 8 <= to) {
    let size = readUint(bytes, offset, 4);
    const type = fourcc(bytes, offset + 4);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > to) break;
      size = readUint(bytes, offset + 8, 8);
      header = 16;
    } else if (size === 0) {
      size = to - offset;
    }
    if (size < header || offset + size > to) {
      // A truncated tail is expected when only part of the file was read.
      found.push({ type, start: offset + header, end: to });
      break;
    }
    found.push({ type, start: offset + header, end: offset + size });
    offset += size;
  }
  return found;
}

function findBox(bytes: Uint8Array, list: Box[], type: string): Box | null {
  return list.find((box) => box.type === type) ?? null;
}

function readIsoBmff(bytes: Uint8Array): ContainerProbeResult {
  const top = boxes(bytes, 0, bytes.length);
  const moov = findBox(bytes, top, "moov");
  if (!moov) return { container: "mp4", tracks: [], video: "unknown", audio: "unknown", notes: [] };

  const tracks: ContainerTrack[] = [];
  const notes: string[] = [];
  let movieTimescale = 0;

  for (const box of boxes(bytes, moov.start, moov.end)) {
    if (box.type === "mvhd") {
      const version = bytes[box.start];
      movieTimescale = version === 1 ? readUint(bytes, box.start + 20, 4) : readUint(bytes, box.start + 12, 4);
      continue;
    }
    if (box.type !== "trak") continue;

    const trak = boxes(bytes, box.start, box.end);
    const mdia = findBox(bytes, trak, "mdia");
    if (!mdia) continue;
    const inMdia = boxes(bytes, mdia.start, mdia.end);

    // The handler box is what actually says what kind of track this is.
    const hdlr = findBox(bytes, inMdia, "hdlr");
    if (!hdlr || hdlr.start + 12 > hdlr.end) continue;
    const handler = fourcc(bytes, hdlr.start + 8);
    const kind = handler === "vide" ? "video" : handler === "soun" ? "audio" : null;
    if (!kind) continue;

    const mdhd = findBox(bytes, inMdia, "mdhd");
    let timescale = 0;
    let duration = 0;
    if (mdhd && mdhd.start + 24 <= mdhd.end) {
      const version = bytes[mdhd.start];
      if (version === 1) {
        timescale = readUint(bytes, mdhd.start + 20, 4);
        duration = readUint(bytes, mdhd.start + 24, 8);
      } else {
        timescale = readUint(bytes, mdhd.start + 12, 4);
        duration = readUint(bytes, mdhd.start + 16, 4);
      }
    }

    const track: ContainerTrack = {
      kind,
      codec: null, widthPx: null, heightPx: null, channels: null, sampleRateHz: null,
      durationSeconds: timescale > 0 && duration > 0 ? duration / timescale : null,
      frameRate: null,
    };

    const minf = findBox(bytes, inMdia, "minf");
    const stbl = minf ? findBox(bytes, boxes(bytes, minf.start, minf.end), "stbl") : null;
    const stsd = stbl ? findBox(bytes, boxes(bytes, stbl.start, stbl.end), "stsd") : null;
    if (stsd && stsd.start + 8 <= stsd.end) {
      // A sample-description entry begins with its own size and four-character code.
      const entries = boxes(bytes, stsd.start + 8, stsd.end);
      const entry = entries[0];
      if (entry) {
        track.codec = entry.type;
        // Offsets are from the ISO base media spec, past the 8-byte SampleEntry header.
        // VisualSampleEntry: 16 bytes of pre-defined/reserved, then width and height.
        if (kind === "video" && entry.start + 28 <= entry.end) {
          track.widthPx = readUint(bytes, entry.start + 24, 2) || null;
          track.heightPx = readUint(bytes, entry.start + 26, 2) || null;
        }
        // AudioSampleEntry: 8 reserved, channel count, sample size, 4 more reserved, then
        // the sample rate as 16.16 fixed point whose whole part is the rate.
        if (kind === "audio" && entry.start + 26 <= entry.end) {
          track.channels = readUint(bytes, entry.start + 16, 2) || null;
          track.sampleRateHz = readUint(bytes, entry.start + 24, 2) || null;
        }
      }
    }

    // Frame rate from the sample count over the track duration is exact for constant-rate
    // media and a good estimate otherwise; it is only ever used as a suggestion.
    const stts = stbl ? findBox(bytes, boxes(bytes, stbl.start, stbl.end), "stts") : null;
    if (kind === "video" && stts && timescale > 0 && stts.start + 8 <= stts.end) {
      const count = readUint(bytes, stts.start + 4, 4);
      if (count >= 1 && stts.start + 8 + 8 <= stts.end) {
        const delta = readUint(bytes, stts.start + 12, 4);
        if (delta > 0) track.frameRate = { numerator: timescale, denominator: delta };
      }
    }

    tracks.push(track);
  }

  if (movieTimescale && !tracks.length) {
    notes.push("This file declares a movie header but no readable tracks.");
  }
  return {
    container: "mp4",
    tracks,
    video: tracks.some((track) => track.kind === "video") ? "present" : "absent",
    audio: tracks.some((track) => track.kind === "audio") ? "present" : "absent",
    notes,
  };
}

/* --------------------------------- Matroska --------------------------------- */

function isMatroska(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
}

interface EbmlCursor { offset: number; }

/** Reads an EBML element ID, keeping its leading length marker as part of the value. */
function readElementId(bytes: Uint8Array, cursor: EbmlCursor): number | null {
  if (cursor.offset >= bytes.length) return null;
  const first = bytes[cursor.offset];
  let length = 0;
  for (let bit = 0; bit < 4; bit += 1) {
    if (first & (0x80 >> bit)) { length = bit + 1; break; }
  }
  if (!length || cursor.offset + length > bytes.length) return null;
  let value = 0;
  for (let index = 0; index < length; index += 1) value = value * 256 + bytes[cursor.offset + index];
  cursor.offset += length;
  return value;
}

/** Reads an EBML size, stripping the length marker. Returns null for "unknown size". */
function readElementSize(bytes: Uint8Array, cursor: EbmlCursor): number | null {
  if (cursor.offset >= bytes.length) return null;
  const first = bytes[cursor.offset];
  let length = 0;
  for (let bit = 0; bit < 8; bit += 1) {
    if (first & (0x80 >> bit)) { length = bit + 1; break; }
  }
  if (!length || cursor.offset + length > bytes.length) return null;
  let value = first & (0xff >> length);
  let allOnes = value === (0xff >> length);
  for (let index = 1; index < length; index += 1) {
    const byte = bytes[cursor.offset + index];
    if (byte !== 0xff) allOnes = false;
    value = value * 256 + byte;
  }
  cursor.offset += length;
  return allOnes ? null : value;
}

function readUintValue(bytes: Uint8Array, start: number, size: number): number {
  let value = 0;
  for (let index = 0; index < size; index += 1) value = value * 256 + bytes[start + index];
  return value;
}

function readFloatValue(bytes: Uint8Array, start: number, size: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset + start, size);
  return size === 4 ? view.getFloat32(0) : size === 8 ? view.getFloat64(0) : 0;
}

function readStringValue(bytes: Uint8Array, start: number, size: number): string {
  let text = "";
  for (let index = 0; index < size; index += 1) {
    const byte = bytes[start + index];
    if (!byte) break;
    text += String.fromCharCode(byte);
  }
  return text;
}

const EBML_ID = {
  Segment: 0x18538067,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackType: 0x83,
  CodecID: 0x86,
  Video: 0xe0,
  PixelWidth: 0xb0,
  PixelHeight: 0xba,
  DefaultDuration: 0x23e383,
  Audio: 0xe1,
  SamplingFrequency: 0xb5,
  Channels: 0x9f,
  Info: 0x1549a966,
  TimestampScale: 0x2ad7b1,
  Duration: 0x4489,
} as const;

/** Element IDs whose children this walker descends into rather than skipping. */
const CONTAINERS = new Set<number>([
  EBML_ID.Segment, EBML_ID.Tracks, EBML_ID.TrackEntry, EBML_ID.Video, EBML_ID.Audio, EBML_ID.Info,
]);

function readMatroska(bytes: Uint8Array): ContainerProbeResult {
  const tracks: ContainerTrack[] = [];
  let current: ContainerTrack | null = null;
  let timestampScale = 1_000_000;
  let segmentDuration = 0;
  let sawTracks = false;

  const walk = (from: number, to: number, depth: number): void => {
    if (depth > 8) return;
    const cursor: EbmlCursor = { offset: from };
    while (cursor.offset < to) {
      const id = readElementId(bytes, cursor);
      if (id === null) return;
      const size = readElementSize(bytes, cursor);
      const start = cursor.offset;
      // An unknown-size element runs to the end of what was read; that is normal for the
      // Segment in a file written as a stream.
      const end = size === null ? to : Math.min(to, start + size);
      if (end < start) return;

      if (id === EBML_ID.Tracks) sawTracks = true;
      if (id === EBML_ID.TrackEntry) {
        current = {
          kind: "video", codec: null, widthPx: null, heightPx: null,
          channels: null, sampleRateHz: null, durationSeconds: null, frameRate: null,
        };
      }

      if (CONTAINERS.has(id)) {
        walk(start, end, depth + 1);
        if (id === EBML_ID.TrackEntry && current) {
          tracks.push(current);
          current = null;
        }
      } else if (current) {
        const length = end - start;
        if (id === EBML_ID.TrackType) current.kind = readUintValue(bytes, start, length) === 2 ? "audio" : "video";
        else if (id === EBML_ID.CodecID) current.codec = readStringValue(bytes, start, length) || null;
        else if (id === EBML_ID.PixelWidth) current.widthPx = readUintValue(bytes, start, length) || null;
        else if (id === EBML_ID.PixelHeight) current.heightPx = readUintValue(bytes, start, length) || null;
        else if (id === EBML_ID.Channels) current.channels = readUintValue(bytes, start, length) || null;
        else if (id === EBML_ID.SamplingFrequency) current.sampleRateHz = Math.round(readFloatValue(bytes, start, length)) || null;
        else if (id === EBML_ID.DefaultDuration) {
          const nanoseconds = readUintValue(bytes, start, length);
          if (nanoseconds > 0) current.frameRate = { numerator: 1_000_000_000, denominator: nanoseconds };
        }
      } else if (id === EBML_ID.TimestampScale) {
        timestampScale = readUintValue(bytes, start, end - start) || timestampScale;
      } else if (id === EBML_ID.Duration) {
        segmentDuration = readFloatValue(bytes, start, end - start);
      }

      cursor.offset = end;
      if (size === null) return;
    }
  };

  walk(0, bytes.length, 0);

  const durationSeconds = segmentDuration > 0 ? (segmentDuration * timestampScale) / 1_000_000_000 : null;
  for (const track of tracks) track.durationSeconds = durationSeconds;

  // A file whose `Tracks` element was never reached says unknown rather than absent.
  const decided = sawTracks && tracks.length > 0;
  return {
    container: "matroska",
    tracks,
    video: decided ? (tracks.some((track) => track.kind === "video") ? "present" : "absent") : "unknown",
    audio: decided ? (tracks.some((track) => track.kind === "audio") ? "present" : "absent") : "unknown",
    notes: decided ? [] : ["This file's track list was not found in the part Estro read, so its streams are reported as unknown."],
  };
}

/** Plain-language wording for each state, used in the library and in WebMCP results. */
export function describePresence(kind: "video" | "audio", presence: StreamPresence): string {
  switch (presence) {
    case "present": return `Contains ${kind}.`;
    case "absent": return `Contains no ${kind}.`;
    case "undecodable": return `Contains ${kind} this browser cannot decode.`;
    default: return `Estro could not tell whether this file contains ${kind}.`;
  }
}
