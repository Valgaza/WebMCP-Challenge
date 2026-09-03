import { describe, expect, it } from "vitest";
import {
  addTime, clampTime, compareTime, divideTime, formatTimecode, frameDuration, frameToTime,
  intersectRanges, isDropFrameRate, multiplyTime, parseTimecode, rangeContains, rangeEnd,
  rangesOverlap, rational, snapToFrame, subtractTime, timeToFrame, toSeconds,
} from "./time";

const FPS_2997 = { numerator: 30000, denominator: 1001 };
const FPS_23976 = { numerator: 24000, denominator: 1001 };
const FPS_25 = { numerator: 25, denominator: 1 };
const FPS_30 = { numerator: 30, denominator: 1 };

describe("rational construction", () => {
  it("reduces to lowest terms and normalizes sign", () => {
    expect(rational(4, 8)).toEqual({ numerator: 1, denominator: 2 });
    expect(rational(-6, 4)).toEqual({ numerator: -3, denominator: 2 });
    expect(rational(6, -4)).toEqual({ numerator: -3, denominator: 2 });
    expect(rational(0, 5)).toEqual({ numerator: 0, denominator: 1 });
  });

  it("refuses a zero denominator or fractional parts", () => {
    expect(() => rational(1, 0)).toThrowError(/zero denominator/);
    expect(() => rational(1.5, 2)).toThrowError(/whole-number/);
  });
});

describe("exact arithmetic", () => {
  it("adds thirds without drift, which floating seconds cannot do", () => {
    let total = rational(0);
    for (let index = 0; index < 3; index += 1) total = addTime(total, rational(1, 3));
    expect(total).toEqual({ numerator: 1, denominator: 1 });
  });

  /**
   * The reason the whole model is rational: a thousand 29.97 frames must land exactly on
   * frame 1000, with no accumulated error.
   */
  it("accumulates a thousand 29.97 frames exactly", () => {
    const step = frameDuration(FPS_2997);
    let total = rational(0);
    for (let index = 0; index < 1000; index += 1) total = addTime(total, step);
    expect(timeToFrame(total, FPS_2997)).toBe(1000);
    expect(total).toEqual({ numerator: 1001, denominator: 30 });
  });

  it("subtracts, multiplies, and divides exactly", () => {
    expect(subtractTime(rational(1), rational(1, 3))).toEqual({ numerator: 2, denominator: 3 });
    expect(multiplyTime(rational(1, 3), rational(3, 1))).toEqual({ numerator: 1, denominator: 1 });
    expect(divideTime(rational(1), rational(2))).toEqual({ numerator: 1, denominator: 2 });
    expect(() => divideTime(rational(1), rational(0))).toThrowError(/divide a time by zero/);
  });

  it("compares without tolerance", () => {
    expect(compareTime(rational(1, 3), rational(2, 6))).toBe(0);
    expect(compareTime(rational(1, 3), rational(1, 2))).toBe(-1);
    expect(compareTime(rational(1, 2), rational(1, 3))).toBe(1);
  });

  it("clamps into a range", () => {
    expect(clampTime(rational(5), rational(1), rational(3))).toEqual(rational(3));
    expect(clampTime(rational(0), rational(1), rational(3))).toEqual(rational(1));
    expect(clampTime(rational(2), rational(1), rational(3))).toEqual(rational(2));
  });

  it("converts to seconds only for display", () => {
    expect(toSeconds(rational(1001, 30000))).toBeCloseTo(0.03337, 5);
  });
});

describe("frames", () => {
  it("round-trips every frame at 29.97 and 23.976", () => {
    for (const rate of [FPS_2997, FPS_23976]) {
      for (const frame of [0, 1, 29, 30, 1000, 17982, 107892]) {
        expect(timeToFrame(frameToTime(frame, rate), rate)).toBe(frame);
      }
    }
  });

  it("snaps an off-grid time onto a frame boundary", () => {
    const rate = FPS_25;
    const offGrid = rational(7, 200);
    const snapped = snapToFrame(offGrid, rate);
    expect(timeToFrame(snapped, rate)).toBe(1);
    expect(snapped).toEqual({ numerator: 1, denominator: 25 });
  });

  it("reports which rates are drop frame", () => {
    expect(isDropFrameRate(FPS_2997)).toBe(true);
    expect(isDropFrameRate({ numerator: 60000, denominator: 1001 })).toBe(true);
    expect(isDropFrameRate(FPS_30)).toBe(false);
    expect(isDropFrameRate(FPS_23976)).toBe(false);
  });

  it("rejects a fractional frame index", () => {
    expect(() => frameToTime(1.5, FPS_25)).toThrowError(/whole number/);
  });
});

