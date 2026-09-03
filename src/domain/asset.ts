import { z } from "zod";
import { rationalSchema } from "./time";

export const ASSET_SCHEMA_VERSION = 2 as const;

/**
 * Formats Estro will attempt to decode. Actual support is probed at runtime because
 * AVIF in particular varies by browser and build; see `probeImageFormatSupport`.
 */
export const SUPPORTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
] as const;
export type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];

export const imageMediaTypeSchema = z.enum(SUPPORTED_IMAGE_TYPES);

/**
 * Container types Estro will attempt to demux. As with images, real support is probed at
 * runtime: a browser advertising a container may still refuse its codec.
 */
export const SUPPORTED_VIDEO_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
] as const;
export type SupportedVideoType = (typeof SUPPORTED_VIDEO_TYPES)[number];
export const videoMediaTypeSchema = z.enum(SUPPORTED_VIDEO_TYPES);

export const SUPPORTED_AUDIO_TYPES = ["audio/wav", "audio/mpeg", "audio/aac", "audio/ogg", "audio/flac"] as const;
export type SupportedAudioType = (typeof SUPPORTED_AUDIO_TYPES)[number];
export const audioMediaTypeSchema = z.enum(SUPPORTED_AUDIO_TYPES);

export const anyMediaTypeSchema = z.union([imageMediaTypeSchema, videoMediaTypeSchema, audioMediaTypeSchema]);
export type AnyMediaType = z.infer<typeof anyMediaTypeSchema>;

export const MAX_MEDIA_SECONDS = 4 * 60 * 60;

export const MAX_ASSET_BYTES = 512 * 1024 * 1024;
export const MAX_ASSET_PIXELS_PER_AXIS = 32768;

/**
 * What the probe actually found inside the container, rather than what its MIME type claims.
 * "The browser recognizes a MIME type" is not the same as "Estro can edit and export it", so
 * each stream is recorded separately and left null when the runtime cannot report it.
 */
export const videoStreamSchema = z.object({
  widthPx: z.number().int().min(1).max(MAX_ASSET_PIXELS_PER_AXIS),
  heightPx: z.number().int().min(1).max(MAX_ASSET_PIXELS_PER_AXIS),
  frameRate: rationalSchema.nullable().default(null),
  codec: z.string().max(80).nullable().default(null),
});
export type VideoStream = z.infer<typeof videoStreamSchema>;

export const audioStreamSchema = z.object({
  channels: z.number().int().min(1).max(32),
  sampleRateHz: z.number().int().min(1).max(768000).nullable().default(null),
  codec: z.string().max(80).nullable().default(null),
});
export type AudioStream = z.infer<typeof audioStreamSchema>;

/**
 * Whether a stream is there, kept as four values rather than a boolean.
 *
 * "This browser could not decode it" and "it is not in the file" are different facts with
 * different remedies, and collapsing them is what silently drops a valid audio track from a
 * mix. `unknown` is a legitimate answer and is shown as one.
 */
export const streamPresenceSchema = z.enum(["present", "absent", "unknown", "undecodable"]);
export type StreamPresence = z.infer<typeof streamPresenceSchema>;

export const mediaStreamsSchema = z.object({
  container: z.string().max(80).nullable().default(null),
  video: videoStreamSchema.nullable().default(null),
  audio: audioStreamSchema.nullable().default(null),
  /** What the container declared, independent of whether this runtime can decode it. */
  videoPresence: streamPresenceSchema.default("unknown"),
  audioPresence: streamPresenceSchema.default("unknown"),
  /** How the answer was reached, so a surprising result can be explained rather than argued with. */
  presenceSource: z.enum(["container", "element", "decode", "none"]).default("none"),
});
export type MediaStreams = z.infer<typeof mediaStreamsSchema>;

export const EMPTY_STREAMS: MediaStreams = {
  container: null, video: null, audio: null,
  videoPresence: "absent", audioPresence: "absent", presenceSource: "none",
};

/**
 * An asset reference is the part of an asset that belongs to project history: stable
 * identity and the technical facts an edit can depend on. It is deliberately small and
 * free of file handles so revisions stay cheap to store and replay.
 */
