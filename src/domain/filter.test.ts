import { describe, expect, it } from "vitest";
import { luma } from "./colour-op";
import {
  applyFilter, assertFilterCost, boxBlur, describeFilter, filterOperationSchema,
  type FilterOperation,
} from "./filter";

/** An image built from a per-pixel colour function. */
const image = (
  width: number, height: number, colour: (x: number, y: number) => [number, number, number],
): Uint8ClampedArray => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.set([...colour(x, y), 255], (y * width + x) * 4);
  }
  return data;
};

const at = (data: Uint8ClampedArray, width: number, x: number, y: number): number[] => {
  const index = (y * width + x) * 4;
  return [data[index], data[index + 1], data[index + 2]];
};

const run = (data: Uint8ClampedArray, width: number, height: number, operation: unknown) => {
  applyFilter(data, width, height, filterOperationSchema.parse(operation) as FilterOperation);
  return data;
};

/** Half black, half white, split down the middle: an edge to blur, sharpen, and distort. */
const edge = (size = 16) => image(size, size, (x) => (x < size / 2 ? [0, 0, 0] : [255, 255, 255]));

/** Flat grey with one bright speck, for the noise filters. */
const speck = (size = 9) => image(size, size, (x, y) => (x === 4 && y === 4 ? [255, 255, 255] : [100, 100, 100]));

/**
 * `PH-047`, `PH-057` through `PH-061`. These are apart from the colour operators because the
 * difference is real: a colour operator reduces to a lookup table, and every one of these has
 * to see a neighbourhood.
 */
describe("blur", () => {
  it("does nothing at a radius of nothing", () => {
    const data = edge();
    const before = [...data];
    run(data, 16, 16, { kind: "blur", radiusPx: 0 });
    expect([...data]).toEqual(before);
  });

  it("softens an edge, leaving the far sides alone", () => {
    const data = edge();
    run(data, 16, 16, { kind: "blur", shape: "gaussian", radiusPx: 3 });
    expect(at(data, 16, 8, 8)[0]).toBeGreaterThan(0);
    expect(at(data, 16, 8, 8)[0]).toBeLessThan(255);
    expect(at(data, 16, 0, 8)[0]).toBeLessThan(40);
    expect(at(data, 16, 15, 8)[0]).toBeGreaterThan(215);
  });

  /** Three box passes are indistinguishable from a Gaussian and cost a fraction of one. */
  it("spreads further as a Gaussian than as a single box pass", () => {
    const gaussian = edge();
    const box = edge();
    run(gaussian, 16, 16, { kind: "blur", shape: "gaussian", radiusPx: 2 });
    run(box, 16, 16, { kind: "blur", shape: "box", radiusPx: 2 });
    // Six pixels from the edge, the Gaussian has reached and the single box pass has not.
    expect(at(gaussian, 16, 2, 8)[0]).toBeGreaterThanOrEqual(at(box, 16, 2, 8)[0]);
  });

  it("smears along the angle a motion blur is given", () => {
    const dot = image(21, 21, (x, y) => (x === 10 && y === 10 ? [255, 255, 255] : [0, 0, 0]));
    run(dot, 21, 21, { kind: "blur", shape: "motion", radiusPx: 6, angleDeg: 0 });
    expect(at(dot, 21, 13, 10)[0]).toBeGreaterThan(at(dot, 21, 10, 13)[0]);
  });

  it("leaves the centre of a radial blur where it is", () => {
    const rings = image(21, 21, (x, y) => [Math.hypot(x - 10, y - 10) * 20, 0, 0]);
    const before = at(rings, 21, 10, 10)[0];
    run(rings, 21, 21, { kind: "blur", shape: "radial", radialMode: "zoom", radiusPx: 8 });
    expect(at(rings, 21, 10, 10)[0]).toBeCloseTo(before, -1);
  });

  /** The whole point of a surface blur: smooth the surface, keep the edge. */
  it("keeps an edge sharp while smoothing what is on either side of it", () => {
    const noisy = image(16, 16, (x, y) => {
      const base = x < 8 ? 40 : 220;
      return [base + ((x + y) % 2 ? 8 : -8), base, base];
    });
    run(noisy, 16, 16, { kind: "blur", shape: "surface", radiusPx: 2, threshold: 30 });
    expect(Math.abs(at(noisy, 16, 3, 3)[0] - at(noisy, 16, 4, 3)[0])).toBeLessThan(8);
    expect(at(noisy, 16, 8, 8)[0] - at(noisy, 16, 7, 8)[0]).toBeGreaterThan(150);
  });

  it("blurs through a shaped aperture", () => {
    const dot = image(21, 21, (x, y) => (x === 10 && y === 10 ? [255, 255, 255] : [0, 0, 0]));
    run(dot, 21, 21, { kind: "blur", shape: "lens", radiusPx: 5, blades: 6 });
    expect(at(dot, 21, 10, 10)[0]).toBeGreaterThan(0);
  });

  it("blurs alpha along with colour, so a soft edge is soft rather than cut out", () => {
    const data = new Uint8ClampedArray(16 * 16 * 4);
    for (let index = 0; index < 16 * 16; index += 1) {
      data.set([255, 255, 255, index % 16 < 8 ? 255 : 0], index * 4);
    }
    const blurred = boxBlur(data, 16, 16, 3, 3);
    expect(blurred[(8 * 16 + 8) * 4 + 3]).toBeGreaterThan(0);
    expect(blurred[(8 * 16 + 8) * 4 + 3]).toBeLessThan(255);
  });
});

