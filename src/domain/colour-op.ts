import { z } from "zod";
import { ProjectError } from "./project-error";

export const COLOUR_OP_SCHEMA_VERSION = 1 as const;

/**
 * The tone and colour operators, as parameters rather than as baked pixels.
 *
 * Every one of these is a function from a colour to a colour, so they share one shape: a
 * description that can be stored, reordered, switched off, masked, and re-run at export
 * resolution. That is what lets them drop into the effect container Phase 6 built rather than
 * each becoming its own layer property.
 *
 * They are deliberately kept apart from the simple adjustment stack. Brightness and contrast
 * are one slider each and belong on every layer; a curve is a graph with its own editor, and
 * putting it on every layer would mean every layer carried an unused one.
 */

/* -------------------------------- shared pieces -------------------------------- */

const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** One point on a curve. Input and output both run 0–255. */
export const curvePointSchema = z.object({
  input: z.number().min(0).max(255),
  output: z.number().min(0).max(255),
});
export type CurvePoint = z.infer<typeof curvePointSchema>;

export const curveChannelSchema = z.enum(["rgb", "red", "green", "blue"]);
export type CurveChannel = z.infer<typeof curveChannelSchema>;

const levelsChannelSchema = z.object({
  /** Where black and white are taken from in the input. */
  inBlack: z.number().min(0).max(254).default(0),
  inWhite: z.number().min(1).max(255).default(255),
  /** Midpoint, above 1 lightens. */
  gamma: z.number().min(0.1).max(9.99).default(1),
  /** Where they land in the output, for a deliberately lifted or crushed result. */
  outBlack: z.number().min(0).max(255).default(0),
  outWhite: z.number().min(0).max(255).default(255),
});
export type LevelsChannel = z.infer<typeof levelsChannelSchema>;

/**
 * The neutral settings, written out rather than left to `.default({})`.
 *
 * Zod does not parse a default value, so `.default({})` hands the operator a literally empty
 * object: every field is `undefined`, the arithmetic produces `NaN`, and the result clamps to
 * black. Naming the neutral value is the fix and it reads better anyway.
 */
export const NEUTRAL_LEVELS: LevelsChannel = { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 };

const rgbTriplet = z.object({
  red: z.number().min(-100).max(100).default(0),
  green: z.number().min(-100).max(100).default(0),
  blue: z.number().min(-100).max(100).default(0),
});

/** Neutral for the same reason as `NEUTRAL_LEVELS`. */
const NO_SHIFT = { red: 0, green: 0, blue: 0 };

export const selectiveColourTargetSchema = z.enum([
  "reds", "yellows", "greens", "cyans", "blues", "magentas", "whites", "neutrals", "blacks",
]);
export type SelectiveColourTarget = z.infer<typeof selectiveColourTargetSchema>;

export const gradientMapStopSchema = z.object({
  offset: z.number().min(0).max(1),
  colour: hexColour,
});

/* ------------------------------- the operators -------------------------------- */

