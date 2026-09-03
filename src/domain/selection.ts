import { z } from "zod";
import { ProjectError } from "./project-error";
import { toCommands, type Shape } from "./vector";

export const SELECTION_SCHEMA_VERSION = 1 as const;

/**
 * What part of the document an edit applies to.
 *
 * A selection is coverage per pixel, from 0 to 255, not a boolean region. That matters: a
 * feathered edge, an anti-aliased curve, and a partially selected colour range are all
 * partial coverage, and a binary mask would turn every one of them into a staircase. Every
 * operation here preserves partial values rather than thresholding them.
 *
 * The mask is kept apart from the document. Nothing is ever destroyed by selecting, and a
 * selection can be saved, reloaded, inverted, or thrown away without touching a pixel.
 */

export const selectionModeSchema = z.enum(["replace", "add", "subtract", "intersect"]);
export type SelectionMode = z.infer<typeof selectionModeSchema>;

/** How a selection was made, kept so it can be described and re-run. */
export const selectionSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("marquee"),
    shape: z.enum(["rectangle", "ellipse"]),
    x: z.number(), y: z.number(), width: z.number().min(0), height: z.number().min(0),
    featherPx: z.number().min(0).max(500).default(0),
  }),
  z.object({
    kind: z.literal("lasso"),
    points: z.array(z.object({ x: z.number(), y: z.number() })).min(3).max(20_000),
    featherPx: z.number().min(0).max(500).default(0),
  }),
  z.object({
    kind: z.literal("wand"),
    x: z.number().int().min(0), y: z.number().int().min(0),
    tolerance: z.number().min(0).max(255).default(32),
    contiguous: z.boolean().default(true),
  }),
  z.object({
    kind: z.literal("colour_range"),
    colour: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    tolerance: z.number().min(0).max(255).default(32),
  }),
  z.object({
    kind: z.literal("luminance_range"),
    low: z.number().min(0).max(255),
    high: z.number().min(0).max(255),
    softness: z.number().min(0).max(128).default(0),
  }),
  z.object({ kind: z.literal("layer_alpha"), layerId: z.string().min(1) }),
  z.object({ kind: z.literal("path") }),
  z.object({ kind: z.literal("all") }),
]);
export type SelectionSource = z.infer<typeof selectionSourceSchema>;

/** A named selection stored with the project, so it survives a reload. */
export const savedSelectionSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(SELECTION_SCHEMA_VERSION),
  name: z.string().trim().min(1).max(80),
  widthPx: z.number().int().min(1).max(32768),
  heightPx: z.number().int().min(1).max(32768),
  /** How many pixels it covers, so a list can be shown without loading every mask. */
  areaPx: z.number().min(0),
  source: selectionSourceSchema,
  createdAt: z.string().datetime(),
});
export type SavedSelection = z.infer<typeof savedSelectionSchema>;

/* --------------------------------- the mask ---------------------------------- */

export interface SelectionMask {
  widthPx: number;
  heightPx: number;
  /** One byte of coverage per pixel: 0 excluded, 255 fully selected. */
  coverage: Uint8Array;
}

export function createMask(widthPx: number, heightPx: number, fill = 0): SelectionMask {
  if (widthPx < 1 || heightPx < 1) {
    throw new ProjectError("INVALID_INPUT", "A selection needs a positive size.", { fieldPath: "size" });
  }
  const coverage = new Uint8Array(widthPx * heightPx);
  if (fill) coverage.fill(Math.max(0, Math.min(255, fill)));
  return { widthPx, heightPx, coverage };
}

function assertSameSize(a: SelectionMask, b: SelectionMask): void {
  if (a.widthPx !== b.widthPx || a.heightPx !== b.heightPx) {
    throw new ProjectError("INVALID_INPUT", "Those selections describe documents of different sizes.", { fieldPath: "selection" });
  }
}

