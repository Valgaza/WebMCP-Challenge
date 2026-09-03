import { describe, expect, it } from "vitest";
import {
  applyColourOperation, colourOperationSchema, curveTable, describeColourOperation, equalizeTable,
  fromHsl, gradientMapTable, levelsTable, luma, parseCubeLut, sampleLut, sampleWhiteBalance,
  toCubeLut, toHsl,
  type ColourOperation,
} from "./colour-op";

const pixels = (...triplets: number[][]): Uint8ClampedArray => {
  const data = new Uint8ClampedArray(triplets.length * 4);
  triplets.forEach((triplet, index) => data.set([...triplet, triplet[3] ?? 255].slice(0, 4), index * 4));
  return data;
};

const rgb = (data: Uint8ClampedArray, index = 0): number[] =>
  [data[index * 4], data[index * 4 + 1], data[index * 4 + 2]];

const run = (data: Uint8ClampedArray, operation: unknown, size?: { widthPx: number; heightPx: number }) => {
  applyColourOperation(data, colourOperationSchema.parse(operation) as ColourOperation, size);
  return data;
};

/**
 * `PH-031` through `PH-044`. Every operator is a function from a colour to a colour, stored as
 * parameters, so all of them drop into the effect container Phase 6 built rather than each one
 * becoming its own layer property.
 */
describe("exposure", () => {
  it("changes nothing at rest", () => {
    expect(rgb(run(pixels([100, 120, 140]), { kind: "exposure" }))).toEqual([100, 120, 140]);
  });

  /** A stop is a doubling. That is the unit a photograph is taken in. */
  it("doubles the light for one stop up", () => {
    expect(rgb(run(pixels([60, 60, 60]), { kind: "exposure", exposureEv: 1 }))).toEqual([120, 120, 120]);
    expect(rgb(run(pixels([120, 120, 120]), { kind: "exposure", exposureEv: -1 }))).toEqual([60, 60, 60]);
  });

  it("clips at white rather than wrapping around", () => {
    expect(rgb(run(pixels([200, 200, 200]), { kind: "exposure", exposureEv: 3 }))).toEqual([255, 255, 255]);
  });

  it("lifts the middle without moving the ends when gamma changes", () => {
    const result = run(pixels([0, 0, 0], [128, 128, 128], [255, 255, 255]), { kind: "exposure", gamma: 2 });
    expect(rgb(result, 0)).toEqual([0, 0, 0]);
    expect(rgb(result, 1)[0]).toBeGreaterThan(128);
    expect(rgb(result, 2)).toEqual([255, 255, 255]);
  });
});

describe("levels", () => {
  it("maps the input range onto the output range", () => {
    const table = levelsTable({ inBlack: 50, inWhite: 200, gamma: 1, outBlack: 0, outWhite: 255 });
    expect(table[50]).toBe(0);
    expect(table[200]).toBe(255);
    expect(table[30]).toBe(0);
    expect(table[230]).toBe(255);
  });

  it("lifts the blacks when the output black is raised", () => {
    const table = levelsTable({ inBlack: 0, inWhite: 255, gamma: 1, outBlack: 40, outWhite: 255 });
    expect(table[0]).toBe(40);
  });

  /** A per-channel black point is how a colour cast is removed. */
  it("corrects a cast by pulling one channel's black point", () => {
    const result = run(pixels([40, 20, 20]), {
      kind: "levels", red: { inBlack: 40, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 },
    });
    expect(rgb(result)[0]).toBe(0);
    expect(rgb(result)[1]).toBe(20);
  });
});

describe("curves", () => {
  it("passes everything through unchanged for a straight line", () => {
    const table = curveTable([{ input: 0, output: 0 }, { input: 255, output: 255 }]);
    expect(table[0]).toBe(0);
    expect(table[128]).toBe(128);
    expect(table[255]).toBe(255);
  });

  it("lifts the tones a raised point asks for", () => {
    const table = curveTable([{ input: 0, output: 0 }, { input: 128, output: 180 }, { input: 255, output: 255 }]);
    expect(table[128]).toBe(180);
    expect(table[64]).toBeGreaterThan(64);
  });

  /**
   * A natural spline overshoots between points, so dragging a curve up can make a nearby
   * region darker. A tone curve that does that is unusable.
   */
  it("never overshoots, so raising one point cannot darken its neighbours", () => {
    const table = curveTable([
      { input: 0, output: 0 }, { input: 100, output: 100 },
      { input: 110, output: 200 }, { input: 255, output: 255 },
    ]);
    for (let value = 1; value < 256; value += 1) {
      expect(table[value]).toBeGreaterThanOrEqual(table[value - 1]);
    }
  });

  it("holds outside its points rather than running off the scale", () => {
    const table = curveTable([{ input: 50, output: 20 }, { input: 200, output: 240 }]);
    expect(table[0]).toBe(20);
    expect(table[255]).toBe(240);
  });

  it("sorts its points, so a caller need not be careful", () => {
    const table = curveTable([{ input: 255, output: 255 }, { input: 0, output: 0 }, { input: 128, output: 200 }]);
    expect(table[128]).toBe(200);
  });

  it("applies to one channel when one is named", () => {
    const result = run(pixels([100, 100, 100]), {
      kind: "curves", channel: "red",
      points: [{ input: 0, output: 0 }, { input: 100, output: 200 }, { input: 255, output: 255 }],
    });
    expect(rgb(result)).toEqual([200, 100, 100]);
  });
});

