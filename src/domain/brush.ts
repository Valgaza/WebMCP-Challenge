import { z } from "zod";
import { paintSchema } from "./vector";
import { ProjectError } from "./project-error";

export const BRUSH_SCHEMA_VERSION = 1 as const;

/**
 * Painting, stored as strokes rather than as pixels.
 *
 * This is the phase's central decision. A painted stroke could be flattened into the layer the
 * moment it is drawn, which is simple and permanent — and permanent is the problem. Keeping the
 * stroke means its size, colour, hardness, and even its brush can be changed afterwards, it
 * redraws crisply at export resolution rather than at the resolution of the screen it was drawn
 * on, and one stroke is one Undo step without a pixel buffer per step.
 *
 * The cost is that painting is replayed at render time. A layer holds a bounded number of
 * strokes for that reason, and a stroke a bounded number of points.
 */

/**
 * What a brush does where it lands.
 *
 * Retouching tools are brushes, not separate tools: a dodge, a blur, and a clone all follow a
 * dragged path, respond to pressure, honour a selection, and build up as a stroke crosses
 * itself. Only what happens at each stamp differs, so they extend this list rather than
 * duplicating the stroke engine four more times.
 */
export const brushKindSchema = z.enum([
  "brush", "pencil", "eraser",
  /** Copies pixels from somewhere else in the picture. */
  "clone",
  /**
   * Copies the *texture* from somewhere else and keeps the destination's colour and
   * brightness, which is the difference between a patch that disappears and one that shows.
   */
  "heal",
  /** Lightens, darkens, and changes saturation, as a darkroom did. */
  "dodge", "burn", "sponge",
  /** Softens, defines, and pushes pixels about. */
  "blur", "sharpen", "smudge",
  /** Replaces a red pupil with a neutral one. */
  "red_eye",
]);
export type BrushKind = z.infer<typeof brushKindSchema>;

/** Brushes that change what is already there rather than laying down colour of their own. */
export const RETOUCH_KINDS: BrushKind[] = ["clone", "heal", "dodge", "burn", "sponge", "blur", "sharpen", "smudge", "red_eye"];

/**
 * What each brush does, in the words a person would use.
 *
 * "Sponge" and "burn" are darkroom terms nobody born after film has met, so the label says
 * the effect rather than the tradition.
 */
export const BRUSH_KIND_LABELS: Record<BrushKind, string> = {
  brush: "Brush \u2014 soft-edged paint",
  pencil: "Pencil \u2014 hard-edged paint",
  eraser: "Eraser \u2014 removes paint",
  clone: "Clone \u2014 copies from elsewhere",
  heal: "Heal \u2014 removes a blemish and keeps the surrounding tone",
  dodge: "Dodge \u2014 lightens",
  burn: "Burn \u2014 darkens",
  sponge: "Sponge \u2014 takes colour out, or adds it",
  blur: "Blur \u2014 softens",
  sharpen: "Sharpen \u2014 defines",
  smudge: "Smudge \u2014 pushes colour about",
  red_eye: "Red eye \u2014 neutralises a red pupil",
};

export function isRetouch(kind: BrushKind): boolean {
  return RETOUCH_KINDS.includes(kind);
}

/**
 * What a brush is: a size, an edge, and how heavily it lays down colour.
 *
 * A pencil is a brush whose edge is hard and whose spacing is tight; an eraser is a brush that
 * removes rather than adds. Keeping them as one shape with three behaviours means a preset,
 * a dynamic, and a stroke all work identically whichever tool made them.
 */
export const brushSchema = z.object({
  kind: brushKindSchema.default("brush"),
  sizePx: z.number().min(0.1).max(2500).default(24),
  /** 1 is a crisp edge, 0 a fully soft one. A pencil is always 1. */
  hardness: z.number().min(0).max(1).default(0.8),
  /** How much colour one stamp lays down. Below 1 builds up as a stroke crosses itself. */
  flow: z.number().min(0.01).max(1).default(1),
  opacity: z.number().min(0.01).max(1).default(1),
  /** Distance between stamps, as a fraction of the brush's size. */
  spacing: z.number().min(0.01).max(4).default(0.1),
  /** Squashes the tip; 1 is round. */
  roundness: z.number().min(0.05).max(1).default(1),
  angleDeg: z.number().min(-180).max(180).default(0),
  /** Random size variation per stamp, which is what keeps a natural brush from looking printed. */
  scatter: z.number().min(0).max(1).default(0),
});
export type Brush = z.infer<typeof brushSchema>;

export const DEFAULT_BRUSH: Brush = brushSchema.parse({});