export const colourOperationSchema = z.discriminatedUnion("kind", [
  /**
   * Exposure in stops, an offset in linear light, and a gamma.
   *
   * Stops rather than a percentage because that is the unit a photograph is taken in: +1 EV is
   * twice the light, whatever the picture started at.
   */
  z.object({
    kind: z.literal("exposure"),
    exposureEv: z.number().min(-10).max(10).default(0),
    offset: z.number().min(-0.5).max(0.5).default(0),
    gamma: z.number().min(0.1).max(9.99).default(1),
  }),

  z.object({
    kind: z.literal("levels"),
    rgb: levelsChannelSchema.default(NEUTRAL_LEVELS),
    red: levelsChannelSchema.default(NEUTRAL_LEVELS),
    green: levelsChannelSchema.default(NEUTRAL_LEVELS),
    blue: levelsChannelSchema.default(NEUTRAL_LEVELS),
  }),

  z.object({
    kind: z.literal("curves"),
    channel: curveChannelSchema.default("rgb"),
    /** At least the two ends. Points are sorted by input, so a caller need not be careful. */
    points: z.array(curvePointSchema).min(2).max(24),
  }),

  /**
   * Vibrance, which raises the least saturated colours most.
   *
   * Distinct from saturation because a flat multiply pushes already-vivid colours out of gamut
   * and turns skin orange, which is the whole reason a separate control exists.
   */
  z.object({
    kind: z.literal("vibrance"),
    vibrance: z.number().min(-100).max(100).default(0),
    saturation: z.number().min(-100).max(100).default(0),
  }),

  z.object({
    kind: z.literal("colour_balance"),
    shadows: rgbTriplet.default(NO_SHIFT),
    midtones: rgbTriplet.default(NO_SHIFT),
    highlights: rgbTriplet.default(NO_SHIFT),
    /** Keeps the picture's brightness where it was while its colour shifts. */
    preserveLuminosity: z.boolean().default(true),
  }),

  z.object({
    kind: z.literal("selective_colour"),
    target: selectiveColourTargetSchema,
    cyan: z.number().min(-100).max(100).default(0),
    magenta: z.number().min(-100).max(100).default(0),
    yellow: z.number().min(-100).max(100).default(0),
    black: z.number().min(-100).max(100).default(0),
    /** Relative scales what is already there; absolute adds a fixed amount. */
    relative: z.boolean().default(true),
  }),

  /**
   * Black and white by mixing the colour channels, with an optional tint.
   *
   * A plain desaturation throws away the only control that matters here: which colours become
   * which greys. Mixing is what turns a blue sky dark or light without touching anything else.
   */
  z.object({
    kind: z.literal("black_and_white"),
    red: z.number().min(-200).max(300).default(40),
    yellow: z.number().min(-200).max(300).default(60),
    green: z.number().min(-200).max(300).default(40),
    cyan: z.number().min(-200).max(300).default(60),
    blue: z.number().min(-200).max(300).default(20),
    magenta: z.number().min(-200).max(300).default(80),
    tint: hexColour.nullable().default(null),
    tintStrength: z.number().min(0).max(1).default(0.25),
  }),

  /** The general form: each output channel from a weighted mix of the inputs. */
  z.object({
    kind: z.literal("channel_mixer"),
    outputChannel: z.enum(["red", "green", "blue"]),
    fromRed: z.number().min(-200).max(200).default(100),
    fromGreen: z.number().min(-200).max(200).default(0),
    fromBlue: z.number().min(-200).max(200).default(0),
    constant: z.number().min(-100).max(100).default(0),
  }),

  /** Remaps brightness onto a gradient, which is how a duotone or a heat map is made. */
  z.object({
    kind: z.literal("gradient_map"),
    stops: z.array(gradientMapStopSchema).min(2).max(32),
  }),

  z.object({
    kind: z.literal("photo_filter"),
    colour: hexColour.default("#ec8a00"),
    density: z.number().min(0).max(1).default(0.25),
    preserveLuminosity: z.boolean().default(true),
  }),

  /**
   * A three-dimensional colour lookup table.
   *
   * Three dimensions rather than one per channel, because a look that only maps each channel
   * separately cannot turn one hue without turning every colour containing it — which is most
   * of what a film emulation does.
   */
  z.object({
    kind: z.literal("lut"),
    name: z.string().trim().min(1).max(120),
    size: z.number().int().min(2).max(64),
    /** `size³` triplets in 0–1, ordered with red changing fastest, as `.cube` files are. */
    table: z.array(z.number().min(-1).max(2)),
    strength: z.number().min(0).max(1).default(1),
  }),

  /**
   * Recovers detail from the dark and bright ends without moving the middle.
   *
   * The radius is what separates this from a curve: the correction is judged against what is
   * around a pixel, so a face in shadow lifts while a shadow beside a bright edge does not
   * turn into a halo.
   */
  z.object({
    kind: z.literal("shadows_highlights"),
    shadowAmount: z.number().min(0).max(100).default(0),
    shadowTone: z.number().min(1).max(100).default(50),
    highlightAmount: z.number().min(0).max(100).default(0),
    highlightTone: z.number().min(1).max(100).default(50),
    radiusPx: z.number().min(0).max(500).default(30),
  }),

  z.object({
    kind: z.literal("replace_colour"),
    from: hexColour,
    tolerance: z.number().min(0).max(255).default(40),
    hueShiftDeg: z.number().min(-180).max(180).default(0),
    saturationShift: z.number().min(-100).max(100).default(0),
    lightnessShift: z.number().min(-100).max(100).default(0),
  }),

  z.object({ kind: z.literal("posterize"), levels: z.number().int().min(2).max(255).default(6) }),
  z.object({ kind: z.literal("threshold"), level: z.number().min(0).max(255).default(128) }),
  z.object({ kind: z.literal("invert") }),
  /** Spreads the tones so every level is equally used; a measurement, not a taste. */
  z.object({ kind: z.literal("equalize") }),
]);
export type ColourOperation = z.infer<typeof colourOperationSchema>;
export type ColourOperationKind = ColourOperation["kind"];

/* ---------------------------------- the maths ---------------------------------- */

const clamp255 = (value: number): number => (value < 0 ? 0 : value > 255 ? 255 : value);

/** Rec. 601 luma: the standard perceptual weighting, so "brightness" matches what a person sees. */
export function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * A curve through its points, sampled into a 256-entry table.
 *
 * Monotone cubic rather than a natural spline: a natural spline overshoots between points, so
 * dragging a curve upwards can make a nearby region *darker* than before. A tone curve that
 * does that is unusable, and the fix is a interpolation that cannot overshoot by construction.
 */
export function curveTable(points: readonly CurvePoint[]): Uint8ClampedArray {
  const sorted = [...points].sort((a, b) => a.input - b.input);
  const table = new Uint8ClampedArray(256);
  const n = sorted.length;

  // Slopes between neighbours, then tangents chosen so the result stays monotone
  // (Fritsch–Carlson).
  const secants: number[] = [];
  for (let index = 0; index < n - 1; index += 1) {
    const run = sorted[index + 1].input - sorted[index].input;
    secants.push(run === 0 ? 0 : (sorted[index + 1].output - sorted[index].output) / run);
  }
  const tangents: number[] = new Array(n);
  tangents[0] = secants[0] ?? 0;
  tangents[n - 1] = secants[n - 2] ?? 0;
  for (let index = 1; index < n - 1; index += 1) {
    tangents[index] = secants[index - 1] * secants[index] <= 0
      ? 0
      : (secants[index - 1] + secants[index]) / 2;
  }
  for (let index = 0; index < n - 1; index += 1) {
    if (secants[index] === 0) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
      continue;
    }
    const a = tangents[index] / secants[index];
    const b = tangents[index + 1] / secants[index];
    const magnitude = Math.hypot(a, b);
    if (magnitude > 3) {
      tangents[index] = (3 / magnitude) * a * secants[index];
      tangents[index + 1] = (3 / magnitude) * b * secants[index];
    }
  }

  for (let value = 0; value < 256; value += 1) {
    // Outside the points the curve holds, rather than extrapolating off the scale.
    if (value <= sorted[0].input) { table[value] = sorted[0].output; continue; }
    if (value >= sorted[n - 1].input) { table[value] = sorted[n - 1].output; continue; }

    let segment = 0;
    while (segment < n - 2 && value > sorted[segment + 1].input) segment += 1;
    const from = sorted[segment];
    const to = sorted[segment + 1];
    const run = to.input - from.input;
    const t = run === 0 ? 0 : (value - from.input) / run;
    const t2 = t * t;
    const t3 = t2 * t;
    table[value] =
      (2 * t3 - 3 * t2 + 1) * from.output
      + (t3 - 2 * t2 + t) * run * tangents[segment]
      + (-2 * t3 + 3 * t2) * to.output
      + (t3 - t2) * run * tangents[segment + 1];
  }
  return table;
}

