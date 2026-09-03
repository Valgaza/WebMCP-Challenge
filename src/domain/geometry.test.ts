import { describe, expect, it } from "vitest";
import {
  IDENTITY, IDENTITY_TRANSFORM, NO_LENS_CORRECTION, applyMatrix, assertConvex, assertMeshShape,
  createMesh, describeFreeTransform, describeLensCorrection, freeTransformMatrix, homography,
  invert, isLensCorrected, isMeshFlat, keystoneMatrix, lensCorrectionSchema, meshCells, meshPoint,
  moveMeshPoint, multiply, perspectiveSlidersSchema, slidersToCorners, straightenedSize,
  undistort, vignetteAt, type PerspectiveCorners, type Point,
} from "./geometry";

const close = (actual: Point, expected: Point, precision = 6) => {
  expect(actual.x).toBeCloseTo(expected.x, precision);
  expect(actual.y).toBeCloseTo(expected.y, precision);
};

const rectangle = (width: number, height: number): PerspectiveCorners => ({
  topLeft: { x: 0, y: 0 }, topRight: { x: width, y: 0 },
  bottomRight: { x: width, y: height }, bottomLeft: { x: 0, y: height },
});

/**
 * `PH-005`, `PH-023`, `PH-024`, and `PH-046`. Free transform, keystone correction, warping,
 * and lens correction are one map from where a pixel is to where it should go, so they share
 * one engine rather than four.
 */
describe("matrices", () => {
  it("leaves a point alone under the identity", () => {
    close(applyMatrix(IDENTITY, { x: 3, y: 4 }), { x: 3, y: 4 });
    expect(multiply(IDENTITY, IDENTITY)).toEqual(IDENTITY);
  });

  it("inverts, and an inverse undoes the original", () => {
    const matrix = freeTransformMatrix({ ...IDENTITY_TRANSFORM, rotationDeg: 30, scaleX: 2, scaleY: 2 }, 100, 100);
    const back = invert(matrix)!;
    close(applyMatrix(back, applyMatrix(matrix, { x: 17, y: 23 })), { x: 17, y: 23 }, 4);
  });

  it("has no inverse for a transform that flattens everything to a line", () => {
    expect(invert([1, 2, 3, 2, 4, 6, 0, 0, 0])).toBeNull();
  });
});

describe("free transform", () => {
  it("does nothing when nothing has been asked for", () => {
    close(applyMatrix(freeTransformMatrix(IDENTITY_TRANSFORM, 200, 100), { x: 40, y: 60 }), { x: 40, y: 60 });
  });

  it("scales about the anchor rather than about the corner", () => {
    const matrix = freeTransformMatrix({ ...IDENTITY_TRANSFORM, scaleX: 2, scaleY: 2 }, 100, 100);
    // The centre is the anchor, so it stays put while the corners move outwards.
    close(applyMatrix(matrix, { x: 50, y: 50 }), { x: 50, y: 50 });
    close(applyMatrix(matrix, { x: 0, y: 0 }), { x: -50, y: -50 });
  });

  it("honours a moved anchor", () => {
    const matrix = freeTransformMatrix({ ...IDENTITY_TRANSFORM, scaleX: 2, scaleY: 2, anchorX: 0, anchorY: 0 }, 100, 100);
    close(applyMatrix(matrix, { x: 0, y: 0 }), { x: 0, y: 0 });
    close(applyMatrix(matrix, { x: 10, y: 10 }), { x: 20, y: 20 });
  });

  it("rotates a quarter turn exactly", () => {
    const matrix = freeTransformMatrix({ ...IDENTITY_TRANSFORM, rotationDeg: 90, anchorX: 0, anchorY: 0 }, 100, 100);
    close(applyMatrix(matrix, { x: 10, y: 0 }), { x: 0, y: 10 }, 6);
  });

  it("skews a rectangle into a parallelogram", () => {
    const matrix = freeTransformMatrix({ ...IDENTITY_TRANSFORM, skewXDeg: 45, anchorX: 0, anchorY: 0 }, 100, 100);
    close(applyMatrix(matrix, { x: 0, y: 10 }), { x: 10, y: 10 }, 6);
  });

  it("moves, and combines a move with everything else", () => {
    const matrix = freeTransformMatrix({ ...IDENTITY_TRANSFORM, translateX: 5, translateY: -3, scaleX: 2, scaleY: 2, anchorX: 0, anchorY: 0 }, 100, 100);
    close(applyMatrix(matrix, { x: 10, y: 10 }), { x: 25, y: 17 });
  });

  it("says what it did in words", () => {
    expect(describeFreeTransform(IDENTITY_TRANSFORM)).toBe("Not transformed.");
    expect(describeFreeTransform({ ...IDENTITY_TRANSFORM, scaleX: 1.5, scaleY: 1.5, rotationDeg: 10 }))
      .toBe("Transformed: scaled to 150%, rotated 10°.");
    expect(describeFreeTransform({ ...IDENTITY_TRANSFORM, scaleX: 2, scaleY: 1 })).toContain("200% by 100%");
  });
});

