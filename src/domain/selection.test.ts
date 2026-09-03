import { describe, expect, it } from "vitest";
import {
  alphaMask, border, colourRangeMask, combine, createMask, describeSelection, feather, invert,
  isEmpty, lassoMask, luminanceRangeMask, marqueeMask, pathMask, resize, selectedArea,
  selectionBounds, smooth, translate, wandMask, type PixelSource, type SelectionMask,
} from "./selection";

const at = (mask: SelectionMask, x: number, y: number): number => mask.coverage[y * mask.widthPx + x];

/** A solid block of coverage, for testing the combining and refining operations. */
const block = (size: number, x: number, y: number, width: number, height: number): SelectionMask => {
  const mask = createMask(size, size);
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) mask.coverage[row * size + column] = 255;
  }
  return mask;
};

/** An image built from a per-pixel colour function. */
const image = (width: number, height: number, colour: (x: number, y: number) => [number, number, number, number]): PixelSource => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.set(colour(x, y), (y * width + x) * 4);
  }
  return { widthPx: width, heightPx: height, data };
};

/**
 * `PH-016` through `PH-022`. A selection is coverage per pixel rather than a boolean region,
 * because a feathered edge, an anti-aliased curve, and a partial colour match are all partial
 * coverage — and a binary mask turns every one of them into a staircase.
 */
describe("combining selections", () => {
  it("replaces without needing the two to agree on size", () => {
    const result = combine(createMask(4, 4), block(8, 0, 0, 8, 8), "replace");
    expect(result.widthPx).toBe(8);
  });

  it("copies on replace, so editing the result does not reach back into the source", () => {
    const source = block(4, 0, 0, 2, 2);
    const result = combine(createMask(4, 4), source, "replace");
    result.coverage[0] = 7;
    expect(source.coverage[0]).toBe(255);
  });

  it("adds, subtracts, and intersects", () => {
    const left = block(4, 0, 0, 2, 4);
    const right = block(4, 1, 0, 2, 4);
    expect(selectedArea(combine(left, right, "add"))).toBe(12);
    expect(selectedArea(combine(left, right, "subtract"))).toBe(4);
    expect(selectedArea(combine(left, right, "intersect"))).toBe(4);
  });

  /** The whole reason coverage is a byte rather than a bit. */
  it("keeps partial coverage instead of collapsing a soft edge to a hard one", () => {
    const soft = createMask(2, 1);
    soft.coverage[0] = 128;
    const other = createMask(2, 1);
    other.coverage[0] = 64;
    expect(combine(soft, other, "add").coverage[0]).toBe(128);
    expect(combine(soft, other, "subtract").coverage[0]).toBe(64);
    expect(combine(soft, other, "intersect").coverage[0]).toBe(64);
  });

  it("refuses to combine selections describing different documents", () => {
    expect(() => combine(createMask(4, 4), createMask(8, 8), "add")).toThrowError(/different sizes/);
  });

  it("inverts, and inverting twice returns the original", () => {
    const original = block(4, 0, 0, 2, 2);
    expect(selectedArea(invert(original))).toBe(12);
    expect(invert(invert(original)).coverage).toEqual(original.coverage);
  });

  it("measures area, emptiness, and bounds", () => {
    const mask = block(8, 2, 3, 4, 2);
    expect(selectedArea(mask)).toBe(8);
    expect(isEmpty(mask)).toBe(false);
    expect(selectionBounds(mask)).toEqual({ x: 2, y: 3, width: 4, height: 2 });
    expect(selectionBounds(createMask(4, 4))).toBeNull();
    expect(isEmpty(createMask(4, 4))).toBe(true);
  });
});

describe("marquee", () => {
  it("selects the rectangle it was given", () => {
    const mask = marqueeMask(8, 8, { kind: "marquee", shape: "rectangle", x: 2, y: 2, width: 4, height: 4, featherPx: 0 });
    expect(selectionBounds(mask)).toEqual({ x: 2, y: 2, width: 4, height: 4 });
    expect(at(mask, 3, 3)).toBe(255);
    expect(at(mask, 0, 0)).toBe(0);
  });

  it("selects an ellipse that is round rather than square", () => {
    const mask = marqueeMask(20, 20, { kind: "marquee", shape: "ellipse", x: 0, y: 0, width: 20, height: 20, featherPx: 0 });
    expect(at(mask, 10, 10)).toBe(255);
    // A corner is outside a circle inscribed in the same box.
    expect(at(mask, 0, 0)).toBe(0);
    expect(selectedArea(mask)).toBeLessThan(400);
    expect(selectedArea(mask)).toBeGreaterThan(280);
  });

  /** Without this, every diagonal edge in the editor is a visible staircase. */
  it("anti-aliases an elliptical edge rather than stepping it", () => {
    const mask = marqueeMask(20, 20, { kind: "marquee", shape: "ellipse", x: 0, y: 0, width: 20, height: 20, featherPx: 0 });
    const partial = [...mask.coverage].filter((value) => value > 0 && value < 255);
    expect(partial.length).toBeGreaterThan(0);
  });

  it("feathers when asked", () => {
    const hard = marqueeMask(24, 24, { kind: "marquee", shape: "rectangle", x: 8, y: 8, width: 8, height: 8, featherPx: 0 });
    const soft = marqueeMask(24, 24, { kind: "marquee", shape: "rectangle", x: 8, y: 8, width: 8, height: 8, featherPx: 3 });
    expect(at(soft, 8, 12)).toBeLessThan(at(hard, 8, 12));
    expect(at(soft, 6, 12)).toBeGreaterThan(0);
  });

  it("selects nothing from a marquee with no size", () => {
    const mask = marqueeMask(8, 8, { kind: "marquee", shape: "ellipse", x: 4, y: 4, width: 0, height: 0, featherPx: 0 });
    expect(isEmpty(mask)).toBe(true);
  });
});

