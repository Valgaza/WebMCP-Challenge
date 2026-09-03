import { z } from "zod";
import { ProjectError } from "./project-error";

export const GEOMETRY_SCHEMA_VERSION = 1 as const;

/**
 * Moving pixels around: free transform, perspective correction, warping, and lens distortion.
 *
 * All four are the same thing seen from different ends — a map from where a pixel is to where
 * it should go — so they share one engine rather than four. Every one of them is stored as
 * parameters and applied at render time, never baked, so a keystone correction can be undone
 * or adjusted a week later without the original having been resampled twice.
 */

/* ------------------------------- points and matrices ------------------------------- */

export interface Point { x: number; y: number }

export const pointSchema = z.object({ x: z.number(), y: z.number() });

/**
 * A 3×3 projective matrix, row-major.
 *
 * Affine transforms would cover scale, rotation, and skew, but not perspective — and
 * perspective is the whole point of keystone correction, so the extra row earns its place.
 */
export type Matrix3 = readonly [number, number, number, number, number, number, number, number, number];

export const IDENTITY: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function multiply(a: Matrix3, b: Matrix3): Matrix3 {
  const out = new Array(9).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      out[row * 3 + column] = a[row * 3] * b[column]
        + a[row * 3 + 1] * b[3 + column]
        + a[row * 3 + 2] * b[6 + column];
    }
  }
  return out as unknown as Matrix3;
}

export function applyMatrix(matrix: Matrix3, point: Point): Point {
  const x = matrix[0] * point.x + matrix[1] * point.y + matrix[2];
  const y = matrix[3] * point.x + matrix[4] * point.y + matrix[5];
  const w = matrix[6] * point.x + matrix[7] * point.y + matrix[8];
  // A zero w means the point maps to infinity, which happens when a perspective is degenerate.
  // Returning the unprojected point keeps a preview drawable instead of producing NaN.
  if (Math.abs(w) < 1e-12) return { x, y };
  return { x: x / w, y: y / w };
}

/**
 * The matrix that maps four points onto four others.
 *
 * This is what perspective correction is: name the corners of something that should be a
 * rectangle, and solve for the transform that makes it one. Eight unknowns, eight equations,
 * solved by elimination — small enough that a general solver would be more code, not less.
 */
export function homography(from: readonly Point[], to: readonly Point[]): Matrix3 {
  if (from.length !== 4 || to.length !== 4) {
    throw new ProjectError("INVALID_INPUT", "A perspective transform is defined by exactly four corners.", { fieldPath: "corners" });
  }

  const rows: number[][] = [];
  for (let index = 0; index < 4; index += 1) {
    const { x, y } = from[index];
    const { x: u, y: v } = to[index];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }

  const solution = solve(rows);
  if (!solution) {
    throw new ProjectError(
      "INVALID_INPUT",
      "Those four corners do not describe a shape that can be straightened; three of them may be in a line.",
      { fieldPath: "corners" },
    );
  }
  return [...solution, 1] as unknown as Matrix3;
}

/** Gaussian elimination with partial pivoting on an 8×9 augmented system. */
function solve(rows: number[][]): number[] | null {
  const size = rows.length;
  for (let column = 0; column < size; column += 1) {
    // Pivoting on the largest magnitude keeps the elimination stable on near-degenerate
    // inputs, which is exactly what a hand-placed corner produces.
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    if (Math.abs(rows[pivot][column]) < 1e-10) return null;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];

    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column] / rows[column][column];
      for (let k = column; k <= size; k += 1) rows[row][k] -= factor * rows[column][k];
    }
  }
  return rows.map((row, index) => row[size] / row[index]);
}

export function invert(matrix: Matrix3): Matrix3 | null {
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(determinant) < 1e-12) return null;
  return [
    (e * i - f * h) / determinant, (c * h - b * i) / determinant, (b * f - c * e) / determinant,
    (f * g - d * i) / determinant, (a * i - c * g) / determinant, (c * d - a * f) / determinant,
    (d * h - e * g) / determinant, (b * g - a * h) / determinant, (a * e - b * d) / determinant,
  ];
}

/* --------------------------------- free transform --------------------------------- */