/**
 * A change to some of a brush, leaving the rest alone.
 *
 * Not `brushSchema.partial()`: Zod's `.partial()` keeps a field's default, so restyling a
 * drawn stroke to a bigger size would silently reset its hardness, flow, and opacity too.
 */
export const brushPatchSchema = z.object({
  kind: brushKindSchema.optional(),
  sizePx: z.number().min(0.1).max(2500).optional(),
  hardness: z.number().min(0).max(1).optional(),
  flow: z.number().min(0.01).max(1).optional(),
  opacity: z.number().min(0.01).max(1).optional(),
  spacing: z.number().min(0.01).max(4).optional(),
  roundness: z.number().min(0.05).max(1).optional(),
  angleDeg: z.number().min(-180).max(180).optional(),
  scatter: z.number().min(0).max(1).optional(),
});
export type BrushPatch = z.infer<typeof brushPatchSchema>;

/** A pencil is a hard-edged brush with no build-up, so it is one preset rather than one tool. */
export const PENCIL: Brush = brushSchema.parse({ kind: "pencil", hardness: 1, flow: 1, spacing: 0.05, sizePx: 4 });
export const ERASER: Brush = brushSchema.parse({ kind: "eraser", hardness: 0.9, sizePx: 40 });

/* -------------------------------- pen dynamics -------------------------------- */

/**
 * What the pen's pressure, tilt, rotation, and speed do.
 *
 * Each is a separate amount from 0 to 1 rather than a switch, because "pressure changes the
 * size a little and the opacity a lot" is the ordinary case and a switch cannot say it. A
 * device that reports none of these is not a special case: every input is absent, so every
 * dynamic contributes nothing and the brush draws at its stated settings.
 */
export const brushDynamicsSchema = z.object({
  /** How much harder pressing widens the stroke. */
  pressureToSize: z.number().min(0).max(1).default(0.6),
  pressureToOpacity: z.number().min(0).max(1).default(0.3),
  pressureToFlow: z.number().min(0).max(1).default(0),
  /** Tilting the pen flattens the tip, the way a real one does. */
  tiltToRoundness: z.number().min(0).max(1).default(0),
  /** The barrel's rotation turns the tip. */
  rotationToAngle: z.number().min(0).max(1).default(0),
  /** Drawing quickly thins the stroke, which is what makes a fast line taper. */
  velocityToSize: z.number().min(0).max(1).default(0),
});
export type BrushDynamics = z.infer<typeof brushDynamicsSchema>;

export const NO_DYNAMICS: BrushDynamics = brushDynamicsSchema.parse({
  pressureToSize: 0, pressureToOpacity: 0,
});

export const DEFAULT_DYNAMICS: BrushDynamics = brushDynamicsSchema.parse({});

/** A change to some pen dynamics. Optional for the same reason as the brush patch. */
export const brushDynamicsPatchSchema = z.object({
  pressureToSize: z.number().min(0).max(1).optional(),
  pressureToOpacity: z.number().min(0).max(1).optional(),
  pressureToFlow: z.number().min(0).max(1).optional(),
  tiltToRoundness: z.number().min(0).max(1).optional(),
  rotationToAngle: z.number().min(0).max(1).optional(),
  velocityToSize: z.number().min(0).max(1).optional(),
});
export type BrushDynamicsPatch = z.infer<typeof brushDynamicsPatchSchema>;

/**
 * One sample from the pointer.
 *
 * Pressure defaults to full rather than to nothing: a mouse reports no pressure, and a stroke
 * drawn with one has to come out at the brush's stated size rather than invisible.
 */
export const strokePointSchema = z.object({
  x: z.number(),
  y: z.number(),
  pressure: z.number().min(0).max(1).default(1),
  /** How far the pen is tipped from vertical, in degrees. */
  tiltDeg: z.number().min(0).max(90).default(0),
  /** Which way it is tipped, and which way the barrel is turned. */
  rotationDeg: z.number().min(-180).max(180).default(0),
  /** Pointer speed in pixels per millisecond, for the dynamics that use it. */
  velocity: z.number().min(0).max(20).default(0),
});
export type StrokePoint = z.infer<typeof strokePointSchema>;

export const pointOffsetSchema = z.object({
  x: z.number().min(-32768).max(32768),
  y: z.number().min(-32768).max(32768),
});

export const MAX_POINTS_PER_STROKE = 4000;
export const MAX_STROKES_PER_LAYER = 2000;

