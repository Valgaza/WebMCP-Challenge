import { z } from "zod";
import { adjustmentStackSchema } from "./adjustment";
import { colourOperationSchema, describeColourOperation } from "./colour-op";
import { describeFilter, filterOperationSchema } from "./filter";
import { shapeSchema } from "./vector";
import { ProjectError } from "./project-error";

export const EFFECT_SCHEMA_VERSION = 1 as const;

/**
 * How a layer's pixels combine with what is already underneath.
 *
 * Every mode here maps onto a Canvas 2D composite operation, so the browser does the maths
 * and preview and export cannot disagree about it. Modes the platform does not implement are
 * deliberately absent rather than approximated: a "soft light" that is really a multiply is
 * worse than one the interface says it cannot offer.
 */
export const BLEND_MODES = [
  "normal", "multiply", "screen", "overlay", "darken", "lighten",
  "color-dodge", "color-burn", "hard-light", "soft-light",
  "difference", "exclusion", "hue", "saturation", "color", "luminosity",
] as const;
export const blendModeSchema = z.enum(BLEND_MODES);
export type BlendMode = z.infer<typeof blendModeSchema>;

/** The Canvas composite operation for a mode. `normal` is ordinary stacking. */
export function compositeOperationFor(mode: BlendMode): GlobalCompositeOperation {
  return mode === "normal" ? "source-over" : (mode as GlobalCompositeOperation);
}

/** Plain-language description, used in the inspector and in agent explanations. */
export const BLEND_MODE_LABELS: Record<BlendMode, string> = {
  normal: "Normal — stacks on top",
  multiply: "Multiply — darkens, white disappears",
  screen: "Screen — lightens, black disappears",
  overlay: "Overlay — darkens the darks and lightens the lights",
  darken: "Darken — keeps whichever is darker",
  lighten: "Lighten — keeps whichever is lighter",
  "color-dodge": "Colour dodge — brightens what is underneath",
  "color-burn": "Colour burn — deepens what is underneath",
  "hard-light": "Hard light — a harsher overlay",
  "soft-light": "Soft light — a gentler overlay",
  difference: "Difference — the distance between the two",
  exclusion: "Exclusion — a softer difference",
  hue: "Hue — takes hue from this layer, the rest from below",
  saturation: "Saturation — takes saturation from this layer",
  color: "Colour — takes hue and saturation from this layer",
  luminosity: "Luminosity — takes brightness from this layer",
};

/* ------------------------------------ masks ------------------------------------ */

/**
 * What limits where a layer shows.
 *
 * A mask is deliberately a reference plus parameters rather than baked pixels: the original
 * stays untouched, the mask can be edited or removed at any point, and the same model serves
 * a shape drawn by hand and another layer's own alpha.
 */
export const maskSourceSchema = z.discriminatedUnion("kind", [
  /** A rectangle or ellipse in normalised layer coordinates. */
  z.object({
    kind: z.literal("shape"),
    shape: z.enum(["rectangle", "ellipse"]),
    x: z.number().min(-2).max(3),
    y: z.number().min(-2).max(3),
    width: z.number().min(0).max(4),
    height: z.number().min(0).max(4),
    cornerRadius: z.number().min(0).max(1).default(0),
  }),
  /** Another layer's alpha, which is how one object cuts another out. */
  z.object({ kind: z.literal("layer_alpha"), layerId: z.string().min(1) }),
  /** A stored greyscale image, produced by painting or by an effect. */
  z.object({ kind: z.literal("raster"), cacheKey: z.string().min(1) }),
  /**
   * A saved selection used as a mask.
   *
   * A layer mask is a named greyscale image the same size as the document, which is exactly
   * what a saved selection is — so it points at one rather than storing a second copy that
   * could drift from it. It is durable work, unlike a raster mask in the evictable cache.
   */
  z.object({ kind: z.literal("stored"), selectionId: z.string().min(1) }),
  /**
   * A vector path.
   *
   * A path mask stays crisp at any size and can be reshaped point by point long after it was
   * drawn, which a raster mask cannot. It is a different thing from a shape mask: that one is
   * a rectangle or an ellipse chosen from a list, this one is an arbitrary outline.
   */
  z.object({ kind: z.literal("path"), shape: shapeSchema }),
  /**
   * A key: brightness decides what shows, rather than a shape.
   *
   * This is what removes a black background from stock footage or drops a white sky out. It is
   * a mask source rather than a separate mechanism because that is exactly what it produces —
   * coverage per pixel — and putting it here means it inherits feather, density, inversion, and
   * the ability to be switched off without being lost.
   */
  z.object({
    kind: z.literal("luma"),
    /** At or below `low` the pixel is hidden; at or above `high` it is fully shown. */
    low: z.number().min(0).max(255).default(0),
    high: z.number().min(0).max(255).default(40),
  }),
  /**
   * Another track used as the matte, by its brightness or by its own transparency.
   *
   * A track rather than a clip, because a matte usually runs across several clips and pointing
   * at one of them would break the moment it was split.
   */
  z.object({
    kind: z.literal("track_matte"),
    trackId: z.string().min(1),
    use: z.enum(["luma", "alpha"]).default("luma"),
  }),
]);
export type MaskSource = z.infer<typeof maskSourceSchema>;