/**
 * Scale, rotate, skew, and move, as numbers rather than as a dragged handle.
 *
 * Dragging is how most of this is done, but numbers are how it is done exactly — matching one
 * layer's rotation to another's, or nudging by a single pixel. Both produce the same record,
 * so the two are never out of step.
 */
export const freeTransformSchema = z.object({
  translateX: z.number().default(0),
  translateY: z.number().default(0),
  scaleX: z.number().min(-100).max(100).default(1),
  scaleY: z.number().min(-100).max(100).default(1),
  rotationDeg: z.number().min(-3600).max(3600).default(0),
  /** Slants the shape; a rectangle becomes a parallelogram. */
  skewXDeg: z.number().min(-89).max(89).default(0),
  skewYDeg: z.number().min(-89).max(89).default(0),
  /** The fixed point everything happens around, normalised within the layer. */
  anchorX: z.number().min(0).max(1).default(0.5),
  anchorY: z.number().min(0).max(1).default(0.5),
});
export type FreeTransform = z.infer<typeof freeTransformSchema>;

export const IDENTITY_TRANSFORM: FreeTransform = freeTransformSchema.parse({});

/**
 * A change to some of a transform, with the rest left alone.
 *
 * Written out rather than derived with `.partial()`, because Zod's `.partial()` keeps a
 * field's default: every unmentioned field would arrive as its default rather than as absent,
 * and a merge could not tell "leave the rotation" from "set the rotation to zero".
 */
export const freeTransformPatchSchema = z.object({
  translateX: z.number().optional(),
  translateY: z.number().optional(),
  scaleX: z.number().min(-100).max(100).optional(),
  scaleY: z.number().min(-100).max(100).optional(),
  rotationDeg: z.number().min(-3600).max(3600).optional(),
  skewXDeg: z.number().min(-89).max(89).optional(),
  skewYDeg: z.number().min(-89).max(89).optional(),
  anchorX: z.number().min(0).max(1).optional(),
  anchorY: z.number().min(0).max(1).optional(),
});
export type FreeTransformPatch = z.infer<typeof freeTransformPatchSchema>;

/**
 * The matrix a free transform describes, about a given size.
 *
 * The order is fixed and not negotiable: move to the anchor, then skew, rotate, scale, and
 * move back. Applying scale before rotation gives a different picture from applying it after,
 * and a tool where that order shifts with the input is a tool nobody can predict.
 */