describe("lasso", () => {
  it("selects inside a hand-drawn outline", () => {
    const mask = lassoMask(10, 10, {
      kind: "lasso",
      points: [{ x: 1, y: 1 }, { x: 8, y: 1 }, { x: 8, y: 8 }, { x: 1, y: 8 }],
      featherPx: 0,
    });
    expect(at(mask, 4, 4)).toBe(255);
    expect(at(mask, 0, 0)).toBe(0);
  });

  /** A freehand lasso crosses itself constantly, so the fill rule has to cope. */
  it("handles an outline that crosses itself", () => {
    const mask = lassoMask(12, 12, {
      kind: "lasso",
      points: [{ x: 1, y: 1 }, { x: 10, y: 10 }, { x: 10, y: 1 }, { x: 1, y: 10 }],
      featherPx: 0,
    });
    expect(isEmpty(mask)).toBe(false);
  });

  it("closes an open outline instead of refusing it", () => {
    const mask = lassoMask(10, 10, {
      kind: "lasso", points: [{ x: 1, y: 1 }, { x: 8, y: 1 }, { x: 8, y: 8 }], featherPx: 0,
    });
    expect(isEmpty(mask)).toBe(false);
  });
});

describe("selection from a path", () => {
  it("selects the area a vector shape encloses", () => {
    const mask = pathMask(20, 20, { kind: "rectangle", x: 4, y: 4, width: 10, height: 10, cornerRadius: 0 });
    expect(at(mask, 9, 9)).toBe(255);
    expect(at(mask, 1, 1)).toBe(0);
  });

  it("refuses a path that encloses nothing", () => {
    expect(() => pathMask(10, 10, { kind: "path", commands: [{ kind: "move", x: 0, y: 0 }] }))
      .toThrowError(/does not enclose/);
  });
});

describe("magic wand", () => {
  const halves = image(10, 10, (x) => (x < 5 ? [255, 0, 0, 255] : [0, 0, 255, 255]));

  it("spreads from the point clicked and stops at a different colour", () => {
    const mask = wandMask(halves, { kind: "wand", x: 1, y: 1, tolerance: 10, contiguous: true });
    expect(at(mask, 4, 4)).toBe(255);
    expect(at(mask, 5, 4)).toBe(0);
  });

  /** The difference between the two modes, and the reason both exist. */
  it("takes matching pixels anywhere when not contiguous", () => {
    const spotted = image(10, 10, (x, y) => (x === 0 || (x === 9 && y === 9) ? [255, 0, 0, 255] : [0, 0, 0, 255]));
    const contiguous = wandMask(spotted, { kind: "wand", x: 0, y: 0, tolerance: 10, contiguous: true });
    const everywhere = wandMask(spotted, { kind: "wand", x: 0, y: 0, tolerance: 10, contiguous: false });
    expect(at(contiguous, 9, 9)).toBe(0);
    expect(at(everywhere, 9, 9)).toBe(255);
  });

  it("takes more as tolerance rises", () => {
    const gradient = image(16, 4, (x) => [x * 16, x * 16, x * 16, 255]);
    const tight = selectedArea(wandMask(gradient, { kind: "wand", x: 0, y: 0, tolerance: 8, contiguous: true }));
    const loose = selectedArea(wandMask(gradient, { kind: "wand", x: 0, y: 0, tolerance: 120, contiguous: true }));
    expect(loose).toBeGreaterThan(tight);
  });

  /** A recursive flood overflows the stack on exactly the image size someone would use it on. */
  it("floods a large uniform image without exhausting the stack", () => {
    const large = image(400, 400, () => [10, 10, 10, 255]);
    expect(selectedArea(wandMask(large, { kind: "wand", x: 0, y: 0, tolerance: 5, contiguous: true }))).toBe(160_000);
  });

  it("refuses a point outside the image", () => {
    expect(() => wandMask(halves, { kind: "wand", x: 99, y: 0, tolerance: 10, contiguous: true }))
      .toThrowError(/outside the image/);
  });
});

