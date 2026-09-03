import { z } from "zod";
import {
  EMPTY_EFFECT_CONTAINER, blendModeSchema, effectContainerSchema, maskSchema,
} from "./effect";
import { keyframeTrackSchema } from "./keyframe";
import { textBlockSchema } from "./text";
import { paintSchema, vectorObjectSchema } from "./vector";
import { paintStackSchema } from "./brush";
import { EMPTY_STYLE_STACK, layerStyleStackSchema } from "./layer-style";
import {
  NO_LENS_CORRECTION, lensCorrectionSchema, perspectiveCornersSchema, warpMeshSchema,
} from "./geometry";
import { adjustmentStackSchema, createDefaultAdjustments } from "./adjustment";
import { appliedProfileSchema } from "./colour-op";

export const LAYER_SCHEMA_VERSION = 1 as const;

export const MAX_LAYERS_PER_DOCUMENT = 500;
export const MAX_GROUP_DEPTH = 8;

/**
 * How a layer's pixels are bent, as distinct from where the layer sits.
 *
 * All three are optional and absent by default, so a layer that has never been corrected
 * carries nothing and renders down exactly the path it always did.
 */
export const layerGeometrySchema = z.object({
  /** Four corners of something that should be a rectangle, for keystone correction. */
  perspective: perspectiveCornersSchema.nullable().default(null),
  /** A grid of control points pulled about, for a warp no single matrix describes. */
  warp: warpMeshSchema.nullable().default(null),
  lens: lensCorrectionSchema.default(NO_LENS_CORRECTION),
});
export type LayerGeometry = z.infer<typeof layerGeometrySchema>;

export const NO_GEOMETRY: LayerGeometry = { perspective: null, warp: null, lens: NO_LENS_CORRECTION };

/**
 * Deliberately domain-neutral: it describes where a thing sits and how it is oriented, and
 * knows nothing about what kind of thing that is. Every layer kind — image, graphics, paint,
 * adjustment, fill, group — is placed by this one schema rather than by six that could drift.
 */
export const layerTransformSchema = z.object({
  /** Offset of the anchor point from the document origin, in document pixels. */
  x: z.number().min(-1_000_000).max(1_000_000),
  y: z.number().min(-1_000_000).max(1_000_000),
  scaleX: z.number().min(0.001, "Scale cannot be smaller than 0.1%.").max(64, "Scale cannot exceed 6,400%."),
  scaleY: z.number().min(0.001, "Scale cannot be smaller than 0.1%.").max(64, "Scale cannot exceed 6,400%."),
  rotationDeg: z.number().min(-360).max(360),
  /** Normalized anchor within the layer's own bounds; 0.5/0.5 is the centre. */
  anchorX: z.number().min(0).max(1),
  anchorY: z.number().min(0).max(1),
  flipX: z.boolean(),
  flipY: z.boolean(),
});
export type LayerTransform = z.infer<typeof layerTransformSchema>;

export const DEFAULT_TRANSFORM: LayerTransform = {
  x: 0, y: 0, scaleX: 1, scaleY: 1, rotationDeg: 0, anchorX: 0.5, anchorY: 0.5, flipX: false, flipY: false,
};

/** Crop is expressed in normalized source coordinates so it survives a source replacement. */
export const layerCropSchema = z.object({
  left: z.number().min(0).max(1),
  top: z.number().min(0).max(1),
  right: z.number().min(0).max(1),
  bottom: z.number().min(0).max(1),
}).refine((crop) => crop.right > crop.left && crop.bottom > crop.top, {
  message: "A crop must keep some of the image.",
});
export type LayerCrop = z.infer<typeof layerCropSchema>;

export const FULL_CROP: LayerCrop = { left: 0, top: 0, right: 1, bottom: 1 };

const layerBaseSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(LAYER_SCHEMA_VERSION),
  name: z.string().trim().min(1).max(120),
  visible: z.boolean(),
  locked: z.boolean(),
  opacity: z.number().min(0, "Opacity cannot be below 0%.").max(1, "Opacity cannot exceed 100%."),
  transform: layerTransformSchema,
  /**
   * How this layer combines with what is beneath it. Defaulted so every project written
   * before blend modes existed keeps rendering exactly as it did.
   */
  blendMode: blendModeSchema.default("normal"),
  /** What limits where this layer shows. Empty means the whole layer. */
  masks: z.array(maskSchema).max(8).default([]),
  /**
   * Shows only where the layer below has pixels.
   *
   * Stored on the clipped layer rather than the base because the reference points down the
   * stack, so the pair stays correct when either one moves.
   */
  clipToBelow: z.boolean().default(false),
  /** Ordered, individually switchable effects. Replaces a single flat adjustment field. */
  effects: effectContainerSchema.default(EMPTY_EFFECT_CONTAINER),
  /**
   * What this layer's properties do over time. Empty for anything not animated, which is
   * every layer written before Phase 6.
   */
  animation: z.array(keyframeTrackSchema).max(24).default([]),
  /**
   * Strokes, shadows, glows, and overlays drawn from this layer's own shape.
   *
   * Every layer kind can carry them, which is the point: a style follows the shape it is
   * attached to, so it works the same on text, on a vector, on a photograph, and on a group.
   */
  styles: layerStyleStackSchema.default(EMPTY_STYLE_STACK),
  /**
   * Perspective correction, warping, and lens correction, applied at render time.
   *
   * Kept apart from `transform` because these bend the picture rather than place it: a
   * transform is where the layer sits, geometry is what shape it is. Both are parameters and
   * neither is baked, so a keystone correction can be adjusted a week later.
   */
  geometry: layerGeometrySchema.default(NO_GEOMETRY),
});

export const imageLayerSchema = layerBaseSchema.extend({
  kind: z.literal("image"),
  assetId: z.string().min(1),
  crop: layerCropSchema,
  adjustments: adjustmentStackSchema,
  /**
   * How this photograph's colour is interpreted, before anything is edited.
   *
   * A camera profile and a creative look sit here rather than in the effect list because they
   * run first: everything else is an edit away from the starting point they set.
   */
  profiles: z.array(appliedProfileSchema).max(2).default([]),
});
export type ImageLayer = z.infer<typeof imageLayerSchema>;

/**
 * Text and vector objects, sharing everything a layer already has.
 *
 * A graphics layer is an ordinary layer with different content, so it inherits transforms,
 * masks, blend modes, effects, clipping, and animation without any of them being taught about
 * it. That is the difference between a shared model and a parallel one.
 */
export const graphicsLayerSchema = layerBaseSchema.extend({
  kind: z.literal("graphics"),
  content: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("text"), text: textBlockSchema }),
    z.object({ kind: z.literal("vector"), vector: vectorObjectSchema }),
  ]),
});
export type GraphicsLayer = z.infer<typeof graphicsLayerSchema>;

/**
 * A layer that adjusts everything beneath it instead of drawing anything.
 *
 * The alternative — applying the adjustment to each layer in turn — means re-editing every
 * layer whenever the look changes, and means a layer added later is left out. An adjustment
 * layer is one place to change, and it can be masked, clipped, reordered, and switched off
 * with the same controls as anything else, because it is an ordinary layer.
 */
export const adjustmentLayerSchema = layerBaseSchema.extend({
  kind: z.literal("adjustment"),
  adjustments: adjustmentStackSchema,
});
export type AdjustmentLayer = z.infer<typeof adjustmentLayerSchema>;

/**
 * A layer of flat colour or a gradient, filling its own bounds.
 *
 * Kept apart from a vector rectangle because the intent is different: a fill layer covers the
 * document and is almost always clipped or masked to shape, so it re-fits when the document is
 * resized rather than staying the size it was drawn at.
 */
/**
 * A layer of hand-painted strokes, kept as strokes rather than as pixels.
 *
 * The strokes are replayed when the picture is drawn, so a stroke's size, colour, and brush
 * can be changed after it was made and it redraws crisply at export resolution rather than at
 * the resolution of the screen it was painted on. Each stroke is one Undo step without a pixel
 * buffer per step.
 */
export const paintLayerSchema = layerBaseSchema.extend({
  kind: z.literal("paint"),
  strokes: paintStackSchema,
});
export type PaintLayer = z.infer<typeof paintLayerSchema>;

export const fillLayerSchema = layerBaseSchema.extend({
  kind: z.literal("fill"),
  paint: paintSchema,
});
export type FillLayer = z.infer<typeof fillLayerSchema>;

export interface GroupLayer extends z.infer<typeof layerBaseSchema> {
  kind: "group";
  children: Layer[];
}

export type Layer = ImageLayer | GraphicsLayer | AdjustmentLayer | FillLayer | PaintLayer | GroupLayer;

/** Anything that draws. A group only arranges, so it is not one. */
export type ContentLayer = ImageLayer | GraphicsLayer | AdjustmentLayer | FillLayer | PaintLayer;

export const groupLayerSchema: z.ZodType<GroupLayer> = layerBaseSchema.extend({
  kind: z.literal("group"),
  children: z.lazy(() => z.array(layerSchema).max(MAX_LAYERS_PER_DOCUMENT)),
}) as z.ZodType<GroupLayer>;