export const assetReferenceSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(ASSET_SCHEMA_VERSION),
  name: z.string().min(1).max(260),
  mediaType: anyMediaTypeSchema,
  byteSize: z.number().int().min(0).max(MAX_ASSET_BYTES),
  widthPx: z.number().int().min(1).max(MAX_ASSET_PIXELS_PER_AXIS),
  heightPx: z.number().int().min(1).max(MAX_ASSET_PIXELS_PER_AXIS),
  contentHash: z.string().min(8).max(128),
  /**
   * Bumped every time the bytes behind this identity change (relink, replace source). It is
   * what makes derivative provenance and staleness deterministic: a derivative generated at
   * source revision 1 is definitively stale once the asset reaches revision 2.
   */
  sourceRevision: z.number().int().min(1).default(1),
  addedAt: z.string().datetime(),
  /** Still images have no duration; timed media carries one plus its detected streams. */
  kind: z.enum(["image", "video", "audio"]).default("image"),
  durationSeconds: z.number().min(0).max(MAX_MEDIA_SECONDS).nullable().default(null),
  frameRate: rationalSchema.nullable().default(null),
  hasAudio: z.boolean().default(false),
  hasVideo: z.boolean().default(false),
  streams: mediaStreamsSchema.default(EMPTY_STREAMS),
});
export type AssetReference = z.infer<typeof assetReferenceSchema>;

/**
 * Availability is runtime truth, not an edit. It lives outside revisions so that a file
 * going missing never rewrites project history, and relinking never invalidates edits.
 */
export const assetAvailabilitySchema = z.enum(["available", "missing", "permission_required", "unsupported"]);
export type AssetAvailability = z.infer<typeof assetAvailabilitySchema>;

/**
 * Where the original bytes live, and how durable that is.
 *
 * These states are deliberately distinct rather than collapsed into "have file / no file".
 * A permission-backed handle always reflects the file on disk; a durable private copy
 * survives reload but cannot follow later edits to the original; a session-only reference
 * is gone after reload and must be disclosed as such rather than discovered later.
 */
export const sourceLocatorSchema = z.discriminatedUnion("locatorType", [
  z.object({ locatorType: z.literal("file-system-handle"), fileName: z.string().min(1).max(260) }),
  /** A durable copy in the origin private file system, addressed by its own source key. */
  z.object({ locatorType: z.literal("opfs-copy"), fileName: z.string().min(1).max(260), sourceKey: z.string().min(1).max(200) }),
  /** A deliberate fallback: the browser gave neither a handle nor durable storage. */
  z.object({ locatorType: z.literal("session-only"), fileName: z.string().min(1).max(260) }),
  z.object({ locatorType: z.literal("unavailable"), fileName: z.string().min(1).max(260) }),
  /**
   * Reserved for a future remote object store. Estro has none today, so an asset in this
   * state reports itself unavailable rather than pretending a fetch would succeed.
   */
  z.object({ locatorType: z.literal("remote"), fileName: z.string().min(1).max(260), url: z.string().min(1).max(2000) }),
]);
export type SourceLocator = z.infer<typeof sourceLocatorSchema>;
/** Retained name so existing call sites keep reading naturally. */
export type AssetLocator = SourceLocator;

export function isDurableLocator(locator: SourceLocator): boolean {
  return locator.locatorType === "file-system-handle" || locator.locatorType === "opfs-copy";
}

export function describeDurability(locator: SourceLocator): string {
  switch (locator.locatorType) {
    case "file-system-handle": return "Linked to the original file on disk.";
    case "opfs-copy": return "Copied into Estro's private storage, so it survives reload.";
    case "session-only": return "Held for this session only. It will need relinking after a reload.";
    case "remote": return "Stored remotely. Estro cannot read remote sources yet.";
    default: return "No readable source. Relink it to continue.";
  }
}

/**
 * How editable this media actually is in the current runtime, kept apart from whether the
 * bytes are reachable. Unsupported media stays registered and offline with guidance rather
 * than being silently dropped at import.
 */
export const assetEditabilitySchema = z.enum(["editable", "proxy_required", "import_only", "unsupported"]);
export type AssetEditability = z.infer<typeof assetEditabilitySchema>;

/** One generated, reproducible artefact belonging to an asset. */
export const derivativeKindSchema = z.enum(["thumbnail", "proxy", "preview", "waveform", "histogram"]);
export type DerivativeKind = z.infer<typeof derivativeKindSchema>;

export const derivativeRefSchema = z.object({
  key: z.string().min(1).max(200),
  kind: derivativeKindSchema,
  sourceRevision: z.number().int().min(1),
  settings: z.string().max(120),
});
export type DerivativeRef = z.infer<typeof derivativeRefSchema>;

