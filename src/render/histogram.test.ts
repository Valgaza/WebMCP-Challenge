import { describe, expect, it } from "vitest";
import { HISTOGRAM_BINS, computeHistogram, describeExposure } from "./histogram";

function pixels(values: [number, number, number, number][]): Uint8ClampedArray {
  return new Uint8ClampedArray(values.flat());
}

describe("computeHistogram", () => {
  it("bins mid grey into the middle of the range", () => {
    const histogram = computeHistogram(pixels([[128, 128, 128, 255]]));
    expect(histogram.bins).toBe(HISTOGRAM_BINS);
    expect(histogram.sampleCount).toBe(1);
    expect(histogram.luminance.bins[Math.floor(128 * (HISTOGRAM_BINS / 256))]).toBe(1);
    expect(histogram.warnings).toEqual([]);
  });

  it("ignores fully transparent pixels rather than counting them as black", () => {
    const histogram = computeHistogram(pixels([[0, 0, 0, 0], [255, 255, 255, 255]]));
    expect(histogram.sampleCount).toBe(1);
    expect(histogram.luminance.clippedLowPercent).toBe(0);
    expect(histogram.luminance.clippedHighPercent).toBe(100);
  });

  it("reports blown highlights and crushed shadows separately", () => {
    const blown = computeHistogram(pixels(new Array(10).fill([255, 255, 255, 255])));
    expect(blown.warnings.join(" ")).toContain("clipped in the highlights");

    const crushed = computeHistogram(pixels(new Array(10).fill([0, 0, 0, 255])));
    expect(crushed.warnings.join(" ")).toContain("crushed in the shadows");
  });

  it("names the specific channel that is clipping", () => {
    const histogram = computeHistogram(pixels(new Array(10).fill([255, 10, 10, 255])));
    const joined = histogram.warnings.join(" ");
    expect(joined).toContain("Red is clipped");
    expect(joined).not.toContain("Green is clipped");
  });

  it("stays quiet when clipping is below the reporting threshold", () => {
    const values: [number, number, number, number][] = new Array(500).fill([128, 128, 128, 255]);
    values[0] = [255, 255, 255, 255];
    expect(computeHistogram(pixels(values)).warnings).toEqual([]);
  });

  it("uses luma weighting rather than a flat average", () => {
    const green = computeHistogram(pixels([[0, 255, 0, 255]]));
    const blue = computeHistogram(pixels([[0, 0, 255, 255]]));
    const brightest = (bins: number[]) => bins.findIndex((count) => count > 0);
    // Green contributes far more luminance than blue.
    expect(brightest(green.luminance.bins)).toBeGreaterThan(brightest(blue.luminance.bins));
  });

  it("handles an empty image without dividing by zero", () => {
    const histogram = computeHistogram(new Uint8ClampedArray(0));
    expect(histogram.sampleCount).toBe(0);
    expect(histogram.luminance.clippedHighPercent).toBe(0);
    expect(histogram.warnings[0]).toContain("Nothing visible");
  });
});

describe("describeExposure", () => {
  it("names where the image sits tonally", () => {
    expect(describeExposure(computeHistogram(pixels(new Array(20).fill([10, 10, 10, 255]))))).toContain("shadows");
    expect(describeExposure(computeHistogram(pixels(new Array(20).fill([245, 245, 245, 255]))))).toContain("highlights");
    expect(describeExposure(computeHistogram(pixels(new Array(20).fill([128, 128, 128, 255]))))).toContain("balanced");
    expect(describeExposure(computeHistogram(new Uint8ClampedArray(0)))).toContain("Nothing visible");
  });
});
