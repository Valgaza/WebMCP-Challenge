import { describe, expect, it } from "vitest";
import { rational } from "./time";
import {
  ANIMATABLE_PROPERTIES, DEFAULT_HANDLES, assertAnimatable, describeTrack, easedProgress,
  evaluateTracks, keyframeTrackSchema, motionPath, removeKeyframe, setKeyframe, solveBezier,
  sortKeyframes, valueAt, type Keyframe, type KeyframeTrack,
} from "./keyframe";

const key = (id: string, seconds: number, value: number, overrides: Partial<Keyframe> = {}): Keyframe => ({
  id, time: rational(Math.round(seconds * 1000), 1000), value,
  interpolation: "linear", handles: DEFAULT_HANDLES, ...overrides,
});

const track = (keyframes: Keyframe[], propertyPath = "opacity"): KeyframeTrack =>
  keyframeTrackSchema.parse({ id: "track-1", schemaVersion: 1, propertyPath, enabled: true, keyframes });

/**
 * `SH-054` and `SH-055`. Animation is shared: nothing here knows whether the property belongs
 * to a photo layer or a video clip, which is what lets a position animate the same way in
 * both.
 */
describe("keyframe evaluation", () => {
  it("holds the first value before the first key and the last after the last", () => {
    const animated = track([key("a", 1, 0), key("b", 2, 100)]);
    // Extrapolating past the ends would send a position off screen, which nobody meant.
    expect(valueAt(animated, rational(0), -1)).toBe(0);
    expect(valueAt(animated, rational(5), -1)).toBe(100);
  });

  it("interpolates linearly between two keys", () => {
    const animated = track([key("a", 0, 0), key("b", 2, 100)]);
    expect(valueAt(animated, rational(1), 0)).toBeCloseTo(50, 6);
    expect(valueAt(animated, rational(500, 1000), 0)).toBeCloseTo(25, 6);
  });

  it("returns the fallback when a property is not animated", () => {
    expect(valueAt(track([]), rational(1), 0.75)).toBe(0.75);
  });

  it("ignores a track that is switched off rather than freezing its value", () => {
    const disabled = { ...track([key("a", 0, 0), key("b", 2, 100)]), enabled: false };
    expect(valueAt(disabled, rational(1), 0.5)).toBe(0.5);
  });

  /** A step animation is a refusal to interpolate, not an easing curve. */
  it("holds a value across the whole segment when the key says hold", () => {
    const stepped = track([key("a", 0, 10, { interpolation: "hold" }), key("b", 2, 90)]);
    expect(valueAt(stepped, rational(1), 0)).toBe(10);
    expect(valueAt(stepped, rational(1999, 1000), 0)).toBe(10);
    expect(valueAt(stepped, rational(2), 0)).toBe(90);
  });

  it("evaluates in time order regardless of the order keys were authored in", () => {
    const scrambled = track([key("late", 2, 100), key("early", 0, 0)]);
    expect(sortKeyframes(scrambled.keyframes).map((entry) => entry.id)).toEqual(["early", "late"]);
    expect(valueAt(scrambled, rational(1), 0)).toBeCloseTo(50, 6);
  });

  it("takes the later value when two keys land on the same instant", () => {
    const collided = track([key("a", 1, 10), key("b", 1, 90)]);
    expect(valueAt(collided, rational(1), 0)).toBe(90);
  });

  it("evaluates every animated property of one object at once", () => {
    const tracks = [
      track([key("a", 0, 0), key("b", 2, 100)], "transform.x"),
      { ...track([key("c", 0, 1), key("d", 2, 0)], "opacity"), id: "track-2" },
    ];
    const values = evaluateTracks(tracks, rational(1), { "transform.x": 0, opacity: 1 });
    expect(values["transform.x"]).toBeCloseTo(50, 6);
    expect(values.opacity).toBeCloseTo(0.5, 6);
  });
});

