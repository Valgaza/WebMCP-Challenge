import { z } from "zod";

export const ADJUSTMENT_SCHEMA_VERSION = 1 as const;

/**
 * Adjustments are stored as parameters and applied at render time, never baked into pixels.
 * Every range is documented here because the WebMCP contract must state explicit units and
 * bounds, and because the UI, the agent, and the renderer must agree on one definition.
 */
export const ADJUSTMENT_RANGES = {
  brightness: { min: -100, max: 100, default: 0, unit: "percent", label: "Brightness" },
  contrast: { min: -100, max: 100, default: 0, unit: "percent", label: "Contrast" },
  temperature: { min: -100, max: 100, default: 0, unit: "relative warmth", label: "Temperature" },
  tint: { min: -100, max: 100, default: 0, unit: "green to magenta", label: "Tint" },
  hue: { min: -180, max: 180, default: 0, unit: "degrees", label: "Hue" },
  saturation: { min: -100, max: 100, default: 0, unit: "percent", label: "Saturation" },
  lightness: { min: -100, max: 100, default: 0, unit: "percent", label: "Lightness" },
} as const;

export type AdjustmentName = keyof typeof ADJUSTMENT_RANGES;

export const adjustmentNameSchema = z.enum(
  Object.keys(ADJUSTMENT_RANGES) as [AdjustmentName, ...AdjustmentName[]],
);

function bounded(name: AdjustmentName) {
  const range = ADJUSTMENT_RANGES[name];
  return z.number()
    .min(range.min, `${range.label} cannot be below ${range.min}.`)
    .max(range.max, `${range.label} cannot exceed ${range.max}.`)
    .default(range.default);
}

export const adjustmentStackSchema = z.object({
  schemaVersion: z.literal(ADJUSTMENT_SCHEMA_VERSION),
  brightness: bounded("brightness"),
  contrast: bounded("contrast"),
  temperature: bounded("temperature"),
  tint: bounded("tint"),
  hue: bounded("hue"),
  saturation: bounded("saturation"),
  lightness: bounded("lightness"),
});
export type AdjustmentStack = z.infer<typeof adjustmentStackSchema>;

export function createDefaultAdjustments(): AdjustmentStack {
  return adjustmentStackSchema.parse({ schemaVersion: ADJUSTMENT_SCHEMA_VERSION });
}

export function isDefaultAdjustments(stack: AdjustmentStack): boolean {
  return (Object.keys(ADJUSTMENT_RANGES) as AdjustmentName[])
    .every((name) => stack[name] === ADJUSTMENT_RANGES[name].default);
}

export function activeAdjustments(stack: AdjustmentStack): { name: AdjustmentName; value: number; unit: string }[] {
  return (Object.keys(ADJUSTMENT_RANGES) as AdjustmentName[])
    .filter((name) => stack[name] !== ADJUSTMENT_RANGES[name].default)
    .map((name) => ({ name, value: stack[name], unit: ADJUSTMENT_RANGES[name].unit }));
}

/**
 * A plain-language account of what one adjustment is doing, used by both the Inspector and
 * the `explain_edit` tool so the human and the agent receive the same explanation.
 */
export function describeAdjustment(name: AdjustmentName, value: number): string {
  const range = ADJUSTMENT_RANGES[name];
  if (value === range.default) return `${range.label} is at its default.`;
  const direction = value > 0 ? "increased" : "reduced";
  const magnitude = Math.abs(value);
  switch (name) {
    case "brightness":
      return `Brightness is ${direction} by ${magnitude}%, making the whole image ${value > 0 ? "lighter" : "darker"}.`;
    case "contrast":
      return `Contrast is ${direction} by ${magnitude}%, ${value > 0 ? "pushing tones further apart" : "bringing tones closer together"}.`;
    case "temperature":
      return `Temperature is shifted ${value > 0 ? "warmer" : "cooler"} by ${magnitude}, ${value > 0 ? "adding" : "removing"} yellow and orange.`;
    case "tint":
      return `Tint is shifted toward ${value > 0 ? "magenta" : "green"} by ${magnitude}.`;
    case "hue":
      return `Hue is rotated by ${value} degrees, shifting every colour around the colour wheel.`;
    case "saturation":
      return `Saturation is ${direction} by ${magnitude}%, making colours ${value > 0 ? "more vivid" : "more muted"}.`;
    case "lightness":
      return `Lightness is ${direction} by ${magnitude}%, ${value > 0 ? "lifting" : "lowering"} overall luminance.`;
  }
}

/**
 * Builds the per-channel lookup tables the renderer applies. Kept pure and separate from any
 * canvas so it can be unit tested and later reused by a worker or GPU path.
 */
export function buildToneCurve(stack: AdjustmentStack): Uint8ClampedArray {
  const table = new Uint8ClampedArray(256);
  const brightness = (stack.brightness / 100) * 255 * 0.5;
  // Standard contrast factor: 0 leaves the image untouched, +100 roughly doubles separation.
  const contrast = (259 * (stack.contrast + 255)) / (255 * (259 - stack.contrast));
  const lightness = (stack.lightness / 100) * 255 * 0.5;

  for (let value = 0; value < 256; value += 1) {
    let next = contrast * (value - 128) + 128;
    next += brightness + lightness;
    table[value] = Math.max(0, Math.min(255, next));
  }
  return table;
}

/** Temperature and tint are applied as per-channel gains around neutral. */
export function whiteBalanceGains(stack: AdjustmentStack): { r: number; g: number; b: number } {
  const temperature = stack.temperature / 100;
  const tint = stack.tint / 100;
  return {
    r: 1 + temperature * 0.25,
    g: 1 + tint * 0.15,
    b: 1 - temperature * 0.25,
  };
}

/**
 * A change to some adjustments, leaving the rest alone.
 *
 * Written out rather than derived with `.partial()` on the stack: Zod's `.partial()` keeps a
 * field's default, so every unmentioned adjustment would arrive as its own default and a merge
 * could not tell "leave the contrast" from "set the contrast to zero". Changing one slider
 * would quietly reset the others.
 */
export const adjustmentPatchSchema = z.object(
  Object.fromEntries(
    (Object.keys(ADJUSTMENT_RANGES) as AdjustmentName[]).map((name) => {
      const range = ADJUSTMENT_RANGES[name];
      return [name, z.number().min(range.min).max(range.max).optional()];
    }),
  ) as Record<AdjustmentName, z.ZodOptional<z.ZodNumber>>,
);
export type AdjustmentPatch = z.infer<typeof adjustmentPatchSchema>;