describe("colour and luminance range", () => {
  it("selects every pixel near a colour", () => {
    const spotted = image(8, 8, (x, y) => ((x + y) % 2 ? [200, 30, 30, 255] : [20, 20, 20, 255]));
    const mask = colourRangeMask(spotted, { kind: "colour_range", colour: "#c81e1e", tolerance: 20 });
    expect(at(mask, 1, 0)).toBeGreaterThan(200);
    expect(at(mask, 0, 0)).toBe(0);
  });

  it("selects a brightness band, which is how a sky is picked out", () => {
    const ramp = image(16, 2, (x) => [x * 17, x * 17, x * 17, 255]);
    const mask = luminanceRangeMask(ramp, { kind: "luminance_range", low: 200, high: 255, softness: 0 });
    expect(at(mask, 15, 0)).toBe(255);
    expect(at(mask, 0, 0)).toBe(0);
  });

  it("softens the edge of a brightness band when asked", () => {
    const ramp = image(16, 2, (x) => [x * 17, x * 17, x * 17, 255]);
    const soft = luminanceRangeMask(ramp, { kind: "luminance_range", low: 200, high: 255, softness: 60 });
    const hard = luminanceRangeMask(ramp, { kind: "luminance_range", low: 200, high: 255, softness: 0 });
    expect(selectedArea(soft)).toBeGreaterThan(selectedArea(hard));
  });

  it("refuses a range that runs backwards", () => {
    const ramp = image(4, 1, () => [0, 0, 0, 255]);
    expect(() => luminanceRangeMask(ramp, { kind: "luminance_range", low: 200, high: 100, softness: 0 }))
      .toThrowError(/at or above/);
  });

  it("selects from a layer's own transparency", () => {
    const partial = image(4, 1, (x) => [0, 0, 0, x * 60]);
    expect([...alphaMask(partial).coverage]).toEqual([0, 60, 120, 180]);
  });
});

describe("refining a selection", () => {
  it("grows and shrinks", () => {
    const original = block(20, 8, 8, 4, 4);
    expect(selectedArea(resize(original, 2))).toBeGreaterThan(16);
    expect(selectedArea(resize(original, -1))).toBe(4);
  });

  it("treats the area outside the document as unselected when shrinking", () => {
    const edge = block(10, 0, 0, 10, 10);
    expect(at(resize(edge, -2), 0, 0)).toBe(0);
    expect(at(resize(edge, -2), 5, 5)).toBe(255);
  });

  /** A wand on a noisy photograph leaves specks in and pinholes out; this is the fix. */
  it("removes specks and fills pinholes without moving the shape", () => {
    const noisy = block(24, 6, 6, 12, 12);
    noisy.coverage[10 * 24 + 10] = 0;
    noisy.coverage[1 * 24 + 1] = 255;
    const cleaned = smooth(noisy, 2);
    expect(at(cleaned, 10, 10)).toBe(255);
    expect(at(cleaned, 1, 1)).toBe(0);
    expect(at(cleaned, 12, 12)).toBe(255);
  });

  it("keeps only a band along the edge, leaving the middle unselected", () => {
    const original = block(48, 8, 8, 32, 32);
    const edge = border(original, 4);
    expect(at(edge, 24, 24)).toBe(0);
    expect(at(edge, 8, 24)).toBe(255);
    expect(selectedArea(edge)).toBeLessThan(selectedArea(original) / 2);
  });

  it("moves a selection without reshaping it", () => {
    const moved = translate(block(20, 2, 2, 4, 4), 5, 3);
    expect(selectionBounds(moved)).toEqual({ x: 7, y: 5, width: 4, height: 4 });
  });

  it("drops the part of a selection pushed off the document", () => {
    const moved = translate(block(10, 0, 0, 4, 4), -2, 0);
    expect(selectionBounds(moved)).toEqual({ x: 0, y: 0, width: 2, height: 4 });
  });

  it("leaves a selection alone when asked for no change", () => {
    const original = block(8, 2, 2, 2, 2);
    expect(feather(original, 0)).toBe(original);
    expect(resize(original, 0)).toBe(original);
    expect(smooth(original, 0)).toBe(original);
    expect(translate(original, 0, 0).coverage).toEqual(original.coverage);
  });

  /** Three box passes approximate a Gaussian, which is why the falloff is smooth. */
  it("falls off gradually rather than in one step", () => {
    const softened = feather(block(40, 10, 10, 20, 20), 5);
    const across = [8, 9, 10, 11, 12].map((x) => at(softened, x, 20));
    expect(across).toEqual([...across].sort((a, b) => a - b));
    expect(across[0]).toBeLessThan(across[4]);
  });
});

describe("describing a selection", () => {
  it("says how much is selected and how it was made", () => {
    const mask = block(10, 0, 0, 5, 10);
    expect(describeSelection(mask, { kind: "wand", x: 0, y: 0, tolerance: 32, contiguous: true }))
      .toBe("50 pixels selected by colour, spreading from one point, 50.0% of the image.");
  });

  it("says plainly when nothing is selected", () => {
    expect(describeSelection(createMask(4, 4), null)).toBe("Nothing is selected.");
  });
});
