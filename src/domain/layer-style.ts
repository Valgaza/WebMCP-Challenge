import { z } from "zod";
import { blendModeSchema } from "./effect";
import { paintSchema } from "./vector";
import { ProjectError } from "./project-error";

export const LAYER_STYLE_SCHEMA_VERSION = 1 as const;

/**
 * Effects drawn from a layer's own shape: strokes, shadows, glows, and overlays.
 *
 * These are not filters. A filter changes the pixels it is given; a style draws something new
 * derived from where the layer's pixels are, which is why a drop shadow follows text as it is
 * retyped and a stroke follows a shape as it is dragged. Storing them as parameters rather
 * than baking them keeps that link alive, and it is the same argument as masks and effects.
 */

/** Where a stroke sits relative to the edge it follows. */
export const strokePositionSchema = z.enum(["outside", "centre", "inside"]);
export type StrokePosition = z.infer<typeof strokePositionSchema>;

const shadowShape = {
  /** Direction in degrees, measured clockwise from straight up, as a light angle is read. */
  angleDegrees: z.number().min(-360).max(360).default(135),
  distancePx: z.number().min(0).max(500).default(6),
  /** Grows the shadow's shape before it is blurred, which is how a heavy shadow is made. */
  spreadPx: z.number().min(0).max(250).default(0),
  blurPx: z.number().min(0).max(500).default(8),
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#000000"),
  opacity: z.number().min(0).max(1).default(0.5),
  blendMode: blendModeSchema.default("normal"),
};

export const layerStyleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("stroke"),
    id: z.string().min(1),
    enabled: z.boolean().default(true),
    widthPx: z.number().min(0).max(500).default(3),
    position: strokePositionSchema.default("outside"),
    paint: paintSchema,
    opacity: z.number().min(0).max(1).default(1),
    blendMode: blendModeSchema.default("normal"),
  }),
  z.object({
    kind: z.literal("drop_shadow"),
    id: z.string().min(1),
    enabled: z.boolean().default(true),
    ...shadowShape,
  }),
  /** The same shape cast inwards, which reads as depth rather than as lift. */
  z.object({
    kind: z.literal("inner_shadow"),
    id: z.string().min(1),
    enabled: z.boolean().default(true),
    ...shadowShape,
  }),
  z.object({
    kind: z.literal("glow"),
    id: z.string().min(1),
    enabled: z.boolean().default(true),
    /** Outwards is a halo; inwards lights the inside of the shape. */
    direction: z.enum(["outer", "inner"]).default("outer"),
    sizePx: z.number().min(0).max(500).default(12),
    spreadPx: z.number().min(0).max(250).default(0),
    colour: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#ffffff"),
    opacity: z.number().min(0).max(1).default(0.6),
    blendMode: blendModeSchema.default("screen"),
  }),
  /**
   * A bevel: a light edge on one side and a dark one opposite, which is what reads as depth.
   *
   * Two shadows of the shape offset in opposite directions, so it comes out of the same
   * machinery as everything else rather than needing a lighting model.
   */
  z.object({
    kind: z.literal("bevel"),
    id: z.string().min(1),
    enabled: z.boolean().default(true),
    /** Raised looks like a button; pressed looks like a socket. One sign apart. */
    direction: z.enum(["raised", "pressed"]).default("raised"),
    sizePx: z.number().min(0).max(250).default(4),
    softnessPx: z.number().min(0).max(250).default(3),
    angleDegrees: z.number().min(-360).max(360).default(135),
    highlightColour: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#ffffff"),
    shadowColour: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#000000"),
    opacity: z.number().min(0).max(1).default(0.6),
    blendMode: blendModeSchema.default("normal"),
  }),
  z.object({
    kind: z.literal("overlay"),
    id: z.string().min(1),
    enabled: z.boolean().default(true),
    paint: paintSchema,
    opacity: z.number().min(0).max(1).default(1),
    blendMode: blendModeSchema.default("normal"),
  }),
]);
export type LayerStyle = z.infer<typeof layerStyleSchema>;
export type LayerStyleKind = LayerStyle["kind"];

