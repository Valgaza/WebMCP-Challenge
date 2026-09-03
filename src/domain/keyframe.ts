import { z } from "zod";
import { ProjectError } from "./project-error";
import { rationalSchema, toSeconds, type Rational } from "./time";

export const KEYFRAME_SCHEMA_VERSION = 1 as const;

/**
 * Animation, shared by photo and video.
 *
 * A keyframe is a value pinned to an instant; a track is what one property does over time.
 * Nothing here knows whether the property belongs to a layer or a clip, which is what lets a
 * position animate the same way in both. Time is a rational, as everywhere else, so a value
 * at 29.97 fps lands on the frame it was authored on rather than near it.
 */

/**
 * How a value travels from one keyframe to the next.
 *
 * `hold` is not an easing but a refusal to interpolate: the value stays put and jumps at the
 * next key, which is what a step animation needs and what an eased curve cannot express.
 */
export const interpolationSchema = z.enum(["linear", "hold", "ease_in", "ease_out", "ease_in_out", "bezier"]);
export type Interpolation = z.infer<typeof interpolationSchema>;

/**
 * Control handles for a custom curve, in the same normalised space CSS uses.
 *
 * Only meaningful for `bezier`; the named easings are the common cases of exactly this, kept
 * separate so the usual choice does not require understanding control points.
 */
export const bezierHandlesSchema = z.object({
  outX: z.number().min(0).max(1).default(0.42),
  outY: z.number().min(-4).max(4).default(0),
  inX: z.number().min(0).max(1).default(0.58),
  inY: z.number().min(-4).max(4).default(1),
});
export type BezierHandles = z.infer<typeof bezierHandlesSchema>;

export const DEFAULT_HANDLES: BezierHandles = { outX: 0.42, outY: 0, inX: 0.58, inY: 1 };

/** The named easings, expressed as the bezier curves they actually are. */
const NAMED_CURVES: Record<Exclude<Interpolation, "linear" | "hold" | "bezier">, BezierHandles> = {
  ease_in: { outX: 0.42, outY: 0, inX: 1, inY: 1 },
  ease_out: { outX: 0, outY: 0, inX: 0.58, inY: 1 },
  ease_in_out: { outX: 0.42, outY: 0, inX: 0.58, inY: 1 },
};

export const keyframeSchema = z.object({
  id: z.string().min(1),
  time: rationalSchema,
  value: z.number().min(-1_000_000).max(1_000_000),
  /** Governs the segment that *leaves* this keyframe. */
  interpolation: interpolationSchema.default("linear"),
  handles: bezierHandlesSchema.default(DEFAULT_HANDLES),
});
export type Keyframe = z.infer<typeof keyframeSchema>;

export const MAX_KEYFRAMES_PER_TRACK = 500;

/**
 * A property path, dotted.
 *
 * Paths rather than typed fields because the set of animatable properties grows with every
 * later phase, and a union would have to be rewritten each time. Validation is by shape and
 * by an allow-list the caller supplies, so a typo is refused rather than silently animating
 * nothing.
 */
export const propertyPathSchema = z.string().trim().min(1).max(120).regex(
  /^[a-zA-Z][\w-]*(\.[\w-]+)*$/,
  "A property path looks like “transform.x” or “opacity”.",
);

export const keyframeTrackSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(KEYFRAME_SCHEMA_VERSION),
  propertyPath: propertyPathSchema,
  enabled: z.boolean().default(true),
  keyframes: z.array(keyframeSchema).max(MAX_KEYFRAMES_PER_TRACK).default([]),
});
export type KeyframeTrack = z.infer<typeof keyframeTrackSchema>;

/** Every animatable property Estro currently understands, per kind of object. */
export const ANIMATABLE_PROPERTIES: Record<"layer" | "clip", string[]> = {
  layer: ["transform.x", "transform.y", "transform.scaleX", "transform.scaleY", "transform.rotationDeg", "opacity"],
  clip: ["transform.x", "transform.y", "transform.scaleX", "transform.scaleY", "transform.rotationDeg", "opacity", "gainDb"],
};