describe("perspective correction", () => {
  it("maps four corners onto four others", () => {
    const matrix = homography(
      [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
      [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }],
    );
    close(applyMatrix(matrix, { x: 5, y: 5 }), { x: 10, y: 10 }, 5);
  });

  it("straightens a leaning shape into an upright rectangle", () => {
    const leaning: PerspectiveCorners = {
      topLeft: { x: 20, y: 0 }, topRight: { x: 80, y: 0 },
      bottomRight: { x: 100, y: 100 }, bottomLeft: { x: 0, y: 100 },
    };
    const matrix = keystoneMatrix(leaning, 100, 100);
    close(applyMatrix(matrix, leaning.topLeft), { x: 0, y: 0 }, 4);
    close(applyMatrix(matrix, leaning.bottomRight), { x: 100, y: 100 }, 4);
  });

  it("refuses anything but four corners", () => {
    expect(() => homography([{ x: 0, y: 0 }], [{ x: 0, y: 0 }])).toThrowError(/exactly four corners/);
  });

  /** Without this the arithmetic happily produces a picture folded through itself. */
  it("refuses corners that cross over each other, and says how to order them", () => {
    const crossed: PerspectiveCorners = {
      topLeft: { x: 0, y: 0 }, topRight: { x: 100, y: 100 },
      bottomRight: { x: 100, y: 0 }, bottomLeft: { x: 0, y: 100 },
    };
    expect(() => assertConvex(crossed)).toThrowError(/reading order/);
    expect(() => keystoneMatrix(crossed, 100, 100)).toThrowError(/reading order/);
  });

  it("refuses corners that enclose nothing", () => {
    expect(() => assertConvex({
      topLeft: { x: 0, y: 0 }, topRight: { x: 10, y: 0 },
      bottomRight: { x: 10, y: 0 }, bottomLeft: { x: 0, y: 0 },
    })).toThrowError(/enclose no area/);
  });

  it("refuses three corners in a line", () => {
    expect(() => homography(
      [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }],
      [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }],
    )).toThrowError(/three of them may be in a line/);
  });

  /**
   * The size comes from the shape being straightened, not the frame it was photographed in,
   * so a document keeps its own proportions.
   */
  it("takes the straightened size from the longest opposing edges", () => {
    const size = straightenedSize({
      topLeft: { x: 0, y: 0 }, topRight: { x: 60, y: 0 },
      bottomRight: { x: 100, y: 50 }, bottomLeft: { x: 0, y: 50 },
    });
    expect(size.widthPx).toBe(100);
    // The right edge runs from (60,0) to (100,50), which is longer than the left edge's 50.
    expect(size.heightPx).toBeCloseTo(64.03, 2);
  });

  it("turns sliders into corners, and does nothing at rest", () => {
    const rest = slidersToCorners(perspectiveSlidersSchema.parse({}), 100, 80);
    expect(rest).toEqual(rectangle(100, 80));
  });

  /** Leaning the top away is the correction for having looked up at a building. */
  it("pulls the top in when the vertical slider is positive", () => {
    const leaned = slidersToCorners(perspectiveSlidersSchema.parse({ verticalDeg: 30 }), 100, 100);
    expect(leaned.topLeft.x).toBeGreaterThan(0);
    expect(leaned.topRight.x).toBeLessThan(100);
    expect(leaned.bottomLeft.x).toBe(0);
  });

  it("pulls the bottom in when it is negative", () => {
    const leaned = slidersToCorners(perspectiveSlidersSchema.parse({ verticalDeg: -30 }), 100, 100);
    expect(leaned.bottomLeft.x).toBeGreaterThan(0);
    expect(leaned.topLeft.x).toBe(0);
  });

  it("produces corners a keystone correction accepts", () => {
    const corners = slidersToCorners(perspectiveSlidersSchema.parse({ verticalDeg: 20, horizontalDeg: -10 }), 200, 150);
    expect(() => keystoneMatrix(corners, 200, 150)).not.toThrow();
  });
});