export const strokeSchema = z.object({
  id: z.string().min(1),
  brush: brushSchema,
  dynamics: brushDynamicsSchema.default(DEFAULT_DYNAMICS),
  paint: paintSchema,
  points: z.array(strokePointSchema).min(1).max(MAX_POINTS_PER_STROKE),
  /** Limits the stroke to what was selected when it was drawn, by saved selection id. */
  selectionId: z.string().nullable().default(null),
  /**
   * Where a clone stamp reads from, relative to where it paints.
   *
   * An offset rather than a fixed point, because that is what makes a clone follow the hand:
   * the source moves with the brush, so dragging along a wall copies along the wall rather
   * than smearing one spot across it.
   */
  cloneOffset: pointOffsetSchema.nullable().default(null),
  /**
   * How strongly a retouching brush works, from 0 to 1.
   *
   * Separate from opacity because these brushes are not laying down colour: "dodge at 20%"
   * means a fifth as much lightening, not a fifth as opaque a layer of it.
   */
  strength: z.number().min(0).max(1).default(0.5),
});
export type Stroke = z.infer<typeof strokeSchema>;

export const paintStackSchema = z.object({
  schemaVersion: z.literal(BRUSH_SCHEMA_VERSION),
  strokes: z.array(strokeSchema).max(MAX_STROKES_PER_LAYER).default([]),
});
export type PaintStack = z.infer<typeof paintStackSchema>;

export const EMPTY_PAINT_STACK: PaintStack = { schemaVersion: BRUSH_SCHEMA_VERSION, strokes: [] };

/* ------------------------------- stamping a stroke ------------------------------- */

/** One stamp of the brush: everything the renderer needs, with the dynamics already resolved. */
export interface BrushStamp {
  x: number;
  y: number;
  radiusPx: number;
  opacity: number;
  flow: number;
  hardness: number;
  roundness: number;
  angleDeg: number;
}

/**
 * A repeatable pseudo-random number, so scatter looks random but redraws identically.
 *
 * `Math.random` here would make a stroke different every time it was drawn — a preview and its
 * export would not match, and neither would two renders of the same document.
 */
function noise(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * Turns a stroke into the stamps that draw it.
 *
 * The points from a pointer are far apart — a fast gesture reports a handful across the whole
 * screen — so the gaps are filled at the brush's spacing. Interpolating pressure along with
 * position is what makes a stroke taper smoothly rather than in steps at each sample.
 */
export function stampsFor(stroke: Stroke): BrushStamp[] {
  const { brush, dynamics, points } = stroke;
  const stamps: BrushStamp[] = [];
  const step = Math.max(0.5, brush.sizePx * brush.spacing);

  const resolve = (point: StrokePoint, index: number): BrushStamp => {
    // Each dynamic scales between "no effect" and "full effect at this input", so an amount of
    // zero leaves the brush exactly as it was set.
    const pressure = point.pressure;
    const sizeFactor = 1 - dynamics.pressureToSize * (1 - pressure);
    const speedFactor = 1 - dynamics.velocityToSize * Math.min(1, point.velocity / 3);
    const scatter = brush.scatter > 0 ? 1 + (noise(index) - 0.5) * brush.scatter : 1;

    return {
      x: point.x,
      y: point.y,
      radiusPx: Math.max(0.1, (brush.sizePx / 2) * sizeFactor * speedFactor * scatter),
      opacity: brush.opacity * (1 - dynamics.pressureToOpacity * (1 - pressure)),
      flow: brush.flow * (1 - dynamics.pressureToFlow * (1 - pressure)),
      hardness: brush.kind === "pencil" ? 1 : brush.hardness,
      // Tilting flattens the tip, the way holding a real pen at an angle does.
      roundness: brush.roundness * (1 - dynamics.tiltToRoundness * (point.tiltDeg / 90)),
      angleDeg: brush.angleDeg + dynamics.rotationToAngle * point.rotationDeg,
    };
  };

  if (points.length === 1) return [resolve(points[0], 0)];

  let index = 0;
  for (let segment = 0; segment < points.length - 1; segment += 1) {
    const from = points[segment];
    const to = points[segment + 1];
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const count = Math.max(1, Math.ceil(distance / step));

    for (let n = 0; n < count; n += 1) {
      const t = n / count;
      stamps.push(resolve({
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        pressure: from.pressure + (to.pressure - from.pressure) * t,
        tiltDeg: from.tiltDeg + (to.tiltDeg - from.tiltDeg) * t,
        rotationDeg: from.rotationDeg + (to.rotationDeg - from.rotationDeg) * t,
        velocity: from.velocity + (to.velocity - from.velocity) * t,
      }, index += 1));
    }
  }
  // The final sample, which the loop above stops just short of, so a stroke ends where the
  // pointer was lifted rather than one step before it.
  stamps.push(resolve(points[points.length - 1], index + 1));
  return stamps;
}

/** The box a stroke covers, for invalidating only the part of a preview that changed. */
export function strokeBounds(stroke: Stroke): { x: number; y: number; width: number; height: number } {
  const stamps = stampsFor(stroke);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const stamp of stamps) {
    minX = Math.min(minX, stamp.x - stamp.radiusPx);
    minY = Math.min(minY, stamp.y - stamp.radiusPx);
    maxX = Math.max(maxX, stamp.x + stamp.radiusPx);
    maxY = Math.max(maxY, stamp.y + stamp.radiusPx);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Thins a stroke to the points that describe its shape.
 *
 * A pointer reports far more samples than a curve needs, and every one of them is stored,
 * replayed, and synced. Ramer–Douglas–Peucker keeps the corners and drops the samples that sit
 * on a line between their neighbours, which on an ordinary stroke removes most of them without
 * a visible difference.
 */
export function simplify(points: readonly StrokePoint[], tolerancePx = 0.75): StrokePoint[] {
  if (points.length < 3 || tolerancePx <= 0) return [...points];

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    const a = points[start];
    const b = points[end];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);

    let worst = 0;
    let worstAt = -1;
    for (let index = start + 1; index < end; index += 1) {
      const point = points[index];
      // Distance from the point to the line through the ends. A zero-length segment means the
      // ends coincide, so plain distance from one of them is the right measure.
      const distance = length < 1e-9
        ? Math.hypot(point.x - a.x, point.y - a.y)
        : Math.abs(dy * point.x - dx * point.y + b.x * a.y - b.y * a.x) / length;
      if (distance > worst) {
        worst = distance;
        worstAt = index;
      }
    }

    if (worst > tolerancePx && worstAt > 0) {
      keep[worstAt] = 1;
      stack.push([start, worstAt], [worstAt, end]);
    }
  }
  return points.filter((_, index) => keep[index] === 1);
}

