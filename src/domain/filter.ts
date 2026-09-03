import { z } from "zod";
import { luma } from "./colour-op";
import { ProjectError } from "./project-error";

export const FILTER_SCHEMA_VERSION = 1 as const;

/**
 * Filters that need to see more than one pixel: blurs, sharpening, noise, distortion, and the
 * ones that break a picture into blocks.
 *
 * Kept apart from the colour operators because the difference is real rather than tidy. A
 * colour operator is a function from a colour to a colour, so it can be reduced to a lookup
 * table, run on a single pixel, and applied to a stream. Every one of these has to see a
 * neighbourhood, which decides how it is stored, how it is previewed, and what it costs.
 */

const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const filterOperationSchema = z.discriminatedUnion("kind", [
  /**
   * The blurs.
   *
   * One operator with a shape rather than six, because the parameters and the cost are the
   * same argument each time and the only thing that differs is which neighbours are averaged.
   */
  z.object({
    kind: z.literal("blur"),
    shape: z.enum([
      /** A weighted average, the ordinary soft blur. */
      "gaussian",
      /** A flat average: harsher, and much cheaper. */
      "box",
      /** Along a line, the way a moving subject smears. */
      "motion",
      /** Outwards from a centre, or around it. */
      "radial",
      /** Through a shaped aperture, which is what gives out-of-focus highlights their edges. */
      "lens",
      /** Averages only neighbours of a similar colour, so edges stay sharp. */
      "surface",
    ]).default("gaussian"),
    radiusPx: z.number().min(0).max(500).default(8),
    /** For motion blur, and for the direction of a radial zoom. */
    angleDeg: z.number().min(-180).max(180).default(0),
    /** For radial: spin turns about the centre, zoom streaks away from it. */
    radialMode: z.enum(["spin", "zoom"]).default("zoom"),
    centreX: z.number().min(0).max(1).default(0.5),
    centreY: z.number().min(0).max(1).default(0.5),
    /** For lens: how many sides the aperture has. Higher looks rounder. */
    blades: z.number().int().min(3).max(12).default(6),
    /** For surface: how different a neighbour may be and still be averaged in. */
    threshold: z.number().min(1).max(255).default(30),
  }),

  /**
   * Sharpening, in the three forms that differ in what they call detail.
   *
   * Unsharp mask subtracts a blurred copy; smart sharpen leaves flat areas alone so noise is
   * not amplified; high-pass keeps only the detail, for sharpening through a blend mode.
   */
  z.object({
    kind: z.literal("sharpen"),
    method: z.enum(["unsharp_mask", "smart", "high_pass"]).default("unsharp_mask"),
    amount: z.number().min(0).max(500).default(100),
    radiusPx: z.number().min(0.1).max(250).default(1),
    /** Below this much local difference, nothing is sharpened. Keeps noise out of it. */
    threshold: z.number().min(0).max(255).default(0),
  }),

  /**
   * Output sharpening, which is a different job from creative sharpening.
   *
   * Creative sharpening is a judgement about the picture; output sharpening compensates for
   * what a particular medium does to it, so it is stated as a medium and a size rather than as
   * an amount. Keeping them apart means resizing for the web does not undo the sharpening
   * chosen for print.
   */
  z.object({
    kind: z.literal("output_sharpen"),
    medium: z.enum(["screen", "glossy_paper", "matte_paper"]).default("screen"),
    amount: z.enum(["low", "standard", "high"]).default("standard"),
  }),

  z.object({
    kind: z.literal("noise"),
    mode: z.enum([
      /** Grain, either the same in every channel or different in each. */
      "add",
      /** Averages neighbours that are close in colour, keeping edges. */
      "reduce",
      /** Replaces a pixel with the median of its neighbours: removes specks outright. */
      "median",
      /** Finds isolated outliers and replaces only those. */
      "dust_and_scratches",
    ]).default("add"),
    amount: z.number().min(0).max(100).default(10),
    radiusPx: z.number().min(1).max(50).default(2),
    /** How far from its neighbours a pixel must be before it is treated as a speck. */
    threshold: z.number().min(0).max(255).default(20),
    /** Grain in all channels equally reads as film; per-channel reads as digital noise. */
    monochrome: z.boolean().default(true),
    /** Fixed, so a preview and its export get the same grain. */
    seed: z.number().int().min(0).max(2 ** 31).default(1),
  }),

  /**
   * The distortions: a coordinate change rather than a colour change.
   *
   * Every one of them maps an output pixel back to somewhere in the input, so they share one
   * loop and differ only in that map. Working backwards is what avoids holes where a
   * distortion spreads pixels apart.
   */
  z.object({
    kind: z.literal("distort"),
    shape: z.enum(["ripple", "wave", "twirl", "spherize", "pinch", "displace"]).default("ripple"),
    amount: z.number().min(-100).max(100).default(20),
    /** How many crests across the picture, for ripple and wave. */
    frequency: z.number().min(0.1).max(50).default(5),
    angleDeg: z.number().min(-180).max(180).default(0),
    centreX: z.number().min(0).max(1).default(0.5),
    centreY: z.number().min(0).max(1).default(0.5),
    radius: z.number().min(0.01).max(2).default(0.5),
  }),

  /**
   * The ones that break a picture into blocks.
   *
   * Grouped because they are one idea — replace a region with a single value — differing in
   * the shape of the region and what is drawn in it.
   */
  /**
   * A lens flare: the scatter a bright light causes inside a lens.
   *
   * A creative effect rather than a correction, unlike the lens *distortion* it sits beside,
   * which is why it is here with the filters and not with the geometry. The ghosts are placed
   * along the line from the light through the centre, because that is where a real lens puts
   * them — reflections between elements, mirrored about the optical axis.
   */
  z.object({
    kind: z.literal("flare"),
    /** Where the light is, as a fraction of the frame. */
    x: z.number().min(-1).max(2).default(0.7),
    y: z.number().min(-1).max(2).default(0.3),
    intensity: z.number().min(0).max(1).default(0.5),
    /** The width of the main bloom, as a fraction of the frame. */
    sizeRatio: z.number().min(0.01).max(2).default(0.4),
    colour: hexColour.default("#ffeecc"),
    /** How many reflections are cast back across the frame. */
    ghosts: z.number().int().min(0).max(8).default(4),
    /** The horizontal streak an anamorphic lens produces. */
    streak: z.number().min(0).max(1).default(0),
  }),
  z.object({
    kind: z.literal("pixelate"),
    shape: z.enum(["mosaic", "crystallize", "halftone", "pointillize"]).default("mosaic"),
    cellPx: z.number().min(2).max(500).default(12),
    angleDeg: z.number().min(-180).max(180).default(45),
    /** For halftone: the ink the dots are printed in. */
    colour: hexColour.default("#000000"),
    seed: z.number().int().min(0).max(2 ** 31).default(1),
  }),
]);
export type FilterOperation = z.infer<typeof filterOperationSchema>;
export type FilterOperationKind = FilterOperation["kind"];