describe("sharpening", () => {
  it("increases the contrast across an edge", () => {
    const data = edge();
    run(data, 16, 16, { kind: "blur", shape: "gaussian", radiusPx: 2 });
    const soft = at(data, 16, 9, 8)[0] - at(data, 16, 6, 8)[0];
    run(data, 16, 16, { kind: "sharpen", method: "unsharp_mask", amount: 200, radiusPx: 2 });
    expect(at(data, 16, 9, 8)[0] - at(data, 16, 6, 8)[0]).toBeGreaterThan(soft);
  });

  /** The reason a threshold exists: sharpening should not amplify a flat sky's noise. */
  it("leaves a flat area alone when a threshold is set", () => {
    const flat = image(16, 16, () => [120, 120, 120]);
    run(flat, 16, 16, { kind: "sharpen", amount: 300, radiusPx: 2, threshold: 20 });
    expect(at(flat, 16, 8, 8)).toEqual([120, 120, 120]);
  });

  it("eases in when sharpening smartly, so there is no step at the threshold", () => {
    const gentle = image(32, 8, (x) => [100 + x, 100 + x, 100 + x]);
    const harsh = new Uint8ClampedArray(gentle);
    run(gentle, 32, 8, { kind: "sharpen", method: "smart", amount: 200, radiusPx: 2, threshold: 4 });
    run(harsh, 32, 8, { kind: "sharpen", method: "unsharp_mask", amount: 200, radiusPx: 2, threshold: 4 });
    expect(Math.abs(at(gentle, 32, 16, 4)[0] - 116)).toBeLessThanOrEqual(Math.abs(at(harsh, 32, 16, 4)[0] - 116));
  });

  it("leaves only the detail, around mid-grey, for a high pass", () => {
    const data = edge();
    run(data, 16, 16, { kind: "sharpen", method: "high_pass", amount: 100, radiusPx: 2 });
    expect(at(data, 16, 1, 8)[0]).toBeCloseTo(128, -1);
    expect(at(data, 16, 8, 8)[0]).toBeGreaterThan(140);
  });

  /**
   * Output sharpening is a different job from creative sharpening: it compensates for what a
   * medium does, so it is stated as a medium rather than as an amount.
   */
  it("sharpens more for matte paper than for a screen", () => {
    const screen = edge();
    const matte = edge();
    run(screen, 16, 16, { kind: "blur", shape: "gaussian", radiusPx: 2 });
    matte.set(screen);
    run(screen, 16, 16, { kind: "output_sharpen", medium: "screen", amount: "standard" });
    run(matte, 16, 16, { kind: "output_sharpen", medium: "matte_paper", amount: "high" });
    expect(at(matte, 16, 9, 8)[0] - at(matte, 16, 6, 8)[0])
      .toBeGreaterThan(at(screen, 16, 9, 8)[0] - at(screen, 16, 6, 8)[0]);
  });
});