export function assertAnimatable(kind: "layer" | "clip", propertyPath: string): void {
  if (!ANIMATABLE_PROPERTIES[kind].includes(propertyPath)) {
    throw new ProjectError(
      "INVALID_INPUT",
      `A ${kind} cannot animate “${propertyPath}”. Animatable properties are: ${ANIMATABLE_PROPERTIES[kind].join(", ")}.`,
      { fieldPath: "propertyPath" },
    );
  }
}

/* --------------------------------- evaluation --------------------------------- */

/**
 * Solves a cubic bezier for y at a given x.
 *
 * The curve is parameterised by t, but animation asks "how far through in time", which is x.
 * Newton's method converges in a few iterations for the well-behaved curves easing uses, and
 * bisection catches the ones where it does not, so the solver terminates on any input rather
 * than spinning on a pathological curve.
 */
export function solveBezier(handles: BezierHandles, x: number): number {
  const clampedX = Math.max(0, Math.min(1, x));
  if (clampedX === 0 || clampedX === 1) return clampedX;

  const curveX = (t: number) => {
    const inverse = 1 - t;
    return 3 * inverse * inverse * t * handles.outX + 3 * inverse * t * t * handles.inX + t * t * t;
  };
  const curveY = (t: number) => {
    const inverse = 1 - t;
    return 3 * inverse * inverse * t * handles.outY + 3 * inverse * t * t * handles.inY + t * t * t;
  };
  const slopeX = (t: number) => {
    const inverse = 1 - t;
    return 3 * inverse * inverse * handles.outX + 6 * inverse * t * (handles.inX - handles.outX) + 3 * t * t * (1 - handles.inX);
  };

  let t = clampedX;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const error = curveX(t) - clampedX;
    if (Math.abs(error) < 1e-6) return curveY(t);
    const slope = slopeX(t);
    if (Math.abs(slope) < 1e-6) break;
    t -= error / slope;
  }

  // Newton stalled, so fall back to something that cannot.
  let low = 0;
  let high = 1;
  t = clampedX;
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const value = curveX(t);
    if (Math.abs(value - clampedX) < 1e-6) break;
    if (value > clampedX) high = t; else low = t;
    t = (low + high) / 2;
  }
  return curveY(t);
}

/** The eased progress through one segment, given the interpolation leaving its first key. */
export function easedProgress(progress: number, interpolation: Interpolation, handles: BezierHandles): number {
  const clamped = Math.max(0, Math.min(1, progress));
  if (interpolation === "hold") return 0;
  if (interpolation === "linear") return clamped;
  const curve = interpolation === "bezier" ? handles : NAMED_CURVES[interpolation];
  return solveBezier(curve, clamped);
}

/** Keyframes in time order. Authoring order is not playback order. */
export function sortKeyframes(keyframes: readonly Keyframe[]): Keyframe[] {
  return [...keyframes].sort((a, b) => toSeconds(a.time) - toSeconds(b.time));
}

/**
 * The value of an animated property at an instant.
 *
 * Before the first key and after the last, the value holds rather than extrapolating: a
 * position that kept accelerating past its final keyframe would fly off screen, which is
 * never what anyone meant.
 */
export function valueAt(track: KeyframeTrack, time: Rational, fallback: number): number {
  if (!track.enabled || track.keyframes.length === 0) return fallback;
  const ordered = sortKeyframes(track.keyframes);
  const seconds = toSeconds(time);

  // The last key at or before this instant. Taking the *last* matters when several share a
  // time: `setKeyframe` replaces rather than stacks, so where duplicates do exist the later
  // one is the one that was meant.
  let index = -1;
  for (let candidate = 0; candidate < ordered.length; candidate += 1) {
    if (toSeconds(ordered[candidate].time) <= seconds + 1e-9) index = candidate;
    else break;
  }

  // Before the first key and after the last, the value holds rather than extrapolating: a
  // position that kept accelerating past its final keyframe would fly off screen.
  if (index === -1) return ordered[0].value;
  const from = ordered[index];
  if (index === ordered.length - 1) return from.value;

  const to = ordered[index + 1];
  const start = toSeconds(from.time);
  const end = toSeconds(to.time);
  const span = end - start;
  if (span <= 0) return to.value;

  const progress = easedProgress((seconds - start) / span, from.interpolation, from.handles);
  return from.value + (to.value - from.value) * progress;
}