/** The levels mapping for one channel, as a table. */
export function levelsTable(settings: LevelsChannel): Uint8ClampedArray {
  const table = new Uint8ClampedArray(256);
  const span = Math.max(1, settings.inWhite - settings.inBlack);
  for (let value = 0; value < 256; value += 1) {
    const normalised = Math.max(0, Math.min(1, (value - settings.inBlack) / span));
    const corrected = Math.pow(normalised, 1 / settings.gamma);
    table[value] = settings.outBlack + corrected * (settings.outWhite - settings.outBlack);
  }
  return table;
}

/** The 256 greys a gradient map produces, one per input brightness. */
export function gradientMapTable(stops: readonly { offset: number; colour: string }[]): Uint8ClampedArray {
  const sorted = [...stops].sort((a, b) => a.offset - b.offset);
  const table = new Uint8ClampedArray(256 * 3);
  const channels = sorted.map((stop) => [
    parseInt(stop.colour.slice(1, 3), 16),
    parseInt(stop.colour.slice(3, 5), 16),
    parseInt(stop.colour.slice(5, 7), 16),
  ]);

  for (let value = 0; value < 256; value += 1) {
    const position = value / 255;
    let segment = 0;
    while (segment < sorted.length - 2 && position > sorted[segment + 1].offset) segment += 1;
    const from = sorted[segment];
    const to = sorted[segment + 1];
    const run = to.offset - from.offset;
    const t = run <= 0 ? 0 : Math.max(0, Math.min(1, (position - from.offset) / run));
    for (let channel = 0; channel < 3; channel += 1) {
      table[value * 3 + channel] = channels[segment][channel]
        + (channels[segment + 1][channel] - channels[segment][channel]) * t;
    }
  }
  return table;
}

/** RGB to HSL, with hue in degrees and the rest 0–1. */
export function toHsl(r: number, g: number, b: number): [number, number, number] {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];

  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  const hue = max === red ? ((green - blue) / delta + (green < blue ? 6 : 0))
    : max === green ? (blue - red) / delta + 2
      : (red - green) / delta + 4;
  return [hue * 60, saturation, lightness];
}

export function fromHsl(hue: number, saturation: number, lightness: number): [number, number, number] {
  if (saturation <= 0) {
    const grey = lightness * 255;
    return [grey, grey, grey];
  }
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const channel = (offset: number): number => {
    let t = (((hue / 360) + offset) % 1 + 1) % 1;
    if (t < 1 / 6) t = p + (q - p) * 6 * t;
    else if (t < 1 / 2) t = q;
    else if (t < 2 / 3) t = p + (q - p) * (2 / 3 - t) * 6;
    else t = p;
    return t * 255;
  };
  return [channel(1 / 3), channel(0), channel(-1 / 3)];
}

/**
 * Which of the nine selective-colour bands a pixel belongs to, and how much.
 *
 * Membership is partial: a colour halfway between red and yellow belongs to both, which is what
 * keeps an adjustment from producing a visible edge where one band ends.
 */
function bandStrength(target: SelectiveColourTarget, r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const mid = r + g + b - max - min;

  if (target === "whites") return min > 128 ? (min - 128) / 127 : 0;
  if (target === "blacks") return max < 128 ? (128 - max) / 128 : 0;
  if (target === "neutrals") {
    // How grey the pixel is, so a fully saturated colour is not touched at all.
    if (max === 0) return 0;
    return Math.max(0, 1 - (max - min) / max);
  }

  const range = max - min;
  if (range === 0) return 0;
  const strength = range / 255;
  switch (target) {
    case "reds": return r === max && b === min ? ((max - mid) / range) * strength : (r === max && g === min ? ((max - mid) / range) * strength : 0);
    case "yellows": return b === min && r !== max && g !== max ? 0 : (b === min ? ((mid - min) / range) * strength : 0);
    case "greens": return g === max ? ((max - mid) / range) * strength : 0;
    case "cyans": return r === min ? ((mid - min) / range) * strength : 0;
    case "blues": return b === max ? ((max - mid) / range) * strength : 0;
    case "magentas": return g === min ? ((mid - min) / range) * strength : 0;
    default: return 0;
  }
}

/**
 * The cumulative histogram an equalize uses.
 *
 * Kept separate because it is a measurement of the picture rather than a setting on it: the
 * same operator gives a different result on a different image, and that is the point of it.
 */