describe("vibrance", () => {
  /** The whole reason vibrance exists apart from saturation. */
  it("raises a dull colour more than an already-vivid one", () => {
    const dull = run(pixels([120, 110, 100]), { kind: "vibrance", vibrance: 100 });
    const vivid = run(pixels([255, 10, 10]), { kind: "vibrance", vibrance: 100 });
    const dullSpread = Math.max(...rgb(dull)) - Math.min(...rgb(dull));
    const vividSpread = Math.max(...rgb(vivid)) - Math.min(...rgb(vivid));
    expect(dullSpread / 20).toBeGreaterThan(vividSpread / 245);
  });

  it("leaves grey alone, because grey has no colour to raise", () => {
    expect(rgb(run(pixels([128, 128, 128]), { kind: "vibrance", vibrance: 100 }))).toEqual([128, 128, 128]);
  });

  it("drains colour when pushed negative", () => {
    const result = rgb(run(pixels([200, 100, 50]), { kind: "vibrance", saturation: -100 }));
    expect(Math.max(...result) - Math.min(...result)).toBeLessThan(5);
  });
});

describe("colour balance", () => {
  it("warms the shadows without touching the highlights", () => {
    const result = run(pixels([30, 30, 30], [230, 230, 230]), {
      kind: "colour_balance", shadows: { red: 50, green: 0, blue: 0 }, preserveLuminosity: false,
    });
    expect(rgb(result, 0)[0]).toBeGreaterThan(30);
    expect(rgb(result, 1)[0]).toBe(230);
  });

  it("keeps brightness where it was when asked to", () => {
    const result = run(pixels([128, 128, 128]), {
      kind: "colour_balance", midtones: { red: 20, green: 0, blue: -20 }, preserveLuminosity: true,
    });
    expect(luma(...(rgb(result) as [number, number, number]))).toBeCloseTo(128, 0);
    expect(rgb(result)[0]).toBeGreaterThan(rgb(result)[2]);
  });

  /**
   * A shift large enough to push a channel past black or white cannot be undone by scaling:
   * the clipped channel has already lost the value the correction would have taken back.
   */
  it("cannot hold brightness exactly once a channel clips, and drifts rather than lying", () => {
    const result = run(pixels([128, 128, 128]), {
      kind: "colour_balance", midtones: { red: 60, green: 0, blue: -60 }, preserveLuminosity: true,
    });
    const after = luma(...(rgb(result) as [number, number, number]));
    expect(after).toBeGreaterThan(128);
    expect(after).toBeLessThan(140);
  });
});

describe("black and white", () => {
  it("turns colour into grey", () => {
    const result = rgb(run(pixels([200, 60, 40]), { kind: "black_and_white" }));
    expect(result[0]).toBe(result[1]);
    expect(result[1]).toBe(result[2]);
  });

  /** The only control that matters: which colours become which greys. */
  it("darkens a blue sky without touching a green field", () => {
    const dark = rgb(run(pixels([40, 60, 200]), { kind: "black_and_white", blue: -50 }))[0];
    const light = rgb(run(pixels([40, 60, 200]), { kind: "black_and_white", blue: 150 }))[0];
    expect(light).toBeGreaterThan(dark);

    const green = rgb(run(pixels([40, 200, 60]), { kind: "black_and_white", blue: -50 }))[0];
    const greenAgain = rgb(run(pixels([40, 200, 60]), { kind: "black_and_white", blue: 150 }))[0];
    expect(green).toBe(greenAgain);
  });

  it("tints the result when a tint is given", () => {
    const result = rgb(run(pixels([150, 150, 150]), { kind: "black_and_white", tint: "#ff8800", tintStrength: 1 }));
    expect(result[0]).toBeGreaterThan(result[2]);
  });
});