export const MAX_STYLES_PER_LAYER = 12;

export const layerStyleStackSchema = z.object({
  schemaVersion: z.literal(LAYER_STYLE_SCHEMA_VERSION),
  styles: z.array(layerStyleSchema).max(MAX_STYLES_PER_LAYER).default([]),
});
export type LayerStyleStack = z.infer<typeof layerStyleStackSchema>;

export const EMPTY_STYLE_STACK: LayerStyleStack = { schemaVersion: LAYER_STYLE_SCHEMA_VERSION, styles: [] };

/**
 * The order styles are drawn in, which is not the order they are stored in.
 *
 * Everything that sits behind the layer has to be painted before it, and everything on top
 * after; a person reordering a list of styles is not thinking about that. Fixing the painting
 * order here means a shadow can never end up covering the thing casting it, whatever order the
 * list happens to be in.
 */
const PAINT_ORDER: Record<LayerStyleKind, number> = {
  drop_shadow: 0,
  stroke: 1,
  overlay: 2,
  inner_shadow: 3,
  // A bevel sits over the fill it is shaping, and under a glow that is meant to sit over
  // everything.
  bevel: 4,
  glow: 5,
};

export function paintOrder(styles: readonly LayerStyle[]): LayerStyle[] {
  return [...styles]
    .filter((style) => style.enabled)
    // A stable sort keeps two styles of the same kind in the order the person put them.
    .map((style, index) => ({ style, index }))
    .sort((a, b) => PAINT_ORDER[a.style.kind] - PAINT_ORDER[b.style.kind] || a.index - b.index)
    .map((entry) => entry.style);
}

/** Whether a style is drawn behind the layer rather than on top of it. */
export function drawsBehind(style: LayerStyle): boolean {
  return style.kind === "drop_shadow" || (style.kind === "glow" && style.direction === "outer")
    || (style.kind === "stroke" && style.position === "outside");
}

/** Turns a light angle and distance into the offset a shadow is drawn at. */
export function shadowOffset(angleDegrees: number, distancePx: number): { dx: number; dy: number } {
  // Screen y grows downwards, so a light from above casts a shadow with positive y. Measuring
  // clockwise from straight up is how the angle reads in an interface.
  const radians = (angleDegrees * Math.PI) / 180;
  return {
    dx: Math.sin(radians) * distancePx,
    dy: -Math.cos(radians) * distancePx,
  };
}

export function assertStyleCount(count: number): void {
  if (count > MAX_STYLES_PER_LAYER) {
    throw new ProjectError(
      "INVALID_INPUT",
      `A layer holds at most ${MAX_STYLES_PER_LAYER} styles; ${count} were requested.`,
      { fieldPath: "styles" },
    );
  }
}

/** A sentence describing what a style does, for the inspector and agent replies. */
export function describeStyle(style: LayerStyle): string {
  const suffix = style.enabled ? "" : " (switched off)";
  switch (style.kind) {
    case "stroke":
      return `A ${style.widthPx} px ${style.position} outline${suffix}.`;
    case "drop_shadow":
      return `A shadow ${style.distancePx} px away at ${style.angleDegrees}°, blurred by ${style.blurPx} px${suffix}.`;
    case "inner_shadow":
      return `A shadow cast inwards ${style.distancePx} px at ${style.angleDegrees}°${suffix}.`;
    case "glow":
      return `${style.direction === "outer" ? "An outer" : "An inner"} glow of ${style.sizePx} px in ${style.colour}${suffix}.`;
    case "bevel":
      return `A ${style.direction} bevel of ${style.sizePx} px, lit from ${style.angleDegrees}°${suffix}.`;
    case "overlay":
      return `A ${style.paint.kind} fill over the layer's own shape${suffix}.`;
  }
}