/** Every animated property of one object, evaluated at an instant. */
export function evaluateTracks(
  tracks: readonly KeyframeTrack[],
  time: Rational,
  current: Readonly<Record<string, number>>,
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const track of tracks) {
    values[track.propertyPath] = valueAt(track, time, current[track.propertyPath] ?? 0);
  }
  return values;
}

/* -------------------------------- motion paths -------------------------------- */

/**
 * The path an object travels, sampled from its position tracks.
 *
 * Returned as points rather than drawn, so the same data serves the overlay a user drags and
 * an agent asking where something goes. Sampling rather than solving analytically keeps one
 * implementation for every easing, including custom curves.
 */
export function motionPath(
  xTrack: KeyframeTrack | null,
  yTrack: KeyframeTrack | null,
  options: { from: Rational; to: Rational; samples?: number; fallbackX?: number; fallbackY?: number },
): { points: { seconds: number; x: number; y: number }[]; keyTimes: number[] } {
  const samples = Math.max(2, Math.min(600, options.samples ?? 120));
  const start = toSeconds(options.from);
  const end = toSeconds(options.to);
  if (end <= start) {
    throw new ProjectError("INVALID_INPUT", "A motion path needs a range longer than zero.", { fieldPath: "range" });
  }

  const points: { seconds: number; x: number; y: number }[] = [];
  for (let index = 0; index < samples; index += 1) {
    const seconds = start + ((end - start) * index) / (samples - 1);
    const time = { numerator: Math.round(seconds * 1000), denominator: 1000 };
    points.push({
      seconds,
      x: xTrack ? valueAt(xTrack, time, options.fallbackX ?? 0) : options.fallbackX ?? 0,
      y: yTrack ? valueAt(yTrack, time, options.fallbackY ?? 0) : options.fallbackY ?? 0,
    });
  }

  // The instants a user can grab are the keyframes themselves, so they travel with the path.
  const keyTimes = [...new Set([
    ...(xTrack?.keyframes ?? []).map((key) => toSeconds(key.time)),
    ...(yTrack?.keyframes ?? []).map((key) => toSeconds(key.time)),
  ])].filter((seconds) => seconds >= start && seconds <= end).sort((a, b) => a - b);

  return { points, keyTimes };
}

/* ---------------------------------- editing ----------------------------------- */

/**
 * Adds or replaces a keyframe at an instant.
 *
 * Setting a key where one already exists replaces it rather than stacking a second at the
 * same time, because two values at one instant have no defined result.
 */
export function setKeyframe(track: KeyframeTrack, keyframe: Keyframe): KeyframeTrack {
  const seconds = toSeconds(keyframe.time);
  const without = track.keyframes.filter((entry) => Math.abs(toSeconds(entry.time) - seconds) > 1e-9);
  if (without.length + 1 > MAX_KEYFRAMES_PER_TRACK) {
    throw new ProjectError(
      "INVALID_INPUT",
      `A property holds at most ${MAX_KEYFRAMES_PER_TRACK} keyframes.`,
      { fieldPath: "keyframes" },
    );
  }
  return { ...track, keyframes: sortKeyframes([...without, keyframe]) };
}

export function removeKeyframe(track: KeyframeTrack, keyframeId: string): KeyframeTrack {
  if (!track.keyframes.some((entry) => entry.id === keyframeId)) {
    throw new ProjectError("INVALID_INPUT", "That keyframe is not on this property.", { fieldPath: "keyframeId" });
  }
  return { ...track, keyframes: track.keyframes.filter((entry) => entry.id !== keyframeId) };
}

/** A sentence describing what a track does, for the inspector and agent replies. */
export function describeTrack(track: KeyframeTrack): string {
  if (!track.keyframes.length) return `${track.propertyPath} is not animated.`;
  const ordered = sortKeyframes(track.keyframes);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const span = (toSeconds(last.time) - toSeconds(first.time)).toFixed(2);
  const state = track.enabled ? "" : " (currently switched off)";
  if (ordered.length === 1) return `${track.propertyPath} is pinned to ${first.value} throughout${state}.`;
  return `${track.propertyPath} moves from ${first.value} to ${last.value} across ${span}s in ${ordered.length} keyframes${state}.`;
}
