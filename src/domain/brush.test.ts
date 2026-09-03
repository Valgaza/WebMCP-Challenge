import { describe, expect, it } from "vitest";
import {
  DEFAULT_BRUSH, DEFAULT_DYNAMICS, ERASER, MAX_STROKES_PER_LAYER, NO_DYNAMICS, PENCIL,
  assertStrokeCount, brushDynamicsSchema, brushSchema, describeBrush, describeStroke, isRetouch,
  simplify,
  stampsFor, strokeBounds, strokePointSchema, strokeSchema, type Stroke, type StrokePoint,
} from "./brush";

const point = (x: number, y: number, overrides: Partial<StrokePoint> = {}): StrokePoint =>
  strokePointSchema.parse({ x, y, ...overrides });

const stroke = (points: StrokePoint[], overrides: Record<string, unknown> = {}): Stroke =>
  strokeSchema.parse({
    id: "s1", brush: DEFAULT_BRUSH, dynamics: NO_DYNAMICS,
    paint: { kind: "solid", colour: "#000000", opacity: 1 },
    points, ...overrides,
  });

/**
 * `PH-050` through `PH-052`. Painting is stored as strokes rather than pixels, so a stroke's
 * size, colour, and brush can be changed after it is drawn and it redraws crisply at export
 * resolution rather than at the resolution of the screen it was made on.
 */
describe("brushes", () => {
  it("gives a brush sensible settings without being told any", () => {
    expect(DEFAULT_BRUSH).toMatchObject({ kind: "brush", sizePx: 24, hardness: 0.8, flow: 1, spacing: 0.1 });
  });

  /** A pencil and an eraser are one shape with different behaviour, not separate tools. */
  it("makes a pencil a hard-edged brush and an eraser one that removes", () => {
    expect(PENCIL).toMatchObject({ kind: "pencil", hardness: 1 });
    expect(ERASER.kind).toBe("eraser");
  });

  it("refuses a brush with no size", () => {
    expect(() => brushSchema.parse({ sizePx: 0 })).toThrowError();
  });

  it("describes a brush in words a person would use", () => {
    expect(describeBrush(DEFAULT_BRUSH)).toBe("A brush 24 px across, soft-edged.");
    expect(describeBrush(PENCIL)).toBe("A pencil 4 px across, hard-edged.");
    expect(describeBrush(brushSchema.parse({ hardness: 0.1, opacity: 0.5 })))
      .toContain("very soft, at 50% opacity");
    expect(describeBrush(ERASER)).toContain("An eraser");
  });
});