export function equalizeTable(data: Uint8ClampedArray): Uint8ClampedArray {
  const histogram = new Uint32Array(256);
  let counted = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue;
    histogram[Math.round(luma(data[index], data[index + 1], data[index + 2]))] += 1;
    counted += 1;
  }
  const table = new Uint8ClampedArray(256);
  if (counted === 0) {
    for (let value = 0; value < 256; value += 1) table[value] = value;
    return table;
  }
  let running = 0;
  for (let value = 0; value < 256; value += 1) {
    running += histogram[value];
    table[value] = (running / counted) * 255;
  }
  return table;
}

/** Reads a 3D lookup table, trilinearly, so a 33-point table does not band. */
export function sampleLut(
  table: readonly number[], size: number, r: number, g: number, b: number,
): [number, number, number] {
  const scale = size - 1;
  const at = (ri: number, gi: number, bi: number): number =>
    ((bi * size + gi) * size + ri) * 3;

  const rf = (r / 255) * scale;
  const gf = (g / 255) * scale;
  const bf = (b / 255) * scale;
  const r0 = Math.floor(rf);
  const g0 = Math.floor(gf);
  const b0 = Math.floor(bf);
  const r1 = Math.min(scale, r0 + 1);
  const g1 = Math.min(scale, g0 + 1);
  const b1 = Math.min(scale, b0 + 1);
  const dr = rf - r0;
  const dg = gf - g0;
  const db = bf - b0;

  const out: [number, number, number] = [0, 0, 0];
  for (let channel = 0; channel < 3; channel += 1) {
    const c000 = table[at(r0, g0, b0) + channel];
    const c100 = table[at(r1, g0, b0) + channel];
    const c010 = table[at(r0, g1, b0) + channel];
    const c110 = table[at(r1, g1, b0) + channel];
    const c001 = table[at(r0, g0, b1) + channel];
    const c101 = table[at(r1, g0, b1) + channel];
    const c011 = table[at(r0, g1, b1) + channel];
    const c111 = table[at(r1, g1, b1) + channel];

    const c00 = c000 + (c100 - c000) * dr;
    const c10 = c010 + (c110 - c010) * dr;
    const c01 = c001 + (c101 - c001) * dr;
    const c11 = c011 + (c111 - c011) * dr;
    const c0 = c00 + (c10 - c00) * dg;
    const c1 = c01 + (c11 - c01) * dg;
    out[channel] = (c0 + (c1 - c0) * db) * 255;
  }
  return out;
}

export function assertLutShape(size: number, table: readonly number[]): void {
  const wanted = size * size * size * 3;
  if (table.length !== wanted) {
    throw new ProjectError(
      "INVALID_INPUT",
      `A ${size}-point lookup table needs ${wanted} numbers; ${table.length} were given.`,
      { fieldPath: "table" },
    );
  }
}

/**
 * Reads an Adobe `.cube` file.
 *
 * The format is a header and a list of triplets, red changing fastest. Anything it does not
 * understand is refused by name rather than guessed at: a look applied from a file that was
 * half-read is worse than one that would not load.
 */
export function parseCubeLut(text: string, name = "Lookup"): { name: string; size: number; table: number[] } {
  let size = 0;
  let title = name;
  const table: number[] = [];
  let domainMin = [0, 0, 0];
  let domainMax = [1, 1, 1];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("TITLE")) {
      title = line.slice(5).trim().replace(/^"|"$/g, "") || name;
      continue;
    }
    if (line.startsWith("LUT_1D_SIZE")) {
      throw new ProjectError(
        "INVALID_INPUT",
        "That is a one-dimensional lookup table. Estro uses three-dimensional ones, which can turn a single hue without turning everything containing it.",
        { fieldPath: "table" },
      );
    }
    if (line.startsWith("LUT_3D_SIZE")) {
      size = Number.parseInt(line.slice(11).trim(), 10);
      continue;
    }
    if (line.startsWith("DOMAIN_MIN")) {
      domainMin = line.slice(10).trim().split(/\s+/).map(Number);
      continue;
    }
    if (line.startsWith("DOMAIN_MAX")) {
      domainMax = line.slice(10).trim().split(/\s+/).map(Number);
      continue;
    }

    const parts = line.split(/\s+/).map(Number);
    if (parts.length !== 3 || parts.some((value) => !Number.isFinite(value))) {
      throw new ProjectError("INVALID_INPUT", `That lookup table has a line Estro cannot read: “${line}”.`, { fieldPath: "table" });
    }
    // Rescaled into 0–1 here, so everything downstream works in one range whatever the file
    // declared.
    for (let channel = 0; channel < 3; channel += 1) {
      const span = domainMax[channel] - domainMin[channel];
      table.push(span === 0 ? 0 : (parts[channel] - domainMin[channel]) / span);
    }
  }

  if (!size) {
    throw new ProjectError("INVALID_INPUT", "That file does not declare a lookup table size, so it is not a readable .cube file.", { fieldPath: "table" });
  }
  assertLutShape(size, table);
  return { name: title, size, table };
}

/**
 * Writes a lookup table back out as a `.cube` file.
 *
 * The counterpart to reading one, so a look built here leaves in the format every other tool
 * reads. Red changes fastest, which is what the format specifies and what a reader assumes.
 */
export function toCubeLut(input: { name: string; size: number; table: readonly number[] }): string {
  assertLutShape(input.size, input.table);
  const lines = [
    `TITLE "${input.name.replace(/"/g, "'")}"`,
    `LUT_3D_SIZE ${input.size}`,
    "DOMAIN_MIN 0.0 0.0 0.0",
    "DOMAIN_MAX 1.0 1.0 1.0",
    "",
  ];
  for (let index = 0; index < input.table.length; index += 3) {
    // Six decimals is beyond what any 8-bit pipeline can tell apart, and keeps the file
    // readable rather than exact to a precision nothing uses.
    lines.push([0, 1, 2].map((channel) => input.table[index + channel].toFixed(6)).join(" "));
  }
  return `${lines.join("\n")}\n`;
}