describe("channel mixer, gradient map, and photo filter", () => {
  it("builds one output channel from a mix of the inputs", () => {
    const result = rgb(run(pixels([100, 200, 50]), {
      kind: "channel_mixer", outputChannel: "red", fromRed: 0, fromGreen: 100, fromBlue: 0,
    }));
    expect(result).toEqual([200, 200, 50]);
  });

  it("reads the original channels, not the ones it has just written", () => {
    const result = rgb(run(pixels([10, 20, 30]), {
      kind: "channel_mixer", outputChannel: "red", fromRed: 100, fromGreen: 100, fromBlue: 100,
    }));
    expect(result[0]).toBe(60);
  });

  it("maps brightness onto a gradient", () => {
    const table = gradientMapTable([{ offset: 0, colour: "#000080" }, { offset: 1, colour: "#ffff00" }]);
    expect([table[0], table[1], table[2]]).toEqual([0, 0, 128]);
    expect([table[255 * 3], table[255 * 3 + 1], table[255 * 3 + 2]]).toEqual([255, 255, 0]);

    const result = rgb(run(pixels([255, 255, 255]), {
      kind: "gradient_map", stops: [{ offset: 0, colour: "#000080" }, { offset: 1, colour: "#ffff00" }],
    }));
    expect(result).toEqual([255, 255, 0]);
  });

  /** Glass in front of a lens removes light, which is why a dense filter darkens. */
  it("warms an image, and darkens it when brightness is not preserved", () => {
    const warmed = rgb(run(pixels([128, 128, 128]), {
      kind: "photo_filter", colour: "#ff8800", density: 1, preserveLuminosity: false,
    }));
    expect(warmed[0]).toBeGreaterThan(warmed[2]);
    expect(luma(warmed[0], warmed[1], warmed[2])).toBeLessThan(128);

    const kept = rgb(run(pixels([128, 128, 128]), {
      kind: "photo_filter", colour: "#ff8800", density: 1, preserveLuminosity: true,
    }));
    expect(luma(kept[0], kept[1], kept[2])).toBeCloseTo(128, 0);
  });
});

describe("lookup tables", () => {
  /** An identity table has to come back out exactly, or every look is subtly wrong. */
  const identity = (size: number): number[] => {
    const table: number[] = [];
    for (let b = 0; b < size; b += 1) {
      for (let g = 0; g < size; g += 1) {
        for (let r = 0; r < size; r += 1) table.push(r / (size - 1), g / (size - 1), b / (size - 1));
      }
    }
    return table;
  };

  it("returns a colour unchanged through an identity table", () => {
    const sampled = sampleLut(identity(8), 8, 90, 140, 200);
    expect(sampled[0]).toBeCloseTo(90, 0);
    expect(sampled[1]).toBeCloseTo(140, 0);
    expect(sampled[2]).toBeCloseTo(200, 0);
  });

  it("blends between entries rather than stepping, so a small table does not band", () => {
    const table = identity(2);
    const low = sampleLut(table, 2, 100, 100, 100);
    const high = sampleLut(table, 2, 140, 140, 140);
    expect(high[0]).toBeGreaterThan(low[0]);
  });

  it("applies at partial strength", () => {
    const inverted = identity(2).map((value) => 1 - value);
    const half = rgb(run(pixels([0, 0, 0]), { kind: "lut", name: "Negative", size: 2, table: inverted, strength: 0.5 }));
    expect(half[0]).toBeCloseTo(128, -1);
  });

  it("refuses a table whose size and contents disagree", () => {
    expect(() => run(pixels([0, 0, 0]), { kind: "lut", name: "Broken", size: 8, table: [0, 0, 0] }))
      .toThrowError(/needs 1536 numbers; 3 were given/);
  });

  it("reads a .cube file", () => {
    const parsed = parseCubeLut(`
      TITLE "Warm"
      LUT_3D_SIZE 2
      0 0 0
      1 0 0
      0 1 0
      1 1 0
      0 0 1
      1 0 1
      0 1 1
      1 1 1
    `);
    expect(parsed).toMatchObject({ name: "Warm", size: 2 });
    expect(parsed.table).toHaveLength(24);
  });

  it("rescales a file that declares its own domain", () => {
    const parsed = parseCubeLut(`
      LUT_3D_SIZE 2
      DOMAIN_MIN 0 0 0
      DOMAIN_MAX 2 2 2
      0 0 0
      2 0 0
      0 2 0
      2 2 0
      0 0 2
      2 0 2
      0 2 2
      2 2 2
    `);
    expect(Math.max(...parsed.table)).toBe(1);
  });

  it("says what is wrong rather than half-reading a file", () => {
    expect(() => parseCubeLut("LUT_1D_SIZE 16\n0 0 0")).toThrowError(/one-dimensional/);
    expect(() => parseCubeLut("0 0 0\n1 1 1")).toThrowError(/does not declare a lookup table size/);
    expect(() => parseCubeLut("LUT_3D_SIZE 2\nnot numbers here")).toThrowError(/cannot read/);
    expect(() => parseCubeLut("LUT_3D_SIZE 2\n0 0 0")).toThrowError(/needs 24 numbers/);
  });
});

