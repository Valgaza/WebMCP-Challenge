import { buildToneCurve, isDefaultAdjustments, whiteBalanceGains, type AdjustmentStack } from "../domain/adjustment";
import { clippingRuns, compositeOperationFor, type Effect, type Mask } from "../domain/effect";
import { applyColourOperation, applyProfile } from "../domain/colour-op";
import { applyFilter } from "../domain/filter";
import { paintOrder, shadowOffset, type LayerStyle } from "../domain/layer-style";
import {
  applyMatrix, invert as invertMatrix, isLensCorrected, isMeshFlat, keystoneMatrix, meshCells,
  undistort, vignetteAt, type LensCorrection, type MeshCell, type Point,
} from "../domain/geometry";
import { evaluateTracks } from "../domain/keyframe";
import { cssFont, formattingAt, paragraphsOf, styleForParagraph, type TextBlock } from "../domain/text";
import { shapeBounds, toCommands, toPathData, type Paint, type Swatch, type VectorObject } from "../domain/vector";
import { isRetouch, stampsFor, type Stroke } from "../domain/brush";
import type { Rational } from "../domain/time";
import {
  applyViewingModes, resolveInheritance, flattenLayers,
  type ContentLayer, type ImageLayer, type Layer, type LayerGeometry,
} from "../domain/layer";
import { ProjectError } from "../domain/project-error";

export interface RenderDocument {
  widthPx: number;
  heightPx: number;
  background: { type: "transparent" } | { type: "solid"; color: string };
  layers: Layer[];
  /** Named colours and gradients the layers can point at. */
  swatches?: readonly Swatch[];
}

export interface RenderSource {
  assetId: string;
  bitmap: CanvasImageSource;
  /** The bitmap's own size, used to read pixels out of it. */
  widthPx: number;
  heightPx: number;
  /**
   * The size the layer's transform was authored against.
   *
   * A resampled derivative has fewer pixels than the original, but the layer's scale still
   * means what it meant. Keeping the two apart lets the render sample the resampled pixels
   * while drawing at the size the document asks for, instead of shrinking by the ratio twice.
   */
  nativeWidthPx?: number;
  nativeHeightPx?: number;
}

export interface RenderOptions {
  /**
   * The instant to render at.
   *
   * Animation makes a document a function of time, so a render without a time is a render of
   * the authored values. Photo work leaves this out and gets exactly what it had before.
   */
  time?: Rational;
  /** Scales the whole output; a proxy render uses a fraction of full size. */
  scale?: number;
  /** Layers listed here are skipped, which is how before/after isolates one edit. */
  excludeLayerIds?: string[];
  /**
   * Saved selections a mask can point at, by id.
   *
   * Passed in rather than fetched because the compositor draws; loading is the render
   * service's job. A mask whose image is missing leaves its layer whole rather than blanking
   * it, which is the same choice made everywhere else here.
   */
  maskImages?: ReadonlyMap<string, CanvasImageSource>;
  /** Viewing modes narrow what is drawn without changing the stored document. */
  soloLayerIds?: readonly string[];
  isolateGroupId?: string | null;
}

export interface RenderResult {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  widthPx: number;
  heightPx: number;
  renderedLayerIds: string[];
  skippedLayerIds: string[];
  warnings: string[];
}

export function createCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new ProjectError("CAPABILITY_UNAVAILABLE", "This runtime provides no canvas to render into.");
}

/**
 * Applies an adjustment stack to already-drawn pixels. Kept as a separate pass over image
 * data rather than a CSS filter so the result is identical in preview and export, and so a
 * worker or GPU path can replace it later without changing what it produces.
 */
export function applyAdjustments(data: Uint8ClampedArray, stack: AdjustmentStack): void {
  if (isDefaultAdjustments(stack)) return;

  const curve = buildToneCurve(stack);
  const gains = whiteBalanceGains(stack);
  const saturation = 1 + stack.saturation / 100;
  const hueRadians = (stack.hue * Math.PI) / 180;
  const cosHue = Math.cos(hueRadians);
  const sinHue = Math.sin(hueRadians);

  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue;

    let r = curve[data[index]] * gains.r;
    let g = curve[data[index + 1]] * gains.g;
    let b = curve[data[index + 2]] * gains.b;

    if (stack.hue !== 0) {
      // Rotation in YIQ space, which keeps luminance stable while shifting chroma.
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      const i = 0.596 * r - 0.274 * g - 0.322 * b;
      const q = 0.211 * r - 0.523 * g + 0.312 * b;
      const i2 = i * cosHue - q * sinHue;
      const q2 = i * sinHue + q * cosHue;
      r = y + 0.956 * i2 + 0.621 * q2;
      g = y - 0.272 * i2 - 0.647 * q2;
      b = y - 1.106 * i2 + 1.703 * q2;
    }

    if (saturation !== 1) {
      const grey = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = grey + (r - grey) * saturation;
      g = grey + (g - grey) * saturation;
      b = grey + (b - grey) * saturation;
    }

    data[index] = Math.max(0, Math.min(255, r));
    data[index + 1] = Math.max(0, Math.min(255, g));
    data[index + 2] = Math.max(0, Math.min(255, b));
  }
}

/**
 * Renders a document deterministically: the same layers, sources, and options always produce
 * the same pixels. That is what makes before/after comparison and agent previews meaningful
 * rather than approximate.
 */