/**
 * The white balance that would make a sampled pixel neutral.
 *
 * This is what an eyedropper does: point at something that should be grey and let the
 * arithmetic work out the correction. Returned as temperature and tint rather than as channel
 * gains, because those are the two controls a person then adjusts by hand.
 */
export function sampleWhiteBalance(r: number, g: number, b: number): {
  temperature: number;
  tint: number;
  neutral: boolean;
} {
  const level = (r + g + b) / 3;
  if (level < 8) {
    // Almost black: the ratios are noise, and a correction from them would be arbitrary.
    return { temperature: 0, tint: 0, neutral: false };
  }
  // Blue against red is warmth; green against the other two is tint. Both scaled so a fully
  // saturated cast maps to the ends of the ordinary range.
  const temperature = Math.max(-100, Math.min(100, ((b - r) / level) * 100));
  const tint = Math.max(-100, Math.min(100, ((g - (r + b) / 2) / level) * -100));
  return { temperature, tint, neutral: Math.abs(temperature) < 1 && Math.abs(tint) < 1 };
}

/* --------------------------------- applying them --------------------------------- */

/**
 * Runs one operator over a block of pixels, in place.
 *
 * A table is built once per operator rather than per pixel wherever the operator allows it,
 * which is what keeps a curve or a levels pass linear in the number of pixels rather than in
 * the number of pixels times the cost of the maths.
 */