/* --------------------------------- shared helpers --------------------------------- */

const clamp = (value: number, low: number, high: number): number =>
  (value < low ? low : value > high ? high : value);

/** Repeatable pseudo-randomness, so a preview and its export get the same grain. */
function noiseAt(seed: number, index: number): number {
  const value = Math.sin((index + 1) * 12.9898 + seed * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * A separable box blur, run enough times to approximate a Gaussian.
 *
 * Three passes are indistinguishable from a true Gaussian and cost a fraction of one on a
 * full-resolution photograph; separable means two passes per round rather than a square
 * kernel, which is what keeps the cost linear in the radius rather than quadratic.
 */
export function boxBlur(
  data: Uint8ClampedArray, widthPx: number, heightPx: number, radiusPx: number, passes = 1,
): Uint8ClampedArray {
  const radius = Math.max(0, Math.round(radiusPx));
  if (radius === 0) return data;

  let source = new Float32Array(data);
  let target = new Float32Array(data.length);

  for (let pass = 0; pass < passes; pass += 1) {
    for (let y = 0; y < heightPx; y += 1) {
      for (let x = 0; x < widthPx; x += 1) {
        for (let channel = 0; channel < 4; channel += 1) {
          let total = 0;
          let count = 0;
          for (let dx = -radius; dx <= radius; dx += 1) {
            const sx = x + dx;
            if (sx < 0 || sx >= widthPx) continue;
            total += source[(y * widthPx + sx) * 4 + channel];
            count += 1;
          }
          target[(y * widthPx + x) * 4 + channel] = total / count;
        }
      }
    }
    [source, target] = [target, source];

    for (let x = 0; x < widthPx; x += 1) {
      for (let y = 0; y < heightPx; y += 1) {
        for (let channel = 0; channel < 4; channel += 1) {
          let total = 0;
          let count = 0;
          for (let dy = -radius; dy <= radius; dy += 1) {
            const sy = y + dy;
            if (sy < 0 || sy >= heightPx) continue;
            total += source[(sy * widthPx + x) * 4 + channel];
            count += 1;
          }
          target[(y * widthPx + x) * 4 + channel] = total / count;
        }
      }
    }
    [source, target] = [target, source];
  }

  const result = new Uint8ClampedArray(data.length);
  for (let index = 0; index < result.length; index += 1) result[index] = source[index];
  return result;
}

/** Bilinear read, so a distortion does not come out blocky. */
function sample(
  data: Uint8ClampedArray, widthPx: number, heightPx: number, x: number, y: number, out: number[],
): void {
  const cx = clamp(x, 0, widthPx - 1);
  const cy = clamp(y, 0, heightPx - 1);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(widthPx - 1, x0 + 1);
  const y1 = Math.min(heightPx - 1, y0 + 1);
  const fx = cx - x0;
  const fy = cy - y0;

  for (let channel = 0; channel < 4; channel += 1) {
    const a = data[(y0 * widthPx + x0) * 4 + channel];
    const b = data[(y0 * widthPx + x1) * 4 + channel];
    const c = data[(y1 * widthPx + x0) * 4 + channel];
    const d = data[(y1 * widthPx + x1) * 4 + channel];
    out[channel] = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
}

/* ---------------------------------- the filters ---------------------------------- */

/**
 * Runs one filter over a block of pixels, in place.
 *
 * Every one of these reads a copy and writes the original, because a filter that fed on its own
 * output would spread rather than blur — the same reason the retouching brushes work from a
 * separate patch.
 */
export function applyFilter(
  data: Uint8ClampedArray, widthPx: number, heightPx: number, operation: FilterOperation,
): void {
  switch (operation.kind) {
    case "blur": return applyBlur(data, widthPx, heightPx, operation);
    case "sharpen": return applySharpen(data, widthPx, heightPx, operation);
    case "output_sharpen": {
      // Stated as a medium rather than an amount, because that is the judgement being made:
      // paper spreads ink, so it needs more than a screen does, and matte spreads more than
      // glossy.
      const byMedium = { screen: 0.6, glossy_paper: 1, matte_paper: 1.4 }[operation.medium];
      const byAmount = { low: 0.6, standard: 1, high: 1.6 }[operation.amount];
      return applySharpen(data, widthPx, heightPx, {
        kind: "sharpen", method: "unsharp_mask",
        amount: 80 * byMedium * byAmount, radiusPx: 0.8, threshold: 4,
      });
    }
    case "noise": return applyNoise(data, widthPx, heightPx, operation);
    case "flare": return applyFlare(data, widthPx, heightPx, operation);
    case "distort": return applyDistort(data, widthPx, heightPx, operation);
    case "pixelate": return applyPixelate(data, widthPx, heightPx, operation);
  }
}

function applyBlur(
  data: Uint8ClampedArray, widthPx: number, heightPx: number,
  operation: Extract<FilterOperation, { kind: "blur" }>,
): void {
  const radius = operation.radiusPx;
  if (radius <= 0) return;

  if (operation.shape === "box" || operation.shape === "gaussian") {
    // Gaussian is three box passes; box is one. Same code, one number apart.
    const blurred = boxBlur(data, widthPx, heightPx, radius, operation.shape === "gaussian" ? 3 : 1);
    data.set(blurred);
    return;
  }

  if (operation.shape === "surface") {
    // Averages only neighbours close in colour, so a surface smooths while an edge survives.
    const original = new Uint8ClampedArray(data);
    const reach = Math.max(1, Math.round(radius));
    for (let y = 0; y < heightPx; y += 1) {
      for (let x = 0; x < widthPx; x += 1) {
        const target = (y * widthPx + x) * 4;
        const totals = [0, 0, 0];
        let count = 0;
        for (let dy = -reach; dy <= reach; dy += 1) {
          for (let dx = -reach; dx <= reach; dx += 1) {
            const sx = x + dx;
            const sy = y + dy;
            if (sx < 0 || sx >= widthPx || sy < 0 || sy >= heightPx) continue;
            const source = (sy * widthPx + sx) * 4;
            const difference = Math.max(
              Math.abs(original[source] - original[target]),
              Math.abs(original[source + 1] - original[target + 1]),
              Math.abs(original[source + 2] - original[target + 2]),
            );
            if (difference > operation.threshold) continue;
            totals[0] += original[source];
            totals[1] += original[source + 1];
            totals[2] += original[source + 2];
            count += 1;
          }
        }
        if (!count) continue;
        for (let channel = 0; channel < 3; channel += 1) data[target + channel] = totals[channel] / count;
      }
    }
    return;
  }

  // Motion, radial, and lens are all "average along a path", differing only in the path. One
  // loop with three ways of choosing the samples keeps them honest with each other.
  const original = new Uint8ClampedArray(data);
  // Motion and radial sample along a line, so their count scales with the length. A lens
  // samples an area, so its count has to scale with the area — a handful of samples spread
  // over a disc leaves gaps a bright point falls straight through.
  const steps = operation.shape === "lens"
    ? Math.max(16, Math.min(256, Math.round((Math.PI * radius * radius) / 2)))
    : Math.max(2, Math.min(64, Math.round(radius * 2)));
  const cx = operation.centreX * widthPx;
  const cy = operation.centreY * heightPx;
  const radians = (operation.angleDeg * Math.PI) / 180;
  const read = [0, 0, 0, 0];

  for (let y = 0; y < heightPx; y += 1) {
    for (let x = 0; x < widthPx; x += 1) {
      const totals = [0, 0, 0, 0];
      for (let step = 0; step < steps; step += 1) {
        const t = steps === 1 ? 0 : step / (steps - 1) - 0.5;
        let sx = x;
        let sy = y;

        if (operation.shape === "motion") {
          sx = x + Math.cos(radians) * t * radius * 2;
          sy = y + Math.sin(radians) * t * radius * 2;
        } else if (operation.shape === "radial") {
          const dx = x - cx;
          const dy = y - cy;
          if (operation.radialMode === "zoom") {
            const scale = 1 + (t * radius) / Math.max(1, Math.hypot(widthPx, heightPx) / 2);
            sx = cx + dx * scale;
            sy = cy + dy * scale;
          } else {
            const spin = (t * radius) / Math.max(1, Math.hypot(dx, dy));
            const cos = Math.cos(spin);
            const sin = Math.sin(spin);
            sx = cx + dx * cos - dy * sin;
            sy = cy + dx * sin + dy * cos;
          }
        } else {
          // A lens aperture: samples spread across a polygon rather than a disc, which is what
          // gives an out-of-focus highlight its straight edges. They have to fill the shape
          // rather than trace its rim, or a small bright point would be hollowed out instead
          // of spread.
          const sides = operation.blades;
          const segment = (Math.PI * 2) / sides;
          // A sunflower spiral: even coverage of the area from a single index, with no
          // clustering at the centre.
          // Starting at zero puts one sample at the centre, so a single bright pixel is
          // spread rather than erased.
          const spiral = steps === 1 ? 0 : step / (steps - 1);
          const angle = step * 2.39996;
          const edge = Math.cos(Math.PI / sides) / Math.cos(((angle % segment) - segment / 2));
          const distance = Math.sqrt(spiral) * radius * edge;
          sx = x + Math.cos(angle) * distance;
          sy = y + Math.sin(angle) * distance;
        }

        sample(original, widthPx, heightPx, sx, sy, read);
        for (let channel = 0; channel < 4; channel += 1) totals[channel] += read[channel];
      }
      const target = (y * widthPx + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) data[target + channel] = totals[channel] / steps;
    }
  }
}

function applySharpen(
  data: Uint8ClampedArray, widthPx: number, heightPx: number,
  operation: Extract<FilterOperation, { kind: "sharpen" }>,
): void {
  const original = new Uint8ClampedArray(data);
  // Every method needs the same blurred copy: sharpening is the difference between a picture
  // and a softer version of itself, whatever the method chooses to do with that difference.
  const blurred = boxBlur(original, widthPx, heightPx, operation.radiusPx, 3);
  const amount = operation.amount / 100;

  for (let index = 0; index < data.length; index += 4) {
    let detail = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      detail = Math.max(detail, Math.abs(original[index + channel] - blurred[index + channel]));
    }

    if (operation.method === "high_pass") {
      // Only the detail, around mid-grey: laid over the picture with a blend mode, this is
      // what a high-pass sharpen is.
      for (let channel = 0; channel < 3; channel += 1) {
        data[index + channel] = 128 + (original[index + channel] - blurred[index + channel]) * amount;
      }
      continue;
    }

    // Below the threshold nothing happens, which is what keeps a sharpen out of the noise in
    // a flat sky. Smart sharpen additionally eases in, so there is no visible step at the
    // threshold itself.
    if (detail < operation.threshold) continue;
    const strength = operation.method === "smart"
      ? amount * Math.min(1, (detail - operation.threshold) / Math.max(1, operation.threshold || 32))
      : amount;

    for (let channel = 0; channel < 3; channel += 1) {
      data[index + channel] = original[index + channel]
        + (original[index + channel] - blurred[index + channel]) * strength;
    }
  }
}

function applyNoise(
  data: Uint8ClampedArray, widthPx: number, heightPx: number,
  operation: Extract<FilterOperation, { kind: "noise" }>,
): void {
  if (operation.mode === "add") {
    const amount = (operation.amount / 100) * 255;
    for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
      if (operation.monochrome) {
        const shift = (noiseAt(operation.seed, pixel) - 0.5) * amount;
        for (let channel = 0; channel < 3; channel += 1) data[index + channel] += shift;
      } else {
        for (let channel = 0; channel < 3; channel += 1) {
          data[index + channel] += (noiseAt(operation.seed, pixel * 3 + channel) - 0.5) * amount;
        }
      }
    }
    return;
  }

  const original = new Uint8ClampedArray(data);
  const reach = Math.max(1, Math.round(operation.radiusPx));

  for (let y = 0; y < heightPx; y += 1) {
    for (let x = 0; x < widthPx; x += 1) {
      const target = (y * widthPx + x) * 4;

      if (operation.mode === "reduce") {
        // The same edge-preserving average the surface blur uses, at a strength rather than
        // as a replacement, so texture survives while grain goes.
        const totals = [0, 0, 0];
        let count = 0;
        for (let dy = -reach; dy <= reach; dy += 1) {
          for (let dx = -reach; dx <= reach; dx += 1) {
            const sx = x + dx;
            const sy = y + dy;
            if (sx < 0 || sx >= widthPx || sy < 0 || sy >= heightPx) continue;
            const source = (sy * widthPx + sx) * 4;
            if (Math.abs(luma(original[source], original[source + 1], original[source + 2])
              - luma(original[target], original[target + 1], original[target + 2])) > operation.threshold) continue;
            for (let channel = 0; channel < 3; channel += 1) totals[channel] += original[source + channel];
            count += 1;
          }
        }
        if (!count) continue;
        const strength = operation.amount / 100;
        for (let channel = 0; channel < 3; channel += 1) {
          data[target + channel] = original[target + channel]
            + (totals[channel] / count - original[target + channel]) * strength;
        }
        continue;
      }

      // Median and dust-and-scratches both need the sorted neighbourhood. The difference is
      // that a median replaces every pixel while dust-and-scratches replaces only the ones
      // that stand out — which is what keeps real detail from being smoothed away.
      for (let channel = 0; channel < 3; channel += 1) {
        const window: number[] = [];
        for (let dy = -reach; dy <= reach; dy += 1) {
          for (let dx = -reach; dx <= reach; dx += 1) {
            const sx = x + dx;
            const sy = y + dy;
            if (sx < 0 || sx >= widthPx || sy < 0 || sy >= heightPx) continue;
            window.push(original[(sy * widthPx + sx) * 4 + channel]);
          }
        }
        window.sort((a, b) => a - b);
        const median = window[window.length >> 1];
        if (operation.mode === "median") data[target + channel] = median;
        else if (Math.abs(original[target + channel] - median) > operation.threshold) {
          data[target + channel] = median;
        }
      }
    }
  }
}

/**
 * Adds light rather than changing it: a flare is scattered light, so it only ever brightens.
 *
 * Screen blending would be more faithful still, but adding is what the eye reads as glare and
 * it cannot darken anything, which is the property that matters — a flare that dimmed part of
 * the picture would look like a bug.
 */
function applyFlare(
  data: Uint8ClampedArray, widthPx: number, heightPx: number,
  operation: Extract<FilterOperation, { kind: "flare" }>,
): void {
  if (operation.intensity <= 0) return;
  const cx = widthPx / 2;
  const cy = heightPx / 2;
  const lightX = operation.x * widthPx;
  const lightY = operation.y * heightPx;
  const reach = operation.sizeRatio * Math.max(widthPx, heightPx);
  const ink = [
    parseInt(operation.colour.slice(1, 3), 16),
    parseInt(operation.colour.slice(3, 5), 16),
    parseInt(operation.colour.slice(5, 7), 16),
  ];

  // The light itself, then its reflections mirrored through the centre — which is where a
  // real lens puts them.
  const sources: { x: number; y: number; radius: number; strength: number }[] = [
    { x: lightX, y: lightY, radius: reach, strength: 1 },
  ];
  for (let ghost = 1; ghost <= operation.ghosts; ghost += 1) {
    const t = ghost / (operation.ghosts + 1);
    sources.push({
      x: lightX + (cx - lightX) * 2 * t,
      y: lightY + (cy - lightY) * 2 * t,
      radius: reach * (0.12 + 0.18 * ((ghost % 3) + 1) / 3),
      strength: 0.25 / ghost,
    });
  }

  for (let y = 0; y < heightPx; y += 1) {
    for (let x = 0; x < widthPx; x += 1) {
      let added = 0;
      for (const source of sources) {
        const distance = Math.hypot(x - source.x, y - source.y);
        if (distance >= source.radius) continue;
        const falloff = 1 - distance / source.radius;
        added += falloff * falloff * source.strength;
      }
      if (operation.streak > 0) {
        // An anamorphic streak: bright along the light's own row, falling away from it.
        const across = Math.abs(y - lightY) / Math.max(1, reach * 0.06);
        if (across < 1) added += (1 - across) * (1 - across) * operation.streak * 0.6;
      }
      if (added <= 0) continue;

      const gain = Math.min(1, added) * operation.intensity;
      const target = (y * widthPx + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        data[target + channel] += ink[channel] * gain;
      }
    }
  }
}

function applyDistort(
  data: Uint8ClampedArray, widthPx: number, heightPx: number,
  operation: Extract<FilterOperation, { kind: "distort" }>,
): void {
  const original = new Uint8ClampedArray(data);
  const amount = operation.amount;
  if (amount === 0) return;

  const cx = operation.centreX * widthPx;
  const cy = operation.centreY * heightPx;
  const reach = operation.radius * Math.max(widthPx, heightPx) / 2;
  const radians = (operation.angleDeg * Math.PI) / 180;
  const read = [0, 0, 0, 0];

  for (let y = 0; y < heightPx; y += 1) {
    for (let x = 0; x < widthPx; x += 1) {
      let sx = x;
      let sy = y;
      const dx = x - cx;
      const dy = y - cy;
      const distance = Math.hypot(dx, dy);

      switch (operation.shape) {
        case "ripple": {
          // Rings out from the centre, so it reads as something dropped in water.
          const wave = Math.sin((distance / Math.max(1, reach)) * operation.frequency * Math.PI * 2);
          const scale = distance === 0 ? 0 : (wave * amount) / distance;
          sx = x + dx * scale;
          sy = y + dy * scale;
          break;
        }
        case "wave": {
          // Along one direction, so it reads as a flag or a reflection.
          const along = x * Math.cos(radians) + y * Math.sin(radians);
          const offset = Math.sin((along / Math.max(1, widthPx)) * operation.frequency * Math.PI * 2) * amount;
          sx = x - Math.sin(radians) * offset;
          sy = y + Math.cos(radians) * offset;
          break;
        }
        case "twirl": {
          // Full turn at the centre, none at the edge, so the picture is not torn.
          if (distance > reach) break;
          const strength = (1 - distance / reach) ** 2 * (amount / 100) * Math.PI;
          const cos = Math.cos(strength);
          const sin = Math.sin(strength);
          sx = cx + dx * cos - dy * sin;
          sy = cy + dx * sin + dy * cos;
          break;
        }
        case "spherize":
        case "pinch": {
          if (distance > reach || distance === 0) break;
          const normalised = distance / reach;
          const sign = operation.shape === "pinch" ? -1 : 1;
          // Reading closer to the centre magnifies, reading further shrinks — which is a
          // sphere and a pinch, one sign apart.
          const factor = 1 - sign * (amount / 100) * (1 - normalised) * (1 - normalised);
          sx = cx + dx * factor;
          sy = cy + dy * factor;
          break;
        }
        case "displace": {
          // Displaced by the picture's own brightness, which needs no second image and gives
          // a result that follows what is actually there.
          const here = (y * widthPx + x) * 4;
          const level = (luma(original[here], original[here + 1], original[here + 2]) - 128) / 128;
          sx = x + level * amount;
          sy = y + level * amount;
          break;
        }
      }

      sample(original, widthPx, heightPx, sx, sy, read);
      const target = (y * widthPx + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) data[target + channel] = read[channel];
    }
  }
}

function applyPixelate(
  data: Uint8ClampedArray, widthPx: number, heightPx: number,
  operation: Extract<FilterOperation, { kind: "pixelate" }>,
): void {
  const original = new Uint8ClampedArray(data);
  const cell = Math.max(2, Math.round(operation.cellPx));

  if (operation.shape === "mosaic") {
    for (let by = 0; by < heightPx; by += cell) {
      for (let bx = 0; bx < widthPx; bx += cell) {
        const totals = [0, 0, 0, 0];
        let count = 0;
        for (let y = by; y < Math.min(heightPx, by + cell); y += 1) {
          for (let x = bx; x < Math.min(widthPx, bx + cell); x += 1) {
            const source = (y * widthPx + x) * 4;
            for (let channel = 0; channel < 4; channel += 1) totals[channel] += original[source + channel];
            count += 1;
          }
        }
        if (!count) continue;
        for (let y = by; y < Math.min(heightPx, by + cell); y += 1) {
          for (let x = bx; x < Math.min(widthPx, bx + cell); x += 1) {
            const target = (y * widthPx + x) * 4;
            for (let channel = 0; channel < 4; channel += 1) data[target + channel] = totals[channel] / count;
          }
        }
      }
    }
    return;
  }

  if (operation.shape === "halftone") {
    // A dot per cell, sized by how dark the cell is: what a printing screen does, and the
    // reason the angle matters.
    const ink = [
      parseInt(operation.colour.slice(1, 3), 16),
      parseInt(operation.colour.slice(3, 5), 16),
      parseInt(operation.colour.slice(5, 7), 16),
    ];
    const radians = (operation.angleDeg * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);

    for (let y = 0; y < heightPx; y += 1) {
      for (let x = 0; x < widthPx; x += 1) {
        // Rotating the grid rather than the picture is what lets the screen sit at an angle
        // without the image being resampled.
        const rx = x * cos + y * sin;
        const ry = -x * sin + y * cos;
        const cellX = Math.floor(rx / cell) * cell + cell / 2;
        const cellY = Math.floor(ry / cell) * cell + cell / 2;
        const centreX = cellX * cos - cellY * sin;
        const centreY = cellX * sin + cellY * cos;
        const source = (clamp(Math.round(centreY), 0, heightPx - 1) * widthPx
          + clamp(Math.round(centreX), 0, widthPx - 1)) * 4;
        const darkness = 1 - luma(original[source], original[source + 1], original[source + 2]) / 255;
        const dot = Math.sqrt(darkness) * (cell / 2) * 1.15;
        const inside = Math.hypot(rx - cellX, ry - cellY) <= dot;

        const target = (y * widthPx + x) * 4;
        for (let channel = 0; channel < 3; channel += 1) data[target + channel] = inside ? ink[channel] : 255;
        data[target + 3] = original[target + 3];
      }
    }
    return;
  }

  // Crystallize and pointillize both scatter a cell centre and take the colour there; they
  // differ in whether the space between centres is filled or left white.
  const jitter = (cellX: number, cellY: number, axis: number): number =>
    (noiseAt(operation.seed, cellX * 7919 + cellY * 104729 + axis) - 0.5) * cell;

  for (let y = 0; y < heightPx; y += 1) {
    for (let x = 0; x < widthPx; x += 1) {
      const cellX = Math.floor(x / cell);
      const cellY = Math.floor(y / cell);
      let bestDistance = Infinity;
      let bestSource = (y * widthPx + x) * 4;

      // The nearest scattered centre among this cell and its neighbours, which is what makes
      // the shapes irregular rather than square.
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = cellX + dx;
          const ny = cellY + dy;
          const px = (nx + 0.5) * cell + jitter(nx, ny, 0);
          const py = (ny + 0.5) * cell + jitter(nx, ny, 1);
          const distance = (px - x) ** 2 + (py - y) ** 2;
          if (distance >= bestDistance) continue;
          bestDistance = distance;
          bestSource = (clamp(Math.round(py), 0, heightPx - 1) * widthPx + clamp(Math.round(px), 0, widthPx - 1)) * 4;
        }
      }

      const target = (y * widthPx + x) * 4;
      if (operation.shape === "pointillize" && Math.sqrt(bestDistance) > cell * 0.4) {
        // Between the dots, the paper shows through.
        data[target] = 255;
        data[target + 1] = 255;
        data[target + 2] = 255;
        continue;
      }
      for (let channel = 0; channel < 3; channel += 1) data[target + channel] = original[bestSource + channel];
    }
  }
}

