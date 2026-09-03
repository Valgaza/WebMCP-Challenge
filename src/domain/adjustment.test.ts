import { describe, expect, it } from "vitest";
import {
  ADJUSTMENT_RANGES,
  activeAdjustments,
  adjustmentStackSchema,
  buildToneCurve,
  createDefaultAdjustments,
  describeAdjustment,
  isDefaultAdjustments,
  whiteBalanceGains,
  type AdjustmentName,
} from "./adjustment";

describe("adjustment stack", () => {
  it("starts neutral", () => {
    const stack = createDefaultAdjustments();
    expect(isDefaultAdjustments(stack)).toBe(true);
    expect(activeAdjustments(stack)).toEqual([]);
  });

  it("enforces every documented range with a readable message", () => {
    const stack = createDefaultAdjustments();
    for (const name of Object.keys(ADJUSTMENT_RANGES) as AdjustmentName[]) {
      const range = ADJUSTMENT_RANGES[name];
      expect(adjustmentStackSchema.safeParse({ ...stack, [name]: range.max + 1 }).success).toBe(false);
      expect(adjustmentStackSchema.safeParse({ ...stack, [name]: range.min - 1 }).success).toBe(false);
      expect(adjustmentStackSchema.safeParse({ ...stack, [name]: range.max }).success).toBe(true);
    }
  });

  it("reports only the adjustments that differ from default", () => {
    const stack = adjustmentStackSchema.parse({ ...createDefaultAdjustments(), brightness: 20, hue: -30 });
    expect(activeAdjustments(stack)).toEqual([
      { name: "brightness", value: 20, unit: "percent" },
      { name: "hue", value: -30, unit: "degrees" },
    ]);
    expect(isDefaultAdjustments(stack)).toBe(false);
  });
});

describe("describeAdjustment", () => {
  it("explains direction and consequence in plain language", () => {
    expect(describeAdjustment("brightness", 0)).toContain("default");
    expect(describeAdjustment("brightness", 25)).toContain("lighter");
    expect(describeAdjustment("brightness", -25)).toContain("darker");
    expect(describeAdjustment("temperature", 40)).toContain("warmer");
    expect(describeAdjustment("temperature", -40)).toContain("cooler");
    expect(describeAdjustment("tint", 10)).toContain("magenta");
    expect(describeAdjustment("tint", -10)).toContain("green");
    expect(describeAdjustment("saturation", 50)).toContain("more vivid");
  });

  it("covers every adjustment so no parameter is unexplainable", () => {
    for (const name of Object.keys(ADJUSTMENT_RANGES) as AdjustmentName[]) {
      expect(describeAdjustment(name, ADJUSTMENT_RANGES[name].max).length).toBeGreaterThan(10);
    }
  });
});

describe("tone curve", () => {
  it("is the identity when nothing is adjusted", () => {
    const table = buildToneCurve(createDefaultAdjustments());
    expect(table[0]).toBe(0);
    expect(table[128]).toBe(128);
    expect(table[255]).toBe(255);
  });

  it("lifts every value when brightness rises and never leaves the byte range", () => {
    const stack = adjustmentStackSchema.parse({ ...createDefaultAdjustments(), brightness: 50 });
    const table = buildToneCurve(stack);
    expect(table[128]).toBeGreaterThan(128);
    expect(table[255]).toBe(255);
    expect(Math.min(...table)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...table)).toBeLessThanOrEqual(255);
  });

  it("pushes tones apart when contrast rises", () => {
    const stack = adjustmentStackSchema.parse({ ...createDefaultAdjustments(), contrast: 60 });
    const table = buildToneCurve(stack);
    expect(table[64]).toBeLessThan(64);
    expect(table[192]).toBeGreaterThan(192);
    expect(table[128]).toBe(128);
  });

  it("clamps rather than wrapping at extremes", () => {
    const stack = adjustmentStackSchema.parse({ ...createDefaultAdjustments(), brightness: 100, contrast: 100 });
    const table = buildToneCurve(stack);
    expect(table[255]).toBe(255);
    expect(table[0]).toBeGreaterThanOrEqual(0);
  });
});

describe("white balance", () => {
  it("is neutral by default and moves red against blue", () => {
    expect(whiteBalanceGains(createDefaultAdjustments())).toEqual({ r: 1, g: 1, b: 1 });

    const warm = whiteBalanceGains(adjustmentStackSchema.parse({ ...createDefaultAdjustments(), temperature: 100 }));
    expect(warm.r).toBeGreaterThan(1);
    expect(warm.b).toBeLessThan(1);

    const tinted = whiteBalanceGains(adjustmentStackSchema.parse({ ...createDefaultAdjustments(), tint: 100 }));
    expect(tinted.g).toBeGreaterThan(1);
  });
});