describe("warp mesh", () => {
  it("starts flat, with a control point at every grid position", () => {
    const mesh = createMesh(4, 3);
    expect(mesh.offsets).toHaveLength(12);
    expect(isMeshFlat(mesh)).toBe(true);
    close(meshPoint(mesh, 0, 0, 90, 60), { x: 0, y: 0 });
    close(meshPoint(mesh, 3, 2, 90, 60), { x: 90, y: 60 });
    close(meshPoint(mesh, 1, 1, 90, 60), { x: 30, y: 30 });
  });

  it("moves one point and leaves the others alone", () => {
    const moved = moveMeshPoint(createMesh(3, 3), 1, 1, { x: 0.1, y: -0.2 });
    expect(isMeshFlat(moved)).toBe(false);
    close(meshPoint(moved, 1, 1, 100, 100), { x: 60, y: 30 });
    close(meshPoint(moved, 0, 0, 100, 100), { x: 0, y: 0 });
  });

  it("returns a new mesh rather than editing the one it was given", () => {
    const original = createMesh(3, 3);
    moveMeshPoint(original, 1, 1, { x: 0.5, y: 0.5 });
    expect(isMeshFlat(original)).toBe(true);
  });

  it("refuses a control point that is not on the mesh", () => {
    expect(() => meshPoint(createMesh(3, 3), 5, 0, 100, 100)).toThrowError(/not on the mesh/);
    expect(() => moveMeshPoint(createMesh(3, 3), 0, 9, { x: 0, y: 0 })).toThrowError(/not on the mesh/);
  });

  it("refuses a mesh whose control points do not match its size", () => {
    expect(() => assertMeshShape({ schemaVersion: 1, columns: 4, rows: 4, offsets: [{ x: 0, y: 0 }] }))
      .toThrowError(/needs 16 control points; 1 were given/);
  });

  /** A renderer draws a warp one cell at a time; no single matrix describes the whole thing. */
  it("breaks the mesh into cells that tile the layer", () => {
    const cells = meshCells(createMesh(3, 3), 100, 100);
    expect(cells).toHaveLength(4);
    expect(cells[0].source).toEqual({ x: 0, y: 0, width: 50, height: 50 });
    close(cells[0].corners[0], { x: 0, y: 0 });
    close(cells[0].corners[2], { x: 50, y: 50 });
    close(cells[3].corners[2], { x: 100, y: 100 });
  });

  it("carries a moved point through to the cells that touch it", () => {
    const cells = meshCells(moveMeshPoint(createMesh(3, 3), 1, 1, { x: 0.2, y: 0 }), 100, 100);
    close(cells[0].corners[2], { x: 70, y: 50 });
    // The source rectangle is untouched: only where it lands has moved.
    expect(cells[0].source).toEqual({ x: 0, y: 0, width: 50, height: 50 });
  });
});

describe("lens correction", () => {
  it("does nothing at rest", () => {
    expect(isLensCorrected(NO_LENS_CORRECTION)).toBe(false);
    close(undistort({ x: 30, y: 40 }, 100, 100, NO_LENS_CORRECTION), { x: 30, y: 40 });
    expect(vignetteAt({ x: 0, y: 0 }, 100, 100, 0)).toBe(1);
  });

  it("leaves the centre alone whatever the correction, because the bend is radial", () => {
    const correction = lensCorrectionSchema.parse({ distortion: 0.5 });
    close(undistort({ x: 50, y: 50 }, 100, 100, correction), { x: 50, y: 50 });
  });

  it("reads further out for a barrel correction and closer in for a pinch", () => {
    const barrel = undistort({ x: 100, y: 50 }, 100, 100, lensCorrectionSchema.parse({ distortion: 0.4 }));
    const pinch = undistort({ x: 100, y: 50 }, 100, 100, lensCorrectionSchema.parse({ distortion: -0.4 }));
    expect(barrel.x).toBeGreaterThan(100);
    expect(pinch.x).toBeLessThan(100);
  });

  /** The same coefficient has to mean the same bend whatever size the image is. */
  it("means the same thing at any image size", () => {
    const correction = lensCorrectionSchema.parse({ distortion: 0.3 });
    const small = undistort({ x: 100, y: 50 }, 100, 100, correction);
    const large = undistort({ x: 1000, y: 500 }, 1000, 1000, correction);
    expect((small.x - 50) / 50).toBeCloseTo((large.x - 500) / 500, 6);
  });

  it("darkens or lifts the corners more than the centre", () => {
    expect(vignetteAt({ x: 50, y: 50 }, 100, 100, -0.5)).toBe(1);
    expect(vignetteAt({ x: 0, y: 0 }, 100, 100, -0.5)).toBeCloseTo(0.5, 6);
    expect(vignetteAt({ x: 0, y: 0 }, 100, 100, 0.5)).toBeCloseTo(1.5, 6);
  });

  it("says what it corrected", () => {
    expect(describeLensCorrection(NO_LENS_CORRECTION)).toBe("No lens correction.");
    expect(describeLensCorrection(lensCorrectionSchema.parse({ distortion: 0.4 }))).toContain("40% of a barrel bend");
    expect(describeLensCorrection(lensCorrectionSchema.parse({ distortion: -0.2 }))).toContain("20% of a pinch");
    expect(describeLensCorrection(lensCorrectionSchema.parse({ vignette: -0.3 }))).toContain("darkening the corners");
  });
});