export function assertStrokeCount(count: number): void {
  if (count > MAX_STROKES_PER_LAYER) {
    throw new ProjectError(
      "INVALID_INPUT",
      `A paint layer holds at most ${MAX_STROKES_PER_LAYER} strokes; flatten it or start another layer.`,
      { fieldPath: "strokes" },
    );
  }
}

/** A sentence describing a brush, for the inspector and for agent replies. */
const BRUSH_LABELS: Record<BrushKind, string> = {
  brush: "A brush", pencil: "A pencil", eraser: "An eraser",
  clone: "A clone stamp", heal: "A healing brush", dodge: "A dodge brush", burn: "A burn brush", sponge: "A sponge",
  blur: "A blur brush", sharpen: "A sharpen brush", smudge: "A smudge brush",
  red_eye: "A red-eye brush",
};

export function describeBrush(brush: Brush): string {
  const what = BRUSH_LABELS[brush.kind];
  const edge = brush.hardness >= 0.95 ? "hard-edged" : brush.hardness <= 0.2 ? "very soft" : "soft-edged";
  const parts = [`${what} ${Math.round(brush.sizePx)} px across, ${edge}`];
  if (brush.opacity < 1) parts.push(`at ${Math.round(brush.opacity * 100)}% opacity`);
  if (brush.flow < 1) parts.push(`building up at ${Math.round(brush.flow * 100)}% flow`);
  if (brush.roundness < 1) parts.push(`flattened to ${Math.round(brush.roundness * 100)}%`);
  return `${parts.join(", ")}.`;
}

const RETOUCH_VERBS: Partial<Record<BrushKind, string>> = {
  clone: "Cloned", dodge: "Lightened", burn: "Darkened", sponge: "Changed the saturation of",
  blur: "Softened", sharpen: "Sharpened", smudge: "Smudged", red_eye: "Corrected red eye in",
};

export function describeStroke(stroke: Stroke): string {
  const size = Math.round(stroke.brush.sizePx);
  const where = stroke.selectionId ? ", inside the selection" : "";

  if (stroke.brush.kind === "eraser") return `Erased with a ${size} px brush${where}.`;

  const verb = RETOUCH_VERBS[stroke.brush.kind];
  if (verb) {
    const strength = ` at ${Math.round(stroke.strength * 100)}% strength`;
    const from = stroke.brush.kind === "clone" && stroke.cloneOffset
      ? ` from ${Math.round(stroke.cloneOffset.x)}, ${Math.round(stroke.cloneOffset.y)} px away`
      : "";
    return `${verb} an area with a ${size} px brush${from}${strength}${where}.`;
  }

  const colour = stroke.paint.kind === "solid" ? stroke.paint.colour : `a ${stroke.paint.kind}`;
  return `Painted ${colour} with a ${size} px ${stroke.brush.kind}${where}.`;
}