describe("stamping a stroke", () => {
  it("stamps once for a single tap", () => {
    expect(stampsFor(stroke([point(10, 10)]))).toHaveLength(1);
  });

  /** A fast gesture reports a handful of samples across the whole screen. */
  it("fills the gaps between far-apart samples at the brush's spacing", () => {
    const stamps = stampsFor(stroke([point(0, 0), point(100, 0)]));
    // 100 px at a 24 px brush with 0.1 spacing is a stamp every 2.4 px.
    expect(stamps.length).toBeGreaterThan(40);
    expect(stamps[0]).toMatchObject({ x: 0, y: 0 });
  });

  it("ends where the pointer was lifted, not one step short of it", () => {
    const stamps = stampsFor(stroke([point(0, 0), point(50, 0)]));
    expect(stamps[stamps.length - 1].x).toBe(50);
  });

  it("draws at the brush's stated size when nothing reports pressure", () => {
    const stamps = stampsFor(stroke([point(0, 0), point(20, 0)]));
    expect(stamps.every((stamp) => stamp.radiusPx === 12)).toBe(true);
  });

  it("narrows the stroke where the pen was pressed lightly", () => {
    const tapered = stroke([point(0, 0, { pressure: 1 }), point(60, 0, { pressure: 0.2 })], { dynamics: DEFAULT_DYNAMICS });
    const stamps = stampsFor(tapered);
    expect(stamps[0].radiusPx).toBeGreaterThan(stamps[stamps.length - 1].radiusPx);
    expect(stamps[0].opacity).toBeGreaterThan(stamps[stamps.length - 1].opacity);
  });

  /** Interpolating pressure is what makes a taper smooth rather than stepped at each sample. */
  it("tapers smoothly between samples rather than in steps", () => {
    const stamps = stampsFor(stroke(
      [point(0, 0, { pressure: 1 }), point(100, 0, { pressure: 0 })],
      { dynamics: brushDynamicsSchema.parse({ pressureToSize: 1 }) },
    ));
    const radii = stamps.map((stamp) => stamp.radiusPx);
    expect(radii).toEqual([...radii].sort((a, b) => b - a));
    // No single step is a jump: neighbouring stamps differ by a fraction of a pixel.
    for (let index = 1; index < radii.length; index += 1) {
      expect(radii[index - 1] - radii[index]).toBeLessThan(1);
    }
  });

  it("thins a fast stroke when velocity drives size", () => {
    const dynamics = brushDynamicsSchema.parse({ pressureToSize: 0, velocityToSize: 1 });
    const slow = stampsFor(stroke([point(0, 0), point(30, 0)], { dynamics }))[0].radiusPx;
    const fast = stampsFor(stroke([point(0, 0, { velocity: 3 }), point(30, 0, { velocity: 3 })], { dynamics }))[0].radiusPx;
    expect(fast).toBeLessThan(slow);
  });

  it("flattens the tip as the pen is tilted, and turns it as the barrel rotates", () => {
    const dynamics = brushDynamicsSchema.parse({ tiltToRoundness: 1, rotationToAngle: 1 });
    const stamps = stampsFor(stroke([point(0, 0, { tiltDeg: 90, rotationDeg: 45 })], { dynamics }));
    expect(stamps[0].roundness).toBeCloseTo(0, 6);
    expect(stamps[0].angleDeg).toBe(45);
  });

  it("keeps a pencil hard-edged whatever its hardness says", () => {
    const stamps = stampsFor(stroke([point(0, 0)], { brush: brushSchema.parse({ kind: "pencil", hardness: 0.1 }) }));
    expect(stamps[0].hardness).toBe(1);
  });

  /** A stroke that redrew differently each time would make a preview disagree with its export. */
  it("scatters repeatably, so two renders of one stroke are identical", () => {
    const scattered = stroke([point(0, 0), point(60, 0)], { brush: brushSchema.parse({ scatter: 0.8 }) });
    expect(stampsFor(scattered).map((s) => s.radiusPx)).toEqual(stampsFor(scattered).map((s) => s.radiusPx));
    // And it does vary, or the setting would do nothing.
    expect(new Set(stampsFor(scattered).map((s) => s.radiusPx)).size).toBeGreaterThan(1);
  });

  it("measures the box a stroke covers", () => {
    const bounds = strokeBounds(stroke([point(50, 50), point(100, 50)]));
    expect(bounds).toMatchObject({ x: 38, y: 38, width: 74, height: 24 });
  });
});

describe("simplifying a stroke", () => {
  /** A pointer reports far more samples than a curve needs, and every one is stored and synced. */
  it("drops the samples that sit on a line between their neighbours", () => {
    const straight = Array.from({ length: 50 }, (_, index) => point(index * 2, 0));
    expect(simplify(straight)).toHaveLength(2);
  });

  it("keeps the corners", () => {
    const corner = simplify([point(0, 0), point(10, 0), point(20, 0), point(20, 20), point(20, 40)]);
    expect(corner.map((p) => [p.x, p.y])).toEqual([[0, 0], [20, 0], [20, 40]]);
  });

  it("keeps a curve's shape, dropping only what does not describe it", () => {
    const curve = Array.from({ length: 40 }, (_, index) => point(index, Math.sin(index / 5) * 20));
    const simplified = simplify(curve, 0.75);
    expect(simplified.length).toBeLessThan(curve.length);
    expect(simplified.length).toBeGreaterThan(5);
  });

  it("leaves a stroke alone when it is already short or the tolerance is off", () => {
    const two = [point(0, 0), point(5, 5)];
    expect(simplify(two)).toEqual(two);
    const many = [point(0, 0), point(1, 0), point(2, 0)];
    expect(simplify(many, 0)).toHaveLength(3);
  });

  it("copes with a stroke that came back to where it started", () => {
    const loop = [point(0, 0), point(10, 10), point(0, 0)];
    expect(simplify(loop)).toHaveLength(3);
  });
});