/* --------------------------------- describing them --------------------------------- */

export function assertFilterCost(operation: FilterOperation, widthPx: number, heightPx: number): void {
  // A surface blur or a median is quadratic in its radius, so a large one on a large picture
  // is minutes rather than seconds. Refusing is better than appearing to hang.
  const pixels = widthPx * heightPx;
  const radius = operation.kind === "blur" && operation.shape === "surface" ? operation.radiusPx
    : operation.kind === "noise" && operation.mode !== "add" ? operation.radiusPx
      : 0;
  if (radius > 0 && pixels * (radius * 2 + 1) ** 2 > 4e10) {
    throw new ProjectError(
      "INVALID_INPUT",
      `A radius of ${Math.round(radius)} px on a ${widthPx} × ${heightPx} image would take minutes. Use a smaller radius, or work on a smaller copy.`,
      { fieldPath: "radiusPx" },
    );
  }
}

const BLUR_LABELS: Record<string, string> = {
  gaussian: "a soft blur", box: "a box blur", motion: "motion blur",
  radial: "a radial blur", lens: "a lens blur", surface: "a surface blur",
};

export function describeFilter(operation: FilterOperation): string {
  switch (operation.kind) {
    case "blur":
      return operation.shape === "motion"
        ? `Motion blur of ${Math.round(operation.radiusPx)} px at ${operation.angleDeg}°.`
        : operation.shape === "radial"
          ? `A radial ${operation.radialMode} of ${Math.round(operation.radiusPx)} px.`
          : `${BLUR_LABELS[operation.shape][0].toUpperCase()}${BLUR_LABELS[operation.shape].slice(1)} of ${Math.round(operation.radiusPx)} px.`;
    case "sharpen":
      return operation.method === "high_pass"
        ? `A high-pass of ${operation.radiusPx} px, for sharpening through a blend mode.`
        : `${operation.method === "smart" ? "Smart sharpening" : "An unsharp mask"} at ${Math.round(operation.amount)}% over ${operation.radiusPx} px.`;
    case "output_sharpen":
      return `Output sharpening for ${operation.medium.replace("_", " ")}, ${operation.amount}.`;
    case "noise":
      return operation.mode === "add"
        ? `${operation.monochrome ? "Film-like" : "Coloured"} grain at ${operation.amount}%.`
        : operation.mode === "median"
          ? `A median of ${operation.radiusPx} px, which removes specks outright.`
          : operation.mode === "dust_and_scratches"
            ? `Removing specks that stand more than ${operation.threshold} from their surroundings.`
            : `Reducing noise by ${operation.amount}% while keeping edges.`;
    case "distort":
      return `A ${operation.shape} of ${Math.round(Math.abs(operation.amount))}%.`;
    case "flare":
      return `A lens flare at ${Math.round(operation.x * 100)}%, ${Math.round(operation.y * 100)}% of the frame, ${Math.round(operation.intensity * 100)}% strong${operation.ghosts ? ` with ${operation.ghosts} ghosts` : ""}.`;
    case "pixelate":
      return `${operation.shape[0].toUpperCase()}${operation.shape.slice(1)} at ${Math.round(operation.cellPx)} px cells.`;
  }
}