export const layerSchema: z.ZodType<Layer> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    imageLayerSchema, graphicsLayerSchema, adjustmentLayerSchema, fillLayerSchema,
    paintLayerSchema, groupLayerSchema as never,
  ]),
) as z.ZodType<Layer>;

export function createImageLayer(input: {
  id: string;
  name: string;
  assetId: string;
  transform?: Partial<LayerTransform>;
}): ImageLayer {
  return imageLayerSchema.parse({
    id: input.id,
    schemaVersion: LAYER_SCHEMA_VERSION,
    name: input.name,
    kind: "image",
    assetId: input.assetId,
    visible: true,
    locked: false,
    opacity: 1,
    transform: { ...DEFAULT_TRANSFORM, ...input.transform },
    crop: FULL_CROP,
    adjustments: createDefaultAdjustments(),
  });
}

export function createGroupLayer(input: { id: string; name: string; children?: Layer[] }): GroupLayer {
  return groupLayerSchema.parse({
    id: input.id,
    schemaVersion: LAYER_SCHEMA_VERSION,
    name: input.name,
    kind: "group",
    visible: true,
    locked: false,
    opacity: 1,
    transform: { ...DEFAULT_TRANSFORM },
    children: input.children ?? [],
  });
}

/** Depth-first walk in paint order (first entry paints first, i.e. bottom of the stack). */
export function flattenLayers(layers: readonly Layer[], depth = 0): { layer: Layer; depth: number }[] {
  return layers.flatMap((layer) =>
    layer.kind === "group"
      ? [{ layer, depth }, ...flattenLayers(layer.children, depth + 1)]
      : [{ layer, depth }],
  );
}

