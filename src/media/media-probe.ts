import {
  EMPTY_STREAMS, MAX_ASSET_BYTES, MAX_ASSET_PIXELS_PER_AXIS, MAX_MEDIA_SECONDS, mediaKindOf,
  type AnyMediaType, type MediaStreams,
} from "../domain/asset";
import { ProjectError } from "../domain/project-error";
import type { Rational } from "../domain/time";
import { probeImage, type ImageProbeDeps } from "./image-probe";
import { probeContainer, type ContainerProbeResult, type StreamPresence } from "./container-probe";

export interface ProbedMedia {
  mediaType: AnyMediaType;
  kind: "image" | "video" | "audio";
  widthPx: number;
  heightPx: number;
  byteSize: number;
  contentHash: string;
  durationSeconds: number | null;
  frameRate: Rational | null;
  hasVideo: boolean;
  hasAudio: boolean;
  streams: MediaStreams;
  warnings: string[];
}

export interface TimedProbeResult {
  durationSeconds: number;
  widthPx: number;
  heightPx: number;
  hasVideo: boolean;
  /** Null when the runtime genuinely cannot tell, so nothing downstream guesses. */
  hasAudio: boolean | null;
  /** Set when a decode attempt was made and refused, which is not the same as no audio. */
  audioUndecodable?: boolean;
  audioChannels: number | null;
  audioSampleRateHz: number | null;
  frameRate: Rational | null;
  detectionNotes: string[];
}

/**
 * Injected so probing can be tested without real media, and so a worker or WebCodecs path
 * can replace the element-based one without changing callers.
 */
export interface TimedMediaProbeDeps {
  probeTimed: (file: File) => Promise<TimedProbeResult>;
  hash: (bytes: ArrayBuffer) => Promise<string>;
  /** Overridable so tests can supply a container answer without a real file. */
  probeContainer?: (file: File) => Promise<ContainerProbeResult>;
}

interface AudioCapableElement extends HTMLVideoElement {
  mozHasAudio?: boolean;
  webkitAudioDecodedByteCount?: number;
  audioTracks?: { length: number };
  videoTracks?: { length: number };
}

/**
 * Whether a file really carries audio.
 *
 * `duration > 0` is not evidence of an audio stream — a silent screen recording has both a
 * duration and no audio track, and treating them the same puts an unplayable clip on an
 * audio track. Each browser exposes a different signal, so all of them are tried and the
 * result is left null when none answer.
 */
function detectAudioPresence(element: AudioCapableElement, isVideoContainer: boolean): { hasAudio: boolean | null; note: string | null } {
  if (typeof element.audioTracks?.length === "number") {
    return { hasAudio: element.audioTracks.length > 0, note: null };
  }
  if (typeof element.mozHasAudio === "boolean") {
    return { hasAudio: element.mozHasAudio, note: null };
  }
  if (typeof element.webkitAudioDecodedByteCount === "number") {
    // Only meaningful once decoding has begun; zero before playback proves nothing.
    if (element.webkitAudioDecodedByteCount > 0) return { hasAudio: true, note: null };
  }
  if (!isVideoContainer) {
    // An audio container that loaded and reported a duration has an audio stream by
    // definition; that is the one case where the inference is sound.
    return { hasAudio: true, note: null };
  }
  return {
    hasAudio: null,
    note: "This browser does not report whether the file contains an audio stream, so audio availability is unknown until it is decoded.",
  };
}

/**
 * Confirms an audio stream by decoding a short slice.
 *
 * Used only when the element gave no answer. Decoding the head of the file is bounded work
 * and produces a definite result, which is better than registering media whose audio
 * availability nobody knows.
 */
async function confirmAudioByDecoding(file: File): Promise<{ presence: StreamPresence; channels: number | null; sampleRateHz: number | null } | null> {
  const AudioContextCtor = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;

  const context = new AudioContextCtor();
  try {
    // A whole file may be gigabytes; the container header plus a little payload is enough
    // for the decoder to either produce samples or refuse.
    const slice = file.size > 4 * 1024 * 1024 ? file.slice(0, 4 * 1024 * 1024) : file;
    const buffer = await context.decodeAudioData(await slice.arrayBuffer());
    return {
      presence: buffer.numberOfChannels > 0 ? "present" : "absent",
      channels: buffer.numberOfChannels,
      sampleRateHz: buffer.sampleRate,
    };
  } catch {
    // A refused decode says nothing about whether the stream exists. Reporting "absent"
    // here is what dropped valid audio whose codec this browser cannot handle, and what
    // made MP4 files whose metadata sits past the sliced head look silent.
    return { presence: "undecodable", channels: null, sampleRateHz: null };
  } finally {
    await context.close().catch(() => undefined);
  }
}

