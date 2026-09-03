import { z } from "zod";
import { rationalSchema, timeRangeSchema } from "./time";

export const OUTPUT_SCHEMA_VERSION = 1 as const;

export const outputKindSchema = z.enum(["photo", "video", "audio"]);
export type OutputKind = z.infer<typeof outputKindSchema>;

/**
 * What a render actually covered. Scope is recorded rather than reconstructed, because a
 * clip export and a work-area export can produce identical durations from different intent.
 */
export const renderScopeSchema = z.enum(["whole_sequence", "work_area", "selected_range", "clip", "document"]);
export type RenderScope = z.infer<typeof renderScopeSchema>;

export const outputSettingsSchema = z.object({
  container: z.string().max(80),
  videoCodec: z.string().max(80).nullable(),
  audioCodec: z.string().max(80).nullable(),
  widthPx: z.number().int().min(0).max(16384),
  heightPx: z.number().int().min(0).max(16384),
  frameRate: rationalSchema.nullable(),
  videoBitsPerSecond: z.number().int().min(0).nullable(),
  audioBitsPerSecond: z.number().int().min(0).nullable(),
  sampleRateHz: z.number().int().min(0).max(768000).nullable(),
  channels: z.number().int().min(0).max(32).nullable(),
  quality: z.number().min(0).max(1).nullable(),
});
export type OutputSettings = z.infer<typeof outputSettingsSchema>;

/**
 * A durable record of one completed delivery. Outputs are not cache: they are never
 * LRU-evicted, and they survive reload with the metadata needed to explain what was made,
 * from which revision, and under which substitutions.
 */
export const outputRecordSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(OUTPUT_SCHEMA_VERSION),
  projectId: z.string().min(1),
  kind: outputKindSchema,
  name: z.string().min(1).max(200),
  /** The project revision the render was compiled from. */
  sourceRevisionId: z.string().min(1),
  scope: renderScopeSchema,
  sequenceId: z.string().min(1).nullable(),
  clipId: z.string().min(1).nullable(),
  documentId: z.string().min(1).nullable(),
  range: timeRangeSchema.nullable(),
  presetId: z.string().min(1).nullable(),
  requestedSettings: outputSettingsSchema,
  actualSettings: outputSettingsSchema,
  mediaType: z.string().min(1).max(120),
  byteSize: z.number().int().min(0),
  durationSeconds: z.number().min(0).nullable(),
  frameCount: z.number().int().min(0).nullable(),
  warnings: z.array(z.string().min(1)).max(32),
  substitutions: z.array(z.string().min(1)).max(32),
  jobId: z.string().min(1).nullable(),
  /** Key into the output store; the bytes themselves never live in a revision. */
  storageKey: z.string().min(1).max(200),
  available: z.boolean(),
  createdAt: z.string().datetime(),
});
export type OutputRecord = z.infer<typeof outputRecordSchema>;

export function summarizeOutput(output: OutputRecord): string {
  const size = output.byteSize >= 1024 * 1024
    ? `${(output.byteSize / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(output.byteSize / 1024))} KB`;
  const dimensions = output.actualSettings.widthPx
    ? `${output.actualSettings.widthPx} × ${output.actualSettings.heightPx}, `
    : "";
  return `${output.name} — ${dimensions}${size} as ${output.mediaType}.`;
}

export function outputFileName(output: OutputRecord): string {
  const extension = output.mediaType.split("/")[1]?.split(";")[0] ?? "bin";
  const base = output.name.replace(/[^a-z0-9 _-]/gi, "").trim() || "estro-output";
  return `${base}.${extension === "jpeg" ? "jpg" : extension === "mpeg" ? "mp3" : extension}`;
}