export function applyColourOperation(
  data: Uint8ClampedArray,
  operation: ColourOperation,
  size?: { widthPx: number; heightPx: number },
): void {
  switch (operation.kind) {
    case "exposure": {
      const gain = Math.pow(2, operation.exposureEv);
      const table = new Uint8ClampedArray(256);
      for (let value = 0; value < 256; value += 1) {
        // Exposure and offset act in linear light, gamma on the result — the order a camera
        // pipeline uses, so +1 EV means one stop rather than "roughly brighter".
        const linear = Math.max(0, (value / 255) * gain + operation.offset);
        table[value] = Math.pow(linear, 1 / operation.gamma) * 255;
      }
      applyChannelTables(data, table, table, table);
      return;
    }

    case "levels": {
      const rgb = levelsTable(operation.rgb);
      const combine = (channel: LevelsChannel): Uint8ClampedArray => {
        const own = levelsTable(channel);
        const result = new Uint8ClampedArray(256);
        // The master pass runs after the per-channel one, which is the order a levels dialog
        // shows them in and the only order where the master's black point means what it says.
        for (let value = 0; value < 256; value += 1) result[value] = rgb[own[value]];
        return result;
      };
      applyChannelTables(data, combine(operation.red), combine(operation.green), combine(operation.blue));
      return;
    }

    case "curves": {
      const table = curveTable(operation.points);
      const identity = new Uint8ClampedArray(256);
      for (let value = 0; value < 256; value += 1) identity[value] = value;
      applyChannelTables(
        data,
        operation.channel === "rgb" || operation.channel === "red" ? table : identity,
        operation.channel === "rgb" || operation.channel === "green" ? table : identity,
        operation.channel === "rgb" || operation.channel === "blue" ? table : identity,
      );
      return;
    }

    case "vibrance": {
      const vibrance = operation.vibrance / 100;
      const saturation = operation.saturation / 100;
      for (let index = 0; index < data.length; index += 4) {
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        const max = Math.max(r, g, b);
        const average = (r + g + b) / 3;
        const current = max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
        // The less saturated a colour already is, the more vibrance raises it — which is what
        // stops skin going orange while a dull sky still lifts.
        const amount = saturation + vibrance * (1 - current);
        for (let channel = 0; channel < 3; channel += 1) {
          data[index + channel] = clamp255(average + (data[index + channel] - average) * (1 + amount));
        }
      }
      return;
    }

    case "colour_balance": {
      const shift = (value: number, weight: number, amount: number): number => value + weight * amount * 2.55;
      for (let index = 0; index < data.length; index += 4) {
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        const before = luma(r, g, b);
        const level = before / 255;
        // Overlapping weights, so a correction fades between the three ranges rather than
        // stopping at a boundary.
        const shadowWeight = Math.max(0, 1 - level * 2);
        const highlightWeight = Math.max(0, level * 2 - 1);
        const midWeight = 1 - shadowWeight - highlightWeight;

        let nr = shift(shift(shift(r, shadowWeight, operation.shadows.red), midWeight, operation.midtones.red), highlightWeight, operation.highlights.red);
        let ng = shift(shift(shift(g, shadowWeight, operation.shadows.green), midWeight, operation.midtones.green), highlightWeight, operation.highlights.green);
        let nb = shift(shift(shift(b, shadowWeight, operation.shadows.blue), midWeight, operation.midtones.blue), highlightWeight, operation.highlights.blue);

        if (operation.preserveLuminosity) {
          const after = luma(nr, ng, nb);
          if (after > 0) {
            const ratio = before / after;
            nr *= ratio;
            ng *= ratio;
            nb *= ratio;
          }
        }
        data[index] = clamp255(nr);
        data[index + 1] = clamp255(ng);
        data[index + 2] = clamp255(nb);
      }
      return;
    }

    case "selective_colour": {
      for (let index = 0; index < data.length; index += 4) {
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        const strength = bandStrength(operation.target, r, g, b);
        if (strength <= 0) continue;

        // CMY move the channel they oppose; black moves all three. Relative scales what is
        // there, absolute adds a fixed amount, which is the difference the checkbox names.
        const apply = (value: number, cmyk: number): number => {
          const amount = (cmyk / 100) * strength;
          const change = operation.relative ? value * amount : 255 * amount;
          return value - change;
        };
        let nr = apply(r, operation.cyan);
        let ng = apply(g, operation.magenta);
        let nb = apply(b, operation.yellow);
        const blackAmount = (operation.black / 100) * strength;
        const black = operation.relative ? blackAmount : blackAmount;
        nr -= (operation.relative ? nr : 255) * black;
        ng -= (operation.relative ? ng : 255) * black;
        nb -= (operation.relative ? nb : 255) * black;

        data[index] = clamp255(nr);
        data[index + 1] = clamp255(ng);
        data[index + 2] = clamp255(nb);
      }
      return;
    }

    case "black_and_white": {
      const tint = operation.tint
        ? [
          parseInt(operation.tint.slice(1, 3), 16),
          parseInt(operation.tint.slice(3, 5), 16),
          parseInt(operation.tint.slice(5, 7), 16),
        ]
        : null;

      for (let index = 0; index < data.length; index += 4) {
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);

        // Each of the six sliders weights the part of the pixel belonging to that hue, which
        // is what lets a blue sky be darkened without touching a green field.
        const weights = {
          red: Math.max(0, r - Math.max(g, b)),
          green: Math.max(0, g - Math.max(r, b)),
          blue: Math.max(0, b - Math.max(r, g)),
          yellow: Math.max(0, Math.min(r, g) - b),
          cyan: Math.max(0, Math.min(g, b) - r),
          magenta: Math.max(0, Math.min(r, b) - g),
        };
        const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
        const neutral = min;
        const mixed = total === 0
          ? neutral
          : neutral
          + (weights.red * operation.red + weights.green * operation.green + weights.blue * operation.blue
            + weights.yellow * operation.yellow + weights.cyan * operation.cyan + weights.magenta * operation.magenta) / 100;
        const grey = clamp255(max === min ? neutral : mixed);

        if (tint) {
          for (let channel = 0; channel < 3; channel += 1) {
            data[index + channel] = clamp255(grey + (tint[channel] - 128) * operation.tintStrength * (grey / 255));
          }
        } else {
          data[index] = grey;
          data[index + 1] = grey;
          data[index + 2] = grey;
        }
      }
      return;
    }

    case "channel_mixer": {
      const offset = { red: 0, green: 1, blue: 2 }[operation.outputChannel];
      const original = new Uint8ClampedArray(data);
      for (let index = 0; index < data.length; index += 4) {
        data[index + offset] = clamp255(
          (original[index] * operation.fromRed
            + original[index + 1] * operation.fromGreen
            + original[index + 2] * operation.fromBlue) / 100
          + operation.constant * 2.55,
        );
      }
      return;
    }

    case "gradient_map": {
      const table = gradientMapTable(operation.stops);
      for (let index = 0; index < data.length; index += 4) {
        const level = Math.round(luma(data[index], data[index + 1], data[index + 2]));
        data[index] = table[level * 3];
        data[index + 1] = table[level * 3 + 1];
        data[index + 2] = table[level * 3 + 2];
      }
      return;
    }

    case "photo_filter": {
      const filter = [
        parseInt(operation.colour.slice(1, 3), 16),
        parseInt(operation.colour.slice(3, 5), 16),
        parseInt(operation.colour.slice(5, 7), 16),
      ];
      for (let index = 0; index < data.length; index += 4) {
        const before = luma(data[index], data[index + 1], data[index + 2]);
        // A filter multiplies rather than blends: glass in front of a lens removes light of
        // the colours it is not, which is why a dense filter darkens.
        let nr = (data[index] * filter[0]) / 255;
        let ng = (data[index + 1] * filter[1]) / 255;
        let nb = (data[index + 2] * filter[2]) / 255;
        nr = data[index] + (nr - data[index]) * operation.density;
        ng = data[index + 1] + (ng - data[index + 1]) * operation.density;
        nb = data[index + 2] + (nb - data[index + 2]) * operation.density;

        if (operation.preserveLuminosity) {
          const after = luma(nr, ng, nb);
          if (after > 0) {
            const ratio = before / after;
            nr *= ratio;
            ng *= ratio;
            nb *= ratio;
          }
        }
        data[index] = clamp255(nr);
        data[index + 1] = clamp255(ng);
        data[index + 2] = clamp255(nb);
      }
      return;
    }

    case "lut": {
      assertLutShape(operation.size, operation.table);
      for (let index = 0; index < data.length; index += 4) {
        const [r, g, b] = sampleLut(operation.table, operation.size, data[index], data[index + 1], data[index + 2]);
        data[index] = clamp255(data[index] + (r - data[index]) * operation.strength);
        data[index + 1] = clamp255(data[index + 1] + (g - data[index + 1]) * operation.strength);
        data[index + 2] = clamp255(data[index + 2] + (b - data[index + 2]) * operation.strength);
      }
      return;
    }

    case "shadows_highlights": {
      // The correction is judged against a blurred copy, so it follows the shape of the
      // picture rather than the value of one pixel. Without it, a dark pixel beside a bright
      // edge lifts on its own and leaves a halo.
      const mask = size ? blurredLuma(data, size.widthPx, size.heightPx, operation.radiusPx) : null;
      const shadowAmount = operation.shadowAmount / 100;
      const highlightAmount = operation.highlightAmount / 100;

      for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
        const local = mask ? mask[pixel] : luma(data[index], data[index + 1], data[index + 2]);
        const level = local / 255;
        const shadowWeight = Math.max(0, 1 - level / (operation.shadowTone / 100));
        const highlightWeight = Math.max(0, (level - (1 - operation.highlightTone / 100)) / Math.max(0.01, operation.highlightTone / 100));
        const gain = 1 + shadowAmount * shadowWeight - highlightAmount * Math.min(1, highlightWeight);
        if (gain === 1) continue;
        for (let channel = 0; channel < 3; channel += 1) data[index + channel] = clamp255(data[index + channel] * gain);
      }
      return;
    }

    case "replace_colour": {
      const target = [
        parseInt(operation.from.slice(1, 3), 16),
        parseInt(operation.from.slice(3, 5), 16),
        parseInt(operation.from.slice(5, 7), 16),
      ];
      for (let index = 0; index < data.length; index += 4) {
        const distance = Math.sqrt(
          (data[index] - target[0]) ** 2 + (data[index + 1] - target[1]) ** 2 + (data[index + 2] - target[2]) ** 2,
        ) / Math.sqrt(3);
        if (distance > operation.tolerance) continue;
        // Fading with distance is what stops a replaced colour leaving a hard rim where the
        // tolerance ended.
        const strength = 1 - distance / Math.max(1, operation.tolerance);

        const [hue, saturation, lightness] = toHsl(data[index], data[index + 1], data[index + 2]);
        const [r, g, b] = fromHsl(
          (hue + operation.hueShiftDeg * strength + 360) % 360,
          Math.max(0, Math.min(1, saturation + (operation.saturationShift / 100) * strength)),
          Math.max(0, Math.min(1, lightness + (operation.lightnessShift / 100) * strength)),
        );
        data[index] = clamp255(r);
        data[index + 1] = clamp255(g);
        data[index + 2] = clamp255(b);
      }
      return;
    }

    case "posterize": {
      const steps = operation.levels - 1;
      const table = new Uint8ClampedArray(256);
      for (let value = 0; value < 256; value += 1) table[value] = Math.round((value / 255) * steps) * (255 / steps);
      applyChannelTables(data, table, table, table);
      return;
    }

    case "threshold": {
      for (let index = 0; index < data.length; index += 4) {
        const value = luma(data[index], data[index + 1], data[index + 2]) >= operation.level ? 255 : 0;
        data[index] = value;
        data[index + 1] = value;
        data[index + 2] = value;
      }
      return;
    }

    case "invert": {
      for (let index = 0; index < data.length; index += 4) {
        data[index] = 255 - data[index];
        data[index + 1] = 255 - data[index + 1];
        data[index + 2] = 255 - data[index + 2];
      }
      return;
    }

    case "equalize": {
      const table = equalizeTable(data);
      for (let index = 0; index < data.length; index += 4) {
        const before = luma(data[index], data[index + 1], data[index + 2]);
        if (before <= 0) continue;
        // Scaling by the change in brightness keeps the colour: equalizing each channel apart
        // shifts hues, which is not what an equalize is for.
        const gain = table[Math.round(before)] / before;
        for (let channel = 0; channel < 3; channel += 1) data[index + channel] = clamp255(data[index + channel] * gain);
      }
      return;
    }
  }
}