/**
 * Combines two selections.
 *
 * The arithmetic is chosen so partial coverage survives: add takes the larger, subtract
 * removes proportionally, and intersect takes the smaller. Using booleans would collapse a
 * feathered edge to a hard one the first time a user added to a selection.
 */
export function combine(base: SelectionMask, incoming: SelectionMask, mode: SelectionMode): SelectionMask {
  if (mode === "replace") return { ...incoming, coverage: new Uint8Array(incoming.coverage) };
  assertSameSize(base, incoming);
  const coverage = new Uint8Array(base.coverage.length);
  for (let index = 0; index < coverage.length; index += 1) {
    const a = base.coverage[index];
    const b = incoming.coverage[index];
    coverage[index] = mode === "add" ? Math.max(a, b)
      : mode === "subtract" ? Math.max(0, a - b)
        : Math.min(a, b);
  }
  return { widthPx: base.widthPx, heightPx: base.heightPx, coverage };
}

export function invert(mask: SelectionMask): SelectionMask {
  const coverage = new Uint8Array(mask.coverage.length);
  for (let index = 0; index < coverage.length; index += 1) coverage[index] = 255 - mask.coverage[index];
  return { ...mask, coverage };
}

/** How much is selected, in whole pixels, counting partial coverage proportionally. */
export function selectedArea(mask: SelectionMask): number {
  let total = 0;
  for (const value of mask.coverage) total += value;
  return total / 255;
}

export function isEmpty(mask: SelectionMask): boolean {
  return mask.coverage.every((value) => value === 0);
}