describe("shadows and highlights", () => {
  it("lifts the shadows and leaves the highlights alone", () => {
    const data = pixels([30, 30, 30], [220, 220, 220]);
    run(data, { kind: "shadows_highlights", shadowAmount: 80, radiusPx: 0 }, { widthPx: 2, heightPx: 1 });
    expect(rgb(data, 0)[0]).toBeGreaterThan(30);
    expect(rgb(data, 1)[0]).toBe(220);
  });

  it("pulls the highlights down", () => {
    const data = pixels([240, 240, 240]);
    run(data, { kind: "shadows_highlights", highlightAmount: 60, radiusPx: 0 }, { widthPx: 1, heightPx: 1 });
    expect(rgb(data)[0]).toBeLessThan(240);
  });

  it("does nothing at rest", () => {
    const data = pixels([30, 30, 30], [220, 220, 220]);
    run(data, { kind: "shadows_highlights", radiusPx: 0 }, { widthPx: 2, heightPx: 1 });
    expect(rgb(data, 0)).toEqual([30, 30, 30]);
  });
});

describe("replace colour", () => {
  it("shifts the hue of the colours it matches and leaves the rest", () => {
    const data = pixels([200, 40, 40], [40, 40, 200]);
    run(data, { kind: "replace_colour", from: "#c82828", tolerance: 30, hueShiftDeg: 120 });
    expect(rgb(data, 0)[1]).toBeGreaterThan(rgb(data, 0)[0]);
    expect(rgb(data, 1)).toEqual([40, 40, 200]);
  });

  /** Without the fade, a replaced colour leaves a hard rim where the tolerance ended. */
  it("fades with distance rather than stopping at a rim", () => {
    const near = pixels([200, 40, 40]);
    const far = pixels([200, 70, 70]);
    run(near, { kind: "replace_colour", from: "#c82828", tolerance: 60, lightnessShift: 40 });
    run(far, { kind: "replace_colour", from: "#c82828", tolerance: 60, lightnessShift: 40 });
    expect(luma(...(rgb(near) as [number, number, number]))).toBeGreaterThan(200);
    expect(rgb(far)[0]).toBeLessThan(255);
  });
});

describe("posterize, threshold, invert, and equalize", () => {
  it("reduces to the levels asked for", () => {
    const data = pixels([0, 0, 0], [128, 128, 128], [255, 255, 255]);
    run(data, { kind: "posterize", levels: 2 });
    expect(rgb(data, 0)).toEqual([0, 0, 0]);
    expect(rgb(data, 2)).toEqual([255, 255, 255]);
    expect(new Set([rgb(data, 0)[0], rgb(data, 1)[0], rgb(data, 2)[0]]).size).toBeLessThanOrEqual(2);
  });

  it("splits at the threshold", () => {
    const data = pixels([100, 100, 100], [200, 200, 200]);
    run(data, { kind: "threshold", level: 128 });
    expect(rgb(data, 0)).toEqual([0, 0, 0]);
    expect(rgb(data, 1)).toEqual([255, 255, 255]);
  });

  it("inverts, and inverting twice returns the original", () => {
    const data = pixels([10, 200, 90]);
    run(data, { kind: "invert" });
    expect(rgb(data)).toEqual([245, 55, 165]);
    run(data, { kind: "invert" });
    expect(rgb(data)).toEqual([10, 200, 90]);
  });

  it("spreads a narrow range of tones across the whole scale", () => {
    const data = pixels([100, 100, 100], [110, 110, 110], [120, 120, 120]);
    const table = equalizeTable(data);
    expect(table[100]).toBeLessThan(table[120]);
    expect(table[120]).toBe(255);
  });

  /** Equalizing each channel apart would shift hues; scaling brightness keeps the colour. */
  it("keeps colour while spreading brightness", () => {
    const data = pixels([120, 60, 30], [130, 65, 33]);
    run(data, { kind: "equalize" });
    const first = rgb(data, 0);
    expect(first[0] / first[1]).toBeCloseTo(2, 0);
  });

  it("copes with an image that is entirely transparent", () => {
    const data = new Uint8ClampedArray(8);
    const table = equalizeTable(data);
    expect(table[128]).toBe(128);
  });
});