describe("easing curves", () => {
  it("passes through both ends whatever the curve", () => {
    for (const mode of ["linear", "ease_in", "ease_out", "ease_in_out", "bezier"] as const) {
      expect(easedProgress(0, mode, DEFAULT_HANDLES)).toBeCloseTo(0, 6);
      expect(easedProgress(1, mode, DEFAULT_HANDLES)).toBeCloseTo(1, 6);
    }
  });

  it("starts slowly when easing in and finishes slowly when easing out", () => {
    // At the midpoint an ease-in is still behind linear; an ease-out is ahead of it.
    expect(easedProgress(0.5, "ease_in", DEFAULT_HANDLES)).toBeLessThan(0.5);
    expect(easedProgress(0.5, "ease_out", DEFAULT_HANDLES)).toBeGreaterThan(0.5);
  });

  it("rises without going backwards across the whole curve", () => {
    let previous = -1;
    for (let step = 0; step <= 20; step += 1) {
      const value = easedProgress(step / 20, "ease_in_out", DEFAULT_HANDLES);
      expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = value;
    }
  });

  it("clamps progress outside the segment rather than extrapolating", () => {
    expect(easedProgress(-1, "linear", DEFAULT_HANDLES)).toBe(0);
    expect(easedProgress(2, "linear", DEFAULT_HANDLES)).toBe(1);
  });

  /** Newton's method can stall; the solver has to terminate on any curve it is handed. */
  it("terminates on a curve that defeats the fast solver", () => {
    const awkward = { outX: 0, outY: 3, inX: 1, inY: -2 };
    for (let step = 0; step <= 10; step += 1) {
      const value = solveBezier(awkward, step / 10);
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("follows custom handles rather than the named curves", () => {
    const sharp = { outX: 0.9, outY: 0, inX: 1, inY: 1 };
    expect(solveBezier(sharp, 0.5)).toBeLessThan(easedProgress(0.5, "ease_in", DEFAULT_HANDLES) + 0.5);
  });
});

describe("editing a track", () => {
  it("replaces a keyframe at an instant rather than stacking a second there", () => {
    const before = track([key("a", 1, 10)]);
    const after = setKeyframe(before, key("b", 1, 90));
    expect(after.keyframes).toHaveLength(1);
    expect(after.keyframes[0].value).toBe(90);
  });

  it("keeps keyframes in time order after an insert", () => {
    const built = setKeyframe(setKeyframe(track([]), key("late", 2, 1)), key("early", 0, 0));
    expect(built.keyframes.map((entry) => entry.id)).toEqual(["early", "late"]);
  });

  it("removes a keyframe and refuses one that is not there", () => {
    const built = track([key("a", 0, 0), key("b", 1, 1)]);
    expect(removeKeyframe(built, "a").keyframes.map((entry) => entry.id)).toEqual(["b"]);
    expect(() => removeKeyframe(built, "missing")).toThrowError(/not on this property/);
  });

  it("refuses to animate a property the object does not have", () => {
    expect(() => assertAnimatable("layer", "gainDb")).toThrowError(/cannot animate/);
    expect(() => assertAnimatable("clip", "gainDb")).not.toThrow();
    expect(ANIMATABLE_PROPERTIES.layer).toContain("transform.x");
  });

  it("describes a track in words rather than field names", () => {
    expect(describeTrack(track([]))).toContain("not animated");
    expect(describeTrack(track([key("a", 0, 0), key("b", 2, 100)]))).toContain("moves from 0 to 100");
    expect(describeTrack({ ...track([key("a", 0, 5)]), enabled: false })).toContain("switched off");
  });
});

describe("motion paths", () => {
  const xTrack = track([key("a", 0, 0), key("b", 2, 200)], "transform.x");
  const yTrack = { ...track([key("c", 0, 0), key("d", 2, 100)], "transform.y"), id: "track-2" };

  it("samples the path an object actually travels", () => {
    const path = motionPath(xTrack, yTrack, { from: rational(0), to: rational(2), samples: 5 });
    expect(path.points).toHaveLength(5);
    expect(path.points[0]).toMatchObject({ x: 0, y: 0 });
    expect(path.points[4].x).toBeCloseTo(200, 6);
    expect(path.points[2].x).toBeCloseTo(100, 6);
  });

  it("carries the instants a user can grab", () => {
    const path = motionPath(xTrack, yTrack, { from: rational(0), to: rational(2), samples: 10 });
    expect(path.keyTimes).toEqual([0, 2]);
  });

  it("holds a coordinate steady when only one axis is animated", () => {
    const path = motionPath(xTrack, null, { from: rational(0), to: rational(2), samples: 3, fallbackY: 40 });
    expect(path.points.every((point) => point.y === 40)).toBe(true);
  });

  it("refuses a range with no duration", () => {
    expect(() => motionPath(xTrack, yTrack, { from: rational(2), to: rational(2) }))
      .toThrowError(/longer than zero/);
  });

  it("bounds how many samples it will produce", () => {
    expect(motionPath(xTrack, yTrack, { from: rational(0), to: rational(2), samples: 100000 }).points.length)
      .toBeLessThanOrEqual(600);
  });
});
