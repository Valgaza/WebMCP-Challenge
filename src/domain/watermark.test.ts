import { describe, expect, it } from "vitest";
import {
  DEFAULT_WATERMARK, assertLegible, burnInSchema, burnInText, describeBurnIn, describeWatermark,
  watermarkPlacements, watermarkSchema,
} from "./watermark";

const watermark = (overrides: Record<string, unknown> = {}) =>
  watermarkSchema.parse({ schemaVersion: 1, ...overrides });

const burnIn = (overrides: Record<string, unknown> = {}) =>
  burnInSchema.parse({ schemaVersion: 1, version: "v3", ...overrides });

/**
 * `VI-075`. A review burn is not decoration: a cut sent out for comment must be impossible to
 * confuse with the finished thing, and traceable if it turns up where it should not.
 */
describe("watermarks", () => {
  /** A corner watermark is croppable, and a review copy that crops clean is not doing its job. */
  it("tiles by default, which is the trade a review burn exists to make", () => {
    expect(DEFAULT_WATERMARK.position).toBe("tiled");
    expect(describeWatermark(DEFAULT_WATERMARK)).toContain("hard to crop out");
  });

  it("says plainly that a corner watermark can be cropped away", () => {
    expect(describeWatermark(watermark({ position: "bottom_right" }))).toContain("a crop could remove");
  });

  it("covers the frame when tiled, in more than one row and column", () => {
    const placements = watermarkPlacements(DEFAULT_WATERMARK, 1920, 1080);
    expect(placements.length).toBeGreaterThan(10);
    expect(new Set(placements.map((entry) => entry.y)).size).toBeGreaterThan(2);
    expect(placements.every((entry) => entry.x >= 0 && entry.x <= 1 && entry.y >= 0 && entry.y <= 1)).toBe(true);
  });

  /** Straight columns of tiles are the easiest thing to crop or paint out. */
  it("offsets alternate rows so the tiles do not line up", () => {
    const placements = watermarkPlacements(DEFAULT_WATERMARK, 1920, 1080);
    const firstRow = placements.filter((entry) => entry.y === placements[0].y).map((entry) => entry.x);
    const secondRowY = [...new Set(placements.map((entry) => entry.y))].sort((a, b) => a - b)[1];
    const secondRow = placements.filter((entry) => entry.y === secondRowY).map((entry) => entry.x);
    expect(secondRow[0]).not.toBe(firstRow[0]);
  });

  it("places a single watermark where it was asked for", () => {
    expect(watermarkPlacements(watermark({ position: "centre" }), 1920, 1080)).toEqual([{ x: 0.5, y: 0.5 }]);
    expect(watermarkPlacements(watermark({ position: "top_left" }), 1920, 1080)[0].x).toBeLessThan(0.1);
    expect(watermarkPlacements(watermark({ position: "bottom_right" }), 1920, 1080)[0].y).toBeGreaterThan(0.9);
  });

  /** A size in pixels would be wrong at every output resolution but one. */
  it("sizes by the frame, so it is the same at any resolution", () => {
    expect(DEFAULT_WATERMARK.sizeRatio).toBeLessThan(0.1);
    const small = watermarkPlacements(DEFAULT_WATERMARK, 640, 360);
    const large = watermarkPlacements(DEFAULT_WATERMARK, 3840, 2160);
    // Same aspect, so the same tiling either way.
    expect(small.length).toBe(large.length);
  });

  /**
   * The failure that matters: someone sets it low to judge the picture, sends the cut out, and
   * it might as well not be there.
   */
  it("refuses a watermark too faint to notice, rather than silently raising it", () => {
    expect(() => assertLegible(watermark({ opacity: 0.03 }))).toThrowError(/defeats the point of a review burn/);
    expect(() => assertLegible(watermark({ opacity: 0.28 }))).not.toThrow();
  });

  it("refuses a single watermark small enough to miss, and suggests tiling", () => {
    expect(() => assertLegible(watermark({ position: "bottom_right", sizeRatio: 0.008 })))
      .toThrowError(/Make it larger, or tile it/);
    // Tiled, a small one is still all over the frame, so it is allowed.
    expect(() => assertLegible(watermark({ position: "tiled", sizeRatio: 0.008 }))).not.toThrow();
  });
});

/** A note about the wrong cut is worse than no note. */
describe("burn-ins", () => {
  it("will not be made without a version", () => {
    expect(() => burnInSchema.parse({ schemaVersion: 1 })).toThrowError();
    expect(() => burnInSchema.parse({ schemaVersion: 1, version: "  " })).toThrowError();
  });

  it("carries the version, and the recipient when there is one", () => {
    const date = new Date("2026-09-03T10:00:00.000Z");
    expect(burnInText(burnIn(), { date })).toContain("v3");
    expect(burnInText(burnIn({ recipient: "Alex" }), { date })).toContain("Alex");
  });

  it("shows the timecode when there is one and it was asked for", () => {
    const date = new Date("2026-09-03T10:00:00.000Z");
    expect(burnInText(burnIn(), { date, timecode: "00:01:23:14" })).toContain("00:01:23:14");
    expect(burnInText(burnIn({ showTimecode: false }), { date, timecode: "00:01:23:14" }))
      .not.toContain("00:01:23:14");
    // No timecode to show is not an error; the rest is still worth burning in.
    expect(burnInText(burnIn(), { date })).toContain("2026-09-03");
  });

  it("can be reduced to the version alone", () => {
    expect(burnInText(burnIn({ showDate: false, showTimecode: false }), {})).toBe("v3");
  });

  /** Unreadable over a bright frame is the same as absent. */
  it("puts a plate behind the text by default", () => {
    expect(burnIn().background).toBe(true);
  });

  it("describes what it will carry", () => {
    expect(describeBurnIn(burnIn({ recipient: "Alex" })))
      .toBe("A burn-in in the bottom left carrying version “v3”, for Alex, with timecode, with the date.");
  });
});