/** The box enclosing everything selected, or null when nothing is. */
export function selectionBounds(mask: SelectionMask): { x: number; y: number; width: number; height: number } | null {
  let minX = mask.widthPx;
  let minY = mask.heightPx;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < mask.heightPx; y += 1) {
    for (let x = 0; x < mask.widthPx; x += 1) {
      if (!mask.coverage[y * mask.widthPx + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/* -------------------------------- making them -------------------------------- */

/** Anti-aliased coverage for a rectangle or ellipse, so an edge is smooth rather than stepped. */
export function marqueeMask(
  widthPx: number, heightPx: number,
  source: Extract<SelectionSource, { kind: "marquee" }>,
): SelectionMask {
  const mask = createMask(widthPx, heightPx);
  const { x, y, width, height } = source;
  const cx = x + width / 2;
  const cy = y + height / 2;
  const rx = width / 2;
  const ry = height / 2;

  for (let row = 0; row < heightPx; row += 1) {
    for (let column = 0; column < widthPx; column += 1) {
      // Sampling at the pixel centre, and softening across one pixel, is what removes the
      // staircase without needing a separate anti-aliasing pass.
      const px = column + 0.5;
      const py = row + 0.5;
      let coverage: number;
      if (source.shape === "rectangle") {
        const insideX = Math.min(px - x, x + width - px);
        const insideY = Math.min(py - y, y + height - py);
        coverage = Math.max(0, Math.min(1, insideX + 0.5)) * Math.max(0, Math.min(1, insideY + 0.5));
      } else {
        if (rx <= 0 || ry <= 0) coverage = 0;
        else {
          const distance = Math.hypot((px - cx) / rx, (py - cy) / ry);
          const softness = 1 / Math.max(rx, ry);
          coverage = Math.max(0, Math.min(1, (1 - distance) / softness + 0.5));
        }
      }
      mask.coverage[row * widthPx + column] = Math.round(coverage * 255);
    }
  }
  return source.featherPx > 0 ? feather(mask, source.featherPx) : mask;
}

/** Coverage for any closed polygon, which is what every lasso produces. */
export function lassoMask(
  widthPx: number, heightPx: number,
  source: Extract<SelectionSource, { kind: "lasso" }>,
): SelectionMask {
  const mask = createMask(widthPx, heightPx);
  const points = source.points;

  // Even-odd crossing test at the pixel centre. Simple, and correct for self-intersecting
  // outlines, which a freehand lasso produces constantly.
  for (let row = 0; row < heightPx; row += 1) {
    const py = row + 0.5;
    for (let column = 0; column < widthPx; column += 1) {
      const px = column + 0.5;
      let inside = false;
      for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
        const a = points[index];
        const b = points[previous];
        const crosses = a.y > py !== b.y > py
          && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x;
        if (crosses) inside = !inside;
      }
      mask.coverage[row * widthPx + column] = inside ? 255 : 0;
    }
  }
  return source.featherPx > 0 ? feather(mask, source.featherPx) : mask;
}

/** A selection from a vector path, by way of the polygon its commands describe. */
export function pathMask(widthPx: number, heightPx: number, shape: Shape, featherPx = 0): SelectionMask {
  const points: { x: number; y: number }[] = [];
  for (const command of toCommands(shape)) {
    if (command.kind === "close") continue;
    // Curves are sampled at their endpoints and control points, which is enough for a
    // selection and avoids a curve flattener this does not otherwise need.
    if (command.kind === "cubic") points.push({ x: command.x1, y: command.y1 }, { x: command.x2, y: command.y2 });
    if (command.kind === "quadratic") points.push({ x: command.x1, y: command.y1 });
    points.push({ x: command.x, y: command.y });
  }
  if (points.length < 3) {
    throw new ProjectError("INVALID_INPUT", "That path does not enclose an area to select.", { fieldPath: "shape" });
  }
  return lassoMask(widthPx, heightPx, { kind: "lasso", points, featherPx });
}

/** Pixel access for the selection tools that read the composited image. */
export interface PixelSource {
  widthPx: number;
  heightPx: number;
  /** RGBA, four bytes per pixel, row-major. */
  data: Uint8ClampedArray;
}

function colourDistance(data: Uint8ClampedArray, a: number, b: number): number {
  const dr = data[a] - data[b];
  const dg = data[a + 1] - data[b + 1];
  const db = data[a + 2] - data[b + 2];
  // Euclidean in RGB, scaled back to a 0-255 range so tolerance reads as "how different".
  return Math.sqrt(dr * dr + dg * dg + db * db) / Math.sqrt(3);
}

/**
 * Selects pixels similar to the one clicked.
 *
 * Contiguous mode floods outwards from the click; non-contiguous takes every matching pixel
 * in the image. The flood is iterative rather than recursive, because a recursive fill
 * overflows the stack on a large photograph — which is exactly when someone would use it.
 */
export function wandMask(
  pixels: PixelSource,
  source: Extract<SelectionSource, { kind: "wand" }>,
): SelectionMask {
  const { widthPx, heightPx, data } = pixels;
  if (source.x >= widthPx || source.y >= heightPx) {
    throw new ProjectError("INVALID_INPUT", "That point is outside the image.", { fieldPath: "x" });
  }
  const mask = createMask(widthPx, heightPx);
  const seed = (source.y * widthPx + source.x) * 4;

  if (!source.contiguous) {
    for (let index = 0; index < widthPx * heightPx; index += 1) {
      const distance = colourDistance(data, index * 4, seed);
      if (distance <= source.tolerance) {
        // Coverage falls off across the tolerance band, so an edge is soft rather than jagged.
        mask.coverage[index] = Math.round(255 * (1 - distance / Math.max(1, source.tolerance)));
      }
    }
    return mask;
  }

  const queue: number[] = [source.y * widthPx + source.x];
  const visited = new Uint8Array(widthPx * heightPx);
  visited[queue[0]] = 1;

  while (queue.length) {
    const index = queue.pop()!;
    const distance = colourDistance(data, index * 4, seed);
    if (distance > source.tolerance) continue;
    mask.coverage[index] = Math.round(255 * (1 - distance / Math.max(1, source.tolerance)));

    const x = index % widthPx;
    const y = (index - x) / widthPx;
    const neighbours = [
      x > 0 ? index - 1 : -1,
      x < widthPx - 1 ? index + 1 : -1,
      y > 0 ? index - widthPx : -1,
      y < heightPx - 1 ? index + widthPx : -1,
    ];
    for (const neighbour of neighbours) {
      if (neighbour < 0 || visited[neighbour]) continue;
      visited[neighbour] = 1;
      queue.push(neighbour);
    }
  }
  return mask;
}

/** Selects every pixel near a colour, wherever it appears. */
export function colourRangeMask(
  pixels: PixelSource,
  source: Extract<SelectionSource, { kind: "colour_range" }>,
): SelectionMask {
  const mask = createMask(pixels.widthPx, pixels.heightPx);
  const target = [
    parseInt(source.colour.slice(1, 3), 16),
    parseInt(source.colour.slice(3, 5), 16),
    parseInt(source.colour.slice(5, 7), 16),
  ];
  for (let index = 0; index < mask.coverage.length; index += 1) {
    const offset = index * 4;
    const dr = pixels.data[offset] - target[0];
    const dg = pixels.data[offset + 1] - target[1];
    const db = pixels.data[offset + 2] - target[2];
    const distance = Math.sqrt(dr * dr + dg * dg + db * db) / Math.sqrt(3);
    if (distance <= source.tolerance) {
      mask.coverage[index] = Math.round(255 * (1 - distance / Math.max(1, source.tolerance)));
    }
  }
  return mask;
}

/** Selects by brightness, which is how a sky or a shadow is picked out. */
export function luminanceRangeMask(
  pixels: PixelSource,
  source: Extract<SelectionSource, { kind: "luminance_range" }>,
): SelectionMask {
  if (source.high < source.low) {
    throw new ProjectError("INVALID_INPUT", "The top of the range must be at or above the bottom.", { fieldPath: "high" });
  }
  const mask = createMask(pixels.widthPx, pixels.heightPx);
  for (let index = 0; index < mask.coverage.length; index += 1) {
    const offset = index * 4;
    // Rec. 601 luma: the standard perceptual weighting, so "brightness" matches what a
    // person sees rather than a flat channel average.
    const luma = 0.299 * pixels.data[offset] + 0.587 * pixels.data[offset + 1] + 0.114 * pixels.data[offset + 2];
    if (luma >= source.low && luma <= source.high) mask.coverage[index] = 255;
    else if (source.softness > 0) {
      const outside = luma < source.low ? source.low - luma : luma - source.high;
      if (outside < source.softness) mask.coverage[index] = Math.round(255 * (1 - outside / source.softness));
    }
  }
  return mask;
}

/** A selection from a layer's own transparency. */
export function alphaMask(pixels: PixelSource): SelectionMask {
  const mask = createMask(pixels.widthPx, pixels.heightPx);
  for (let index = 0; index < mask.coverage.length; index += 1) mask.coverage[index] = pixels.data[index * 4 + 3];
  return mask;
}

/* ------------------------------- refining them ------------------------------- */

/**
 * Softens an edge with a separable box blur, run three times.
 *
 * Three box passes approximate a Gaussian closely enough that no one can tell, and cost a
 * fraction of a true Gaussian on a full-resolution photograph. Separable means two passes per
 * round rather than a square kernel, which is what keeps it linear in the radius.
 */
export function feather(mask: SelectionMask, radiusPx: number): SelectionMask {
  const radius = Math.max(0, Math.round(radiusPx));
  if (radius === 0) return mask;

  const { widthPx, heightPx } = mask;
  let source = new Float32Array(mask.coverage);
  let target = new Float32Array(source.length);

  for (let pass = 0; pass < 3; pass += 1) {
    // Horizontal.
    for (let y = 0; y < heightPx; y += 1) {
      const row = y * widthPx;
      let total = 0;
      for (let x = -radius; x <= radius; x += 1) total += source[row + Math.min(widthPx - 1, Math.max(0, x))];
      const window = radius * 2 + 1;
      for (let x = 0; x < widthPx; x += 1) {
        target[row + x] = total / window;
        const leaving = row + Math.min(widthPx - 1, Math.max(0, x - radius));
        const entering = row + Math.min(widthPx - 1, Math.max(0, x + radius + 1));
        total += source[entering] - source[leaving];
      }
    }
    [source, target] = [target, source];

    // Vertical.
    for (let x = 0; x < widthPx; x += 1) {
      let total = 0;
      for (let y = -radius; y <= radius; y += 1) total += source[Math.min(heightPx - 1, Math.max(0, y)) * widthPx + x];
      const window = radius * 2 + 1;
      for (let y = 0; y < heightPx; y += 1) {
        target[y * widthPx + x] = total / window;
        const leaving = Math.min(heightPx - 1, Math.max(0, y - radius)) * widthPx + x;
        const entering = Math.min(heightPx - 1, Math.max(0, y + radius + 1)) * widthPx + x;
        total += source[entering] - source[leaving];
      }
    }
    [source, target] = [target, source];
  }

  const coverage = new Uint8Array(source.length);
  for (let index = 0; index < coverage.length; index += 1) coverage[index] = Math.round(Math.max(0, Math.min(255, source[index])));
  return { widthPx, heightPx, coverage };
}

/**
 * Grows or shrinks a selection.
 *
 * Expanding is a maximum over a disc; contracting is a minimum over the same disc, which is
 * dilation and erosion under their ordinary names. Both preserve partial coverage, so a
 * feathered selection stays feathered after being grown.
 */
export function resize(mask: SelectionMask, deltaPx: number): SelectionMask {
  const radius = Math.round(Math.abs(deltaPx));
  if (radius === 0) return mask;
  const grow = deltaPx > 0;
  const { widthPx, heightPx } = mask;
  const coverage = new Uint8Array(mask.coverage.length);

  for (let y = 0; y < heightPx; y += 1) {
    for (let x = 0; x < widthPx; x += 1) {
      let best = grow ? 0 : 255;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const sy = y + dy;
        if (sy < 0 || sy >= heightPx) { if (!grow) best = 0; continue; }
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (dx * dx + dy * dy > radius * radius) continue;
          const sx = x + dx;
          if (sx < 0 || sx >= widthPx) { if (!grow) best = 0; continue; }
          const value = mask.coverage[sy * widthPx + sx];
          best = grow ? Math.max(best, value) : Math.min(best, value);
        }
      }
      coverage[y * widthPx + x] = best;
    }
  }
  return { widthPx, heightPx, coverage };
}

/**
 * Smooths a ragged edge without softening it.
 *
 * A magic wand on a noisy photograph leaves stray pixels selected outside the region and
 * pinholes unselected inside it. Contracting then expanding removes the specks; expanding then
 * contracting fills the holes. Only doing both fixes both, and doing them in that order means
 * the specks are gone before the second pass could grow them. Each pair returns the shape to
 * roughly where it started, so smoothing cleans an edge rather than moving it.
 */
export function smooth(mask: SelectionMask, radiusPx: number): SelectionMask {
  const radius = Math.max(0, Math.round(radiusPx));
  if (radius === 0) return mask;
  const despeckled = resize(resize(mask, -radius), radius);
  return resize(resize(despeckled, radius), -radius);
}

/**
 * Keeps only a band along the edge.
 *
 * Used for stroking a selection and for the refinement band a select-and-mask workspace works
 * inside, which is why it is a selection operation rather than a drawing one.
 */
export function border(mask: SelectionMask, widthPxBand: number): SelectionMask {
  const band = Math.max(1, Math.round(widthPxBand));
  const outer = resize(mask, band / 2);
  const inner = resize(mask, -band / 2);
  return combine(outer, inner, "subtract");
}

/**
 * Hardens or softens an edge in place, without moving it.
 *
 * Feathering widens the transition band; contrast steepens it. They are opposites and both are
 * needed: hair selected by a magic wand comes out too soft, and a marquee dragged over a
 * gradient comes out too hard. Positive values sharpen, negative soften, and the midpoint
 * stays where it is so the boundary does not creep.
 */
export function edgeContrast(mask: SelectionMask, amount: number): SelectionMask {
  const strength = Math.max(-1, Math.min(1, amount));
  if (strength === 0) return mask;
  // A slope of 1 leaves coverage alone; higher slopes compress the ramp around the midpoint.
  const slope = strength > 0 ? 1 / Math.max(0.02, 1 - strength) : 1 - Math.abs(strength) * 0.9;
  const coverage = new Uint8Array(mask.coverage.length);
  for (let index = 0; index < coverage.length; index += 1) {
    const value = (mask.coverage[index] - 128) * slope + 128;
    coverage[index] = Math.round(Math.max(0, Math.min(255, value)));
  }
  return { ...mask, coverage };
}

/**
 * Nudges the boundary of a soft edge without changing how soft it is.
 *
 * Growing a selection morphologically reshapes it: the disc rounds off concavities and pushes
 * corners outwards. Adding a constant instead slides the ramp where it already stands, so the
 * halo left around a cut-out can be pulled in without the shape itself changing. A hard edge
 * has no ramp, so this correctly leaves one alone — growing is the operation for that.
 */
export function shiftEdge(mask: SelectionMask, amount: number): SelectionMask {
  const offset = Math.round(Math.max(-1, Math.min(1, amount)) * 255);
  if (offset === 0) return mask;
  const coverage = new Uint8Array(mask.coverage.length);
  for (let index = 0; index < coverage.length; index += 1) {
    // Fully in and fully out stay put: only the transition band moves.
    const value = mask.coverage[index];
    coverage[index] = value === 0 || value === 255 ? value : Math.max(0, Math.min(255, value + offset));
  }
  return { ...mask, coverage };
}

/** Moves a selection without changing its shape. */
export function translate(mask: SelectionMask, dx: number, dy: number): SelectionMask {
  const shiftX = Math.round(dx);
  const shiftY = Math.round(dy);
  const { widthPx, heightPx } = mask;
  const coverage = new Uint8Array(mask.coverage.length);
  for (let y = 0; y < heightPx; y += 1) {
    const sourceY = y - shiftY;
    if (sourceY < 0 || sourceY >= heightPx) continue;
    for (let x = 0; x < widthPx; x += 1) {
      const sourceX = x - shiftX;
      if (sourceX < 0 || sourceX >= widthPx) continue;
      coverage[y * widthPx + x] = mask.coverage[sourceY * widthPx + sourceX];
    }
  }
  return { widthPx, heightPx, coverage };
}

/** A sentence describing a selection, for the interface and for agent replies. */
export function describeSelection(mask: SelectionMask, source: SelectionSource | null): string {
  if (isEmpty(mask)) return "Nothing is selected.";
  const area = Math.round(selectedArea(mask));
  const total = mask.widthPx * mask.heightPx;
  const percent = ((area / total) * 100).toFixed(1);
  const how = !source ? "" : source.kind === "marquee" ? ` from ${source.shape === "ellipse" ? "an elliptical" : "a rectangular"} marquee`
    : source.kind === "lasso" ? " drawn by hand"
      : source.kind === "wand" ? ` by colour, ${source.contiguous ? "spreading from one point" : "across the whole image"}`
        : source.kind === "colour_range" ? ` by colour range around ${source.colour}`
          : source.kind === "luminance_range" ? ` by brightness between ${source.low} and ${source.high}`
            : source.kind === "layer_alpha" ? " from a layer's transparency"
              : source.kind === "path" ? " from a path" : "";
  return `${area.toLocaleString()} pixels selected${how}, ${percent}% of the image.`;
}