describe("stroke records", () => {
  it("refuses a stroke with no points", () => {
    expect(() => stroke([])).toThrowError();
  });

  it("refuses more strokes than a layer holds, and says what to do instead", () => {
    expect(() => assertStrokeCount(MAX_STROKES_PER_LAYER)).not.toThrow();
    expect(() => assertStrokeCount(MAX_STROKES_PER_LAYER + 1)).toThrowError(/flatten it or start another layer/);
  });

  it("describes a stroke, including what it was confined to", () => {
    expect(describeStroke(stroke([point(0, 0)]))).toBe("Painted #000000 with a 24 px brush.");
    expect(describeStroke(stroke([point(0, 0)], { brush: ERASER }))).toContain("Erased with a 40 px brush");
    expect(describeStroke(stroke([point(0, 0)], { selectionId: "sel-1" }))).toContain("inside the selection");
  });
});

/**
 * `PH-026` through `PH-029`. Retouching tools are brushes, not separate tools: a dodge, a blur,
 * and a clone all follow a dragged path, respond to pressure, honour a selection, and build up
 * as a stroke crosses itself. Only what happens at each stamp differs.
 */
describe("retouching brushes", () => {
  it("knows which brushes change what is there rather than laying down colour", () => {
    expect(isRetouch("clone")).toBe(true);
    expect(isRetouch("dodge")).toBe(true);
    expect(isRetouch("red_eye")).toBe(true);
    expect(isRetouch("brush")).toBe(false);
    expect(isRetouch("eraser")).toBe(false);
  });

  /** The reuse that makes this worth doing: one stroke engine, eight more tools. */
  it("stamps a retouching stroke exactly as it stamps a painted one", () => {
    const painted = stampsFor(stroke([point(0, 0), point(60, 0)]));
    const dodged = stampsFor(stroke([point(0, 0), point(60, 0)], { brush: brushSchema.parse({ kind: "dodge" }) }));
    expect(dodged.map((stamp) => [stamp.x, stamp.radiusPx])).toEqual(painted.map((stamp) => [stamp.x, stamp.radiusPx]));
  });

  it("tapers a retouching stroke with pressure like any other", () => {
    const stamps = stampsFor(stroke(
      [point(0, 0, { pressure: 1 }), point(50, 0, { pressure: 0.2 })],
      { brush: brushSchema.parse({ kind: "burn" }), dynamics: DEFAULT_DYNAMICS },
    ));
    expect(stamps[0].radiusPx).toBeGreaterThan(stamps[stamps.length - 1].radiusPx);
  });

  it("carries a clone's source offset and a retouch strength", () => {
    const cloned = stroke([point(10, 10)], {
      brush: brushSchema.parse({ kind: "clone" }), cloneOffset: { x: -40, y: 0 }, strength: 0.8,
    });
    expect(cloned.cloneOffset).toEqual({ x: -40, y: 0 });
    expect(cloned.strength).toBe(0.8);
  });

  it("defaults a retouch to half strength rather than to nothing or to full", () => {
    expect(stroke([point(0, 0)]).strength).toBe(0.5);
    expect(stroke([point(0, 0)]).cloneOffset).toBeNull();
  });

  it("names each retouching brush the way a person would", () => {
    expect(describeBrush(brushSchema.parse({ kind: "clone", sizePx: 30 }))).toContain("A clone stamp 30 px across");
    expect(describeBrush(brushSchema.parse({ kind: "sponge" }))).toContain("A sponge");
    expect(describeBrush(brushSchema.parse({ kind: "red_eye" }))).toContain("A red-eye brush");
  });

  it("describes what a retouching stroke did, including where a clone read from", () => {
    expect(describeStroke(stroke([point(0, 0)], { brush: brushSchema.parse({ kind: "dodge", sizePx: 50 }), strength: 0.2 })))
      .toBe("Lightened an area with a 50 px brush at 20% strength.");
    expect(describeStroke(stroke([point(0, 0)], {
      brush: brushSchema.parse({ kind: "clone", sizePx: 20 }), cloneOffset: { x: -35, y: 12 },
    }))).toBe("Cloned an area with a 20 px brush from -35, 12 px away at 50% strength.");
    expect(describeStroke(stroke([point(0, 0)], { brush: brushSchema.parse({ kind: "blur" }), selectionId: "s" })))
      .toContain("inside the selection");
  });
});