/** Applies three per-channel tables at once, which is the fast path for most operators. */
function applyChannelTables(
  data: Uint8ClampedArray,
  red: Uint8ClampedArray, green: Uint8ClampedArray, blue: Uint8ClampedArray,
): void {
  for (let index = 0; index < data.length; index += 4) {
    data[index] = red[data[index]];
    data[index + 1] = green[data[index + 1]];
    data[index + 2] = blue[data[index + 2]];
  }
}

/** A blurred brightness map, used where a correction has to follow the shape of the picture. */
function blurredLuma(
  data: Uint8ClampedArray, widthPx: number, heightPx: number, radiusPx: number,
): Float32Array {
  const values = new Float32Array(widthPx * heightPx);
  for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
    values[pixel] = luma(data[index], data[index + 1], data[index + 2]);
  }
  const radius = Math.max(0, Math.round(radiusPx));
  if (radius === 0) return values;

  // A separable box blur, twice: enough to follow the shape without the cost of a Gaussian
  // over a full-resolution photograph.
  let source = values;
  let target = new Float32Array(values.length);
  for (let pass = 0; pass < 2; pass += 1) {
    for (let y = 0; y < heightPx; y += 1) {
      for (let x = 0; x < widthPx; x += 1) {
        let total = 0;
        let count = 0;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const sx = x + dx;
          if (sx < 0 || sx >= widthPx) continue;
          total += source[y * widthPx + sx];
          count += 1;
        }
        target[y * widthPx + x] = total / Math.max(1, count);
      }
    }
    [source, target] = [target, source];
    for (let x = 0; x < widthPx; x += 1) {
      for (let y = 0; y < heightPx; y += 1) {
        let total = 0;
        let count = 0;
        for (let dy = -radius; dy <= radius; dy += 1) {
          const sy = y + dy;
          if (sy < 0 || sy >= heightPx) continue;
          total += source[sy * widthPx + x];
          count += 1;
        }
        target[y * widthPx + x] = total / Math.max(1, count);
      }
    }
    [source, target] = [target, source];
  }
  return source;
}

