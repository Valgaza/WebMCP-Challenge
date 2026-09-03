import { z } from "zod";
import { ProjectError } from "./project-error";

/**
 * Time is rational, never a floating-point number of seconds.
 *
 * 29.97 fps is exactly 30000/1001. Storing seconds as doubles accumulates error until cuts
 * drift off frame boundaries, and no later fix recovers the original intent. Every duration,
 * position, and range in the timeline is an exact fraction.
 */
export const rationalSchema = z.object({
  numerator: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  denominator: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
});
export type Rational = z.infer<typeof rationalSchema>;

function greatestCommonDivisor(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) { [x, y] = [y, x % y]; }
  return x || 1;
}

export function rational(numerator: number, denominator = 1): Rational {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator)) {
    throw new ProjectError("INVALID_INPUT", "A rational time needs whole-number parts.");
  }
  if (denominator === 0) {
    throw new ProjectError("INVALID_INPUT", "A rational time cannot have a zero denominator.");
  }
  const sign = denominator < 0 ? -1 : 1;
  const divisor = greatestCommonDivisor(numerator, denominator);
  return { numerator: (sign * numerator) / divisor, denominator: Math.abs(denominator) / divisor };
}

export const ZERO: Rational = { numerator: 0, denominator: 1 };

export function addTime(a: Rational, b: Rational): Rational {
  return rational(a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator);
}

export function subtractTime(a: Rational, b: Rational): Rational {
  return rational(a.numerator * b.denominator - b.numerator * a.denominator, a.denominator * b.denominator);
}

export function multiplyTime(a: Rational, factor: Rational): Rational {
  return rational(a.numerator * factor.numerator, a.denominator * factor.denominator);
}

export function divideTime(a: Rational, divisor: Rational): Rational {
  if (divisor.numerator === 0) throw new ProjectError("INVALID_INPUT", "Cannot divide a time by zero.");
  return rational(a.numerator * divisor.denominator, a.denominator * divisor.numerator);
}

/** Negative when a is earlier. Exact: no tolerance and no floating comparison. */
export function compareTime(a: Rational, b: Rational): number {
  const left = a.numerator * b.denominator;
  const right = b.numerator * a.denominator;
  return left === right ? 0 : left < right ? -1 : 1;
}

export const timeEquals = (a: Rational, b: Rational) => compareTime(a, b) === 0;
export const timeIsBefore = (a: Rational, b: Rational) => compareTime(a, b) < 0;
export const timeIsAfter = (a: Rational, b: Rational) => compareTime(a, b) > 0;
export const maxTime = (a: Rational, b: Rational) => (timeIsAfter(a, b) ? a : b);
export const minTime = (a: Rational, b: Rational) => (timeIsBefore(a, b) ? a : b);
export const negateTime = (a: Rational): Rational => rational(-a.numerator, a.denominator);
export const isZero = (a: Rational) => a.numerator === 0;
export const isPositive = (a: Rational) => a.numerator > 0;

/** Lossy on purpose, and only ever used for display or for handing a number to a media API. */
export function toSeconds(time: Rational): number {
  return time.numerator / time.denominator;
}

export function clampTime(time: Rational, low: Rational, high: Rational): Rational {
  if (timeIsBefore(time, low)) return low;
  if (timeIsAfter(time, high)) return high;
  return time;
}

/**
 * A frame rate is itself rational: 30000/1001 for 29.97, 24000/1001 for 23.976. Storing it
 * as 29.97 would make every frame boundary approximate.
 */
export const frameRateSchema = rationalSchema.refine((value) => value.numerator > 0, {
  message: "A frame rate must be greater than zero.",
});
export type FrameRate = Rational;

export const COMMON_FRAME_RATES: { label: string; rate: FrameRate; dropFrame: boolean }[] = [
  { label: "23.976", rate: { numerator: 24000, denominator: 1001 }, dropFrame: false },
  { label: "24", rate: { numerator: 24, denominator: 1 }, dropFrame: false },
  { label: "25", rate: { numerator: 25, denominator: 1 }, dropFrame: false },
  { label: "29.97", rate: { numerator: 30000, denominator: 1001 }, dropFrame: true },
  { label: "30", rate: { numerator: 30, denominator: 1 }, dropFrame: false },
  { label: "50", rate: { numerator: 50, denominator: 1 }, dropFrame: false },
  { label: "59.94", rate: { numerator: 60000, denominator: 1001 }, dropFrame: true },
  { label: "60", rate: { numerator: 60, denominator: 1 }, dropFrame: false },
];