export function freeTransformMatrix(transform: FreeTransform, widthPx: number, heightPx: number): Matrix3 {
  const ax = transform.anchorX * widthPx;
  const ay = transform.anchorY * heightPx;
  const radians = (transform.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const skewX = Math.tan((transform.skewXDeg * Math.PI) / 180);
  const skewY = Math.tan((transform.skewYDeg * Math.PI) / 180);

  const toAnchor: Matrix3 = [1, 0, -ax, 0, 1, -ay, 0, 0, 1];
  const skew: Matrix3 = [1, skewX, 0, skewY, 1, 0, 0, 0, 1];
  const rotate: Matrix3 = [cos, -sin, 0, sin, cos, 0, 0, 0, 1];
  const scale: Matrix3 = [transform.scaleX, 0, 0, 0, transform.scaleY, 0, 0, 0, 1];
  const back: Matrix3 = [1, 0, ax + transform.translateX, 0, 1, ay + transform.translateY, 0, 0, 1];

  return multiply(back, multiply(scale, multiply(rotate, multiply(skew, toAnchor))));
}

/* ----------------------------- perspective and keystone ---------------------------- */

/**
 * Four corners of something that should be a rectangle.
 *
 * Named in reading order so a mis-ordered set can be caught rather than producing a picture
 * folded through itself.
 */
export const perspectiveCornersSchema = z.object({
  topLeft: pointSchema,
  topRight: pointSchema,
  bottomRight: pointSchema,
  bottomLeft: pointSchema,
});
export type PerspectiveCorners = z.infer<typeof perspectiveCornersSchema>;

export function cornerList(corners: PerspectiveCorners): Point[] {
  return [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
}

/** Twice the signed area of the quadrilateral; its sign says which way the corners wind. */
function signedArea(points: readonly Point[]): number {
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    total += a.x * b.y - b.x * a.y;
  }
  return total;
}

/**
 * Refuses corners that cannot be straightened into a rectangle.
 *
 * A quadrilateral whose sides cross has no sensible rectangle to become, and the arithmetic
 * would happily produce one folded through itself. Catching it here means a message instead of
 * a picture nobody can explain.
 */
export function assertConvex(corners: PerspectiveCorners): void {
  const points = cornerList(corners);
  let sign = 0;
  for (let index = 0; index < 4; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % 4];
    const c = points[(index + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) continue;
    const current = Math.sign(cross);
    if (sign === 0) sign = current;
    else if (current !== sign) {
      throw new ProjectError(
        "INVALID_INPUT",
        "Those corners cross over each other, so there is no rectangle to straighten them into. Put them in reading order: top left, top right, bottom right, bottom left.",
        { fieldPath: "corners" },
      );
    }
  }
  if (Math.abs(signedArea(points)) < 1e-6) {
    throw new ProjectError("INVALID_INPUT", "Those four corners enclose no area.", { fieldPath: "corners" });
  }
}

/**
 * The size the straightened result should be.
 *
 * Taken from the longest opposing edges rather than from the original frame, so correcting a
 * photograph of a document gives back the document's proportions rather than the camera's.
 */
export function straightenedSize(corners: PerspectiveCorners): { widthPx: number; heightPx: number } {
  const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
  return {
    widthPx: Math.max(
      distance(corners.topLeft, corners.topRight),
      distance(corners.bottomLeft, corners.bottomRight),
    ),
    heightPx: Math.max(
      distance(corners.topLeft, corners.bottomLeft),
      distance(corners.topRight, corners.bottomRight),
    ),
  };
}

/** The transform that turns those four corners into an upright rectangle of the given size. */
export function keystoneMatrix(corners: PerspectiveCorners, widthPx: number, heightPx: number): Matrix3 {
  assertConvex(corners);
  return homography(cornerList(corners), [
    { x: 0, y: 0 }, { x: widthPx, y: 0 }, { x: widthPx, y: heightPx }, { x: 0, y: heightPx },
  ]);
}

/**
 * Perspective as two sliders rather than four corners.
 *
 * Dragging corners is precise; sliders are quick. Both end at the same matrix, so a photograph
 * corrected either way is corrected identically.
 */
export const perspectiveSlidersSchema = z.object({
  /** Positive leans the top away, which is the correction for looking up at a building. */
  verticalDeg: z.number().min(-60).max(60).default(0),
  horizontalDeg: z.number().min(-60).max(60).default(0),
  /** Counter-rotates, for a camera that was not level. */
  rotationDeg: z.number().min(-45).max(45).default(0),
  /** Scales back up, because correcting perspective always crops the frame. */
  scale: z.number().min(0.1).max(4).default(1),
});
export type PerspectiveSliders = z.infer<typeof perspectiveSlidersSchema>;

export function slidersToCorners(
  sliders: PerspectiveSliders, widthPx: number, heightPx: number,
): PerspectiveCorners {
  // The tangent of the lean is how much of the width each end gives up, which is what makes
  // the slider read as an angle rather than as an arbitrary number.
  const vertical = Math.tan((sliders.verticalDeg * Math.PI) / 180) / 2;
  const horizontal = Math.tan((sliders.horizontalDeg * Math.PI) / 180) / 2;
  const inTop = Math.max(0, vertical) * widthPx;
  const inBottom = Math.max(0, -vertical) * widthPx;
  const inLeft = Math.max(0, horizontal) * heightPx;
  const inRight = Math.max(0, -horizontal) * heightPx;

  return {
    topLeft: { x: inTop, y: inLeft },
    topRight: { x: widthPx - inTop, y: inRight },
    bottomRight: { x: widthPx - inBottom, y: heightPx - inRight },
    bottomLeft: { x: inBottom, y: heightPx - inLeft },
  };
}

/* ------------------------------------- warping ------------------------------------- */

/**
 * A grid of control points that can be pulled about.
 *
 * A mesh is the general case a perspective transform is a special case of: four points make a
 * homography, more than four make a warp no single matrix can describe. Storing offsets rather
 * than absolute positions means a mesh survives the document being resized.
 */
export const warpMeshSchema = z.object({
  schemaVersion: z.literal(GEOMETRY_SCHEMA_VERSION),
  columns: z.number().int().min(2).max(16),
  rows: z.number().int().min(2).max(16),
  /**
   * Where each control point has been pulled to, in fractions of the layer's own size, in
   * row-major order. Exactly `columns × rows` of them.
   */
  offsets: z.array(pointSchema).max(256),
});
export type WarpMesh = z.infer<typeof warpMeshSchema>;

export function createMesh(columns = 4, rows = 4): WarpMesh {
  return warpMeshSchema.parse({
    schemaVersion: GEOMETRY_SCHEMA_VERSION,
    columns, rows,
    offsets: Array.from({ length: columns * rows }, () => ({ x: 0, y: 0 })),
  });
}

export function assertMeshShape(mesh: WarpMesh): void {
  if (mesh.offsets.length !== mesh.columns * mesh.rows) {
    throw new ProjectError(
      "INVALID_INPUT",
      `A ${mesh.columns}×${mesh.rows} mesh needs ${mesh.columns * mesh.rows} control points; ${mesh.offsets.length} were given.`,
      { fieldPath: "offsets" },
    );
  }
}

/** Where one control point sits, in the layer's own pixels. */
export function meshPoint(mesh: WarpMesh, column: number, row: number, widthPx: number, heightPx: number): Point {
  assertMeshShape(mesh);
  if (column < 0 || column >= mesh.columns || row < 0 || row >= mesh.rows) {
    throw new ProjectError("INVALID_INPUT", "That control point is not on the mesh.", { fieldPath: "column" });
  }
  const offset = mesh.offsets[row * mesh.columns + column];
  return {
    x: (column / (mesh.columns - 1)) * widthPx + offset.x * widthPx,
    y: (row / (mesh.rows - 1)) * heightPx + offset.y * heightPx,
  };
}

/** Moves one control point, returning a new mesh rather than editing this one. */
export function moveMeshPoint(mesh: WarpMesh, column: number, row: number, offset: Point): WarpMesh {
  assertMeshShape(mesh);
  const index = row * mesh.columns + column;
  if (index < 0 || index >= mesh.offsets.length) {
    throw new ProjectError("INVALID_INPUT", "That control point is not on the mesh.", { fieldPath: "column" });
  }
  return { ...mesh, offsets: mesh.offsets.map((existing, at) => (at === index ? offset : existing)) };
}

export function isMeshFlat(mesh: WarpMesh): boolean {
  return mesh.offsets.every((offset) => offset.x === 0 && offset.y === 0);
}

/**
 * The mesh as quads, each with where it came from and where it goes.
 *
 * A renderer draws a warp one cell at a time, because no single matrix describes the whole
 * thing. Producing the cells here keeps that arithmetic in one place and testable without a
 * canvas.
 */
export interface MeshCell {
  source: { x: number; y: number; width: number; height: number };
  corners: [Point, Point, Point, Point];
}

export function meshCells(mesh: WarpMesh, widthPx: number, heightPx: number): MeshCell[] {
  assertMeshShape(mesh);
  const cells: MeshCell[] = [];
  const cellWidth = widthPx / (mesh.columns - 1);
  const cellHeight = heightPx / (mesh.rows - 1);

  for (let row = 0; row < mesh.rows - 1; row += 1) {
    for (let column = 0; column < mesh.columns - 1; column += 1) {
      cells.push({
        source: { x: column * cellWidth, y: row * cellHeight, width: cellWidth, height: cellHeight },
        corners: [
          meshPoint(mesh, column, row, widthPx, heightPx),
          meshPoint(mesh, column + 1, row, widthPx, heightPx),
          meshPoint(mesh, column + 1, row + 1, widthPx, heightPx),
          meshPoint(mesh, column, row + 1, widthPx, heightPx),
        ],
      });
    }
  }
  return cells;
}

/* --------------------------------- lens distortion --------------------------------- */

/**
 * The bend a lens puts into straight lines, and the correction for it.
 *
 * A wide lens bows lines outwards and a long one pinches them inwards; both are radial, so one
 * pair of coefficients describes either. This is not a creative effect — it is undoing
 * something the glass did — which is why it is stored with the other geometry rather than with
 * the filters.
 */
export const lensCorrectionSchema = z.object({
  /** Positive corrects barrel distortion (a wide lens bowing lines outwards). */
  distortion: z.number().min(-1).max(1).default(0),
  /** The second-order term, for lenses one coefficient cannot describe. */
  distortionFine: z.number().min(-0.5).max(0.5).default(0),
  /** Colour fringing at the edges, where the lens focused each colour slightly differently. */
  chromaticAberration: z.number().min(-1).max(1).default(0),
  /** Corner darkening; positive brightens the corners back up. */
  vignette: z.number().min(-1).max(1).default(0),
});
export type LensCorrection = z.infer<typeof lensCorrectionSchema>;

export const NO_LENS_CORRECTION: LensCorrection = lensCorrectionSchema.parse({});

/** A change to some of a lens correction. Optional for the same reason as the transform patch. */
export const lensCorrectionPatchSchema = z.object({
  distortion: z.number().min(-1).max(1).optional(),
  distortionFine: z.number().min(-0.5).max(0.5).optional(),
  chromaticAberration: z.number().min(-1).max(1).optional(),
  vignette: z.number().min(-1).max(1).optional(),
});
export type LensCorrectionPatch = z.infer<typeof lensCorrectionPatchSchema>;

export function isLensCorrected(correction: LensCorrection): boolean {
  return correction.distortion !== 0 || correction.distortionFine !== 0
    || correction.chromaticAberration !== 0 || correction.vignette !== 0;
}

/**
 * Where a corrected pixel is read from in the original.
 *
 * The map runs backwards — for each output pixel, find its source — because working forwards
 * leaves holes wherever the correction spreads pixels apart. Radius is normalised against the
 * half-diagonal so the same coefficient means the same thing at any size.
 */
export function undistort(
  point: Point, widthPx: number, heightPx: number, correction: LensCorrection,
): Point {
  const cx = widthPx / 2;
  const cy = heightPx / 2;
  const half = Math.hypot(cx, cy);
  if (half === 0) return point;

  const dx = (point.x - cx) / half;
  const dy = (point.y - cy) / half;
  const radiusSquared = dx * dx + dy * dy;
  const factor = 1 + correction.distortion * radiusSquared + correction.distortionFine * radiusSquared * radiusSquared;

  return { x: cx + dx * factor * half, y: cy + dy * factor * half };
}

/** How much the corners are darkened or lifted at a point, as a multiplier on brightness. */
export function vignetteAt(point: Point, widthPx: number, heightPx: number, amount: number): number {
  if (amount === 0) return 1;
  const cx = widthPx / 2;
  const cy = heightPx / 2;
  const half = Math.hypot(cx, cy);
  if (half === 0) return 1;
  const radius = Math.hypot(point.x - cx, point.y - cy) / half;
  // Squared falloff, because that is roughly how a lens loses light towards the edge.
  return 1 + amount * radius * radius;
}

/* --------------------------------- describing them --------------------------------- */

export function describeFreeTransform(transform: FreeTransform): string {
  const parts: string[] = [];
  if (transform.translateX || transform.translateY) {
    parts.push(`moved ${Math.round(transform.translateX)}, ${Math.round(transform.translateY)} px`);
  }
  if (transform.scaleX !== 1 || transform.scaleY !== 1) {
    parts.push(transform.scaleX === transform.scaleY
      ? `scaled to ${Math.round(transform.scaleX * 100)}%`
      : `scaled to ${Math.round(transform.scaleX * 100)}% by ${Math.round(transform.scaleY * 100)}%`);
  }
  if (transform.rotationDeg) parts.push(`rotated ${transform.rotationDeg}°`);
  if (transform.skewXDeg || transform.skewYDeg) parts.push(`skewed ${transform.skewXDeg}°, ${transform.skewYDeg}°`);
  return parts.length ? `Transformed: ${parts.join(", ")}.` : "Not transformed.";
}

export function describeLensCorrection(correction: LensCorrection): string {
  if (!isLensCorrected(correction)) return "No lens correction.";
  const parts: string[] = [];
  if (correction.distortion) {
    parts.push(correction.distortion > 0
      ? `straightening ${Math.round(correction.distortion * 100)}% of a barrel bend`
      : `straightening ${Math.round(-correction.distortion * 100)}% of a pinch`);
  }
  if (correction.chromaticAberration) parts.push("removing colour fringing at the edges");
  if (correction.vignette) {
    parts.push(correction.vignette > 0 ? "lifting the corners" : "darkening the corners");
  }
  return `Lens correction: ${parts.join(", ")}.`;
}