export function renderDocument(
  document: RenderDocument,
  sources: readonly RenderSource[],
  options: RenderOptions = {},
): RenderResult {
  const scale = options.scale ?? 1;
  const width = Math.max(1, Math.round(document.widthPx * scale));
  const height = Math.max(1, Math.round(document.heightPx * scale));
  const excluded = new Set(options.excludeLayerIds ?? []);
  // Looked up by id all through the draw, so it is built once rather than searched per shape.
  const swatches = new Map((document.swatches ?? []).map((swatch) => [swatch.id, swatch]));

  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d") as (OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D) | null;
  if (!context) throw new ProjectError("CAPABILITY_UNAVAILABLE", "This browser did not provide a 2D drawing context.");

  context.clearRect(0, 0, width, height);
  if (document.background.type === "solid") {
    context.fillStyle = document.background.color;
    context.fillRect(0, 0, width, height);
  }

  const renderedLayerIds: string[] = [];
  const skippedLayerIds: string[] = [];
  const warnings: string[] = [];

  const visibleTree = applyViewingModes(document.layers, {
    soloLayerIds: options.soloLayerIds,
    isolateGroupId: options.isolateGroupId,
  });

  /**
   * A scratch surface, reused across layers.
   *
   * Adjustments used to be applied by reading a padded rectangle back off the shared canvas,
   * adjusting it, and writing it down again. That rectangle contained whatever was already
   * underneath and every pixel the layer's own alpha did not cover, so brightening a rotated
   * cut-out also brightened the background around it. Drawing the layer alone, adjusting
   * that, and compositing the result keeps a layer's colour work inside the layer.
   */
  let scratch: OffscreenCanvas | HTMLCanvasElement | null = null;
  let scratchContext: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;

  /**
   * A clipping run composites as a unit.
   *
   * A layer set to clip shows only where the one below it has pixels. Drawing it straight
   * onto the document would let it blend against everything already there rather than against
   * its base, so a run is drawn on its own surface, cut to the base's alpha, and put down
   * once. Runs of one — the ordinary case — cost nothing extra.
   */
  const resolved = resolveInheritance(visibleTree);
  const runs = clippingRuns(resolved.map((entry) => ({ id: entry.layer.id, clipToBelow: entry.layer.clipToBelow, entry })));
  const clippedBy = new Map<string, string>();
  for (const run of runs) {
    for (const member of run.clipped) clippedBy.set(member.id, run.base.id);
  }

  for (const entry of resolved) {
    const layer: ContentLayer = entry.layer;
    if (!entry.visible || excluded.has(layer.id)) { skippedLayerIds.push(layer.id); continue; }
    const clipBase = clippedBy.get(layer.id);

    // A graphics layer draws itself; only an image layer needs a decoded source.
    const source = layer.kind === "image"
      ? sources.find((candidate) => candidate.assetId === layer.assetId)
      : null;
    if (layer.kind === "image" && !source) {
      skippedLayerIds.push(layer.id);
      warnings.push(`“${layer.name}” could not be drawn because its image is unavailable.`);
      continue;
    }

    // Animated properties override the authored ones at this instant. A layer with no
    // animation resolves to exactly its stored values, so nothing changes for photo work.
    const animated = options.time && layer.animation.length
      ? evaluateTracks(layer.animation.filter((track) => track.enabled), options.time, {
        "transform.x": layer.transform.x, "transform.y": layer.transform.y,
        "transform.scaleX": layer.transform.scaleX, "transform.scaleY": layer.transform.scaleY,
        "transform.rotationDeg": layer.transform.rotationDeg, opacity: layer.opacity,
      })
      : null;
    const transform = animated
      ? {
        ...layer.transform,
        x: animated["transform.x"] ?? layer.transform.x,
        y: animated["transform.y"] ?? layer.transform.y,
        scaleX: animated["transform.scaleX"] ?? layer.transform.scaleX,
        scaleY: animated["transform.scaleY"] ?? layer.transform.scaleY,
        rotationDeg: animated["transform.rotationDeg"] ?? layer.transform.rotationDeg,
      }
      : layer.transform;
    const layerOpacity = animated?.opacity ?? layer.opacity;

    // Sampling happens in the bitmap's own pixels; the drawn size comes from the size the
    // transform was authored against, so a resampled derivative changes quality, not layout.
    const crop = layer.kind === "image" ? layer.crop : { left: 0, top: 0, right: 1, bottom: 1 };
    const sx = crop.left * (source?.widthPx ?? 0);
    const sy = crop.top * (source?.heightPx ?? 0);
    const sw = (crop.right - crop.left) * (source?.widthPx ?? 0);
    const sh = (crop.bottom - crop.top) * (source?.heightPx ?? 0);
    const nativeWidth = source?.nativeWidthPx ?? source?.widthPx ?? 0;
    const nativeHeight = source?.nativeHeightPx ?? source?.heightPx ?? 0;
    const drawWidth = (crop.right - crop.left) * nativeWidth * transform.scaleX * scale;
    const drawHeight = (crop.bottom - crop.top) * nativeHeight * transform.scaleY * scale;

    // A layer needs its own surface whenever anything has to happen to it in isolation:
    // colour work, a mask, a blend that must see the layer alone, or a clipping run.
    const activeEffects = layer.effects.effects.filter((effect) => effect.enabled);
    const activeMasks = layer.masks.filter((mask) => mask.enabled);

    const activeStyles = paintOrder(layer.styles.styles);
    const hasProfiles = layer.kind === "image" && layer.profiles.length > 0;
    const hasLens = isLensCorrected(layer.geometry.lens);
    const hasAdjustments = (layer.kind === "image" || layer.kind === "adjustment")
      && !isDefaultAdjustments(layer.adjustments);
    const adjusted = hasAdjustments
      || hasProfiles
      || hasLens
      || activeEffects.length > 0
      || activeMasks.length > 0
      || activeStyles.length > 0
      || layer.blendMode !== "normal"
      || clipBase !== undefined
      // An adjustment layer changes what is already on the document, so it always needs its
      // own surface: there is nothing of its own to draw.
      || layer.kind === "adjustment";
    let target: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D = context;

    if (adjusted) {
      if (!scratch || !scratchContext) {
        scratch = createCanvas(width, height);
        scratchContext = scratch.getContext("2d") as (OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D) | null;
        if (!scratchContext) throw new ProjectError("CAPABILITY_UNAVAILABLE", "This browser did not provide a 2D drawing context.");
      }
      scratchContext.setTransform(1, 0, 0, 1, 0, 0);
      scratchContext.clearRect(0, 0, width, height);
      target = scratchContext;
    }

    target.save();
    // Opacity is applied when the layer lands on the document, not while it is being drawn
    // in isolation, so an adjustment sees the layer's own colours rather than faded ones.
    target.globalAlpha = adjusted ? 1 : entry.opacity * (layerOpacity / (layer.opacity || 1));
    // Every ancestor group's transform, then the layer's own.
    const inherited = entry.matrix;
    target.transform(inherited.a, inherited.b, inherited.c, inherited.d, inherited.e * scale, inherited.f * scale);
    target.translate(transform.x * scale, transform.y * scale);
    target.rotate((transform.rotationDeg * Math.PI) / 180);
    target.scale(transform.flipX ? -1 : 1, transform.flipY ? -1 : 1);
    if (layer.kind === "adjustment") {
      // The document as it stands beneath this layer. Copying it here is what lets one
      // adjustment layer change every layer under it, including ones added later.
      target.setTransform(1, 0, 0, 1, 0, 0);
      target.drawImage(canvas as CanvasImageSource, 0, 0);
    } else if (layer.kind === "image" && source) {
      // The mesh is built in the bitmap's own pixels so each cell samples the right part of
      // it; the corners are then scaled out to the size the layer is being drawn at.
      const cells = sw > 0 && sh > 0 ? geometryCells(layer.geometry, sw, sh) : null;
      if (cells) {
        // A bent layer is drawn cell by cell from its own corner, because no single canvas
        // transform describes a perspective or a warp.
        target.translate(-drawWidth * transform.anchorX, -drawHeight * transform.anchorY);
        drawWarped(target, source.bitmap, cells, { x: sx, y: sy }, drawWidth / sw, drawHeight / sh);
      } else {
        target.drawImage(
          source.bitmap,
          sx, sy, sw, sh,
          -drawWidth * transform.anchorX, -drawHeight * transform.anchorY,
          drawWidth, drawHeight,
        );
      }
    } else if (layer.kind === "graphics") {
      // Text and vector draw from their own description at whatever scale is asked for,
      // which is what keeps them crisp rather than resampled.
      target.scale(scale, scale);
      const anchor = { x: transform.anchorX, y: transform.anchorY };
      if (layer.content.kind === "text") drawText(target, layer.content.text, anchor);
      else drawVector(target, layer.content.vector, swatches, anchor);
    } else if (layer.kind === "fill") {
      // A fill covers the whole document rather than a shape it was drawn at, which is why
      // it re-fits when the document is resized. It is almost always masked or clipped.
      target.setTransform(1, 0, 0, 1, 0, 0);
      const style = resolvePaint(target, layer.paint, { x: 0, y: 0, width, height }, swatches);
      if (style) {
        if (layer.paint.kind === "solid") target.globalAlpha *= layer.paint.opacity;
        target.fillStyle = style;
        target.fillRect(0, 0, width, height);
      } else if (layer.paint.kind === "swatch") {
        // A swatch that has gone leaves the layer unpainted rather than having a colour
        // invented for it, and says so.
        warnings.push(`“${layer.name}” points at a swatch that is no longer in the document.`);
      }
    } else if (layer.kind === "paint") {
      // Strokes are stored in the layer's own coordinates, so they are replayed at the render
      // scale rather than resampled from a buffer drawn at some other size.
      target.setTransform(1, 0, 0, 1, 0, 0);
      // Retouching brushes read the document beneath this layer, which is what makes a clone
      // copy the photograph rather than the empty surface the strokes are drawn on.
      drawStrokes(target, layer.strokes.strokes, document.widthPx, document.heightPx, scale, swatches, canvas);
    }
    target.restore();

    if (adjusted && scratch && scratchContext) {
      // Only the layer's own pixels are non-transparent here, so colour work reaches exactly
      // the layer and nothing else.
      if (hasAdjustments || hasProfiles || hasLens || activeEffects.length) {
        const imageData = scratchContext.getImageData(0, 0, width, height);
        // Lens correction comes first: it undoes what the glass did, so everything after it
        // works on a picture that is already geometrically true.
        applyLensCorrection(imageData.data, width, height, layer.geometry.lens);
        // Then the profile, which is the starting point everything else is an edit away from.
        if (layer.kind === "image") {
          for (const profile of layer.profiles) {
            applyProfile(imageData.data, profile, { widthPx: width, heightPx: height });
          }
        }
        if (layer.kind === "image" || layer.kind === "adjustment") applyAdjustments(imageData.data, layer.adjustments);
        // The container's effects run in order after the layer's own adjustments, which is
        // what makes them reorderable rather than a single flat setting.
        applyEffects(imageData.data, activeEffects, width, height);
        scratchContext.putImageData(imageData, 0, 0);
      }

      // Styles are drawn from the layer's own shape, so they belong here — after the layer is
      // alone on its surface and before any mask, which should cut the styles too.
      if (activeStyles.length) drawStyles(scratchContext, scratch, activeStyles, width, height, scale);

      for (const mask of activeMasks) {
        applyMask(scratchContext, mask, width, height, scale, sources, visibleTree, options.maskImages);
      }

      // Clipping is a mask whose shape is the base layer's own alpha, so it reuses the same
      // painter rather than a second implementation that could disagree with it.
      if (clipBase) {
        applyMask(
          scratchContext,
          { id: `clip_${layer.id}`, source: { kind: "layer_alpha", layerId: clipBase }, featherPx: 0, density: 1, inverted: false, enabled: true },
          width, height, scale, sources, visibleTree, options.maskImages,
        );
      }

      context.save();
      context.globalAlpha = entry.opacity * (layerOpacity / (layer.opacity || 1));
      // The blend happens here, where the layer meets what is already on the document. Doing
      // it while drawing would blend the layer against an empty surface, which is a no-op.
      //
      // An adjustment layer is the exception. Its surface *is* the document beneath it, so it
      // replaces rather than stacks. Where it covers everything, `copy` says exactly that and
      // avoids compounding alpha with itself; where a mask or partial opacity means it covers
      // only part, it has to draw over instead, and semi-transparent pixels under the mask
      // gain a little alpha as a result.
      const replacesWholly = layer.kind === "adjustment"
        && layer.blendMode === "normal"
        && !activeMasks.length
        && !clipBase
        && entry.opacity * (layerOpacity / (layer.opacity || 1)) === 1;
      context.globalCompositeOperation = replacesWholly ? "copy" : compositeOperationFor(layer.blendMode);
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.drawImage(scratch as CanvasImageSource, 0, 0);
      context.restore();
    }

    renderedLayerIds.push(layer.id);
  }

  return { canvas, widthPx: width, heightPx: height, renderedLayerIds, skippedLayerIds, warnings };
}