/** Exact frame index for a time. Rounds only at the boundary, where a frame must be chosen. */
export function timeToFrame(time: Rational, rate: FrameRate): number {
  return Math.round((time.numerator * rate.numerator) / (time.denominator * rate.denominator));
}

export function frameToTime(frame: number, rate: FrameRate): Rational {
  if (!Number.isInteger(frame)) throw new ProjectError("INVALID_INPUT", "A frame index must be a whole number.");
  return rational(frame * rate.denominator, rate.numerator);
}

/** Snaps a time onto the nearest frame boundary, which is what every timeline edit must do. */
export function snapToFrame(time: Rational, rate: FrameRate): Rational {
  return frameToTime(timeToFrame(time, rate), rate);
}

export function frameDuration(rate: FrameRate): Rational {
  return rational(rate.denominator, rate.numerator);
}

/** True for the NTSC rates where wall-clock and frame count diverge without dropped labels. */
export function isDropFrameRate(rate: FrameRate): boolean {
  return rate.denominator === 1001 && (rate.numerator === 30000 || rate.numerator === 60000);
}

function pad(value: number, size = 2): string {
  return String(Math.abs(value)).padStart(size, "0");
}

/** Frame labels dropped per minute for the NTSC rates: two at 29.97, four at 59.94. */
export function dropFrameCount(rate: FrameRate): number {
  if (!isDropFrameRate(rate)) return 0;
  return rate.numerator === 60000 ? 4 : 2;
}

export function nominalRate(rate: FrameRate): number {
  return Math.round(rate.numerator / rate.denominator);
}

/**
 * Drop-frame timecode skips two frame *labels* each minute except every tenth, so the
 * displayed timecode tracks wall clock. It never drops actual frames — a detail that is easy
 * to get wrong and impossible to notice until a delivery is rejected.
 */
export function formatTimecode(time: Rational, rate: FrameRate, forceDropFrame?: boolean): string {
  const dropFrame = forceDropFrame ?? isDropFrameRate(rate);
  const nominal = nominalRate(rate);
  let frame = timeToFrame(time, rate);
  const negative = frame < 0;
  frame = Math.abs(frame);

  if (dropFrame) {
    const dropPerMinute = nominal === 60 ? 4 : 2;
    const framesPerMinute = nominal * 60 - dropPerMinute;
    const framesPerTenMinutes = framesPerMinute * 10 + dropPerMinute;

    const tenMinuteBlocks = Math.floor(frame / framesPerTenMinutes);
    const remainder = frame % framesPerTenMinutes;
    // The first minute of every ten-minute block drops nothing, which is what keeps the
    // running label aligned with wall clock over an hour.
    const minutesInBlock = remainder < dropPerMinute ? 0 : Math.floor((remainder - dropPerMinute) / framesPerMinute) + 1;
    frame += dropPerMinute * (tenMinuteBlocks * 9 + Math.max(0, minutesInBlock - 1));
  }

  const frames = frame % nominal;
  const totalSeconds = Math.floor(frame / nominal);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const separator = dropFrame ? ";" : ":";
  return `${negative ? "-" : ""}${pad(hours)}:${pad(minutes)}:${pad(seconds)}${separator}${pad(frames)}`;
}

/**
 * A drop-frame label that names one of the skipped frames does not exist. `00:01:00;00` and
 * `00:01:00;01` are never produced by any real 29.97 timeline, so accepting them would let a
 * caller address a frame that is not there and silently land somewhere else.
 */
export function isIllegalDropFrameLabel(
  minutes: number,
  seconds: number,
  frames: number,
  rate: FrameRate,
): boolean {
  const drop = dropFrameCount(rate);
  if (!drop) return false;
  return seconds === 0 && minutes % 10 !== 0 && frames < drop;
}

/**
 * Accepts `HH:MM:SS:FF` or `HH:MM:SS;FF`.
 *
 * The separator is meaningful rather than decorative: `;` asks for drop-frame numbering and
 * `:` asks for a straight frame count. Reading both the same way is the bug that makes a
 * 29.97 timeline drift by 3.6 seconds an hour.
 */