describe("noise", () => {
  /** A grain that changed every render would make a preview disagree with its export. */
  it("adds repeatable grain", () => {
    const first = image(8, 8, () => [128, 128, 128]);
    const second = image(8, 8, () => [128, 128, 128]);
    run(first, 8, 8, { kind: "noise", mode: "add", amount: 40, seed: 7 });
    run(second, 8, 8, { kind: "noise", mode: "add", amount: 40, seed: 7 });
    expect([...first]).toEqual([...second]);
    expect(at(first, 8, 3, 3)[0]).not.toBe(128);
  });

  it("shifts every channel together for film grain, and separately otherwise", () => {
    const mono = image(8, 8, () => [128, 128, 128]);
    const colour = image(8, 8, () => [128, 128, 128]);
    run(mono, 8, 8, { kind: "noise", mode: "add", amount: 40, monochrome: true, seed: 3 });
    run(colour, 8, 8, { kind: "noise", mode: "add", amount: 40, monochrome: false, seed: 3 });
    expect(new Set(at(mono, 8, 2, 2)).size).toBe(1);
    expect(new Set(at(colour, 8, 2, 2)).size).toBeGreaterThan(1);
  });

  it("removes a speck outright with a median", () => {
    const data = speck();
    run(data, 9, 9, { kind: "noise", mode: "median", radiusPx: 1 });
    expect(at(data, 9, 4, 4)).toEqual([100, 100, 100]);
  });

  /** A median flattens everything; dust-and-scratches touches only what stands out. */
  it("replaces only the outliers when removing dust and scratches", () => {
    const detailed = image(9, 9, (x, y) => {
      if (x === 4 && y === 4) return [255, 255, 255];
      return [100 + (x % 3) * 4, 100, 100];
    });
    const before = at(detailed, 9, 1, 1);
    run(detailed, 9, 9, { kind: "noise", mode: "dust_and_scratches", radiusPx: 1, threshold: 30 });
    expect(at(detailed, 9, 4, 4)[0]).toBeLessThan(150);
    expect(at(detailed, 9, 1, 1)).toEqual(before);
  });

  it("reduces grain at a strength rather than replacing the picture", () => {
    const grainy = image(16, 16, (x, y) => {
      const shift = (x * 7 + y * 13) % 2 ? 12 : -12;
      return [140 + shift, 140 + shift, 140 + shift];
    });
    run(grainy, 16, 16, { kind: "noise", mode: "reduce", amount: 100, radiusPx: 2, threshold: 40 });
    expect(Math.abs(at(grainy, 16, 8, 8)[0] - 140)).toBeLessThan(8);
  });
});

describe("distortion", () => {
  it("does nothing at zero", () => {
    const data = edge();
    const before = [...data];
    run(data, 16, 16, { kind: "distort", shape: "twirl", amount: 0 });
    expect([...data]).toEqual(before);
  });

  it("leaves the centre of a twirl in place and turns what is around it", () => {
    const stripes = image(32, 32, (x) => [(x % 8) * 30, 0, 0]);
    const before = at(stripes, 32, 16, 16);
    run(stripes, 32, 32, { kind: "distort", shape: "twirl", amount: 100, radius: 0.8 });
    expect(at(stripes, 32, 16, 16)).toEqual(before);
    expect(at(stripes, 32, 20, 20)).not.toEqual([(20 % 8) * 30, 0, 0]);
  });

  it("does not tear the picture at the edge of a twirl", () => {
    const stripes = image(32, 32, (x) => [(x % 8) * 30, 0, 0]);
    run(stripes, 32, 32, { kind: "distort", shape: "twirl", amount: 100, radius: 0.5 });
    expect(at(stripes, 32, 0, 0)).toEqual([0, 0, 0]);
  });

  it("magnifies for a spherize and shrinks for a pinch, one sign apart", () => {
    const stripes = () => image(32, 32, (x) => [(x % 8) * 30, 0, 0]);
    const sphere = stripes();
    const pinch = stripes();
    run(sphere, 32, 32, { kind: "distort", shape: "spherize", amount: 80, radius: 0.9 });
    run(pinch, 32, 32, { kind: "distort", shape: "pinch", amount: 80, radius: 0.9 });
    expect(at(sphere, 32, 20, 16)).not.toEqual(at(pinch, 32, 20, 16));
  });

  it("ripples and waves", () => {
    const stripes = image(32, 32, (x, y) => [(y % 8) * 30, 0, 0]);
    const before = [...stripes];
    run(stripes, 32, 32, { kind: "distort", shape: "ripple", amount: 10, frequency: 4 });
    expect([...stripes]).not.toEqual(before);

    const waved = image(32, 32, (x, y) => [(y % 8) * 30, 0, 0]);
    const wavedBefore = [...waved];
    run(waved, 32, 32, { kind: "distort", shape: "wave", amount: 8, frequency: 3 });
    expect([...waved]).not.toEqual(wavedBefore);
  });

  it("displaces by the picture's own brightness", () => {
    const gradient = image(32, 8, (x) => [x * 8, x * 8, x * 8]);
    const before = [...gradient];
    run(gradient, 32, 8, { kind: "distort", shape: "displace", amount: 20 });
    expect([...gradient]).not.toEqual(before);
  });
});