export const maskSchema = z.object({
  id: z.string().min(1),
  source: maskSourceSchema,
  /** Softens the edge, in document pixels. */
  featherPx: z.number().min(0).max(500).default(0),
  /** How strongly the mask applies; 1 hides everything outside it. */
  density: z.number().min(0).max(1).default(1),
  /** Swaps inside for outside, which is what makes a mask a hole. */
  inverted: z.boolean().default(false),
  enabled: z.boolean().default(true),
});
export type Mask = z.infer<typeof maskSchema>;

/**
 * A change to some of a mask, leaving the rest alone.
 *
 * Not `maskSchema.partial()`: Zod's `.partial()` keeps a field's default, so softening a mask
 * would also silently un-invert it and set its density back to full.
 */
export const maskPatchSchema = z.object({
  source: maskSourceSchema.optional(),
  featherPx: z.number().min(0).max(500).optional(),
  density: z.number().min(0).max(1).optional(),
  inverted: z.boolean().optional(),
  enabled: z.boolean().optional(),
});
export type MaskPatch = z.infer<typeof maskPatchSchema>;

/* ------------------------------- effect containers ------------------------------ */

/**
 * One effect: a named, reorderable, individually switchable unit.
 *
 * Adjustments used to live in a flat field on the layer, so there was no way to have two of
 * them, to reorder them, or to turn one off without losing its settings. A container fixes
 * all three, and is the shape the later phases' filters and generators drop into.
 */
const effectBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean().default(true),
  /** Blend of this effect's result against the layer beneath it in the stack. */
  blendMode: blendModeSchema.default("normal"),
  opacity: z.number().min(0).max(1).default(1),
  /** Limits this one effect rather than the whole layer. */
  mask: maskSchema.nullable().default(null),
});

export const effectSchema = z.discriminatedUnion("kind", [
  /** The simple sliders, the same ones every layer carries. */
  effectBaseSchema.extend({
    kind: z.literal("adjustments"),
    parameters: adjustmentStackSchema,
  }),
  /**
   * One tone or colour operator: a curve, levels, a lookup table, and the rest.
   *
   * These arrive as a second kind rather than as more fields on the first, because a curve is
   * a graph with its own editor and levels is five numbers per channel. Folding them into the
   * slider stack would mean every layer carried an unused curve.
   */
  effectBaseSchema.extend({
    kind: z.literal("colour"),
    operation: colourOperationSchema,
  }),
  /**
   * One filter that needs to see a neighbourhood: a blur, sharpening, noise, a distortion, or
   * one of the ones that breaks a picture into blocks.
   *
   * A third kind rather than a variant of the second, because the difference decides how it is
   * previewed and what it costs: a colour operator reduces to a lookup table and a filter does
   * not.
   */
  effectBaseSchema.extend({
    kind: z.literal("filter"),
    filter: filterOperationSchema,
  }),
]);
export type Effect = z.infer<typeof effectSchema>;
export type EffectKind = Effect["kind"];

export const MAX_EFFECTS_PER_LAYER = 16;

export const effectContainerSchema = z.object({
  schemaVersion: z.literal(EFFECT_SCHEMA_VERSION),
  effects: z.array(effectSchema).max(MAX_EFFECTS_PER_LAYER).default([]),
});
export type EffectContainer = z.infer<typeof effectContainerSchema>;

export const EMPTY_EFFECT_CONTAINER: EffectContainer = { schemaVersion: EFFECT_SCHEMA_VERSION, effects: [] };