describe("timecode", () => {
  it("formats non-drop timecode with colons", () => {
    expect(formatTimecode(rational(0), FPS_25)).toBe("00:00:00:00");
    expect(formatTimecode(frameToTime(25, FPS_25), FPS_25)).toBe("00:00:01:00");
    expect(formatTimecode(frameToTime(1500, FPS_25), FPS_25)).toBe("00:01:00:00");
    expect(formatTimecode(frameToTime(90000, FPS_25), FPS_25)).toBe("01:00:00:00");
  });

  it("marks drop-frame timecode with a semicolon", () => {
    expect(formatTimecode(rational(0), FPS_2997)).toContain(";");
    expect(formatTimecode(rational(0), FPS_2997)).toBe("00:00:00;00");
  });

  /**
   * Checked against published 29.97 reference values. Drop-frame is easy to get subtly wrong
   * and impossible to notice until a delivery is rejected, so the boundaries are pinned.
   */
  it("matches reference drop-frame values at 29.97", () => {
    const expected: [number, string][] = [
      [0, "00:00:00;00"],
      [29, "00:00:00;29"],
      [30, "00:00:01;00"],
      [1799, "00:00:59;29"],
      // Two labels are skipped entering minute one.
      [1800, "00:01:00;02"],
      [3600, "00:02:00;04"],
      // Minute ten drops nothing, so the count realigns exactly.
      [17982, "00:10:00;00"],
      [107892, "01:00:00;00"],
    ];
    for (const [frame, timecode] of expected) {
      expect(formatTimecode(frameToTime(frame, FPS_2997), FPS_2997)).toBe(timecode);
    }
  });

  it("keeps non-drop 30 fps counting straight through a minute", () => {
    expect(formatTimecode(frameToTime(1800, FPS_30), FPS_30)).toBe("00:01:00:00");
  });

  it("labels negative times", () => {
    expect(formatTimecode(frameToTime(-25, FPS_25), FPS_25)).toBe("-00:00:01:00");
  });

  it("parses both separators and round-trips", () => {
    expect(parseTimecode("00:00:01:00", FPS_25)).toEqual(frameToTime(25, FPS_25));
    expect(parseTimecode("00:00:01;00", FPS_2997)).toEqual(frameToTime(30, FPS_2997));
    expect(formatTimecode(parseTimecode("01:02:03:04", FPS_25), FPS_25)).toBe("01:02:03:04");
  });

  it("rejects malformed input and a frame the rate cannot hold", () => {
    expect(() => parseTimecode("nonsense", FPS_25)).toThrowError(/timecode such as/);
    expect(() => parseTimecode("00:00:01", FPS_25)).toThrowError(/timecode such as/);
    // 25 fps has frames 0 through 24.
    expect(() => parseTimecode("00:00:01:25", FPS_25)).toThrowError(/must be below 25/);
    expect(() => parseTimecode("00:99:00:00", FPS_25)).toThrowError(/timecode such as/);
  });
});

describe("ranges", () => {
  const range = { start: rational(1), duration: rational(2) };

  it("is half open, so adjacent clips never overlap", () => {
    expect(rangeEnd(range)).toEqual(rational(3));
    expect(rangeContains(range, rational(1))).toBe(true);
    expect(rangeContains(range, rational(3))).toBe(false);
    expect(rangesOverlap(range, { start: rational(3), duration: rational(1) })).toBe(false);
    expect(rangesOverlap(range, { start: rational(2), duration: rational(1) })).toBe(true);
  });

  it("intersects, returning null when there is no shared span", () => {
    expect(intersectRanges(range, { start: rational(2), duration: rational(5) }))
      .toEqual({ start: rational(2), duration: rational(1) });
    expect(intersectRanges(range, { start: rational(5), duration: rational(1) })).toBeNull();
  });
});