export function parseTimecode(text: string, rate: FrameRate): Rational {
  const match = /^(-)?(\d{1,3}):([0-5]?\d):([0-5]?\d)([:;])(\d{1,3})$/.exec(text.trim());
  if (!match) {
    throw new ProjectError("INVALID_INPUT", "Enter a timecode such as 00:01:23:12, or 00:01:23;12 for drop frame.", { fieldPath: "timecode" });
  }
  const [, sign, hoursText, minutesText, secondsText, separator, framesText] = match;
  const nominal = nominalRate(rate);
  const frames = Number(framesText);
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  const seconds = Number(secondsText);

  if (frames >= nominal) {
    throw new ProjectError("INVALID_INPUT", `This sequence has ${nominal} frames per second, so the frame part must be below ${nominal}.`, { fieldPath: "timecode" });
  }

  const wantsDropFrame = separator === ";";
  if (wantsDropFrame && !isDropFrameRate(rate)) {
    throw new ProjectError(
      "INVALID_INPUT",
      `A semicolon asks for drop-frame numbering, which only applies to 29.97 and 59.94 fps. This sequence runs at ${nominal} fps, so use a colon.`,
      { fieldPath: "timecode" },
    );
  }

  const drop = wantsDropFrame ? dropFrameCount(rate) : 0;
  if (drop && isIllegalDropFrameLabel(minutes, seconds, frames, rate)) {
    throw new ProjectError(
      "INVALID_INPUT",
      `Drop-frame numbering skips the first ${drop} frame labels of every minute except every tenth, so ${text.trim()} names a frame that does not exist.`,
      { fieldPath: "timecode" },
    );
  }

  const labelled = ((hours * 60 + minutes) * 60 + seconds) * nominal + frames;
  // Every minute drops labels except every tenth, so the count of dropped labels up to this
  // point is what separates the label from the real frame index.
  const totalMinutes = hours * 60 + minutes;
  const droppedLabels = drop * (totalMinutes - Math.floor(totalMinutes / 10));
  const total = labelled - droppedLabels;

  return frameToTime(sign ? -total : total, rate);
}

/** True when a timecode string is well formed and legal for this rate. */
export function isValidTimecode(text: string, rate: FrameRate): boolean {
  try {
    parseTimecode(text, rate);
    return true;
  } catch {
    return false;
  }
}

/** Half-open range: `start` is included, `start + duration` is not, so cuts never overlap. */
export const timeRangeSchema = z.object({
  start: rationalSchema,
  duration: rationalSchema,
});
export type TimeRange = z.infer<typeof timeRangeSchema>;

export function rangeEnd(range: TimeRange): Rational {
  return addTime(range.start, range.duration);
}

export function rangeContains(range: TimeRange, time: Rational): boolean {
  return !timeIsBefore(time, range.start) && timeIsBefore(time, rangeEnd(range));
}

export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  return timeIsBefore(a.start, rangeEnd(b)) && timeIsBefore(b.start, rangeEnd(a));
}

export function intersectRanges(a: TimeRange, b: TimeRange): TimeRange | null {
  const start = maxTime(a.start, b.start);
  const end = minTime(rangeEnd(a), rangeEnd(b));
  if (!timeIsBefore(start, end)) return null;
  return { start, duration: subtractTime(end, start) };
}

export function rangeFromBounds(start: Rational, end: Rational): TimeRange {
  if (!timeIsBefore(start, end)) {
    throw new ProjectError("INVALID_INPUT", "A range must end after it starts.", { fieldPath: "end" });
  }
  return { start, duration: subtractTime(end, start) };
}

/**
 * Rejects the range shapes every timeline edit assumes cannot happen: negative starts,
 * zero or negative durations, and inverted bounds. Centralising it means one command
 * cannot quietly accept what another rejects.
 */
export function assertValidRange(range: TimeRange, fieldPath = "range"): TimeRange {
  if (range.start.numerator < 0) {
    throw new ProjectError("INVALID_INPUT", "A time range cannot start before zero.", { fieldPath: `${fieldPath}.start` });
  }
  if (range.duration.numerator <= 0) {
    throw new ProjectError("INVALID_INPUT", "A time range must last longer than zero.", { fieldPath: `${fieldPath}.duration` });
  }
  return range;
}

export function assertNonNegative(time: Rational, fieldPath: string): Rational {
  if (time.numerator < 0) {
    throw new ProjectError("INVALID_INPUT", "A time on the timeline cannot be negative.", { fieldPath });
  }
  return time;
}

/** The last frame that is actually inside a half-open range, for reverse addressing. */
export function lastFrameTimeIn(range: TimeRange, rate: FrameRate): Rational {
  const end = rangeEnd(range);
  const lastFrame = timeToFrame(end, rate) - 1;
  const candidate = frameToTime(Math.max(0, lastFrame), rate);
  return timeIsBefore(candidate, range.start) ? range.start : candidate;
}