/**
 * Loads just enough of the file for the browser to report its metadata. A media element is
 * used rather than WebCodecs because it needs no container parsing and works for every
 * format the browser can play; WebCodecs is reserved for frame-accurate decode.
 */
async function probeWithMediaElement(file: File): Promise<TimedProbeResult> {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new ProjectError("CAPABILITY_UNAVAILABLE", "This runtime cannot inspect timed media.");
  }

  const isVideo = file.type.startsWith("video/");
  const element = document.createElement(isVideo ? "video" : "audio") as AudioCapableElement;
  element.preload = "metadata";
  element.muted = true;

  const url = URL.createObjectURL(file);
  const detectionNotes: string[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new ProjectError(
          "MEDIA_DECODE_FAILED",
          // Chrome suspends media loading in a hidden tab, so a stall there is expected and
          // worth naming rather than presenting as a broken file.
          typeof document !== "undefined" && document.hidden
            ? `“${file.name}” could not be inspected because this tab is in the background. Bring the tab to the front and import again.`
            : `“${file.name}” did not report metadata in time.`,
        )),
        15000,
      );
      element.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
      element.onerror = () => {
        clearTimeout(timer);
        reject(new ProjectError("MEDIA_DECODE_FAILED", `“${file.name}” could not be read as ${file.type || "media"}.`));
      };
      element.src = url;
    });

    const duration = Number.isFinite(element.duration) ? element.duration : 0;
    const widthPx = element.videoWidth || 0;
    const heightPx = element.videoHeight || 0;

    const detected = detectAudioPresence(element, isVideo);
    let hasAudio = detected.hasAudio;
    let audioUndecodable = false;
    let audioChannels: number | null = null;
    let audioSampleRateHz: number | null = null;
    if (detected.note) detectionNotes.push(detected.note);

    // A decode is only worth attempting when the element gave no answer, and its result is
    // now three-valued: it can confirm audio, confirm silence, or say it could not decode.
    if (hasAudio === null || hasAudio) {
      const confirmed = await confirmAudioByDecoding(file);
      if (confirmed) {
        if (confirmed.presence === "undecodable") {
          audioUndecodable = true;
          // Leave `hasAudio` as the element found it; a refused decode is not evidence.
        } else {
          hasAudio = confirmed.presence === "present";
          audioChannels = confirmed.channels;
          audioSampleRateHz = confirmed.sampleRateHz;
          if (detected.note) detectionNotes.pop();
        }
      }
    }

    return {
      durationSeconds: duration,
      widthPx, heightPx,
      hasVideo: isVideo && widthPx > 0 && heightPx > 0,
      hasAudio,
      audioUndecodable,
      audioChannels,
      audioSampleRateHz,
      // The browser does not expose a container's frame rate through a media element, so it
      // is left null rather than guessed. The sequence timebase governs editing.
      frameRate: null,
      detectionNotes,
    };
  } finally {
    element.src = "";
    URL.revokeObjectURL(url);
  }
}