export const assetRecordSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(ASSET_SCHEMA_VERSION),
  projectId: z.string().min(1),
  reference: assetReferenceSchema,
  locator: sourceLocatorSchema,
  availability: assetAvailabilitySchema,
  availabilityReason: z.string().min(1).max(400).nullable(),
  editability: assetEditabilitySchema.default("editable"),
  editabilityReason: z.string().min(1).max(400).nullable().default(null),
  /** Every derivative generated for this asset, with the source revision it came from. */
  derivatives: z.array(derivativeRefSchema).max(64).default([]),
  thumbnailCacheKey: z.string().min(1).nullable(),
  proxyCacheKey: z.string().min(1).nullable(),
  /** Optional relative folder captured at folder import; never trusted as a filesystem path. */
  importPath: z.string().max(400).nullable().default(null),
  binId: z.string().min(1).nullable().default(null),
  tags: z.array(z.string().min(1).max(48)).max(32),
  updatedAt: z.string().datetime(),
});
export type AssetRecord = z.infer<typeof assetRecordSchema>;

/** Structured query model shared by the Media Library filters and the WebMCP search tool. */
export const assetSearchSchema = z.object({
  query: z.string().max(120).default(""),
  mediaTypes: z.array(anyMediaTypeSchema).max(16).default([]),
  kinds: z.array(z.enum(["image", "video", "audio"])).max(3).default([]),
  availability: z.array(assetAvailabilitySchema).max(4).default([]),
  editability: z.array(assetEditabilitySchema).max(4).default([]),
  /** "any" ignores proxy state; the others filter on whether a proxy derivative exists. */
  proxyState: z.enum(["any", "present", "absent"]).default("any"),
  binId: z.string().min(1).nullable().default(null),
  minDurationSeconds: z.number().min(0).max(MAX_MEDIA_SECONDS).nullable().default(null),
  maxDurationSeconds: z.number().min(0).max(MAX_MEDIA_SECONDS).nullable().default(null),
  minPixels: z.number().int().min(0).nullable().default(null),
  maxPixels: z.number().int().min(0).nullable().default(null),
  sortBy: z.enum(["name", "addedAt", "byteSize", "pixels", "duration"]).default("addedAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  limit: z.number().int().min(1).max(500).default(50),
});
export type AssetSearch = z.input<typeof assetSearchSchema>;
export type ParsedAssetSearch = z.infer<typeof assetSearchSchema>;

export function hasProxy(record: AssetRecord): boolean {
  return record.derivatives.some(
    (entry) => entry.kind === "proxy" && entry.sourceRevision === record.reference.sourceRevision,
  );
}

/** Which fields a text query matched, so a caller can explain why a result is in the list. */
export function matchedFields(record: AssetRecord, needle: string): string[] {
  if (!needle) return [];
  const fields: [string, string][] = [
    ["name", record.reference.name],
    ["mediaType", record.reference.mediaType],
    ["tags", record.tags.join(" ")],
    ["importPath", record.importPath ?? ""],
  ];
  return fields.filter(([, value]) => value.toLocaleLowerCase().includes(needle)).map(([field]) => field);
}

/**
 * Matching is done over indexed metadata only. Nothing here decodes or reads media,
 * which keeps search off the expensive path even with a large library.
 */
export function searchAssetRecords(records: AssetRecord[], input: AssetSearch): AssetRecord[] {
  const search = assetSearchSchema.parse(input);
  const needle = search.query.trim().toLocaleLowerCase();

  const filtered = records.filter((record) => {
    if (search.mediaTypes.length && !search.mediaTypes.includes(record.reference.mediaType)) return false;
    if (search.kinds.length && !search.kinds.includes(record.reference.kind)) return false;
    if (search.availability.length && !search.availability.includes(record.availability)) return false;
    if (search.editability.length && !search.editability.includes(record.editability)) return false;
    if (search.binId !== null && record.binId !== search.binId) return false;
    if (search.proxyState === "present" && !hasProxy(record)) return false;
    if (search.proxyState === "absent" && hasProxy(record)) return false;

    const duration = record.reference.durationSeconds;
    if (search.minDurationSeconds !== null && (duration === null || duration < search.minDurationSeconds)) return false;
    if (search.maxDurationSeconds !== null && (duration === null || duration > search.maxDurationSeconds)) return false;

    const pixels = record.reference.widthPx * record.reference.heightPx;
    if (search.minPixels !== null && pixels < search.minPixels) return false;
    if (search.maxPixels !== null && pixels > search.maxPixels) return false;

    if (!needle) return true;
    return matchedFields(record, needle).length > 0;
  });

  const ordered = [...filtered].sort((a, b) => {
    if (search.sortBy === "name") return a.reference.name.localeCompare(b.reference.name);
    if (search.sortBy === "byteSize") return a.reference.byteSize - b.reference.byteSize;
    if (search.sortBy === "duration") return (a.reference.durationSeconds ?? 0) - (b.reference.durationSeconds ?? 0);
    if (search.sortBy === "pixels") {
      return a.reference.widthPx * a.reference.heightPx - b.reference.widthPx * b.reference.heightPx;
    }
    return a.reference.addedAt.localeCompare(b.reference.addedAt);
  });

  if (search.direction === "desc") ordered.reverse();
  return ordered.slice(0, search.limit);
}

/** Human-readable account of which filters are narrowing a result set. */
export function describeActiveFilters(input: AssetSearch): string[] {
  const search = assetSearchSchema.parse(input);
  const parts: string[] = [];
  if (search.query.trim()) parts.push(`matching “${search.query.trim()}”`);
  if (search.kinds.length) parts.push(`kind: ${search.kinds.join(", ")}`);
  if (search.mediaTypes.length) parts.push(`format: ${search.mediaTypes.join(", ")}`);
  if (search.availability.length) parts.push(`availability: ${search.availability.join(", ")}`);
  if (search.editability.length) parts.push(`editability: ${search.editability.join(", ")}`);
  if (search.proxyState !== "any") parts.push(`proxy ${search.proxyState}`);
  if (search.binId) parts.push("inside one bin");
  if (search.minDurationSeconds !== null || search.maxDurationSeconds !== null) parts.push("duration range");
  if (search.minPixels !== null || search.maxPixels !== null) parts.push("pixel range");
  return parts;
}

/**
 * Replacing a source keeps the logical asset ID and every edit that points at it, so the
 * user must be told exactly what changed about the underlying media instead of discovering
 * a silently reframed image later.
 */
export function describeReplacementLosses(previous: AssetReference, next: AssetReference): string[] {
  const losses: string[] = [];
  if (previous.widthPx !== next.widthPx || previous.heightPx !== next.heightPx) {
    losses.push(
      `Dimensions change from ${previous.widthPx} × ${previous.heightPx} to ${next.widthPx} × ${next.heightPx} pixels. Edits positioned against the old frame may need review.`,
    );
  }
  if (previous.mediaType !== next.mediaType) {
    losses.push(`Format changes from ${previous.mediaType} to ${next.mediaType}.`);
  }
  if (previous.kind !== next.kind) {
    losses.push(`Media kind changes from ${previous.kind} to ${next.kind}. Timeline clips built on the old kind may no longer be valid.`);
  }
  const previousRatio = previous.widthPx / previous.heightPx;
  const nextRatio = next.widthPx / next.heightPx;
  if (Math.abs(previousRatio - nextRatio) > 0.01) {
    losses.push("Aspect ratio changes, so crops and transforms may no longer frame the same area.");
  }
  if (previous.durationSeconds !== null && next.durationSeconds !== null && next.durationSeconds < previous.durationSeconds) {
    losses.push(
      `Duration drops from ${previous.durationSeconds.toFixed(2)}s to ${next.durationSeconds.toFixed(2)}s. Clips using the tail of the old source will be trimmed.`,
    );
  }
  if (previous.hasAudio && !next.hasAudio) {
    losses.push("The replacement has no audio stream, so audio clips referencing this asset fall silent.");
  }
  if (previous.hasVideo && !next.hasVideo) {
    losses.push("The replacement has no video stream, so video clips referencing this asset show black.");
  }
  return losses;
}

export function isDecodableImageType(mediaType: string): mediaType is SupportedImageType {
  return (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(mediaType);
}

export function isVideoType(mediaType: string): mediaType is SupportedVideoType {
  return (SUPPORTED_VIDEO_TYPES as readonly string[]).includes(mediaType);
}

export function isAudioType(mediaType: string): mediaType is SupportedAudioType {
  return (SUPPORTED_AUDIO_TYPES as readonly string[]).includes(mediaType);
}

export function mediaKindOf(mediaType: string): "image" | "video" | "audio" | null {
  if (isDecodableImageType(mediaType)) return "image";
  if (isVideoType(mediaType)) return "video";
  if (isAudioType(mediaType)) return "audio";
  return null;
}

/** Every extension Estro's pickers and drop targets accept, by kind. */
export const MEDIA_FILE_EXTENSIONS: Record<"image" | "video" | "audio", string[]> = {
  image: [".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif"],
  video: [".mp4", ".m4v", ".mov", ".webm"],
  audio: [".wav", ".mp3", ".m4a", ".aac", ".ogg", ".flac"],
};

export const ALL_SUPPORTED_MEDIA_TYPES = [
  ...SUPPORTED_IMAGE_TYPES,
  ...SUPPORTED_VIDEO_TYPES,
  ...SUPPORTED_AUDIO_TYPES,
] as const;