describe("pixelating", () => {
  it("replaces each block with its average", () => {
    const data = image(8, 8, (x) => (x < 4 ? [0, 0, 0] : [255, 255, 255]));
    run(data, 8, 8, { kind: "pixelate", shape: "mosaic", cellPx: 4 });
    expect(at(data, 8, 0, 0)).toEqual(at(data, 8, 3, 3));
    expect(at(data, 8, 0, 0)).toEqual([0, 0, 0]);
    expect(at(data, 8, 5, 5)).toEqual([255, 255, 255]);
  });

  it("averages a partial block at the edge rather than skipping it", () => {
    const data = image(10, 10, () => [80, 80, 80]);
    run(data, 10, 10, { kind: "pixelate", shape: "mosaic", cellPx: 4 });
    expect(at(data, 10, 9, 9)).toEqual([80, 80, 80]);
  });

  it("prints dark areas as bigger dots and light areas as smaller ones", () => {
    const ramp = image(64, 16, (x) => [x * 4, x * 4, x * 4]);
    run(ramp, 64, 16, { kind: "pixelate", shape: "halftone", cellPx: 8, angleDeg: 0 });
    const inked = (fromX: number, toX: number) => {
      let count = 0;
      for (let y = 0; y < 16; y += 1) {
        for (let x = fromX; x < toX; x += 1) if (at(ramp, 64, x, y)[0] < 128) count += 1;
      }
      return count;
    };
    expect(inked(0, 16)).toBeGreaterThan(inked(48, 64));
  });

  it("scatters repeatably for crystallize, and leaves white between the dots for pointillize", () => {
    const first = image(32, 32, (x, y) => [x * 8, y * 8, 128]);
    const second = image(32, 32, (x, y) => [x * 8, y * 8, 128]);
    run(first, 32, 32, { kind: "pixelate", shape: "crystallize", cellPx: 8, seed: 5 });
    run(second, 32, 32, { kind: "pixelate", shape: "crystallize", cellPx: 8, seed: 5 });
    expect([...first]).toEqual([...second]);

    const dotted = image(32, 32, () => [40, 40, 40]);
    run(dotted, 32, 32, { kind: "pixelate", shape: "pointillize", cellPx: 8, seed: 5 });
    const white = [...dotted].filter((_, index) => index % 4 === 0).filter((value) => value === 255);
    expect(white.length).toBeGreaterThan(0);
  });
});

describe("guarding against a filter that would appear to hang", () => {
  it("refuses a radius that would take minutes on an image that size", () => {
    expect(() => assertFilterCost(
      filterOperationSchema.parse({ kind: "blur", shape: "surface", radiusPx: 200 }) as FilterOperation,
      6000, 4000,
    )).toThrowError(/would take minutes/);
  });

  it("allows the same radius on a small image, and a cheap filter on a large one", () => {
    expect(() => assertFilterCost(
      filterOperationSchema.parse({ kind: "blur", shape: "surface", radiusPx: 200 }) as FilterOperation, 400, 300,
    )).not.toThrow();
    expect(() => assertFilterCost(
      filterOperationSchema.parse({ kind: "blur", shape: "gaussian", radiusPx: 400 }) as FilterOperation, 6000, 4000,
    )).not.toThrow();
  });
});