/**
 * Undoes what the lens did: the radial bend, the colour fringing, and the corner darkening.
 *
 * The map runs backwards — for each output pixel, find where it came from — because working
 * forwards leaves holes wherever the correction spreads pixels apart. The three corrections
 * share one pass because they share one radius calculation, and doing them separately would
 * mean resampling the image three times.
 */
function applyLensCorrection(
  data: Uint8ClampedArray, widthPx: number, heightPx: number, correction: LensCorrection,
): void {
  if (!isLensCorrected(correction)) return;
  const original = new Uint8ClampedArray(data);
  const bends = correction.distortion !== 0 || correction.distortionFine !== 0 || correction.chromaticAberration !== 0;

  for (let y = 0; y < heightPx; y += 1) {
    for (let x = 0; x < widthPx; x += 1) {
      const target = (y * widthPx + x) * 4;

      if (bends) {
        const from = undistort({ x, y }, widthPx, heightPx, correction);
        // Each colour is read at a slightly different radius, which is what cancels the
        // fringing a lens leaves at the edges.
        const spread = correction.chromaticAberration * 0.004;
        for (let channel = 0; channel < 3; channel += 1) {
          const offset = spread * (channel - 1);
          const sx = Math.round((from.x - widthPx / 2) * (1 + offset) + widthPx / 2);
          const sy = Math.round((from.y - heightPx / 2) * (1 + offset) + heightPx / 2);
          // Outside the original frame there is nothing to read, so the pixel is left empty
          // rather than filled with an invented edge colour.
          const inside = sx >= 0 && sx < widthPx && sy >= 0 && sy < heightPx;
          data[target + channel] = inside ? original[(sy * widthPx + sx) * 4 + channel] : 0;
        }
        const sx = Math.round(from.x);
        const sy = Math.round(from.y);
        data[target + 3] = sx >= 0 && sx < widthPx && sy >= 0 && sy < heightPx
          ? original[(sy * widthPx + sx) * 4 + 3]
          : 0;
      }

      if (correction.vignette !== 0) {
        const gain = vignetteAt({ x, y }, widthPx, heightPx, correction.vignette);
        data[target] *= gain;
        data[target + 1] *= gain;
        data[target + 2] *= gain;
      }
    }
  }
}

/**
 * Draws a layer through its geometry: keystone correction, warping, and lens correction.
 *
 * Canvas cannot draw a projective transform, only an affine one, so anything with perspective
 * in it is drawn as triangles. Each triangle *does* have an exact affine map to where it
 * lands, so the picture is correct rather than approximated; splitting it finely enough is
 * what keeps the seams invisible.
 */
function drawWarped(
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  image: CanvasImageSource,
  cells: readonly MeshCell[],
  /** Where the crop starts in the bitmap, so a cropped layer samples the right pixels. */
  origin: Point,
  /** Bitmap pixels to drawn pixels, which is not 1:1 for a scaled or proxied layer. */
  scaleX: number,
  scaleY: number,
): void {
  for (const cell of cells) {
    const source = { ...cell.source, x: cell.source.x + origin.x, y: cell.source.y + origin.y };
    const [tl, tr, br, bl] = cell.corners;
    // Two triangles per cell, sharing the diagonal so no gap can open along it.
    drawTriangle(context, image, source, [{ u: 0, v: 0 }, { u: 1, v: 0 }, { u: 0, v: 1 }], [tl, tr, bl], scaleX, scaleY);
    drawTriangle(context, image, source, [{ u: 1, v: 0 }, { u: 1, v: 1 }, { u: 0, v: 1 }], [tr, br, bl], scaleX, scaleY);
  }
}

/**
 * One texture-mapped triangle.
 *
 * The affine matrix that carries the source triangle onto the destination one is solved
 * directly; clipping to the destination keeps each triangle to its own share of the picture,
 * which is what stops the whole image being drawn three times per cell.
 */