/* --------------------------------- describing them --------------------------------- */

/** A sentence describing what an operator does, for the inspector and agent replies. */
export function describeColourOperation(operation: ColourOperation): string {
  switch (operation.kind) {
    case "exposure": {
      const parts: string[] = [];
      if (operation.exposureEv) parts.push(`${operation.exposureEv > 0 ? "+" : ""}${operation.exposureEv} stops`);
      if (operation.offset) parts.push(`an offset of ${operation.offset}`);
      if (operation.gamma !== 1) parts.push(`gamma ${operation.gamma}`);
      return parts.length ? `Exposure: ${parts.join(", ")}.` : "Exposure, unchanged.";
    }
    case "levels":
      return `Levels: black at ${operation.rgb.inBlack}, white at ${operation.rgb.inWhite}, gamma ${operation.rgb.gamma}.`;
    case "curves":
      return `A ${operation.channel === "rgb" ? "tone" : operation.channel} curve through ${operation.points.length} points.`;
    case "vibrance":
      return `Vibrance ${operation.vibrance > 0 ? "+" : ""}${operation.vibrance}, saturation ${operation.saturation > 0 ? "+" : ""}${operation.saturation}.`;
    case "colour_balance":
      return `Colour balance across shadows, midtones, and highlights${operation.preserveLuminosity ? ", keeping brightness where it was" : ""}.`;
    case "selective_colour":
      return `Selective colour on the ${operation.target}, ${operation.relative ? "relative" : "absolute"}.`;
    case "black_and_white":
      return operation.tint
        ? `Black and white, tinted towards ${operation.tint}.`
        : "Black and white, mixed from the colour channels.";
    case "channel_mixer":
      return `The ${operation.outputChannel} channel mixed from red ${operation.fromRed}%, green ${operation.fromGreen}%, blue ${operation.fromBlue}%.`;
    case "gradient_map":
      return `Brightness mapped onto a gradient of ${operation.stops.length} colours.`;
    case "photo_filter":
      return `A ${operation.colour} filter at ${Math.round(operation.density * 100)}% density.`;
    case "lut":
      return `The look “${operation.name}” at ${Math.round(operation.strength * 100)}% strength.`;
    case "shadows_highlights":
      return `Recovering ${operation.shadowAmount}% from the shadows and ${operation.highlightAmount}% from the highlights, judged over ${operation.radiusPx} px.`;
    case "replace_colour":
      return `Replacing colours near ${operation.from}, shifting hue by ${operation.hueShiftDeg}°.`;
    case "posterize":
      return `Posterised to ${operation.levels} levels.`;
    case "threshold":
      return `Threshold at ${operation.level}: everything above becomes white, everything below black.`;
    case "invert":
      return "Inverted.";
    case "equalize":
      return "Equalised, spreading the tones so every level is used.";
  }
}

/* ----------------------------------- profiles ----------------------------------- */

/**
 * A named starting point: how a camera's colour is interpreted, or a look applied over it.
 *
 * A profile is an ordered list of colour operations that runs *before* everything else on the
 * layer, which is what makes it a starting point rather than another effect. Editing after it
 * then means editing away from that starting point, exactly as a photographer expects.
 */
export const colourProfileSchema = z.object({
  schemaVersion: z.literal(COLOUR_OP_SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  /**
   * A camera profile interprets what the sensor recorded; a creative one is a look.
   *
   * They are the same shape and kept apart only so an interface can offer one of each: a
   * photograph has exactly one camera profile and may have any creative profile over it.
   */
  kind: z.enum(["camera", "creative"]),
  /** Which camera this was made for, when it is a camera profile. */
  camera: z.string().trim().max(120).nullable().default(null),
  operations: z.array(colourOperationSchema).min(1).max(8),
});
export type ColourProfile = z.infer<typeof colourProfileSchema>;

/**
 * A profile as it sits on a layer.
 *
 * The operations are copied here rather than referenced, and that is deliberate: a photograph
 * developed last month should not change because someone edited a profile today. Editing a
 * profile changes what new work starts from, not what old work already is.
 */
export const appliedProfileSchema = z.object({
  profileId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["camera", "creative"]),
  operations: z.array(colourOperationSchema).min(1).max(8),
  strength: z.number().min(0).max(1).default(1),
});
export type AppliedProfile = z.infer<typeof appliedProfileSchema>;

/**
 * Runs a profile's operations over a block of pixels.
 *
 * Below full strength the result is mixed back towards the original, rather than each
 * operation being weakened separately: half of a look is halfway to the look, not a look made
 * of half-strength parts, which is a different and usually worse picture.
 */
export function applyProfile(
  data: Uint8ClampedArray,
  profile: AppliedProfile,
  size?: { widthPx: number; heightPx: number },
): void {
  if (profile.strength <= 0) return;
  const original = profile.strength < 1 ? new Uint8ClampedArray(data) : null;
  for (const operation of profile.operations) applyColourOperation(data, operation, size);
  if (!original) return;
  for (let index = 0; index < data.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const at = index + channel;
      data[at] = original[at] + (data[at] - original[at]) * profile.strength;
    }
  }
}

export function describeProfile(profile: AppliedProfile): string {
  const what = profile.kind === "camera" ? "camera profile" : "look";
  const strength = profile.strength < 1 ? ` at ${Math.round(profile.strength * 100)}% strength` : "";
  return `The ${what} “${profile.name}”${strength}.`;
}