describe("colour conversions", () => {
  it("round-trips through HSL", () => {
    for (const colour of [[200, 60, 40], [10, 200, 90], [128, 128, 128], [0, 0, 0]]) {
      const [h, s, l] = toHsl(colour[0], colour[1], colour[2]);
      const back = fromHsl(h, s, l).map(Math.round);
      expect(back).toEqual(colour);
    }
  });
});

describe("describing operators", () => {
  it("says what each one does in a sentence", () => {
    expect(describeColourOperation(colourOperationSchema.parse({ kind: "exposure", exposureEv: 1.5 })))
      .toBe("Exposure: +1.5 stops.");
    expect(describeColourOperation(colourOperationSchema.parse({ kind: "exposure" })))
      .toBe("Exposure, unchanged.");
    expect(describeColourOperation(colourOperationSchema.parse({
      kind: "curves", points: [{ input: 0, output: 0 }, { input: 255, output: 255 }],
    }))).toBe("A tone curve through 2 points.");
    expect(describeColourOperation(colourOperationSchema.parse({ kind: "invert" }))).toBe("Inverted.");
    expect(describeColourOperation(colourOperationSchema.parse({ kind: "black_and_white", tint: "#886644" })))
      .toContain("tinted towards #886644");
    expect(describeColourOperation(colourOperationSchema.parse({ kind: "threshold", level: 90 })))
      .toContain("above becomes white");
  });
});

/** `VI-046` and `VI-048`. An eyedropper works out the correction; a look leaves in .cube. */
describe("the white-balance eyedropper", () => {
  it("asks for nothing when the pixel is already neutral", () => {
    const result = sampleWhiteBalance(128, 128, 128);
    expect(result.temperature).toBeCloseTo(0, 6);
    expect(result.tint).toBeCloseTo(0, 6);
    expect(result.neutral).toBe(true);
  });

  it("reads a blue cast as cold and an orange one as warm, with opposite signs", () => {
    const cold = sampleWhiteBalance(100, 120, 160);
    const warm = sampleWhiteBalance(160, 120, 100);
    expect(cold.temperature).toBeGreaterThan(0);
    expect(warm.temperature).toBeLessThan(0);
    expect(cold.temperature).toBeCloseTo(-warm.temperature, 6);
  });

  it("reads a green cast on the tint axis rather than the temperature one", () => {
    const green = sampleWhiteBalance(120, 160, 120);
    expect(Math.abs(green.temperature)).toBeLessThan(1);
    expect(green.tint).toBeLessThan(0);
  });

  /** The ratios in near-black are noise, and a correction from them would be arbitrary. */
  it("refuses to guess from a pixel that is almost black", () => {
    expect(sampleWhiteBalance(2, 1, 4)).toEqual({ temperature: 0, tint: 0, neutral: false });
  });

  it("stays within the range the controls offer", () => {
    const extreme = sampleWhiteBalance(0, 0, 255);
    expect(extreme.temperature).toBeLessThanOrEqual(100);
    expect(extreme.temperature).toBeGreaterThanOrEqual(-100);
  });
});

describe("writing a lookup table", () => {
  const identity = (size: number): number[] => {
    const table: number[] = [];
    for (let b = 0; b < size; b += 1) {
      for (let g = 0; g < size; g += 1) {
        for (let r = 0; r < size; r += 1) table.push(r / (size - 1), g / (size - 1), b / (size - 1));
      }
    }
    return table;
  };

  it("writes a file that reads back as the same table", () => {
    const original = { name: "Test look", size: 4, table: identity(4) };
    const text = toCubeLut(original);
    const round = parseCubeLut(text);
    expect(round.name).toBe("Test look");
    expect(round.size).toBe(4);
    round.table.forEach((value, index) => expect(value).toBeCloseTo(original.table[index], 5));
  });

  it("declares its size and domain, as a reader expects", () => {
    const text = toCubeLut({ name: "L", size: 2, table: identity(2) });
    expect(text).toContain("LUT_3D_SIZE 2");
    expect(text).toContain("DOMAIN_MAX 1.0 1.0 1.0");
  });

  it("keeps a name with a quote in it readable rather than breaking the file", () => {
    const text = toCubeLut({ name: 'Ed"s look', size: 2, table: identity(2) });
    expect(parseCubeLut(text).name).toBe("Ed's look");
  });

  it("refuses to write a table whose size and contents disagree", () => {
    expect(() => toCubeLut({ name: "Broken", size: 8, table: [0, 0, 0] }))
      .toThrowError(/needs 1536 numbers/);
  });
});