function drawTriangle(
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  image: CanvasImageSource,
  source: { x: number; y: number; width: number; height: number },
  uv: readonly { u: number; v: number }[],
  destination: readonly Point[],
  scaleX: number,
  scaleY: number,
): void {
  const sx = uv.map((corner) => source.x + corner.u * source.width);
  const sy = uv.map((corner) => source.y + corner.v * source.height);
  const dx = destination.map((point) => point.x * scaleX);
  const dy = destination.map((point) => point.y * scaleY);

  const denominator = (sx[1] - sx[0]) * (sy[2] - sy[0]) - (sx[2] - sx[0]) * (sy[1] - sy[0]);
  // A degenerate triangle covers no area, so there is nothing to draw and nothing to warn about.
  if (Math.abs(denominator) < 1e-9) return;

  const a = ((dx[1] - dx[0]) * (sy[2] - sy[0]) - (dx[2] - dx[0]) * (sy[1] - sy[0])) / denominator;
  const b = ((dy[1] - dy[0]) * (sy[2] - sy[0]) - (dy[2] - dy[0]) * (sy[1] - sy[0])) / denominator;
  const c = ((dx[2] - dx[0]) * (sx[1] - sx[0]) - (dx[1] - dx[0]) * (sx[2] - sx[0])) / denominator;
  const d = ((dy[2] - dy[0]) * (sx[1] - sx[0]) - (dy[1] - dy[0]) * (sx[2] - sx[0])) / denominator;

  context.save();
  context.beginPath();
  context.moveTo(dx[0], dy[0]);
  context.lineTo(dx[1], dy[1]);
  context.lineTo(dx[2], dy[2]);
  context.closePath();
  context.clip();
  context.transform(a, b, c, d, dx[0] - a * sx[0] - c * sy[0], dy[0] - b * sx[0] - d * sy[0]);
  context.drawImage(image, 0, 0);
  context.restore();
}

/**
 * The mesh a layer's geometry describes, or null when it has none.
 *
 * Perspective and warp both come out as cells, so the renderer has one path rather than two.
 * A perspective correction is a single cell subdivided finely enough that the projective
 * curve is not visible in the straight-line approximation between its corners.
 */
function geometryCells(
  geometry: LayerGeometry, widthPx: number, heightPx: number,
): MeshCell[] | null {
  if (geometry.warp && !isMeshFlat(geometry.warp)) {
    return meshCells(geometry.warp, widthPx, heightPx);
  }
  if (geometry.perspective) {
    const matrix = keystoneMatrix(geometry.perspective, widthPx, heightPx);
    const back = invertMatrix(matrix);
    if (!back) return null;
    // 8×8 is fine enough that the straight edges between neighbouring corners are within a
    // pixel of the true curve at ordinary photograph sizes.
    const steps = 8;
    const cells: MeshCell[] = [];
    const cellWidth = widthPx / steps;
    const cellHeight = heightPx / steps;
    for (let row = 0; row < steps; row += 1) {
      for (let column = 0; column < steps; column += 1) {
        const corner = (cx: number, cy: number) => applyMatrix(back, { x: cx * cellWidth, y: cy * cellHeight });
        cells.push({
          source: { x: column * cellWidth, y: row * cellHeight, width: cellWidth, height: cellHeight },
          corners: [
            corner(column, row), corner(column + 1, row),
            corner(column + 1, row + 1), corner(column, row + 1),
          ],
        });
      }
    }
    return cells;
  }
  return null;
}

/**
 * Turns a paint description into something the canvas can fill with.
 *
 * Gradients are built here rather than at the model, because a gradient's coordinates are
 * normalised so the same description survives a resize, and turning them into pixels needs the
 * box being painted. A swatch resolves to whatever it names, so changing the swatch changes
 * everything using it; a swatch that has gone leaves the shape unpainted rather than having a
 * colour invented for it.
 */
/**
 * Exported because a sequence paints gradients too. It carries no swatch table, so it passes
 * `undefined` and gets `null` back for a swatch reference rather than a colour invented for
 * it — but a linear or radial gradient with inline stops resolves here exactly as it does on
 * a photo, which is what stops the two compositors disagreeing about what a fill looks like.
 */
export function resolvePaint(
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  paint: Paint,
  box: { x: number; y: number; width: number; height: number },
  swatches: ReadonlyMap<string, Swatch> | undefined,
  depth = 0,
): string | CanvasGradient | null {
  if (paint.kind === "none") return null;
  if (paint.kind === "solid") return paint.colour;

  if (paint.kind === "swatch") {
    // A swatch pointing at another swatch would loop for ever; one hop is all that is needed
    // and all that is allowed.
    if (depth > 0) return null;
    const swatch = swatches?.get(paint.swatchId);
    return swatch ? resolvePaint(context, swatch.paint, box, swatches, depth + 1) : null;
  }

  const gradient = paint.kind === "linear"
    ? context.createLinearGradient(
      box.x + paint.x1 * box.width, box.y + paint.y1 * box.height,
      box.x + paint.x2 * box.width, box.y + paint.y2 * box.height,
    )
    : context.createRadialGradient(
      box.x + paint.cx * box.width, box.y + paint.cy * box.height, 0,
      box.x + paint.cx * box.width, box.y + paint.cy * box.height,
      paint.radius * Math.max(box.width, box.height),
    );

  for (const stop of paint.stops) {
    // Canvas takes the stop's own opacity as part of its colour, so the two are combined here
    // rather than by fading the whole shape, which would fade its other stops too.
    gradient.addColorStop(
      Math.max(0, Math.min(1, stop.offset)),
      stop.opacity >= 1 ? stop.colour : withAlpha(stop.colour, stop.opacity),
    );
  }
  return gradient;
}