export function findLayer(layers: readonly Layer[], layerId: string): Layer | null {
  for (const layer of layers) {
    if (layer.id === layerId) return layer;
    if (layer.kind === "group") {
      const found = findLayer(layer.children, layerId);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Returns a new tree with one layer replaced. Every mutation is expressed this way so the
 * layer tree stays immutable and a revision can be replayed deterministically.
 */
export function replaceLayer(layers: readonly Layer[], layerId: string, update: (layer: Layer) => Layer): Layer[] {
  return layers.map((layer) => {
    if (layer.id === layerId) return update(layer);
    if (layer.kind === "group") return { ...layer, children: replaceLayer(layer.children, layerId, update) };
    return layer;
  });
}

export function removeLayer(layers: readonly Layer[], layerId: string): Layer[] {
  return layers
    .filter((layer) => layer.id !== layerId)
    .map((layer) => (layer.kind === "group" ? { ...layer, children: removeLayer(layer.children, layerId) } : layer));
}

/**
 * Narrows the tree to what a viewing mode shows. Isolate scopes to one group's contents;
 * solo then keeps only the chosen layers. Neither touches the stored tree, so auditioning
 * a layer never changes the document or what an export produces.
 */
export function applyViewingModes(
  layers: readonly Layer[],
  modes: { soloLayerIds?: readonly string[]; isolateGroupId?: string | null },
): Layer[] {
  let scoped: Layer[] = [...layers];

  if (modes.isolateGroupId) {
    const group = findLayer(scoped, modes.isolateGroupId);
    scoped = group && group.kind === "group" ? [...group.children] : scoped;
  }

  const solo = new Set(modes.soloLayerIds ?? []);
  if (!solo.size) return scoped;

  const keep = (entries: readonly Layer[]): Layer[] =>
    entries
      .map((layer) => {
        if (solo.has(layer.id)) return layer;
        if (layer.kind !== "group") return null;
        const children = keep(layer.children);
        return children.length ? { ...layer, children } : null;
      })
      .filter((layer): layer is Layer => layer !== null);

  return keep(scoped);
}

export function countLayers(layers: readonly Layer[]): number {
  return layers.reduce((total, layer) => total + 1 + (layer.kind === "group" ? countLayers(layer.children) : 0), 0);
}

export function groupDepth(layers: readonly Layer[], depth = 1): number {
  return layers.reduce(
    (deepest, layer) => (layer.kind === "group" ? Math.max(deepest, groupDepth(layer.children, depth + 1)) : deepest),
    depth,
  );
}

/**
 * Effective visibility and opacity inherit down the tree: hiding a group hides everything
 * inside it, and nested opacities multiply, which is what a user expects from a stack.
 */
/**
 * A 2D affine transform, in the order `canvas.transform` takes its arguments.
 *
 * Groups need this. Inheriting only visibility and opacity meant moving, rotating, or
 * scaling a group left its children exactly where they were — in the render, in the bounds,
 * and in hit testing. A transform has to travel down the tree, and the only way for
 * rendering and selection to agree about where a layer is, is for both to use the same
 * chain.
 */
export interface Matrix2D { a: number; b: number; c: number; d: number; e: number; f: number }

export const IDENTITY_MATRIX: Matrix2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** `outer` applied after `inner`, the order an ancestor composes with its child. */
export function multiplyMatrix(outer: Matrix2D, inner: Matrix2D): Matrix2D {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

/** Translate, then rotate, then scale and flip — the order the renderer draws in. */
export function transformToMatrix(transform: LayerTransform, scale = 1): Matrix2D {
  const radians = (transform.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const scaleX = transform.scaleX * (transform.flipX ? -1 : 1);
  const scaleY = transform.scaleY * (transform.flipY ? -1 : 1);
  return {
    a: cos * scaleX,
    b: sin * scaleX,
    c: -sin * scaleY,
    d: cos * scaleY,
    e: transform.x * scale,
    f: transform.y * scale,
  };
}

export function applyMatrix(matrix: Matrix2D, x: number, y: number): { x: number; y: number } {
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  };
}

export interface ResolvedLayerEntry {
  layer: ContentLayer;
  opacity: number;
  visible: boolean;
  /** Every ancestor group's transform, composed. Identity for a top-level layer. */
  matrix: Matrix2D;
}

/**
 * Flattens the layer tree, carrying down what a group imposes on its children: visibility,
 * opacity, and — the part that was missing — its transform.
 */
export function resolveInheritance(
  layers: readonly Layer[],
  inherited: { visible: boolean; opacity: number; matrix: Matrix2D } = { visible: true, opacity: 1, matrix: IDENTITY_MATRIX },
): ResolvedLayerEntry[] {
  return layers.flatMap((layer) => {
    const visible = inherited.visible && layer.visible;
    const opacity = inherited.opacity * layer.opacity;
    if (layer.kind === "group") {
      return resolveInheritance(layer.children, {
        visible,
        opacity,
        matrix: multiplyMatrix(inherited.matrix, transformToMatrix(layer.transform)),
      });
    }
    return [{ layer, opacity, visible, matrix: inherited.matrix }];
  });
}

/**
 * Layer bounds in document space after crop, scale, flip, rotation, and — when given — every
 * ancestor group's transform.
 *
 * The corners are transformed and the axis-aligned box taken from them, so rendering,
 * selection, hit testing, and export all describe the same rectangle. Approximating a
 * rotation with trigonometry on the width and height agrees only when nothing above the
 * layer has been moved.
 */
export function layerBounds(
  layer: ImageLayer,
  source: { widthPx: number; heightPx: number },
  inherited: Matrix2D = IDENTITY_MATRIX,
): { x: number; y: number; width: number; height: number } {
  const croppedWidth = source.widthPx * (layer.crop.right - layer.crop.left);
  const croppedHeight = source.heightPx * (layer.crop.bottom - layer.crop.top);
  const width = croppedWidth * layer.transform.scaleX;
  const height = croppedHeight * layer.transform.scaleY;

  const matrix = multiplyMatrix(inherited, transformToMatrix(layer.transform));
  const left = -width * layer.transform.anchorX;
  const top = -height * layer.transform.anchorY;
  const corners = [
    applyMatrix(matrix, left, top),
    applyMatrix(matrix, left + width, top),
    applyMatrix(matrix, left, top + height),
    applyMatrix(matrix, left + width, top + height),
  ];

  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

export type AlignEdge = "left" | "horizontal-center" | "right" | "top" | "vertical-center" | "bottom";

/**
 * What alignment lines things up against.
 *
 * Aligning is only meaningful relative to something. Defaulting silently to the canvas made
 * "align left" move a careful arrangement to the document edge, which is why the reference
 * is now chosen rather than assumed.
 */
export type AlignReference = "canvas" | "selection" | "key-layer";

export interface AlignBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function unionBounds(boxes: readonly AlignBox[]): AlignBox {
  if (!boxes.length) return { x: 0, y: 0, width: 0, height: 0 };
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Aligns the chosen layers against the chosen reference. Locked layers are skipped rather
 * than silently moved, so a lock means what it says.
 */
export function alignedTransforms(
  targets: { layer: ImageLayer; bounds: AlignBox }[],
  frame: { widthPx: number; heightPx: number },
  edge: AlignEdge,
  reference: AlignReference = "canvas",
  keyLayerId?: string | null,
): { layerId: string; x: number; y: number }[] {
  const movable = targets.filter((target) => !target.layer.locked);
  if (!movable.length) return [];

  const referenceBox: AlignBox = reference === "canvas"
    ? { x: 0, y: 0, width: frame.widthPx, height: frame.heightPx }
    : reference === "key-layer"
      ? (targets.find((target) => target.layer.id === keyLayerId)?.bounds ?? unionBounds(targets.map((target) => target.bounds)))
      : unionBounds(targets.map((target) => target.bounds));

  return movable.map(({ layer, bounds }) => {
    const transform = layer.transform;
    let { x, y } = transform;
    if (edge === "left") x = transform.x + (referenceBox.x - bounds.x);
    if (edge === "right") x = transform.x + ((referenceBox.x + referenceBox.width) - (bounds.x + bounds.width));
    if (edge === "horizontal-center") x = transform.x + ((referenceBox.x + referenceBox.width / 2) - (bounds.x + bounds.width / 2));
    if (edge === "top") y = transform.y + (referenceBox.y - bounds.y);
    if (edge === "bottom") y = transform.y + ((referenceBox.y + referenceBox.height) - (bounds.y + bounds.height));
    if (edge === "vertical-center") y = transform.y + ((referenceBox.y + referenceBox.height / 2) - (bounds.y + bounds.height / 2));
    return { layerId: layer.id, x, y };
  });
}

/** Common crop ratios offered alongside free and original. */
export const ASPECT_PRESETS: { id: string; label: string; ratio: number | null }[] = [
  { id: "free", label: "Free", ratio: null },
  { id: "original", label: "Original", ratio: null },
  { id: "canvas", label: "Canvas", ratio: null },
  { id: "1:1", label: "Square", ratio: 1 },
  { id: "4:3", label: "4 : 3", ratio: 4 / 3 },
  { id: "3:2", label: "3 : 2", ratio: 3 / 2 },
  { id: "16:9", label: "16 : 9", ratio: 16 / 9 },
  { id: "9:16", label: "9 : 16", ratio: 9 / 16 },
];

/**
 * Constrains a crop to an aspect ratio while keeping it inside the source. The crop stays
 * normalized, so it survives a source replacement at different pixel dimensions.
 */
export function constrainCropToRatio(
  crop: LayerCrop,
  sourceWidthPx: number,
  sourceHeightPx: number,
  ratio: number,
): LayerCrop {
  const centreX = (crop.left + crop.right) / 2;
  const centreY = (crop.top + crop.bottom) / 2;
  const currentWidth = (crop.right - crop.left) * sourceWidthPx;
  const currentHeight = (crop.bottom - crop.top) * sourceHeightPx;

  let width = currentWidth;
  let height = width / ratio;
  if (height > currentHeight) {
    height = currentHeight;
    width = height * ratio;
  }

  const halfWidth = width / sourceWidthPx / 2;
  const halfHeight = height / sourceHeightPx / 2;
  const left = Math.max(0, Math.min(1 - halfWidth * 2, centreX - halfWidth));
  const top = Math.max(0, Math.min(1 - halfHeight * 2, centreY - halfHeight));

  return { left, top, right: Math.min(1, left + halfWidth * 2), bottom: Math.min(1, top + halfHeight * 2) };
}

/** Where content sits when the canvas grows or shrinks around it. */
export const CANVAS_ANCHORS = [
  "top-left", "top-center", "top-right",
  "middle-left", "center", "middle-right",
  "bottom-left", "bottom-center", "bottom-right",
] as const;
export type CanvasAnchor = (typeof CANVAS_ANCHORS)[number];

/** The pixel offset a canvas resize applies to every layer for a given anchor. */
export function canvasAnchorOffset(
  anchor: CanvasAnchor,
  fromWidthPx: number,
  fromHeightPx: number,
  toWidthPx: number,
  toHeightPx: number,
): { dx: number; dy: number } {
  const deltaX = toWidthPx - fromWidthPx;
  const deltaY = toHeightPx - fromHeightPx;
  const horizontal = anchor.endsWith("left") ? 0 : anchor.endsWith("right") ? deltaX : deltaX / 2;
  const vertical = anchor.startsWith("top") ? 0 : anchor.startsWith("bottom") ? deltaY : deltaY / 2;
  return { dx: horizontal, dy: vertical };
}

/** Fit keeps the whole image inside the frame; fill covers it, cropping the overflow. */
export function fitScale(
  source: { widthPx: number; heightPx: number },
  frame: { widthPx: number; heightPx: number },
  mode: "fit" | "fill",
): number {
  const scaleX = frame.widthPx / source.widthPx;
  const scaleY = frame.heightPx / source.heightPx;
  return mode === "fit" ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);
}