/* ----------------------------------- clipping ---------------------------------- */

/**
 * Whether a layer is confined to the one below it.
 *
 * Clipping is a relationship rather than a property of either layer alone, but storing it on
 * the clipped layer is what keeps it correct when the base moves: the pair travels together
 * because the reference points down the stack, not up.
 */
export const clippingSchema = z.object({
  /** True when this layer shows only where the layer below it has pixels. */
  clipToBelow: z.boolean().default(false),
});
export type Clipping = z.infer<typeof clippingSchema>;

/**
 * Groups a stack into clipping runs: each base and the layers confined to it.
 *
 * Rendering needs this because a clipping group composites as a unit — the whole run is drawn
 * and masked together, then blended onto the document once. Treating each layer separately
 * would let a clipped layer blend against the wrong thing.
 */
export function clippingRuns<T extends { id: string; clipToBelow?: boolean }>(
  layers: readonly T[],
): { base: T; clipped: T[] }[] {
  const runs: { base: T; clipped: T[] }[] = [];
  for (const layer of layers) {
    const previous = runs[runs.length - 1];
    if (layer.clipToBelow && previous) previous.clipped.push(layer);
    else runs.push({ base: layer, clipped: [] });
  }
  return runs;
}

/* ---------------------------------- validation --------------------------------- */

/**
 * Refuses a mask that would point at itself, directly or through a chain.
 *
 * A layer masked by a layer masked by the first has no defined result, and discovering that
 * during a render means a frozen tab rather than a message.
 */
export function assertNoMaskCycle(
  masksByLayer: ReadonlyMap<string, Mask[]>,
  startLayerId: string,
): void {
  const seen = new Set<string>();
  const walk = (layerId: string, path: string[]): void => {
    if (seen.has(layerId)) return;
    seen.add(layerId);
    for (const mask of masksByLayer.get(layerId) ?? []) {
      if (mask.source.kind !== "layer_alpha") continue;
      const next = mask.source.layerId;
      if (path.includes(next)) {
        throw new ProjectError(
          "INVALID_INPUT",
          "That mask would refer back to the layer it masks, which has no defined result.",
          { fieldPath: "mask.source.layerId" },
        );
      }
      walk(next, [...path, next]);
    }
  };
  walk(startLayerId, [startLayerId]);
}

export function assertEffectCount(count: number): void {
  if (count > MAX_EFFECTS_PER_LAYER) {
    throw new ProjectError(
      "INVALID_INPUT",
      `A layer holds at most ${MAX_EFFECTS_PER_LAYER} effects; ${count} were requested.`,
      { fieldPath: "effects" },
    );
  }
}

/** A sentence describing what an effect does. */
export function describeEffect(effect: Effect): string {
  const what = effect.kind === "colour" ? describeColourOperation(effect.operation)
    : effect.kind === "filter" ? describeFilter(effect.filter)
      : "Colour sliders.";
  const parts = [`“${effect.name}”: ${what.replace(/\.$/, "")}`];
  if (effect.blendMode !== "normal") parts.push(`blended with ${effect.blendMode}`);
  if (effect.opacity < 1) parts.push(`at ${Math.round(effect.opacity * 100)}%`);
  if (effect.mask) parts.push("masked");
  if (!effect.enabled) parts.push("currently switched off");
  return `${parts.join(", ")}.`;
}

/** A sentence describing what a mask does, for the inspector and agent replies. */
export function describeMask(mask: Mask): string {
  const where = mask.source.kind === "shape"
    ? `${/^[aeiou]/i.test(mask.source.shape) ? "an" : "a"} ${mask.source.shape}`
    : mask.source.kind === "layer_alpha" ? "another layer's shape"
      : mask.source.kind === "path" ? "a vector path"
        : mask.source.kind === "stored" ? "a saved selection"
          : mask.source.kind === "luma" ? `whatever is brighter than ${mask.source.low}`
            : mask.source.kind === "track_matte" ? "another track's shape" : "a painted mask";
  const parts = [`Limited to ${where}`];
  if (mask.inverted) parts.push("inverted, so it hides that area instead");
  if (mask.featherPx > 0) parts.push(`softened by ${mask.featherPx} px`);
  if (mask.density < 1) parts.push(`at ${Math.round(mask.density * 100)}% strength`);
  if (!mask.enabled) parts.push("currently switched off");
  return `${parts.join(", ")}.`;
}