async function defaultHash(bytes: ArrayBuffer): Promise<string> {
  if (typeof crypto === "undefined" || typeof crypto.subtle?.digest !== "function") {
    throw new ProjectError("CAPABILITY_UNAVAILABLE", "This browser cannot compute a content hash for imported media.");
  }
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const defaultTimedProbeDeps: TimedMediaProbeDeps = {
  probeTimed: probeWithMediaElement, hash: defaultHash, probeContainer,
};

/**
 * Hashing a whole video would mean reading gigabytes into memory. The first and last chunk
 * plus the exact byte length identify a file well enough to detect a changed source, which
 * is all the hash is used for.
 */
export const HASH_SAMPLE_BYTES = 1024 * 1024;

/** Builds the exact byte sample a content hash is computed over, so a worker can hash it. */
export async function hashSampleFor(file: Blob): Promise<ArrayBuffer> {
  if (file.size <= HASH_SAMPLE_BYTES * 2) return file.arrayBuffer();
  const head = await file.slice(0, HASH_SAMPLE_BYTES).arrayBuffer();
  const tail = await file.slice(file.size - HASH_SAMPLE_BYTES).arrayBuffer();
  const combined = new Uint8Array(head.byteLength + tail.byteLength + 8);
  combined.set(new Uint8Array(head), 0);
  combined.set(new Uint8Array(tail), head.byteLength);
  new DataView(combined.buffer).setFloat64(head.byteLength + tail.byteLength, file.size);
  return combined.buffer;
}

async function hashTimedMedia(file: File, hash: (bytes: ArrayBuffer) => Promise<string>): Promise<string> {
  return hash(await hashSampleFor(file));
}

/** Validates any supported media before anything else touches it. */
export async function probeMedia(
  file: File,
  deps: { image?: ImageProbeDeps; timed?: TimedMediaProbeDeps } = {},
): Promise<ProbedMedia> {
  const kind = mediaKindOf(file.type);
  if (!kind) {
    throw new ProjectError(
      "CAPABILITY_UNAVAILABLE",
      `“${file.name}” is ${file.type || "an unrecognized type"}. Estro imports JPEG, PNG, WebP, AVIF, GIF images, MP4, WebM, and QuickTime video, and WAV, MP3, AAC, Ogg, and FLAC audio.`,
      { fieldPath: "file" },
    );
  }

  if (kind === "image") {
    const probed = await probeImage(file, deps.image);
    return {
      ...probed, kind: "image", durationSeconds: null, frameRate: null,
      hasVideo: false, hasAudio: false,
      streams: {
        container: file.type, video: null, audio: null,
        videoPresence: "absent", audioPresence: "absent", presenceSource: "none",
      },
      warnings: [],
    };
  }

  if (file.size === 0) throw new ProjectError("INVALID_INPUT", `“${file.name}” is empty.`, { fieldPath: "file" });
  if (file.size > MAX_ASSET_BYTES) {
    throw new ProjectError("INVALID_INPUT", `“${file.name}” is larger than the ${Math.round(MAX_ASSET_BYTES / (1024 * 1024))} MB import limit.`, { fieldPath: "file" });
  }

  const timedDeps = deps.timed ?? defaultTimedProbeDeps;
  const probed = await timedDeps.probeTimed(file);
  const warnings: string[] = [...probed.detectionNotes];

  if (probed.durationSeconds <= 0) {
    throw new ProjectError("MEDIA_DECODE_FAILED", `“${file.name}” reported no usable duration.`);
  }
  if (probed.durationSeconds > MAX_MEDIA_SECONDS) {
    throw new ProjectError("INVALID_INPUT", `“${file.name}” is longer than the ${MAX_MEDIA_SECONDS / 3600} hour import limit.`, { fieldPath: "file" });
  }
  if (probed.widthPx > MAX_ASSET_PIXELS_PER_AXIS || probed.heightPx > MAX_ASSET_PIXELS_PER_AXIS) {
    throw new ProjectError("INVALID_INPUT", `“${file.name}” exceeds the ${MAX_ASSET_PIXELS_PER_AXIS} pixel limit per axis.`, { fieldPath: "file" });
  }
  if (!probed.frameRate && probed.hasVideo) {
    warnings.push("The browser does not report this file's native frame rate, so the sequence timebase is used for editing.");
  }

  // The container is the authority on which streams exist. Element signals and a decode
  // probe are fallbacks, in that order, and each records how the answer was reached so a
  // surprising result can be explained rather than argued with.
  const container = await (deps.timed?.probeContainer ?? probeContainer)(file).catch<ContainerProbeResult>(() => ({
    container: null, tracks: [], video: "unknown", audio: "unknown", notes: [],
  }));

  const containerVideo = container.tracks.find((track) => track.kind === "video") ?? null;
  const containerAudio = container.tracks.find((track) => track.kind === "audio") ?? null;

  let audioPresence: StreamPresence;
  let videoPresence: StreamPresence;
  let presenceSource: MediaStreams["presenceSource"];

  if (container.audio !== "unknown" || container.video !== "unknown") {
    audioPresence = container.audio;
    videoPresence = container.video;
    presenceSource = "container";
    // A stream the container declares but the browser refused to decode is neither present
    // and usable nor absent, and saying so is the whole point of keeping four states.
    if (audioPresence === "present" && probed.audioUndecodable) audioPresence = "undecodable";
    if (videoPresence === "present" && !probed.hasVideo && kind === "video") videoPresence = "undecodable";
  } else if (probed.hasAudio !== null) {
    audioPresence = probed.hasAudio ? "present" : "absent";
    videoPresence = probed.hasVideo ? "present" : kind === "video" ? "unknown" : "absent";
    presenceSource = "element";
  } else if (probed.audioUndecodable) {
    audioPresence = "undecodable";
    videoPresence = probed.hasVideo ? "present" : "unknown";
    presenceSource = "decode";
  } else {
    audioPresence = "unknown";
    videoPresence = probed.hasVideo ? "present" : "unknown";
    presenceSource = "none";
  }
  container.notes.forEach((note) => warnings.push(note));

  // Only a stream that is present *and* usable feeds the editor. An undecodable one is kept
  // in the record so the reason survives, but it is not offered as editable audio.
  const hasAudio = audioPresence === "present";
  const hasVideo = probed.hasVideo || (videoPresence === "present" && kind === "video" && probed.widthPx > 0);

  if (audioPresence === "undecodable") {
    warnings.push(`“${file.name}” contains an audio stream this browser cannot decode, so it imports without sound. Convert it to WAV, Opus, or AAC to use its audio.`);
  }
  if (audioPresence === "unknown") {
    warnings.push(`Estro could not tell whether “${file.name}” contains audio. It is imported, and its audio will appear once a decode succeeds.`);
  }
  if (videoPresence === "undecodable") {
    warnings.push(`“${file.name}” contains a video stream this browser cannot decode, so only its audio is usable.`);
  }

  const streams: MediaStreams = {
    container: container.container ?? file.type,
    video: hasVideo
      ? {
        widthPx: probed.widthPx || containerVideo?.widthPx || 1,
        heightPx: probed.heightPx || containerVideo?.heightPx || 1,
        frameRate: probed.frameRate ?? containerVideo?.frameRate ?? null,
        codec: containerVideo?.codec ?? null,
      }
      : null,
    audio: audioPresence === "present" || audioPresence === "undecodable"
      ? {
        channels: probed.audioChannels ?? containerAudio?.channels ?? 2,
        sampleRateHz: probed.audioSampleRateHz ?? containerAudio?.sampleRateHz ?? null,
        codec: containerAudio?.codec ?? null,
      }
      : null,
    videoPresence,
    audioPresence,
    presenceSource,
  };

  if (kind === "video" && !hasVideo && videoPresence === "absent") {
    warnings.push(`“${file.name}” has a video container but no picture track, so it behaves as audio.`);
  }

  return {
    mediaType: file.type as AnyMediaType,
    kind,
    // Audio has no picture; a nominal 1x1 keeps the shared reference schema satisfied.
    widthPx: probed.widthPx || 1,
    heightPx: probed.heightPx || 1,
    byteSize: file.size,
    contentHash: await hashTimedMedia(file, timedDeps.hash),
    durationSeconds: probed.durationSeconds,
    frameRate: probed.frameRate,
    hasVideo,
    hasAudio,
    streams,
    warnings,
  };
}

/**
 * What this runtime can really do with timed media, split into the stages the guide requires:
 * importing a file, playing it back interactively, generating a proxy, encoding video,
 * encoding audio, and muxing a container. Any one of them can be absent while the others
 * work, and collapsing them into one boolean is how a product ends up advertising an export
 * it cannot perform.
 */
export interface TimedMediaCapabilities {
  mediaElement: boolean;
  webCodecs: boolean;
  webAudio: boolean;
  offlineAudio: boolean;
  mediaRecorder: boolean;
  webWorkers: boolean;
  playableTypes: string[];
  recordableTypes: string[];
  /** Formats Estro can import and inspect. */
  importableTypes: string[];
  /** Container plus codec combinations `MediaRecorder` will actually mux. Estro's own export
   * path does not use MediaRecorder; this is reported for completeness, not relied on. */
  muxableTypes: string[];
  /** Audio-only formats Estro can produce right now, from its own encoders and the browser's. */
  encodableAudioTypes: string[];
  limitations: string[];
}

/**
 * Probed rather than assumed. `canPlayType` returns "probably", "maybe", or "" — anything
 * but empty means the browser is willing to try, which is the honest signal to report.
 */
export function detectTimedMediaCapabilities(): TimedMediaCapabilities {
  const videoCandidates = [
    'video/mp4; codecs="avc1.42E01E"',
    'video/mp4; codecs="hvc1"',
    'video/webm; codecs="vp9"',
    'video/webm; codecs="vp8"',
    'video/webm; codecs="av01.0.05M.08"',
    "video/quicktime",
  ];
  const audioCandidates = ["audio/wav", "audio/mpeg", "audio/aac", "audio/mp4", "audio/ogg", "audio/flac"];

  let playableTypes: string[] = [];
  if (typeof document !== "undefined") {
    const videoProbe = document.createElement("video");
    const audioProbe = document.createElement("audio");
    playableTypes = [
      ...videoCandidates.filter((type) => videoProbe.canPlayType(type) !== ""),
      ...audioCandidates.filter((type) => audioProbe.canPlayType(type) !== ""),
    ];
  }

  const recordableCandidates = [
    "video/mp4;codecs=avc1",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "audio/webm;codecs=opus",
    "audio/webm",
  ];
  const recordableTypes = typeof MediaRecorder === "function"
    ? recordableCandidates.filter((type) => MediaRecorder.isTypeSupported(type))
    : [];

  // A muxable type is one that carries both streams. Recording video-only and calling the
  // result "with audio" is exactly the claim this separation exists to prevent.
  const muxableTypes = recordableTypes.filter((type) =>
    type.includes("opus") || type.includes("avc1") || type === "video/mp4" || type === "video/webm");

  const webAudio = typeof (globalThis as { AudioContext?: unknown }).AudioContext === "function";
  const webCodecs = typeof (globalThis as { VideoDecoder?: unknown }).VideoDecoder === "function";
  const audioEncoder = typeof (globalThis as { AudioEncoder?: unknown }).AudioEncoder === "function";
  const videoEncoder = typeof (globalThis as { VideoEncoder?: unknown }).VideoEncoder === "function";

  /*
   * This list once described a MediaRecorder product. Estro does not use MediaRecorder for
   * export at all: it encodes with WebCodecs and muxes WebM itself, and it bundles its own
   * WAV, FLAC, and MP3 encoders. Reporting "MP3, AAC and FLAC are not bundled" while all
   * three were implemented meant an agent reading get_capabilities chose WAV for everything
   * and told the user the rest were impossible.
   */
  const encodableAudioTypes: string[] = [];
  // Written from PCM by Estro, so they need a mix but no browser encoder.
  if (webAudio) encodableAudioTypes.push("audio/wav", "audio/flac", "audio/mpeg");
  // AAC and Opus come from the browser's own encoder and are gated on it.
  if (webAudio && audioEncoder) encodableAudioTypes.push("audio/mp4", "audio/webm");

  const limitations: string[] = [];
  if (!videoEncoder) {
    limitations.push("This browser has no WebCodecs video encoder, so video export is unavailable. Everything else, including audio export, still works.");
  } else {
    limitations.push("Video is delivered as WebM. Estro muxes WebM itself and does not bundle an MP4 muxer, so MP4 is not offered whatever the browser can encode.");
  }
  if (!webAudio) limitations.push("This browser has no Web Audio, so audio cannot be mixed, previewed, or exported.");
  if (typeof Worker !== "function") limitations.push("This browser has no workers, so heavy media work would run on the interface thread.");
  if (webAudio && !audioEncoder) {
    limitations.push("This browser has no WebCodecs audio encoder, so AAC and Opus are unavailable. WAV, FLAC, and MP3 are written by Estro and still work.");
  }
  if (!webCodecs) {
    limitations.push("This browser has no WebCodecs, so frames are decoded by seeking a video element. That is slower and cannot run while the tab is in the background.");
  }

  return {
    mediaElement: typeof document !== "undefined",
    webCodecs,
    webAudio,
    offlineAudio: typeof (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext === "function",
    mediaRecorder: typeof MediaRecorder === "function",
    webWorkers: typeof Worker === "function",
    playableTypes,
    recordableTypes,
    importableTypes: playableTypes,
    muxableTypes,
    encodableAudioTypes,
    limitations,
  };
}

/**
 * How editable a file is once imported, kept separate from whether it is readable. A file
 * the browser cannot play at all is still worth registering, with guidance, rather than
 * dropped at the door.
 */
export function classifyEditability(
  mediaType: string,
  kind: "image" | "video" | "audio",
  capabilities: TimedMediaCapabilities = detectTimedMediaCapabilities(),
): { editability: "editable" | "proxy_required" | "import_only" | "unsupported"; reason: string | null } {
  if (kind === "image") return { editability: "editable", reason: null };

  const playable = capabilities.playableTypes.some((type) => type.startsWith(mediaType.split(";")[0]));
  if (!playable) {
    return {
      editability: "unsupported",
      reason: `This browser cannot decode ${mediaType}. Convert the file to MP4 (H.264) or WebM (VP9) and relink it to edit here.`,
    };
  }
  if (mediaType === "video/quicktime") {
    return {
      editability: "proxy_required",
      reason: "QuickTime files often use codecs this browser seeks slowly. Generate a proxy for responsive editing.",
    };
  }
  return { editability: "editable", reason: null };
}
