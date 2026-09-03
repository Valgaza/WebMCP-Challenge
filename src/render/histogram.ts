export const HISTOGRAM_BINS = 64;

export interface HistogramChannel {
  bins: number[];
  clippedLowPercent: number;
  clippedHighPercent: number;
}

export interface Histogram {
  bins: number;
  sampleCount: number;
  red: HistogramChannel;
  green: HistogramChannel;
  blue: HistogramChannel;
  luminance: HistogramChannel;
  warnings: string[];
}

const CLIP_WARNING_PERCENT = 1;

function emptyChannel(): { counts: number[]; low: number; high: number } {
  return { counts: new Array(HISTOGRAM_BINS).fill(0), low: 0, high: 0 };
}

/**
 * Summarizes pixels into bounded bins. The ledger is explicit that histogram tools return
 * summaries and clipping diagnostics, never raw media, so this is the only shape that
 * crosses the WebMCP boundary.
 *
 * Fully transparent pixels are skipped: counting them would report a black spike that does
 * not exist in the visible image.
 */
export function computeHistogram(pixels: Uint8ClampedArray): Histogram {
  const channels = { red: emptyChannel(), green: emptyChannel(), blue: emptyChannel(), luminance: emptyChannel() };
  const scale = HISTOGRAM_BINS / 256;
  let sampleCount = 0;

  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] === 0) continue;
    sampleCount += 1;

    const r = pixels[index];
    const g = pixels[index + 1];
    const b = pixels[index + 2];
    // Rec. 709 luma, which matches how the eye weights the channels.
    const luma = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);

    for (const [name, value] of [["red", r], ["green", g], ["blue", b], ["luminance", luma]] as const) {
      const channel = channels[name];
      channel.counts[Math.min(HISTOGRAM_BINS - 1, Math.floor(value * scale))] += 1;
      if (value === 0) channel.low += 1;
      if (value === 255) channel.high += 1;
    }
  }

  const toChannel = (channel: { counts: number[]; low: number; high: number }): HistogramChannel => ({
    bins: channel.counts,
    clippedLowPercent: sampleCount ? (channel.low / sampleCount) * 100 : 0,
    clippedHighPercent: sampleCount ? (channel.high / sampleCount) * 100 : 0,
  });

  const result: Histogram = {
    bins: HISTOGRAM_BINS,
    sampleCount,
    red: toChannel(channels.red),
    green: toChannel(channels.green),
    blue: toChannel(channels.blue),
    luminance: toChannel(channels.luminance),
    warnings: [],
  };

  result.warnings = clippingWarnings(result);
  return result;
}

/** Plain-language warnings, shown in the Inspector and returned to an agent unchanged. */
export function clippingWarnings(histogram: Histogram): string[] {
  const warnings: string[] = [];
  if (histogram.sampleCount === 0) return ["Nothing visible was measured, so there is no histogram to read."];

  const named = [["Red", histogram.red], ["Green", histogram.green], ["Blue", histogram.blue]] as const;
  for (const [label, channel] of named) {
    if (channel.clippedHighPercent >= CLIP_WARNING_PERCENT) {
      warnings.push(`${label} is clipped in the highlights across ${channel.clippedHighPercent.toFixed(1)}% of the image; that detail cannot be recovered.`);
    }
    if (channel.clippedLowPercent >= CLIP_WARNING_PERCENT) {
      warnings.push(`${label} is crushed in the shadows across ${channel.clippedLowPercent.toFixed(1)}% of the image.`);
    }
  }
  return warnings;
}

/** A compact description an agent or the Inspector can read without the bins. */
export function describeExposure(histogram: Histogram): string {
  if (!histogram.sampleCount) return "Nothing visible to measure.";
  const bins = histogram.luminance.bins;
  const total = bins.reduce((sum, count) => sum + count, 0) || 1;
  const weighted = bins.reduce((sum, count, index) => sum + count * index, 0) / total;
  const position = weighted / (HISTOGRAM_BINS - 1);

  if (position < 0.25) return "Overall exposure sits in the shadows; the image reads as dark.";
  if (position > 0.75) return "Overall exposure sits in the highlights; the image reads as bright.";
  return "Overall exposure is balanced across the tonal range.";
}