/** A hex colour as `rgba`, so a gradient stop can carry its own transparency. */
function withAlpha(colour: string, alpha: number): string {
  const value = parseInt(colour.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/**
 * Replays a painted layer's strokes.
 *
 * Each stamp is a radial gradient from the colour to nothing, which is how a soft brush edge
 * is drawn without a second buffer per stamp; a hardness of 1 puts the transparent stop right
 * at the rim, giving a crisp edge from the same code. An eraser is the same drawing with
 * `destination-out`, so there is one painter rather than two that could disagree.
 *
 * Retouching brushes take a different path, because they change what is already there rather
 * than laying down colour — but they share the stamps, the dynamics, and the spacing, which is
 * what makes a dodge feel like a brush rather than like a filter with a mask.
 */
function drawStrokes(
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  strokes: readonly Stroke[],
  widthPx: number,
  heightPx: number,
  scale: number,
  swatches: ReadonlyMap<string, Swatch> | undefined,
  /** The document beneath this layer, which retouching brushes read from. */
  beneath: OffscreenCanvas | HTMLCanvasElement | null,
): void {
  for (const stroke of strokes) {
    if (isRetouch(stroke.brush.kind)) {
      if (beneath) drawRetouch(context, stroke, beneath, scale);
      continue;
    }

    const colour = resolvePaint(context, stroke.paint, { x: 0, y: 0, width: widthPx, height: heightPx }, swatches);
    // An eraser removes whatever is there, so it needs no colour of its own.
    if (!colour && stroke.brush.kind !== "eraser") continue;

    context.save();
    context.globalCompositeOperation = stroke.brush.kind === "eraser" ? "destination-out" : "source-over";

    for (const stamp of stampsFor(stroke)) {
      const radius = stamp.radiusPx * scale;
      if (radius <= 0) continue;
      context.save();
      context.globalAlpha = stamp.opacity * stamp.flow;
      context.translate(stamp.x * scale, stamp.y * scale);
      context.rotate((stamp.angleDeg * Math.PI) / 180);
      context.scale(1, stamp.roundness);

      if (stroke.brush.kind === "eraser") {
        context.fillStyle = "#000000";
      } else if (typeof colour === "string" && stamp.hardness < 1) {
        const soft = context.createRadialGradient(0, 0, radius * stamp.hardness, 0, 0, radius);
        soft.addColorStop(0, colour);
        soft.addColorStop(1, withAlpha(colour, 0));
        context.fillStyle = soft;
      } else {
        context.fillStyle = colour!;
      }

      context.beginPath();
      context.arc(0, 0, radius, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
    context.restore();
  }
}

/**
 * A retouching stroke: clone, dodge, burn, sponge, blur, sharpen, smudge, and red eye.
 *
 * All eight read the picture beneath, change it, and lay the result back down through the
 * brush's own soft edge — so they build up as a stroke crosses itself, taper with pressure,
 * and stop at a selection, exactly as painting does. Everything except cloning works on a copy
 * of the region under each stamp, which is what keeps a blur from feeding on its own output
 * and turning into a smear.
 */
function drawRetouch(
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  stroke: Stroke,
  beneath: OffscreenCanvas | HTMLCanvasElement,
  scale: number,
): void {
  const source = beneath.getContext("2d") as (OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D) | null;
  if (!source) return;
  const kind = stroke.brush.kind;
  const strength = stroke.strength;

  for (const stamp of stampsFor(stroke)) {
    const radius = Math.max(1, Math.round(stamp.radiusPx * scale));
    const size = radius * 2;
    const x = Math.round(stamp.x * scale) - radius;
    const y = Math.round(stamp.y * scale) - radius;
    if (x + size <= 0 || y + size <= 0 || x >= beneath.width || y >= beneath.height) continue;

    // Cloning and healing read from wherever the offset points; everything else reads from
    // under the brush itself.
    const samples = kind === "clone" || kind === "heal";
    const readX = samples && stroke.cloneOffset ? x + Math.round(stroke.cloneOffset.x * scale) : x;
    const readY = samples && stroke.cloneOffset ? y + Math.round(stroke.cloneOffset.y * scale) : y;

    let patch: ImageData;
    try {
      patch = source.getImageData(readX, readY, size, size);
    } catch {
      // Reading outside the surface is not an error worth stopping a stroke for; that stamp
      // simply has nothing to work from.
      continue;
    }

    if (kind === "heal") {
      // Healing needs both: the texture it is borrowing and the tone it has to match.
      let destination: ImageData | null = null;
      try { destination = source.getImageData(x, y, size, size); } catch { destination = null; }
      if (!destination) continue;
      healPatch(patch, destination, strength);
    } else if (kind !== "clone") {
      applyRetouchPixels(patch, kind, strength, radius);
    }

    const stampCanvas = createCanvas(size, size);
    const stampContext = stampCanvas.getContext("2d") as (OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D) | null;
    if (!stampContext) continue;
    stampContext.putImageData(patch, 0, 0);

    // Cut the patch to the brush's shape before it is laid down, so a retouch has the same
    // soft edge as a painted stroke rather than a hard square one.
    stampContext.globalCompositeOperation = "destination-in";
    const mask = stampContext.createRadialGradient(radius, radius, radius * stamp.hardness, radius, radius, radius);
    mask.addColorStop(0, "rgba(0,0,0,1)");
    mask.addColorStop(1, "rgba(0,0,0,0)");
    stampContext.fillStyle = mask;
    stampContext.fillRect(0, 0, size, size);

    context.save();
    context.globalAlpha = stamp.opacity * stamp.flow;
    context.drawImage(stampCanvas as CanvasImageSource, x, y);
    context.restore();
  }
}

/** What each retouching brush does to the pixels under one stamp. */
function applyRetouchPixels(patch: ImageData, kind: string, strength: number, radius: number): void {
  const { data, width, height } = patch;

  if (kind === "blur" || kind === "sharpen" || kind === "smudge") {
    const original = new Uint8ClampedArray(data);
    // A one-pixel box average. Sharpening is the same average subtracted rather than added,
    // which is what unsharp masking is; smudging shifts the average along, which drags colour.
    const shift = kind === "smudge" ? Math.max(1, Math.round(radius / 4)) : 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const target = (y * width + x) * 4;
        for (let channel = 0; channel < 3; channel += 1) {
          let total = 0;
          let count = 0;
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              const sx = Math.min(width - 1, Math.max(0, x + dx - shift));
              const sy = Math.min(height - 1, Math.max(0, y + dy));
              total += original[(sy * width + sx) * 4 + channel];
              count += 1;
            }
          }
          const average = total / count;
          const value = kind === "sharpen"
            ? original[target + channel] + (original[target + channel] - average) * strength * 2
            : original[target + channel] + (average - original[target + channel]) * strength;
          data[target + channel] = value;
        }
      }
    }
    return;
  }

  for (let index = 0; index < data.length; index += 4) {
    if (kind === "dodge" || kind === "burn") {
      // Multiplying towards white or towards black keeps the change proportional, so a
      // highlight does not blow out as fast as a midtone lifts.
      const factor = kind === "dodge" ? 1 + strength * 0.5 : 1 - strength * 0.5;
      data[index] *= factor;
      data[index + 1] *= factor;
      data[index + 2] *= factor;
    } else if (kind === "sponge") {
      // Towards grey at the pixel's own brightness, so a sponge desaturates without darkening.
      const luma = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
      for (let channel = 0; channel < 3; channel += 1) {
        data[index + channel] += (luma - data[index + channel]) * strength;
      }
    } else if (kind === "red_eye") {
      // Only pixels that are actually red are touched, so an eyelash or an iris beside the
      // pupil is left alone rather than turned grey along with it.
      const red = data[index];
      const other = Math.max(data[index + 1], data[index + 2]);
      if (red > other * 1.6 && red > 60) {
        const neutral = (data[index + 1] + data[index + 2]) / 2;
        data[index] += (neutral - red) * strength;
      }
    }
  }
}

/**
 * Runs a container's effects over already-drawn pixels, in order.
 *
 * One door for all three kinds, so a photo layer and a video clip apply an effect list
 * identically. Kept here beside the other painters rather than in each compositor, because a
 * second copy is a second thing to keep in step.
 */
export function applyEffects(
  data: Uint8ClampedArray,
  effects: readonly Effect[],
  widthPx: number,
  heightPx: number,
): void {
  for (const effect of effects) {
    if (!effect.enabled) continue;
    if (effect.kind === "colour") applyColourOperation(data, effect.operation, { widthPx, heightPx });
    else if (effect.kind === "filter") applyFilter(data, widthPx, heightPx, effect.filter);
    else applyAdjustments(data, effect.parameters);
  }
}

/** Points evenly around a circle, used to grow and shrink a silhouette. */
function ring(radius: number): { dx: number; dy: number }[] {
  const steps = Math.max(8, Math.round(radius * 4));
  return Array.from({ length: steps }, (_, step) => {
    const angle = (step / steps) * Math.PI * 2;
    return { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius };
  });
}

/**
 * Grows or shrinks a silhouette by drawing it repeatedly around a circle.
 *
 * Union of the offsets grows it; intersection shrinks it. `source-over` is the union and
 * `destination-in` is the intersection, so both come from one loop with one operation swapped,
 * which is the same trick the selection engine uses on coverage bytes.
 */
