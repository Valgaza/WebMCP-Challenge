import { z } from "zod";
import { ProjectError } from "./project-error";

export const WATERMARK_SCHEMA_VERSION = 1 as const;

/**
 * Marking a render so it cannot be mistaken for a delivery.
 *
 * The point of a review burn is not decoration: it is that a cut sent out for comment must be
 * impossible to confuse with the finished thing, and must be traceable back to who it went to
 * if it turns up somewhere it should not.
 *
 * That decides the defaults. A watermark is visible enough to be obvious and light enough to
 * judge the picture through, it sits where it cannot be cropped off without the crop being
 * obvious, and the burn-in carries the version rather than only a name.
 */

export const watermarkPositionSchema = z.enum([
  "centre", "top_left", "top_right", "bottom_left", "bottom_right", "tiled",
]);
export type WatermarkPosition = z.infer<typeof watermarkPositionSchema>;

export const watermarkSchema = z.object({
  schemaVersion: z.literal(WATERMARK_SCHEMA_VERSION),
  text: z.string().trim().min(1).max(200).default("REVIEW COPY"),
  /**
   * Tiled by default.
   *
   * A corner watermark is croppable, and a review copy that can be cropped into a clean deliver
   * is not doing its job. Tiling is uglier and much harder to remove, which is the trade a
   * review burn exists to make.
   */
  position: watermarkPositionSchema.default("tiled"),
  /** As a fraction of frame height, so it is the same size at any output resolution. */
  sizeRatio: z.number().min(0.005).max(0.3).default(0.04),
  opacity: z.number().min(0.02).max(1).default(0.28),
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#ffffff"),
  rotationDeg: z.number().min(-90).max(90).default(-30),
  /** How far apart tiles sit, as a multiple of the text's own size. */
  tileSpacing: z.number().min(1).max(10).default(3),
});
export type Watermark = z.infer<typeof watermarkSchema>;

export const DEFAULT_WATERMARK: Watermark = watermarkSchema.parse({ schemaVersion: WATERMARK_SCHEMA_VERSION });

/**
 * The information burned into the corner of a review render.
 *
 * Separate from the watermark because it does a different job: the watermark says "this is not
 * final", the burn-in says "this is *which* not-final". A note about the wrong cut is worse than
 * no note, so the version is not optional.
 */
export const burnInSchema = z.object({
  schemaVersion: z.literal(WATERMARK_SCHEMA_VERSION),
  /** Which cut this is. Required: a comment on an unidentified render cannot be acted on. */
  version: z.string().trim().min(1).max(80),
  /** Who it went to, so a leak can be traced. */
  recipient: z.string().trim().max(120).default(""),
  showTimecode: z.boolean().default(true),
  showDate: z.boolean().default(true),
  position: z.enum(["top_left", "top_right", "bottom_left", "bottom_right"]).default("bottom_left"),
  sizeRatio: z.number().min(0.008).max(0.1).default(0.022),
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#ffffff"),
  /** A dark plate behind the text, without which it is unreadable over a bright frame. */
  background: z.boolean().default(true),
});
export type BurnIn = z.infer<typeof burnInSchema>;

/** Where each tile of a tiled watermark goes, in frame fractions. */
export function watermarkPlacements(
  watermark: Watermark,
  widthPx: number,
  heightPx: number,
): { x: number; y: number }[] {
  if (watermark.position !== "tiled") {
    const inset = 0.04;
    switch (watermark.position) {
      case "top_left": return [{ x: inset, y: inset }];
      case "top_right": return [{ x: 1 - inset, y: inset }];
      case "bottom_left": return [{ x: inset, y: 1 - inset }];
      case "bottom_right": return [{ x: 1 - inset, y: 1 - inset }];
      default: return [{ x: 0.5, y: 0.5 }];
    }
  }

  // Spacing follows the text's height rather than the frame's, so a tall frame gets more rows
  // rather than more widely spaced ones.
  const step = watermark.sizeRatio * watermark.tileSpacing;
  const across = Math.max(1, Math.ceil(1 / (step * (widthPx / heightPx)) ) + 1);
  const down = Math.max(1, Math.ceil(1 / step) + 1);
  const placements: { x: number; y: number }[] = [];

  for (let row = 0; row < down; row += 1) {
    for (let column = 0; column < across; column += 1) {
      // Offset alternate rows, so the tiles do not form removable straight columns.
      const offset = row % 2 === 0 ? 0 : 0.5;
      placements.push({
        x: ((column + offset) / across) % 1,
        y: row / down,
      });
    }
  }
  return placements;
}

/** The burn-in's text at a given moment. */
export function burnInText(burnIn: BurnIn, input: { timecode?: string; date?: Date }): string {
  const parts = [burnIn.version];
  if (burnIn.recipient) parts.push(burnIn.recipient);
  if (burnIn.showDate) parts.push((input.date ?? new Date()).toISOString().slice(0, 10));
  if (burnIn.showTimecode && input.timecode) parts.push(input.timecode);
  return parts.join("  ·  ");
}

/**
 * Refuses a watermark that would not do its job.
 *
 * Too faint to see is the failure that matters: someone sets it low to judge the picture, sends
 * the cut out, and it might as well not be there. The floor is stated rather than silently
 * corrected, because silently raising it would be changing what they asked for.
 */
export function assertLegible(watermark: Watermark): void {
  if (watermark.opacity < 0.08) {
    throw new ProjectError(
      "INVALID_INPUT",
      `At ${Math.round(watermark.opacity * 100)}% this would be too faint to notice, which defeats the point of a review burn. Use at least 8%, or leave the watermark off entirely.`,
      { fieldPath: "opacity" },
    );
  }
  if (watermark.sizeRatio < 0.012 && watermark.position !== "tiled") {
    throw new ProjectError(
      "INVALID_INPUT",
      "A single watermark that small is easy to miss and easy to crop out. Make it larger, or tile it.",
      { fieldPath: "sizeRatio" },
    );
  }
}

export function describeWatermark(watermark: Watermark): string {
  const where = watermark.position === "tiled"
    ? "tiled across the frame, which is what makes it hard to crop out"
    : `in the ${watermark.position.replace("_", " ")}, which a crop could remove`;
  return `“${watermark.text}” ${where}, at ${Math.round(watermark.opacity * 100)}% opacity.`;
}

export function describeBurnIn(burnIn: BurnIn): string {
  const parts = [`version “${burnIn.version}”`];
  if (burnIn.recipient) parts.push(`for ${burnIn.recipient}`);
  if (burnIn.showTimecode) parts.push("with timecode");
  if (burnIn.showDate) parts.push("with the date");
  return `A burn-in in the ${burnIn.position.replace("_", " ")} carrying ${parts.join(", ")}.`;
}