describe("describing filters", () => {
  it("says what each one does", () => {
    const describe_ = (input: unknown) => describeFilter(filterOperationSchema.parse(input) as FilterOperation);
    expect(describe_({ kind: "blur", shape: "gaussian", radiusPx: 12 })).toBe("A soft blur of 12 px.");
    expect(describe_({ kind: "blur", shape: "motion", radiusPx: 20, angleDeg: 45 })).toBe("Motion blur of 20 px at 45°.");
    expect(describe_({ kind: "sharpen", amount: 150, radiusPx: 1.2 })).toContain("An unsharp mask at 150%");
    expect(describe_({ kind: "output_sharpen", medium: "matte_paper", amount: "high" })).toBe("Output sharpening for matte paper, high.");
    expect(describe_({ kind: "noise", mode: "add", amount: 15 })).toBe("Film-like grain at 15%.");
    expect(describe_({ kind: "noise", mode: "median", radiusPx: 3 })).toContain("removes specks outright");
    expect(describe_({ kind: "distort", shape: "twirl", amount: -40 })).toBe("A twirl of 40%.");
    expect(describe_({ kind: "pixelate", shape: "halftone", cellPx: 9 })).toBe("Halftone at 9 px cells.");
  });
});

/** `VI-043`. A flare is scattered light, so it only ever brightens. */
describe("lens flare", () => {
  it("does nothing at no intensity", () => {
    const data = image(16, 16, () => [40, 40, 40]);
    run(data, 16, 16, { kind: "flare", intensity: 0 });
    expect(at(data, 16, 8, 8)).toEqual([40, 40, 40]);
  });

  it("brightens around the light and leaves the far corner alone", () => {
    const data = image(64, 64, () => [40, 40, 40]);
    run(data, 64, 64, { kind: "flare", x: 0.8, y: 0.2, intensity: 1, sizeRatio: 0.2, ghosts: 0 });
    expect(at(data, 64, 51, 13)[0]).toBeGreaterThan(40);
    expect(at(data, 64, 2, 60)).toEqual([40, 40, 40]);
  });

  /** A flare that dimmed part of the picture would look like a bug. */
  it("never darkens anything", () => {
    const data = image(48, 48, () => [90, 90, 90]);
    const before = [...data];
    run(data, 48, 48, { kind: "flare", intensity: 1, ghosts: 4, streak: 1 });
    for (let index = 0; index < data.length; index += 4) {
      expect(data[index]).toBeGreaterThanOrEqual(before[index]);
    }
  });

  /** Reflections between lens elements are mirrored about the optical axis. */
  it("casts its ghosts back across the centre", () => {
    const withGhosts = image(64, 64, () => [10, 10, 10]);
    const without = image(64, 64, () => [10, 10, 10]);
    run(withGhosts, 64, 64, { kind: "flare", x: 0.9, y: 0.5, intensity: 1, sizeRatio: 0.1, ghosts: 4 });
    run(without, 64, 64, { kind: "flare", x: 0.9, y: 0.5, intensity: 1, sizeRatio: 0.1, ghosts: 0 });

    // The half of the frame away from the light, where the bloom itself cannot reach: only a
    // reflection cast back through the centre puts light there.
    const leftHalf = (data: Uint8ClampedArray) => {
      let total = 0;
      for (let y = 0; y < 64; y += 1) {
        for (let x = 0; x < 32; x += 1) total += at(data, 64, x, y)[0];
      }
      return total;
    };
    expect(leftHalf(withGhosts)).toBeGreaterThan(leftHalf(without));
  });

  it("streaks along the light's own row when asked", () => {
    const data = image(64, 64, () => [10, 10, 10]);
    run(data, 64, 64, { kind: "flare", x: 0.5, y: 0.5, intensity: 1, sizeRatio: 0.05, ghosts: 0, streak: 1 });
    expect(at(data, 64, 4, 32)[0]).toBeGreaterThan(at(data, 64, 4, 10)[0]);
  });

  it("describes itself", () => {
    expect(describeFilter(filterOperationSchema.parse({ kind: "flare", x: 0.7, y: 0.3 }) as FilterOperation))
      .toBe("A lens flare at 70%, 30% of the frame, 50% strong with 4 ghosts.");
  });
});