function spread(
  shape: OffscreenCanvas | HTMLCanvasElement,
  radius: number, grow: boolean, width: number, height: number,
): OffscreenCanvas | HTMLCanvasElement | null {
  const result = createCanvas(width, height);
  const context = result.getContext("2d") as (OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D) | null;
  if (!context) return null;
  context.drawImage(shape as CanvasImageSource, 0, 0);
  context.globalCompositeOperation = grow ? "source-over" : "destination-in";
  for (const { dx, dy } of ring(radius)) context.drawImage(shape as CanvasImageSource, dx, dy);
  return result;
}

/** A solid-coloured copy of a silhouette, which is what every style is built from. */
function tint(
  shape: OffscreenCanvas | HTMLCanvasElement,
  colour: string, width: number, height: number, invert = false,
): OffscreenCanvas | HTMLCanvasElement | null {
  const result = createCanvas(width, height);
  const context = result.getContext("2d") as (OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D) | null;
  if (!context) return null;
  context.fillStyle = colour;
  context.fillRect(0, 0, width, height);
  // Keeping where the shape is gives the shape in that colour; cutting it out gives
  // everything around it, which is what an inner shadow is cast from.
  context.globalCompositeOperation = invert ? "destination-out" : "destination-in";
  context.drawImage(shape as CanvasImageSource, 0, 0);
  return result;
}

/**
 * Draws a source's *shadow only*, with the source itself off the canvas.
 *
 * Canvas draws a shadow as a side effect of drawing the thing casting it. Pushing the draw
 * one canvas-width to the left and adding that width back to the shadow's offset lands the
 * shadow exactly where it belongs while the source misses the surface entirely.
 */
function drawShadowOnly(
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  source: OffscreenCanvas | HTMLCanvasElement,
  colour: string, blurPx: number, dx: number, dy: number, width: number,
): void {
  context.shadowColor = colour;
  context.shadowBlur = blurPx;
  context.shadowOffsetX = dx + width;
  context.shadowOffsetY = dy;
  context.drawImage(source as CanvasImageSource, -width, 0);
  context.shadowColor = "transparent";
  context.shadowBlur = 0;
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 0;
}

/**
 * Draws a layer's styles from its own shape.
 *
 * Everything here works from the layer's alpha rather than from what the layer is, which is
 * why one implementation serves text, vectors, photographs, clips, and fills alike. Two
 * composite operations carry the whole thing: `destination-over` puts a shadow or an outer
 * glow behind the layer without touching it, and `source-atop` keeps an overlay or an inner
 * shadow inside its shape.
 *
 * Exported because both compositors call it, for the same reason `applyMask` is.
 */
export function drawStyles(
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  surface: OffscreenCanvas | HTMLCanvasElement,
  styles: readonly LayerStyle[],
  width: number,
  height: number,
  scale: number,
): void {
  // A copy of the layer alone, because every style draws the shape again while the surface
  // itself is being written to.
  const shape = createCanvas(width, height);
  const shapeContext = shape.getContext("2d") as (OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D) | null;
  if (!shapeContext) return;
  shapeContext.drawImage(surface as CanvasImageSource, 0, 0);

  for (const style of styles) {
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = style.opacity;
    context.globalCompositeOperation = compositeOperationFor(style.blendMode);

    if (style.kind === "drop_shadow") {
      const { dx, dy } = shadowOffset(style.angleDegrees, style.distancePx * scale);
      const cast = style.spreadPx > 0 ? spread(shape, style.spreadPx * scale, true, width, height) : shape;
      if (cast) {
        // Behind the layer, so the shape casting it stays untouched.
        if (style.blendMode === "normal") context.globalCompositeOperation = "destination-over";
        drawShadowOnly(context, cast, style.colour, style.blurPx * scale, dx, dy, width);
      }
    } else if (style.kind === "inner_shadow") {
      const { dx, dy } = shadowOffset(style.angleDegrees, style.distancePx * scale);
      // Cast from everything *around* the shape, kept inside it: that is what reads as depth.
      const around = tint(shape, style.colour, width, height, true);
      if (around) {
        context.globalCompositeOperation = "source-atop";
        drawShadowOnly(context, around, style.colour, style.blurPx * scale, dx, dy, width);
      }
    } else if (style.kind === "glow") {
      const outer = style.direction === "outer";
      const from = outer
        ? (style.spreadPx > 0 ? spread(shape, style.spreadPx * scale, true, width, height) : shape)
        : tint(shape, style.colour, width, height, true);
      if (from) {
        context.globalCompositeOperation = outer
          ? (style.blendMode === "normal" ? "destination-over" : compositeOperationFor(style.blendMode))
          : "source-atop";
        drawShadowOnly(context, from, style.colour, style.sizePx * scale, 0, 0, width);
      }
    } else if (style.kind === "overlay") {
      if (style.paint.kind === "solid") {
        context.globalAlpha = style.opacity * style.paint.opacity;
        context.globalCompositeOperation = "source-atop";
        context.fillStyle = style.paint.colour;
        context.fillRect(0, 0, width, height);
      }
      // A gradient or swatch overlay needs a resolved paint server; none is invented here.
    } else if (style.kind === "bevel") {
      // A bevel is two shadows of the shape, offset opposite ways and kept inside it. Raised
      // and pressed are the same drawing with the two colours swapped.
      const { dx, dy } = shadowOffset(style.angleDegrees, style.sizePx * scale);
      const lit = style.direction === "raised" ? style.highlightColour : style.shadowColour;
      const dark = style.direction === "raised" ? style.shadowColour : style.highlightColour;
      const around = tint(shape, "#000000", width, height, true);
      if (around) {
        context.globalCompositeOperation = "source-atop";
        drawShadowOnly(context, around, lit, style.softnessPx * scale, dx, dy, width);
        drawShadowOnly(context, around, dark, style.softnessPx * scale, -dx, -dy, width);
      }
    } else if (style.kind === "stroke" && style.paint.kind === "solid") {
      const radius = Math.max(1, style.widthPx * scale);
      // Centre splits the width either side of the edge, which is what "centre" means.
      const outwards = style.position === "centre" ? radius / 2 : radius;
      const inwards = style.position === "centre" ? radius / 2 : radius;

      if (style.position !== "inside") {
        const grown = spread(shape, outwards, true, width, height);
        const band = grown && tint(grown, style.paint.colour, width, height);
        if (band) {
          // Cut the shape back out so the stroke is a band rather than a filled slab, then
          // put it behind the layer.
          const bandContext = band.getContext("2d") as (OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D) | null;
          if (bandContext) {
            bandContext.globalCompositeOperation = "destination-out";
            bandContext.drawImage(shape as CanvasImageSource, 0, 0);
          }
          context.globalCompositeOperation = "destination-over";
          context.drawImage(band as CanvasImageSource, 0, 0);
        }
      }
      if (style.position !== "outside") {
        const shrunk = spread(shape, inwards, false, width, height);
        const band = tint(shape, style.paint.colour, width, height);
        const bandContext = band?.getContext("2d") as (OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D) | null;
        if (band && bandContext && shrunk) {
          bandContext.globalCompositeOperation = "destination-out";
          bandContext.drawImage(shrunk as CanvasImageSource, 0, 0);
          context.globalCompositeOperation = "source-over";
          context.drawImage(band as CanvasImageSource, 0, 0);
        }
      }
    }

    context.restore();
  }
}

/**
 * Draws a text block from its own description.
 *
 * Line breaking is done here rather than by the browser because a paragraph box needs its
 * own wrapping, and because the same measurement has to serve the canvas and the bounds an
 * inspector reports.
 */
/** One laid-out line, in the block's own coordinates. */
interface TextLine {
  text: string;
  x: number;
  y: number;
  width: number;
  sizePx: number;
  colour: string;
  font: string;
  underline: boolean;
  strikethrough: boolean;
}

/**
 * Lays a block out without drawing it, so the caller can know its size before committing
 * to a position. Measuring needs a context — `measureText` is the only accurate width
 * available in a canvas — so one is passed in and left with its font changed; every caller
 * already draws inside a save/restore pair.
 */
export function layoutText(
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  block: TextBlock,
): { lines: TextLine[]; width: number; height: number } {
  const maxWidth = block.layout.kind === "paragraph" ? block.layout.widthPx : Infinity;
  const lines: TextLine[] = [];
  let y = 0;

  paragraphsOf(block).forEach((paragraph, index) => {
    const style = styleForParagraph(block, index);
    const formatting = formattingAt(block, 0);
    const font = cssFont(formatting.font, formatting.sizePx);
    context.font = font;
    const lineHeight = formatting.sizePx * style.leading;
    y += style.spaceBeforePx;

    // Greedy wrapping: the standard behaviour, and the one a user predicts.
    const words = paragraph.split(" ");
    let line = "";
    const wrapped: string[] = [];
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (maxWidth !== Infinity && measure(context, candidate, formatting.trackingMille) > maxWidth && line) {
        wrapped.push(line);
        line = word;
      } else line = candidate;
    }
    wrapped.push(line);

    for (const text of wrapped) {
      const width = measure(context, text, formatting.trackingMille);
      const x = style.alignment === "center" ? (maxWidth === Infinity ? -width / 2 : (maxWidth - width) / 2)
        : style.alignment === "end" ? (maxWidth === Infinity ? -width : maxWidth - width)
          : style.indentStartPx;
      lines.push({
        text, x, y, width,
        sizePx: formatting.sizePx, colour: formatting.colour, font,
        underline: formatting.underline, strikethrough: formatting.strikethrough,
      });
      y += lineHeight;
    }
    y += style.spaceAfterPx;
  });

  const left = lines.length ? Math.min(...lines.map((line) => line.x)) : 0;
  const right = lines.length ? Math.max(...lines.map((line) => line.x + line.width)) : 0;
  return { lines, width: right - left, height: y };
}

/**
 * Tracking is stored in mille — thousandths of an em — because that is how type is specified
 * and how it survives a size change. Canvas has `letterSpacing`, but it is not in every
 * engine that runs this code, so the width is computed rather than asked for.
 */
function measure(
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  text: string,
  trackingMille: number,
): number {
  const base = context.measureText(text).width;
  if (trackingMille === 0 || text.length === 0) return base;
  const size = parseFloat(context.font) || 0;
  return base + (trackingMille / 1000) * size * text.length;
}

export function drawText(
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  block: TextBlock,
  /**
   * Where the layer's origin sits inside the block, matching the layer transform's anchor.
   * Without it a centred text layer put the top-left of its first line on the centre point
   * and ran off to the right, so "centre this title" produced something visibly off-centre.
   */
  anchor: { x: number; y: number } = { x: 0, y: 0 },
): void {
  context.textBaseline = "top";
  const laid = layoutText(context, block);
  const offsetX = -laid.width * anchor.x;
  const offsetY = -laid.height * anchor.y;

  for (const line of laid.lines) {
    context.font = line.font;
    context.fillStyle = line.colour;
    const x = line.x + offsetX;
    const y = line.y + offsetY;
    if (block.trackingMille === 0) {
      context.fillText(line.text, x, y);
    } else {
      // Per-character placement, because the width the layout measured has to be the width
      // that gets drawn or alignment and the underline stop agreeing with the glyphs.
      const extra = (block.trackingMille / 1000) * line.sizePx;
      let pen = x;
      for (const character of line.text) {
        context.fillText(character, pen, y);
        pen += context.measureText(character).width + extra;
      }
    }
    if (line.underline) context.fillRect(x, y + line.sizePx, line.width, Math.max(1, line.sizePx / 16));
    if (line.strikethrough) context.fillRect(x, y + line.sizePx / 2, line.width, Math.max(1, line.sizePx / 16));
  }
}

/** Draws a vector object from its commands, so it stays crisp at any scale. */
export function drawVector(
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  object: VectorObject,
  swatches: ReadonlyMap<string, Swatch> | undefined,
  /** As for text: the layer transform's anchor, so a centred shape is centred. */
  anchor: { x: number; y: number } = { x: 0, y: 0 },
): void {
  if (typeof Path2D !== "function") return;
  const path = new Path2D(toPathData(toCommands(object.shape)));

  // Gradients are laid out across the shape's own box, so a gradient fill follows the shape
  // as it is resized rather than staying where it was first drawn.
  const box = shapeBounds(object.shape);
  if (anchor.x !== 0 || anchor.y !== 0) {
    context.translate(-(box.x + box.width * anchor.x), -(box.y + box.height * anchor.y));
  }
  const paintStyle = (paint: VectorObject["fill"]) => resolvePaint(context, paint, box, swatches);

  const fill = paintStyle(object.fill);
  if (fill) {
    context.fillStyle = fill;
    context.fill(path, object.fillRule);
  }
  if (object.stroke) {
    const stroke = paintStyle(object.stroke.paint);
    if (stroke) {
      context.strokeStyle = stroke;
      context.lineWidth = object.stroke.widthPx;
      context.lineCap = object.stroke.cap;
      context.lineJoin = object.stroke.join;
      if (object.stroke.dash.length) context.setLineDash([...object.stroke.dash]);
      context.stroke(path);
      context.setLineDash([]);
    }
  }
}

/**
 * Cuts a layer's surface down to what its mask allows.
 *
 * `destination-in` keeps the destination only where the source has alpha, which is exactly a
 * mask. An inverted mask uses `destination-out` instead — the same shape, removing rather
 * than keeping — so a hole and a window are one code path with one flag between them.
 *
 * Density is applied as alpha on the mask itself rather than on the layer, so a half-strength
 * mask leaves the layer half-visible outside it instead of halving the whole layer.
 */
/**
 * Cuts a surface down to a mask.
 *
 * Exported rather than duplicated at each call site. Two implementations of one idea drift the
 * first time only one of them is fixed, and a mask that composites differently in two places is
 * the kind of bug that is only ever found in an exported file.
 */
export function applyMask(
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  mask: Mask,
  width: number,
  height: number,
  scale: number,
  sources: readonly RenderSource[],
  layers: readonly Layer[],
  maskImages: ReadonlyMap<string, CanvasImageSource> | undefined,
): void {
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = mask.inverted ? "destination-out" : "destination-in";
  // Density below 1 lets some of the masked-away area survive.
  context.globalAlpha = mask.density;
  if (mask.featherPx > 0) context.filter = `blur(${mask.featherPx * scale}px)`;

  if (mask.source.kind === "shape") {
    const x = mask.source.x * width;
    const y = mask.source.y * height;
    const w = mask.source.width * width;
    const h = mask.source.height * height;
    context.fillStyle = "#ffffff";
    context.beginPath();
    if (mask.source.shape === "ellipse") {
      context.ellipse(x + w / 2, y + h / 2, Math.max(0, w / 2), Math.max(0, h / 2), 0, 0, Math.PI * 2);
    } else if (mask.source.cornerRadius > 0 && typeof context.roundRect === "function") {
      context.roundRect(x, y, w, h, (Math.min(w, h) / 2) * mask.source.cornerRadius);
    } else {
      context.rect(x, y, w, h);
    }
    context.fill();
  } else if (mask.source.kind === "layer_alpha") {
    const maskLayerId = mask.source.layerId;
    // The masking layer's own alpha, drawn where it sits. Anything else would mask against a
    // shape the user cannot see.
    const found = flattenLayers(layers).find((item) => item.layer.id === maskLayerId);
    const maskLayer = found && found.layer.kind === "image" ? (found.layer as ImageLayer) : null;
    const source = maskLayer ? sources.find((candidate) => candidate.assetId === maskLayer.assetId) : undefined;
    if (maskLayer && source) {
      const layer = maskLayer;
      const nativeWidth = source.nativeWidthPx ?? source.widthPx;
      const nativeHeight = source.nativeHeightPx ?? source.heightPx;
      const drawWidth = (layer.crop.right - layer.crop.left) * nativeWidth * layer.transform.scaleX * scale;
      const drawHeight = (layer.crop.bottom - layer.crop.top) * nativeHeight * layer.transform.scaleY * scale;
      context.translate(layer.transform.x * scale, layer.transform.y * scale);
      context.rotate((layer.transform.rotationDeg * Math.PI) / 180);
      context.drawImage(
        source.bitmap,
        layer.crop.left * source.widthPx, layer.crop.top * source.heightPx,
        (layer.crop.right - layer.crop.left) * source.widthPx,
        (layer.crop.bottom - layer.crop.top) * source.heightPx,
        -drawWidth * layer.transform.anchorX, -drawHeight * layer.transform.anchorY,
        drawWidth, drawHeight,
      );
    } else {
      // The masking layer is gone or unreadable. Keeping the layer whole is the safe answer:
      // a mask that silently hid everything would look like a broken render.
      context.globalCompositeOperation = "source-over";
    }
  } else if (mask.source.kind === "stored") {
    const image = maskImages?.get(mask.source.selectionId);
    if (image) {
      // A stored mask is document-sized, so it is stretched to the render scale rather than
      // drawn at its own size, which keeps a proxy render matching the full one.
      context.drawImage(image, 0, 0, width, height);
    } else {
      // The saved selection is gone or was not loaded. Leaving the layer whole is the safe
      // answer: a mask that silently hid everything would look like a broken render.
      context.globalCompositeOperation = "source-over";
    }
  } else if (mask.source.kind === "luma") {
    // A key is coverage from brightness, so it is read off the surface being masked rather
    // than drawn. `destination-in` then applies it like any other mask, which is why keying
    // inherits feather, density, and inversion for free.
    const { low, high } = mask.source;
    const image = context.getImageData(0, 0, width, height);
    const span = Math.max(1, high - low);
    for (let index = 0; index < image.data.length; index += 4) {
      const level = 0.299 * image.data[index] + 0.587 * image.data[index + 1] + 0.114 * image.data[index + 2];
      // A ramp between the two ends rather than a hard cut, so a key does not leave a jagged
      // edge on anti-aliased footage.
      const coverage = Math.max(0, Math.min(1, (level - low) / span));
      image.data[index + 3] *= coverage;
    }
    context.globalCompositeOperation = "source-over";
    context.putImageData(image, 0, 0);
    context.restore();
    return;
  } else if (mask.source.kind === "track_matte") {
    // The matte lives on another track, which only the sequence renderer can resolve. Left
    // whole here rather than blanked: a mask that silently hid everything would look like a
    // broken render.
    context.globalCompositeOperation = "source-over";
  } else if (mask.source.kind === "path") {
    // A path mask is drawn from its own commands, so it stays crisp at any render scale
    // rather than being resampled the way a stored mask image would be.
    if (typeof Path2D === "function") {
      context.scale(scale, scale);
      context.fill(new Path2D(toPathData(toCommands(mask.source.shape))));
    } else {
      context.globalCompositeOperation = "source-over";
    }
  } else {
    // A painted mask is a derivative this renderer does not hold, so the layer is left whole
    // rather than blanked. The caller reports it; guessing here would hide the reason.
    context.globalCompositeOperation = "source-over";
  }

  context.restore();
}

/** Clamps a layer's drawn area to the canvas so getImageData never leaves the surface. */
function layerPixelRegion(
  origin: { x: number; y: number },
  drawWidth: number,
  drawHeight: number,
  layer: ImageLayer,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number; width: number; height: number } | null {
  // A rotated layer's axis-aligned extent is larger, so the region is padded by the diagonal.
  const diagonal = Math.ceil(Math.hypot(drawWidth, drawHeight));
  const left = Math.floor(origin.x - diagonal * layer.transform.anchorX - 1);
  const top = Math.floor(origin.y - diagonal * layer.transform.anchorY - 1);
  const x = Math.max(0, left);
  const y = Math.max(0, top);
  const width = Math.min(canvasWidth - x, diagonal + 2);
  const height = Math.min(canvasHeight - y, diagonal + 2);
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

export function readPixels(result: RenderResult): Uint8ClampedArray {
  const context = result.canvas.getContext("2d") as (OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D) | null;
  if (!context) throw new ProjectError("CAPABILITY_UNAVAILABLE", "This browser did not provide a 2D drawing context.");
  return context.getImageData(0, 0, result.widthPx, result.heightPx).data;
}

/**
 * Healing: borrow the texture, keep the tone.
 *
 * A clone stamp copies pixels outright, which is why a cloned patch shows as a bright or dark
 * square whenever the source and destination were lit differently — and on skin they always
 * are. Healing separates the two: the *variation* around the source's local average is the
 * texture, and adding that variation to the destination's own average puts the borrowed grain
 * onto the destination's colour. The blemish goes and the lighting does not change.
 *
 * The averages are taken over the whole stamp rather than per-pixel, which is the cheap
 * approximation of the gradient-domain solve a full implementation uses. It is visibly right
 * for the case this exists for — a small mark on an evenly lit area — and visibly wrong if
 * you heal across a hard edge, which is true of the real thing as well.
 */
function healPatch(sourcePatch: ImageData, destination: ImageData, strength: number): void {
  const source = sourcePatch.data;
  const target = destination.data;
  const count = source.length / 4;

  let sourceR = 0, sourceG = 0, sourceB = 0;
  let targetR = 0, targetG = 0, targetB = 0;
  for (let index = 0; index < source.length; index += 4) {
    sourceR += source[index]; sourceG += source[index + 1]; sourceB += source[index + 2];
    targetR += target[index]; targetG += target[index + 1]; targetB += target[index + 2];
  }
  const shiftR = targetR / count - sourceR / count;
  const shiftG = targetG / count - sourceG / count;
  const shiftB = targetB / count - sourceB / count;

  const blend = Math.max(0, Math.min(1, strength));
  for (let index = 0; index < source.length; index += 4) {
    // The texture, moved onto the destination's tone, then mixed back toward the original by
    // strength so a light touch is a partial heal rather than an all-or-nothing replacement.
    const healedR = source[index] + shiftR;
    const healedG = source[index + 1] + shiftG;
    const healedB = source[index + 2] + shiftB;
    source[index] = clampChannel(target[index] + (healedR - target[index]) * blend);
    source[index + 1] = clampChannel(target[index + 1] + (healedG - target[index + 1]) * blend);
    source[index + 2] = clampChannel(target[index + 2] + (healedB - target[index + 2]) * blend);
  }
}

function clampChannel(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}
