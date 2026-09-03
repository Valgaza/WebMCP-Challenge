import { z } from "zod";
import {
  ADJUSTMENT_RANGES,
  adjustmentNameSchema,
  adjustmentPatchSchema,
  adjustmentStackSchema,
  createDefaultAdjustments,
  describeAdjustment,
  type AdjustmentName,
} from "../domain/adjustment";
import {
  EMPTY_EFFECT_CONTAINER, MAX_EFFECTS_PER_LAYER, assertEffectCount, assertNoMaskCycle,
  blendModeSchema, describeMask, effectSchema, maskPatchSchema, maskSchema,
} from "../domain/effect";
import {
  DEFAULT_HANDLES, assertAnimatable, bezierHandlesSchema, interpolationSchema, keyframeSchema,
  keyframeTrackSchema, propertyPathSchema, removeKeyframe, setKeyframe,
} from "../domain/keyframe";
import {
  appliedProfileSchema, colourOperationSchema, colourProfileSchema, describeColourOperation,
  describeProfile,
} from "../domain/colour-op";
import { assertFilterCost, describeFilter, filterOperationSchema } from "../domain/filter";
import { rationalSchema, toSeconds } from "../domain/time";
import { describeTrack } from "../domain/keyframe";
import {
  DEFAULT_PARAGRAPH, addRun, fontDescriptorSchema, paragraphStyleSchema, replaceText,
  textBlockSchema, textLayoutSchema,
} from "../domain/text";
import { paintSchema, shapeSchema, strokeSchema, swatchSchema, vectorObjectSchema, type Paint } from "../domain/vector";
import {
  DEFAULT_BRUSH, DEFAULT_DYNAMICS, EMPTY_PAINT_STACK, MAX_POINTS_PER_STROKE, assertStrokeCount,
  brushDynamicsPatchSchema, brushDynamicsSchema, brushPatchSchema, brushSchema, describeStroke,
  pointOffsetSchema, simplify, strokePointSchema, strokeSchema as brushStrokeSchema,
} from "../domain/brush";
import { EMPTY_STYLE_STACK, assertStyleCount, describeStyle, layerStyleSchema } from "../domain/layer-style";
import {
  assertConvex, createMesh, describeFreeTransform, describeLensCorrection,
  freeTransformPatchSchema, freeTransformSchema, lensCorrectionPatchSchema, lensCorrectionSchema,
  moveMeshPoint, perspectiveCornersSchema, perspectiveSlidersSchema, pointSchema, slidersToCorners,
} from "../domain/geometry";
import { describeTypography } from "../domain/text";
import {
  DEFAULT_TRANSFORM,
  LAYER_SCHEMA_VERSION,
  MAX_GROUP_DEPTH,
  MAX_LAYERS_PER_DOCUMENT,
  graphicsLayerSchema,
  adjustmentLayerSchema,
  fillLayerSchema,
  paintLayerSchema,
  NO_GEOMETRY,
  type PaintLayer,
  alignedTransforms,
  canvasAnchorOffset,
  constrainCropToRatio,
  createGroupLayer,
  createImageLayer,
  countLayers,
  findLayer,
  fitScale,
  flattenLayers,
  groupDepth,
  layerBounds,
  layerCropSchema,
  layerTransformSchema,
  removeLayer,
  replaceLayer,
  unionBounds,
  type CanvasAnchor,
  type ImageLayer,
  type Layer,
} from "../domain/layer";
import { CANVAS_ANCHORS } from "../domain/layer";
import type { ResampleAlgorithm } from "../workers/worker-protocol";
import { ProjectError, toProjectError, withArticle } from "../domain/project-error";
import type { ProjectCommandContext, ProjectMutationResult, ProjectService } from "./project-service";
import type { DocumentBackground } from "../domain/photo-document";

/**
 * One consolidated command surface, matching the ledger's `apply_operation` with a typed
 * `operationType` discriminator. The UI and WebMCP both call this, so a dragged handle and
 * an agent request produce identical history.
 */
export const layerOperationSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("add_image"), assetId: z.string().min(1), name: z.string().trim().min(1).max(120).optional(), fit: z.enum(["fit", "fill", "actual"]).default("fit") }),
  z.object({ operation: z.literal("remove"), layerId: z.string().min(1) }),
  z.object({ operation: z.literal("reorder"), layerId: z.string().min(1), toIndex: z.number().int().min(0).max(MAX_LAYERS_PER_DOCUMENT) }),
  z.object({ operation: z.literal("group"), layerIds: z.array(z.string().min(1)).min(1).max(MAX_LAYERS_PER_DOCUMENT), name: z.string().trim().min(1).max(120).optional() }),
  z.object({ operation: z.literal("ungroup"), layerId: z.string().min(1) }),
  z.object({ operation: z.literal("rename"), layerId: z.string().min(1), name: z.string().trim().min(1).max(120) }),
  z.object({ operation: z.literal("set_visibility"), layerId: z.string().min(1), visible: z.boolean() }),
  z.object({ operation: z.literal("set_lock"), layerId: z.string().min(1), locked: z.boolean() }),
  z.object({ operation: z.literal("set_opacity"), layerId: z.string().min(1), opacity: z.number().min(0).max(1) }),
  z.object({ operation: z.literal("transform"), layerId: z.string().min(1), transform: layerTransformSchema.partial() }),
  z.object({ operation: z.literal("crop"), layerId: z.string().min(1), crop: layerCropSchema }),
  z.object({ operation: z.literal("straighten"), layerId: z.string().min(1), rotationDeg: z.number().min(-360).max(360) }),
  z.object({ operation: z.literal("flip"), layerId: z.string().min(1), axis: z.enum(["horizontal", "vertical"]) }),
  z.object({
    operation: z.literal("align"),
    layerIds: z.array(z.string().min(1)).min(1).max(MAX_LAYERS_PER_DOCUMENT),
    edge: z.enum(["left", "horizontal-center", "right", "top", "vertical-center", "bottom"]),
    /** Alignment is meaningless without something to align against, so it is explicit. */
    reference: z.enum(["canvas", "selection", "key-layer"]).default("canvas"),
    keyLayerId: z.string().min(1).nullable().default(null),
  }),
  z.object({ operation: z.literal("distribute"), layerIds: z.array(z.string().min(1)).min(3).max(MAX_LAYERS_PER_DOCUMENT), axis: z.enum(["horizontal", "vertical"]) }),
  z.object({ operation: z.literal("duplicate"), layerId: z.string().min(1) }),
  z.object({
    operation: z.literal("fit"), layerId: z.string().min(1),
    mode: z.enum(["fit", "fill", "actual"]),
  }),
  z.object({
    operation: z.literal("set_crop_ratio"), layerId: z.string().min(1),
    ratio: z.number().min(0.05).max(20).nullable(),
  }),
  z.object({ operation: z.literal("reset_transform"), layerId: z.string().min(1) }),
  z.object({ operation: z.literal("rotate_quarter"), layerId: z.string().min(1), turns: z.number().int().min(-3).max(3) }),
  z.object({
    operation: z.literal("move_into_group"), layerId: z.string().min(1),
    groupId: z.string().min(1).nullable(), toIndex: z.number().int().min(0).max(MAX_LAYERS_PER_DOCUMENT).default(0),
  }),
  z.object({ operation: z.literal("set_blend_mode"), layerId: z.string().min(1), blendMode: blendModeSchema }),
  z.object({ operation: z.literal("set_clipping"), layerId: z.string().min(1), clipToBelow: z.boolean() }),
  z.object({ operation: z.literal("add_mask"), layerId: z.string().min(1), mask: maskSchema.omit({ id: true }) }),
  z.object({ operation: z.literal("update_mask"), layerId: z.string().min(1), maskId: z.string().min(1), mask: maskPatchSchema }),
  z.object({ operation: z.literal("remove_mask"), layerId: z.string().min(1), maskId: z.string().min(1) }),
  z.object({ operation: z.literal("add_effect"), layerId: z.string().min(1), name: z.string().trim().min(1).max(80), parameters: adjustmentPatchSchema.optional(), colourOperation: colourOperationSchema.optional(), filter: filterOperationSchema.optional() }),
  z.object({ operation: z.literal("update_effect"), layerId: z.string().min(1), effectId: z.string().min(1), name: z.string().trim().min(1).max(80).optional(), enabled: z.boolean().optional(), opacity: z.number().min(0).max(1).optional(), blendMode: blendModeSchema.optional(), parameters: adjustmentPatchSchema.optional(), colourOperation: colourOperationSchema.optional(), filter: filterOperationSchema.optional() }),
  z.object({ operation: z.literal("remove_effect"), layerId: z.string().min(1), effectId: z.string().min(1) }),
  z.object({ operation: z.literal("reorder_effect"), layerId: z.string().min(1), effectId: z.string().min(1), toIndex: z.number().int().min(0).max(MAX_EFFECTS_PER_LAYER) }),
  z.object({
    operation: z.literal("set_keyframe"), layerId: z.string().min(1),
    propertyPath: propertyPathSchema, time: rationalSchema, value: z.number(),
    interpolation: interpolationSchema.optional(), handles: bezierHandlesSchema.partial().optional(),
  }),
  z.object({ operation: z.literal("remove_keyframe"), layerId: z.string().min(1), propertyPath: propertyPathSchema, keyframeId: z.string().min(1) }),
  z.object({ operation: z.literal("set_track_enabled"), layerId: z.string().min(1), propertyPath: propertyPathSchema, enabled: z.boolean() }),
  z.object({ operation: z.literal("clear_animation"), layerId: z.string().min(1), propertyPath: propertyPathSchema }),
  z.object({
    operation: z.literal("add_text"), content: z.string().max(20_000).default("Text"),
    name: z.string().trim().min(1).max(120).optional(),
    layout: textLayoutSchema.optional(), font: fontDescriptorSchema.partial().optional(),
    sizePx: z.number().min(1).max(2000).optional(), colour: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  }),
  z.object({
    operation: z.literal("edit_text"), layerId: z.string().min(1),
    content: z.string().max(20_000).optional(),
    range: z.object({ start: z.number().int().min(0), end: z.number().int().min(0) }).optional(),
    insert: z.string().max(20_000).optional(),
    font: fontDescriptorSchema.partial().optional(), sizePx: z.number().min(1).max(2000).optional(),
    colour: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    trackingMille: z.number().min(-500).max(2000).optional(),
    paragraph: paragraphStyleSchema.partial().optional(), paragraphIndex: z.number().int().min(0).max(499).optional(),
  }),
  z.object({
    operation: z.literal("add_shape"), shape: shapeSchema,
    name: z.string().trim().min(1).max(120).optional(),
    fill: paintSchema.optional(), stroke: strokeSchema.nullable().optional(),
  }),
  z.object({
    operation: z.literal("set_paint"), layerId: z.string().min(1),
    fill: paintSchema.optional(), stroke: strokeSchema.nullable().optional(),
  }),
  z.object({
    operation: z.literal("add_adjustment_layer"),
    name: z.string().trim().min(1).max(120).optional(),
    parameters: adjustmentPatchSchema.optional(),
  }),
  z.object({
    operation: z.literal("add_fill_layer"),
    name: z.string().trim().min(1).max(120).optional(),
    paint: paintSchema.optional(),
  }),
  z.object({ operation: z.literal("add_style"), layerId: z.string().min(1), style: layerStyleSchema }),
  z.object({ operation: z.literal("update_style"), layerId: z.string().min(1), styleId: z.string().min(1), style: z.record(z.string(), z.unknown()) }),
  z.object({ operation: z.literal("remove_style"), layerId: z.string().min(1), styleId: z.string().min(1) }),
  z.object({
    operation: z.literal("free_transform"), layerId: z.string().min(1),
    transform: freeTransformPatchSchema,
  }),
  z.object({
    operation: z.literal("set_perspective"), layerId: z.string().min(1),
    /** Four corners in reading order, or sliders; null clears the correction. */
    corners: perspectiveCornersSchema.nullish(),
    sliders: perspectiveSlidersSchema.partial().optional(),
  }),
  z.object({
    operation: z.literal("warp"), layerId: z.string().min(1),
    columns: z.number().int().min(2).max(16).optional(),
    rows: z.number().int().min(2).max(16).optional(),
    /** Moves one control point; leave out to create or clear the mesh. */
    point: z.object({
      column: z.number().int().min(0).max(15),
      row: z.number().int().min(0).max(15),
      offset: pointSchema,
    }).optional(),
    clear: z.boolean().optional(),
  }),
  z.object({
    operation: z.literal("correct_lens"), layerId: z.string().min(1),
    correction: lensCorrectionPatchSchema,
  }),
  z.object({
    operation: z.literal("paint_stroke"),
    /** Paints onto this layer, or starts a new painted layer when left out. */
    layerId: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(120).optional(),
    brush: brushPatchSchema.optional(),
    dynamics: brushDynamicsPatchSchema.optional(),
    paint: paintSchema.optional(),
    points: z.array(strokePointSchema).min(1).max(MAX_POINTS_PER_STROKE),
    /** Confines the stroke to a saved selection. */
    selectionId: z.string().min(1).nullish(),
    /** Where a clone stamp reads from, relative to where it paints. */
    cloneOffset: pointOffsetSchema.nullish(),
    /** How strongly a retouching brush works. Not opacity: these change what is there. */
    strength: z.number().min(0).max(1).optional(),
    /** Thins the points to the ones that describe the shape. */
    simplifyPx: z.number().min(0).max(20).default(0.75),
  }),
  z.object({
    operation: z.literal("apply_profile"), layerId: z.string().min(1),
    /** The profile to apply; leave out with a kind to remove the one of that kind. */
    profile: colourProfileSchema.optional(),
    strength: z.number().min(0).max(1).optional(),
    remove: z.enum(["camera", "creative"]).optional(),
  }),
  z.object({ operation: z.literal("undo_stroke"), layerId: z.string().min(1) }),
  z.object({
    operation: z.literal("restyle_stroke"), layerId: z.string().min(1), strokeId: z.string().min(1),
    brush: brushPatchSchema.optional(), paint: paintSchema.optional(),
  }),
  z.object({
    operation: z.literal("fill_region"), layerId: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(120).optional(),
    /** The saved selection the fill is confined to; a bucket makes one before calling this. */
    selectionId: z.string().min(1),
    paint: paintSchema,
  }),
]);
export type LayerOperation = z.input<typeof layerOperationSchema>;

export const colorAdjustmentSchema = z.object({
  layerId: z.string().min(1),
  adjustment: adjustmentNameSchema,
  value: z.number(),
});
export type ColorAdjustmentInput = z.infer<typeof colorAdjustmentSchema>;

/**
 * The one thing `LayerService` needs from the asset layer: turning a chosen algorithm and a
 * target size into a real, reproducible resampled derivative.
 */
export interface LayerResampler {
  startResampleJob: (
    assetId: string,
    options: { targetWidthPx: number; targetHeightPx: number; algorithm: ResampleAlgorithm },
  ) => Promise<{ jobId: string }>;
}

export interface LayerServiceOptions {
  resampler?: LayerResampler;
  createLayerId?: () => string;
}

export class LayerService {
  private readonly createLayerId: () => string;

  /**
   * Whatever can actually resample pixels, supplied rather than imported so this service
   * stays testable and the asset layer stays the only thing that owns derivatives.
   */
  private resampler: LayerResampler | null = null;

  constructor(private readonly projects: ProjectService, options: LayerServiceOptions = {}) {
    this.createLayerId = options.createLayerId ?? (() => crypto.randomUUID());
    this.resampler = options.resampler ?? null;
  }

  /** Registered at composition, because the asset layer depends on this one, not the reverse. */
  registerResampler(resampler: LayerResampler): void {
    this.resampler = resampler;
  }

  /** Reads the document, applies one typed operation, and commits it as an ordinary mutation. */
  async applyOperation(
    projectId: string,
    input: LayerOperation,
    context: ProjectCommandContext = {},
  ): Promise<ProjectMutationResult> {
    try {
      const parsed = layerOperationSchema.parse(input);
      const history = await this.projects.getProjectHistory(projectId);
      const document = history.headRevision.state.photoDocument;
      if (!document) {
        throw new ProjectError("INVALID_INPUT", "Create an image document before editing layers.", { fieldPath: "projectId" });
      }

      const assets = history.headRevision.state.assets ?? [];
      const { layers, label } = this.computeNextLayers(parsed, document, assets);

      if (countLayers(layers) > MAX_LAYERS_PER_DOCUMENT) {
        throw new ProjectError("INVALID_INPUT", `A document cannot hold more than ${MAX_LAYERS_PER_DOCUMENT} layers.`);
      }
      if (groupDepth(layers) > MAX_GROUP_DEPTH) {
        throw new ProjectError("INVALID_INPUT", `Groups cannot nest more than ${MAX_GROUP_DEPTH} levels deep.`, { fieldPath: "layerIds" });
      }

      return await this.projects.applyLayers(
        { projectId, documentId: document.id, label, fromLayers: document.layers, toLayers: layers },
        context,
      );
    } catch (error) { throw toProjectError(error); }
  }

  /** Colour adjustments are parameters on a layer, so they travel the same command path. */
  async applyColorAdjustment(
    projectId: string,
    input: ColorAdjustmentInput,
    context: ProjectCommandContext = {},
  ): Promise<ProjectMutationResult & { normalizedValue: number; description: string; warnings: string[] }> {
    const parsed = colorAdjustmentSchema.parse(input);
    const history = await this.projects.getProjectHistory(projectId);
    const document = history.headRevision.state.photoDocument;
    if (!document) throw new ProjectError("INVALID_INPUT", "Create an image document before adjusting colour.", { fieldPath: "projectId" });

    const target = findLayer(document.layers, parsed.layerId);
    if (!target || target.kind !== "image") {
      throw new ProjectError("INVALID_INPUT", "Colour adjustments apply to an image layer.", { fieldPath: "layerId" });
    }
    if (target.locked) {
      throw new ProjectError("INVALID_INPUT", `“${target.name}” is locked. Unlock it before adjusting colour.`, { fieldPath: "layerId" });
    }

    const range = ADJUSTMENT_RANGES[parsed.adjustment];
    const clamped = Math.max(range.min, Math.min(range.max, parsed.value));
    const warnings = clamped !== parsed.value
      ? [`${range.label} was clamped from ${parsed.value} to ${clamped}, its documented limit.`]
      : [];

    const layers = replaceLayer(document.layers, parsed.layerId, (layer) => ({
      ...(layer as ImageLayer),
      adjustments: adjustmentStackSchema.parse({ ...(layer as ImageLayer).adjustments, [parsed.adjustment]: clamped }),
    }));

    const result = await this.projects.applyLayers(
      {
        projectId, documentId: document.id,
        label: `${range.label} ${clamped > range.default ? "+" : ""}${clamped} on “${target.name}”`,
        fromLayers: document.layers, toLayers: layers, warnings,
      },
      context,
    );
    return { ...result, normalizedValue: clamped, description: describeAdjustment(parsed.adjustment, clamped), warnings };
  }

  /**
   * Canvas resize changes the frame only; image resize scales every layer with it.
   *
   * Both are expressed as instructions rather than rewritten pixels: the originals stay
   * untouched, and the chosen resampling algorithm is recorded so an export can honour it
   * instead of falling back to whatever the browser's canvas happens to do.
   */
  async resizeDocument(
    projectId: string,
    input: {
      mode: "canvas" | "image";
      widthPx: number;
      heightPx: number;
      anchor?: CanvasAnchor;
      resampleAlgorithm?: ResampleAlgorithm;
      lockAspect?: boolean;
    },
    context: ProjectCommandContext = {},
  ): Promise<ProjectMutationResult & {
    normalizedWidthPx: number;
    normalizedHeightPx: number;
    warnings: string[];
    resampleAlgorithm: ResampleAlgorithm | null;
    resampleJobIds: string[];
  }> {
    const parsed = z.object({
      mode: z.enum(["canvas", "image"]),
      widthPx: z.number().int().min(1).max(32768),
      heightPx: z.number().int().min(1).max(32768),
      anchor: z.enum(CANVAS_ANCHORS).default("center"),
      resampleAlgorithm: z.enum(["nearest", "bilinear", "lanczos3", "browser-smooth"]).default("lanczos3"),
      lockAspect: z.boolean().default(false),
    }).parse(input);

    const history = await this.projects.getProjectHistory(projectId);
    const document = history.headRevision.state.photoDocument;
    if (!document) throw new ProjectError("INVALID_INPUT", "Create an image document before resizing.", { fieldPath: "projectId" });

    let widthPx = parsed.widthPx;
    let heightPx = parsed.heightPx;
    const warnings: string[] = [];

    if (parsed.lockAspect) {
      const ratio = document.widthPx / document.heightPx;
      if (widthPx !== document.widthPx) heightPx = Math.max(1, Math.round(widthPx / ratio));
      else if (heightPx !== document.heightPx) widthPx = Math.max(1, Math.round(heightPx * ratio));
      if (widthPx !== parsed.widthPx || heightPx !== parsed.heightPx) {
        warnings.push(`Aspect lock adjusted the size to ${widthPx} × ${heightPx} pixels.`);
      }
    }

    const scaleX = widthPx / document.widthPx;
    const scaleY = heightPx / document.heightPx;

    const scaleLayers = (layers: readonly Layer[]): Layer[] => layers.map((layer) => {
      const scaled: Layer = {
        ...layer,
        transform: {
          ...layer.transform,
          x: layer.transform.x * scaleX,
          y: layer.transform.y * scaleY,
          scaleX: layer.transform.scaleX * scaleX,
          scaleY: layer.transform.scaleY * scaleY,
        },
      };
      return scaled.kind === "group" ? { ...scaled, children: scaleLayers(scaled.children) } : scaled;
    });

    // A canvas resize re-frames the document; content keeps its size but moves with the anchor.
    const offset = canvasAnchorOffset(parsed.anchor, document.widthPx, document.heightPx, widthPx, heightPx);
    const anchorLayers = (layers: readonly Layer[]): Layer[] => layers.map((layer) => {
      const moved: Layer = {
        ...layer,
        transform: { ...layer.transform, x: layer.transform.x + offset.dx, y: layer.transform.y + offset.dy },
      };
      return moved.kind === "group" ? { ...moved, children: anchorLayers(moved.children) } : moved;
    });

    if (parsed.mode === "canvas") {
      const bounds = document.layers.length ? this.contentBounds(document, history.headRevision.state.assets ?? []) : null;
      if (bounds && (bounds.x + offset.dx < 0 || bounds.y + offset.dy < 0
        || bounds.x + offset.dx + bounds.width > widthPx || bounds.y + offset.dy + bounds.height > heightPx)) {
        warnings.push("Some content falls outside the new canvas. It is kept and still editable, but it will not appear in an export.");
      }
    }

    const result = await this.projects.resizeDocument(
      {
        projectId, documentId: document.id, mode: parsed.mode,
        fromWidthPx: document.widthPx, fromHeightPx: document.heightPx,
        toWidthPx: widthPx, toHeightPx: heightPx,
        fromLayers: document.layers,
        toLayers: parsed.mode === "image" ? scaleLayers(document.layers) : anchorLayers(document.layers),
        resampleAlgorithm: parsed.resampleAlgorithm,
      },
      context,
    );

    // An image resize is a pixel operation, not just a change of numbers. Scaling the
    // transform alone left the interface claiming an algorithm that never ran, so the real
    // resampling is queued here and its result is what the canvas draws from.
    const resampleJobIds: string[] = [];
    if (parsed.mode === "image") {
      const seen = new Set<string>();
      for (const entry of flattenLayers(result.headRevision.state.photoDocument?.layers ?? [])) {
        if (!this.resampler || entry.layer.kind !== "image" || seen.has(entry.layer.assetId)) continue;
        seen.add(entry.layer.assetId);
        const queued = await this.resampler
          .startResampleJob(entry.layer.assetId, {
            targetWidthPx: Math.max(1, Math.round(entry.layer.transform.scaleX * document.widthPx)),
            targetHeightPx: Math.max(1, Math.round(entry.layer.transform.scaleY * document.heightPx)),
            algorithm: parsed.resampleAlgorithm,
          })
          .catch(() => null);
        if (queued) resampleJobIds.push(queued.jobId);
      }
      // The message states what actually happened. Naming an algorithm that never ran is
      // exactly the claim this repair exists to remove.
      warnings.push(
        resampleJobIds.length
          ? `Layers are scaled by ${(scaleX * 100).toFixed(1)}% horizontally and their pixels are being resampled with ${parsed.resampleAlgorithm}. The original files are untouched.`
          : `Layers are scaled by ${(scaleX * 100).toFixed(1)}% horizontally, but this browser could not start the resampling pass, so their pixels are only rescaled for display.`,
      );
    }

    return {
      ...result,
      normalizedWidthPx: widthPx, normalizedHeightPx: heightPx, warnings,
      resampleAlgorithm: parsed.mode === "image" ? parsed.resampleAlgorithm : null,
      resampleJobIds,
    };
  }

  /** Union of every visible layer's bounds, used to warn about content leaving the canvas. */
  private contentBounds(
    document: { layers: Layer[] },
    assets: { id: string; widthPx: number; heightPx: number }[],
  ): { x: number; y: number; width: number; height: number } | null {
    const boxes = flattenLayers(document.layers)
      .filter((entry) => entry.layer.kind === "image")
      .map((entry) => {
        const layer = entry.layer as ImageLayer;
        const asset = assets.find((candidate) => candidate.id === layer.assetId);
        return asset ? layerBounds(layer, asset) : null;
      })
      .filter((box): box is { x: number; y: number; width: number; height: number } => box !== null);
    return boxes.length ? unionBounds(boxes) : null;
  }

  /**
   * The document's named colours and gradients.
   *
   * A separate command from a layer edit because a swatch belongs to the document: the reason
   * to have one at all is that changing it changes every shape, stroke, and fill using it in
   * one edit rather than in forty.
   */
  async applySwatch(
    projectId: string,
    input: { swatchId?: string; name?: string; paint?: Paint; remove?: boolean },
    context: ProjectCommandContext = {},
  ): Promise<ProjectMutationResult> {
    try {
      const history = await this.projects.getProjectHistory(projectId);
      const document = history.headRevision.state.photoDocument;
      if (!document) {
        throw new ProjectError("INVALID_INPUT", "Create an image document before adding swatches.", { fieldPath: "projectId" });
      }
      const from = document.swatches;

      if (input.remove) {
        if (!input.swatchId) {
          throw new ProjectError("INVALID_INPUT", "Removing a swatch needs its id.", { fieldPath: "swatchId" });
        }
        const going = from.find((entry) => entry.id === input.swatchId);
        if (!going) {
          throw new ProjectError("INVALID_INPUT", "That swatch is not in this document.", { fieldPath: "swatchId" });
        }
        // Anything pointing at it is left pointing at it: the reference stays, the shape goes
        // unpainted, and the render says so. Silently baking in the last colour would make
        // the loss invisible until someone tried to change it back.
        return await this.projects.applySwatches({
          projectId, documentId: document.id, label: `Remove the swatch “${going.name}”`,
          fromSwatches: from, toSwatches: from.filter((entry) => entry.id !== input.swatchId),
        }, context);
      }

      if (!input.paint && !input.name) {
        throw new ProjectError("INVALID_INPUT", "A swatch needs a name, a colour, or both.", { fieldPath: "paint" });
      }

      const existing = input.swatchId ? from.find((entry) => entry.id === input.swatchId) : undefined;
      if (input.swatchId && !existing) {
        throw new ProjectError("INVALID_INPUT", "That swatch is not in this document.", { fieldPath: "swatchId" });
      }
      if (!existing && !input.paint) {
        throw new ProjectError("INVALID_INPUT", "A new swatch needs a colour or gradient.", { fieldPath: "paint" });
      }

      const swatch = swatchSchema.parse({
        id: existing?.id ?? crypto.randomUUID(),
        name: input.name ?? existing?.name ?? "Swatch",
        paint: input.paint ?? existing!.paint,
      });
      if (from.length >= 256 && !existing) {
        throw new ProjectError("INVALID_INPUT", "A document holds at most 256 swatches.", { fieldPath: "swatches" });
      }

      return await this.projects.applySwatches({
        projectId, documentId: document.id,
        label: existing ? `Change the swatch “${swatch.name}”` : `Add the swatch “${swatch.name}”`,
        fromSwatches: from,
        toSwatches: existing ? from.map((entry) => (entry.id === swatch.id ? swatch : entry)) : [...from, swatch],
      }, context);
    } catch (error) { throw toProjectError(error); }
  }

  private computeNextLayers(
    operation: z.infer<typeof layerOperationSchema>,
    document: { id: string; widthPx: number; heightPx: number; layers: Layer[]; background: DocumentBackground },
    assets: { id: string; name: string; widthPx: number; heightPx: number }[],
  ): { layers: Layer[]; label: string } {
    const layers = document.layers;
    const frame = { widthPx: document.widthPx, heightPx: document.heightPx };
    /**
     * New text and shapes used to land at the document origin in white. On a white or
     * transparent document that is an invisible layer at the very corner of the canvas,
     * which reads as "the tool did nothing" even though a revision was committed and the
     * layer is in the panel. So an added graphic is centred like an added image, and its
     * colour is chosen to be legible against the background it is landing on.
     */
    const centre = { x: frame.widthPx / 2, y: frame.heightPx / 2 };
    const legibleInk = inkForBackground(document.background);

    const requireLayer = (layerId: string): Layer => {
      const found = findLayer(layers, layerId);
      if (!found) throw new ProjectError("INVALID_INPUT", "That layer is not in this document.", { fieldPath: "layerId" });
      return found;
    };
    const requireUnlocked = (layer: Layer): Layer => {
      if (layer.locked) throw new ProjectError("INVALID_INPUT", `“${layer.name}” is locked. Unlock it before editing.`, { fieldPath: "layerId" });
      return layer;
    };

    switch (operation.operation) {
      case "add_image": {
        const asset = assets.find((entry) => entry.id === operation.assetId);
        if (!asset) throw new ProjectError("INVALID_INPUT", "Import that image before adding it as a layer.", { fieldPath: "assetId" });
        const scale = operation.fit === "actual" ? 1 : fitScale(asset, frame, operation.fit);
        const layer = createImageLayer({
          id: this.createLayerId(), name: operation.name ?? asset.name, assetId: asset.id,
          transform: { x: frame.widthPx / 2, y: frame.heightPx / 2, scaleX: scale, scaleY: scale },
        });
        return { layers: [...layers, layer], label: `Add “${layer.name}”` };
      }
      case "remove": {
        const layer = requireUnlocked(requireLayer(operation.layerId));
        return { layers: removeLayer(layers, operation.layerId), label: `Remove “${layer.name}”` };
      }
      case "reorder": {
        const layer = requireLayer(operation.layerId);
        // Reordering operates on the top level, where the stack is what the user sees.
        const without = layers.filter((entry) => entry.id !== operation.layerId);
        if (without.length === layers.length) {
          throw new ProjectError("INVALID_INPUT", "Only a top-level layer can be reordered.", { fieldPath: "layerId" });
        }
        const index = Math.min(operation.toIndex, without.length);
        return { layers: [...without.slice(0, index), layer, ...without.slice(index)], label: `Reorder “${layer.name}”` };
      }
      case "group": {
        if (operation.layerIds.length < 2) {
          throw new ProjectError("INVALID_INPUT", "Choose at least two layers to group.", { fieldPath: "layerIds" });
        }
        const chosen = operation.layerIds.map(requireLayer);
        const topLevelIds = new Set(layers.map((entry) => entry.id));
        if (!operation.layerIds.every((id) => topLevelIds.has(id))) {
          throw new ProjectError("INVALID_INPUT", "Group only layers that sit at the same level.", { fieldPath: "layerIds" });
        }
        const group = createGroupLayer({ id: this.createLayerId(), name: operation.name ?? "Group", children: chosen });
        const firstIndex = layers.findIndex((entry) => entry.id === operation.layerIds[0]);
        const remaining = layers.filter((entry) => !operation.layerIds.includes(entry.id));
        return {
          layers: [...remaining.slice(0, firstIndex), group, ...remaining.slice(firstIndex)],
          label: `Group ${chosen.length} layers`,
        };
      }
      case "ungroup": {
        const group = requireLayer(operation.layerId);
        if (group.kind !== "group") throw new ProjectError("INVALID_INPUT", "Only a group can be ungrouped.", { fieldPath: "layerId" });
        const index = layers.findIndex((entry) => entry.id === group.id);
        if (index < 0) throw new ProjectError("INVALID_INPUT", "Only a top-level group can be ungrouped.", { fieldPath: "layerId" });
        return {
          layers: [...layers.slice(0, index), ...group.children, ...layers.slice(index + 1)],
          label: `Ungroup “${group.name}”`,
        };
      }
      case "rename": {
        const layer = requireLayer(operation.layerId);
        return { layers: replaceLayer(layers, layer.id, (entry) => ({ ...entry, name: operation.name })), label: `Rename to “${operation.name}”` };
      }
      case "set_visibility": {
        const layer = requireLayer(operation.layerId);
        return {
          layers: replaceLayer(layers, layer.id, (entry) => ({ ...entry, visible: operation.visible })),
          label: `${operation.visible ? "Show" : "Hide"} “${layer.name}”`,
        };
      }
      case "set_lock": {
        const layer = requireLayer(operation.layerId);
        return {
          layers: replaceLayer(layers, layer.id, (entry) => ({ ...entry, locked: operation.locked })),
          label: `${operation.locked ? "Lock" : "Unlock"} “${layer.name}”`,
        };
      }
      case "add_text": {
        const layer = graphicsLayerSchema.parse({
          id: this.createLayerId(), schemaVersion: LAYER_SCHEMA_VERSION, kind: "graphics",
          name: operation.name ?? (operation.content.split("\n")[0].slice(0, 40) || "Text"),
          visible: true, locked: false, opacity: 1,
          transform: { ...DEFAULT_TRANSFORM, ...centre },
          blendMode: "normal", masks: [], clipToBelow: false,
          effects: EMPTY_EFFECT_CONTAINER, animation: [],
          content: {
            kind: "text",
            text: textBlockSchema.parse({
              schemaVersion: 1, content: operation.content,
              layout: operation.layout ?? { kind: "point" },
              font: fontDescriptorSchema.parse({ family: "system-ui", ...operation.font }),
              // A size proportional to the document, so 48px text is not a speck on a 6000px canvas.
              sizePx: operation.sizePx ?? defaultTextSizePx(frame),
              colour: operation.colour ?? legibleInk,
              trackingMille: 0, runs: [], paragraphs: [], direction: "ltr", language: null,
            }),
          },
        });
        if (countLayers(layers) + 1 > MAX_LAYERS_PER_DOCUMENT) {
          throw new ProjectError("INVALID_INPUT", `A document holds at most ${MAX_LAYERS_PER_DOCUMENT} layers.`, { fieldPath: "layers" });
        }
        return { layers: [...layers, layer], label: `Add the text “${layer.name}”` };
      }

      case "edit_text": {
        const found = requireUnlocked(requireLayer(operation.layerId));
        if (found.kind !== "graphics" || found.content.kind !== "text") {
          throw new ProjectError("INVALID_INPUT", `“${found.name}” is not a text layer.`, { fieldPath: "layerId" });
        }
        let text = found.content.text;

        // Replacing a range moves the formatting runs with it; replacing the whole content
        // does not, because there is no correspondence left to preserve.
        if (operation.range && operation.insert !== undefined) {
          text = replaceText(text, operation.range.start, operation.range.end, operation.insert);
        } else if (operation.content !== undefined) {
          text = { ...text, content: operation.content, runs: [] };
        }
        if (operation.range && operation.insert === undefined) {
          text = addRun(text, {
            start: operation.range.start, end: operation.range.end,
            ...(operation.font ? { font: fontDescriptorSchema.parse({ ...text.font, ...operation.font }) } : {}),
            ...(operation.sizePx !== undefined ? { sizePx: operation.sizePx } : {}),
            ...(operation.colour !== undefined ? { colour: operation.colour } : {}),
            ...(operation.trackingMille !== undefined ? { trackingMille: operation.trackingMille } : {}),
          });
        } else {
          text = {
            ...text,
            font: operation.font ? fontDescriptorSchema.parse({ ...text.font, ...operation.font }) : text.font,
            sizePx: operation.sizePx ?? text.sizePx,
            colour: operation.colour ?? text.colour,
            trackingMille: operation.trackingMille ?? text.trackingMille,
          };
        }

        if (operation.paragraph) {
          const index = operation.paragraphIndex ?? 0;
          const paragraphs = [...text.paragraphs];
          while (paragraphs.length <= index) paragraphs.push(DEFAULT_PARAGRAPH);
          paragraphs[index] = paragraphStyleSchema.parse({ ...paragraphs[index], ...operation.paragraph });
          text = { ...text, paragraphs };
        }

        return {
          layers: replaceLayer(layers, found.id, (entry) => ({ ...entry, content: { kind: "text", text } })),
          label: `Edit the text “${found.name}”`,
        };
      }

      case "add_shape": {
        const layer = graphicsLayerSchema.parse({
          id: this.createLayerId(), schemaVersion: LAYER_SCHEMA_VERSION, kind: "graphics",
          name: operation.name ?? `${operation.shape.kind[0].toUpperCase()}${operation.shape.kind.slice(1)}`,
          visible: true, locked: false, opacity: 1,
          transform: { ...DEFAULT_TRANSFORM, ...centre },
          blendMode: "normal", masks: [], clipToBelow: false,
          effects: EMPTY_EFFECT_CONTAINER, animation: [],
          content: {
            kind: "vector",
            vector: vectorObjectSchema.parse({
              schemaVersion: 1, shape: operation.shape,
              fill: operation.fill ?? { kind: "solid", colour: legibleInk, opacity: 1 },
              stroke: operation.stroke ?? null, fillRule: "nonzero",
            }),
          },
        });
        assertRoom(layers);
        // "Add a ellipse" appears in the History panel and in every tool result, so the
        // article is worth getting right.
        return { layers: [...layers, layer], label: `Add ${withArticle(operation.shape.kind)}` };
      }

      case "set_paint": {
        const found = requireUnlocked(requireLayer(operation.layerId));
        if (found.kind !== "graphics" || found.content.kind !== "vector") {
          throw new ProjectError("INVALID_INPUT", `“${found.name}” is not a vector layer.`, { fieldPath: "layerId" });
        }
        const vector = vectorObjectSchema.parse({
          ...found.content.vector,
          fill: operation.fill ?? found.content.vector.fill,
          stroke: operation.stroke === undefined ? found.content.vector.stroke : operation.stroke,
        });
        return {
          layers: replaceLayer(layers, found.id, (entry) => ({ ...entry, content: { kind: "vector", vector } })),
          label: `Repaint “${found.name}”`,
        };
      }

      /**
       * An adjustment layer changes everything beneath it instead of drawing.
       *
       * It is an ordinary layer in every other way, so it can be masked, clipped, reordered,
       * and switched off with the same commands — which is the reason to have one rather than
       * editing each layer underneath in turn.
       */
      /**
       * Scale, rotate, skew, and move as numbers rather than as a dragged handle.
       *
       * A partial transform merges, so setting just the rotation leaves the layer where it
       * was instead of resetting everything else to its default.
       */
      case "free_transform": {
        const found = requireUnlocked(requireLayer(operation.layerId));
        const next = freeTransformSchema.parse({
          translateX: operation.transform.translateX ?? found.transform.x,
          translateY: operation.transform.translateY ?? found.transform.y,
          scaleX: operation.transform.scaleX ?? found.transform.scaleX,
          scaleY: operation.transform.scaleY ?? found.transform.scaleY,
          rotationDeg: operation.transform.rotationDeg ?? found.transform.rotationDeg,
          skewXDeg: operation.transform.skewXDeg ?? 0,
          skewYDeg: operation.transform.skewYDeg ?? 0,
          anchorX: operation.transform.anchorX ?? found.transform.anchorX,
          anchorY: operation.transform.anchorY ?? found.transform.anchorY,
        });
        if (next.scaleX === 0 || next.scaleY === 0) {
          throw new ProjectError("INVALID_INPUT", "A layer scaled to nothing would disappear; use visibility instead.", { fieldPath: "transform.scaleX" });
        }
        return {
          layers: replaceLayer(layers, found.id, (entry) => ({
            ...entry,
            transform: {
              ...entry.transform,
              x: next.translateX, y: next.translateY,
              scaleX: next.scaleX, scaleY: next.scaleY,
              rotationDeg: next.rotationDeg,
              anchorX: next.anchorX, anchorY: next.anchorY,
            },
          })),
          label: `${describeFreeTransform(next).replace(/\.$/, "")} on “${found.name}”`,
        };
      }

      /**
       * Straightens something photographed at an angle, from four corners or from sliders.
       *
       * Both routes end at the same four corners, so a photograph corrected either way is
       * corrected identically and the record does not remember which control was used.
       */
      case "set_perspective": {
        const found = requireUnlocked(requireLayer(operation.layerId));
        const corners = operation.corners === null ? null
          : operation.corners ?? (operation.sliders
            ? slidersToCorners(perspectiveSlidersSchema.parse(operation.sliders), frame.widthPx, frame.heightPx)
            : null);
        if (corners) assertConvex(corners);
        return {
          layers: replaceLayer(layers, found.id, (entry) => ({
            ...entry, geometry: { ...entry.geometry, perspective: corners },
          })),
          label: corners ? `Straighten “${found.name}”` : `Clear the perspective on “${found.name}”`,
        };
      }

      /**
       * A grid of control points, for a bend no single matrix describes.
       *
       * Creating the mesh and moving a point are the same command because a first drag has to
       * create the grid it is dragging, and making that two steps would mean an agent could
       * move a point on a mesh that does not exist yet.
       */
      case "warp": {
        const found = requireUnlocked(requireLayer(operation.layerId));
        if (operation.clear) {
          return {
            layers: replaceLayer(layers, found.id, (entry) => ({ ...entry, geometry: { ...entry.geometry, warp: null } })),
            label: `Clear the warp on “${found.name}”`,
          };
        }
        const existing = found.geometry.warp;
        const wanted = operation.columns ?? existing?.columns ?? 4;
        const wantedRows = operation.rows ?? existing?.rows ?? 4;
        // Changing the grid size starts a fresh mesh: the old control points describe a
        // different grid, and carrying them across would move the picture unpredictably.
        const base = existing && existing.columns === wanted && existing.rows === wantedRows
          ? existing
          : createMesh(wanted, wantedRows);
        const mesh = operation.point
          ? moveMeshPoint(base, operation.point.column, operation.point.row, operation.point.offset)
          : base;
        return {
          layers: replaceLayer(layers, found.id, (entry) => ({ ...entry, geometry: { ...entry.geometry, warp: mesh } })),
          label: operation.point ? `Warp “${found.name}”` : `Add a ${wanted}×${wantedRows} warp grid to “${found.name}”`,
        };
      }

      case "correct_lens": {
        const found = requireUnlocked(requireLayer(operation.layerId));
        const lens = lensCorrectionSchema.parse({ ...found.geometry.lens, ...operation.correction });
        return {
          layers: replaceLayer(layers, found.id, (entry) => ({ ...entry, geometry: { ...entry.geometry, lens } })),
          label: `${describeLensCorrection(lens).replace(/\.$/, "")} on “${found.name}”`,
        };
      }

      /**
       * Adds one stroke, starting a painted layer when there is not one yet.
       *
       * Creating the layer and painting on it are the same command because a first stroke has
       * to create the surface it lands on, and making that two steps means an agent can paint
       * onto a layer that does not exist.
       */
      case "paint_stroke": {
        const brush = brushSchema.parse({ ...DEFAULT_BRUSH, ...operation.brush });
        const stroke = brushStrokeSchema.parse({
          id: crypto.randomUUID(),
          brush,
          dynamics: brushDynamicsSchema.parse({ ...DEFAULT_DYNAMICS, ...operation.dynamics }),
          paint: operation.paint ?? { kind: "solid", colour: "#000000", opacity: 1 },
          // Thinned before it is stored, so the points kept are the ones that describe the
          // shape rather than every sample the pointer happened to report.
          points: simplify(operation.points.map((point) => strokePointSchema.parse(point)), operation.simplifyPx),
          selectionId: operation.selectionId ?? null,
          cloneOffset: operation.cloneOffset ?? null,
          strength: operation.strength ?? 0.5,
        });

        // A clone stamp with nowhere to read from would copy the spot it is painting onto,
        // which does nothing and looks like a broken tool.
        if (brush.kind === "clone" && !stroke.cloneOffset) {
          throw new ProjectError(
            "INVALID_INPUT",
            "A clone stamp needs a source: give cloneOffset as the distance from where it paints to where it reads.",
            { fieldPath: "cloneOffset" },
          );
        }

        if (!operation.layerId) {
          const layer = paintLayerSchema.parse({
            id: this.createLayerId(), schemaVersion: LAYER_SCHEMA_VERSION, kind: "paint",
            name: operation.name ?? "Paint", visible: true, locked: false, opacity: 1,
            transform: DEFAULT_TRANSFORM, blendMode: "normal", masks: [], clipToBelow: false,
            effects: EMPTY_EFFECT_CONTAINER, animation: [], styles: EMPTY_STYLE_STACK,
            geometry: NO_GEOMETRY,
            strokes: { ...EMPTY_PAINT_STACK, strokes: [stroke] },
          });
          assertRoom(layers);
          return { layers: [...layers, layer], label: describeStroke(stroke).replace(/\.$/, "") };
        }

        const found = requireUnlocked(requireLayer(operation.layerId));
        if (found.kind !== "paint") {
          throw new ProjectError(
            "INVALID_INPUT",
            `“${found.name}” is not a painted layer. Leave the layer out to start one, or choose a painted layer.`,
            { fieldPath: "layerId" },
          );
        }
        assertStrokeCount(found.strokes.strokes.length + 1);
        return {
          layers: replaceLayer(layers, found.id, (entry) => ({
            ...entry,
            strokes: { ...(entry as PaintLayer).strokes, strokes: [...(entry as PaintLayer).strokes.strokes, stroke] },
          })),
          label: describeStroke(stroke).replace(/\.$/, ""),
        };
      }

      /**
       * Sets how a photograph's colour is interpreted, before anything is edited.
       *
       * A layer holds at most one of each kind, because "two camera profiles" is not a thing
       * that means anything, and applying a second replaces the first rather than stacking.
       */
      case "apply_profile": {
        const found = requireUnlocked(requireLayer(operation.layerId));
        if (found.kind !== "image") {
          throw new ProjectError(
            "INVALID_INPUT",
            `“${found.name}” is not a photograph, so there is no camera colour to interpret.`,
            { fieldPath: "layerId" },
          );
        }

        if (operation.remove) {
          const kind = operation.remove;
          if (!found.profiles.some((entry) => entry.kind === kind)) {
            throw new ProjectError("INVALID_INPUT", `“${found.name}” has no ${kind} profile.`, { fieldPath: "remove" });
          }
          return {
            layers: replaceLayer(layers, found.id, (entry) => ({
              ...entry, profiles: (entry as ImageLayer).profiles.filter((one) => one.kind !== kind),
            })),
            label: `Remove the ${kind} profile from “${found.name}”`,
          };
        }

        if (!operation.profile) {
          throw new ProjectError("INVALID_INPUT", "Applying a profile needs the profile itself.", { fieldPath: "profile" });
        }
        // The operations are copied rather than referenced: a photograph developed last month
        // should not change because someone edited a profile today.
        const applied = appliedProfileSchema.parse({
          profileId: operation.profile.id,
          name: operation.profile.name,
          kind: operation.profile.kind,
          operations: operation.profile.operations,
          strength: operation.strength ?? 1,
        });
        return {
          layers: replaceLayer(layers, found.id, (entry) => ({
            ...entry,
            profiles: [
              ...(entry as ImageLayer).profiles.filter((one) => one.kind !== applied.kind),
              applied,
            ],
          })),
          label: `Apply ${describeProfile(applied).replace(/^The /, "").replace(/\.$/, "")} to “${found.name}”`,
        };
      }

      case "undo_stroke": {
        const found = requireUnlocked(requireLayer(operation.layerId));
        if (found.kind !== "paint" || !found.strokes.strokes.length) {
          throw new ProjectError("INVALID_INPUT", `“${found.name}” has no strokes to remove.`, { fieldPath: "layerId" });
        }
        const remaining = found.strokes.strokes.slice(0, -1);
        return {
          layers: replaceLayer(layers, found.id, (entry) => ({
            ...entry, strokes: { ...(entry as PaintLayer).strokes, strokes: remaining },
          })),
          label: `Remove the last stroke from “${found.name}”`,
        };
      }

      /**
       * Changes a stroke after it was drawn.
       *
       * This is what storing strokes rather than pixels buys: the size, colour, and brush of
       * something painted an hour ago can still be changed, and it redraws crisply.
       */
      case "restyle_stroke": {
        const found = requireUnlocked(requireLayer(operation.layerId));
        if (found.kind !== "paint") {
          throw new ProjectError("INVALID_INPUT", `“${found.name}” is not a painted layer.`, { fieldPath: "layerId" });
        }
        const existing = found.strokes.strokes.find((entry) => entry.id === operation.strokeId);
        if (!existing) {
          throw new ProjectError("INVALID_INPUT", `“${found.name}” has no such stroke.`, { fieldPath: "strokeId" });
        }
        const next = brushStrokeSchema.parse({
          ...existing,
          brush: brushSchema.parse({ ...existing.brush, ...operation.brush }),
          paint: operation.paint ?? existing.paint,
        });
        return {
          layers: replaceLayer(layers, found.id, (entry) => ({
            ...entry,
            strokes: {
              ...(entry as PaintLayer).strokes,
              strokes: (entry as PaintLayer).strokes.strokes.map((one) => (one.id === next.id ? next : one)),
            },
          })),
          label: `Restyle a stroke on “${found.name}”`,
        };
      }

      /**
       * The paint bucket: a fill confined to a saved selection.
       *
       * The selection is made by the wand and saved first, so the bucket is a fill layer with
       * a mask rather than a second flood-fill implementation that could disagree with the
       * first. It is also why the fill can be recoloured or removed afterwards.
       */
      case "fill_region": {
        const layer = fillLayerSchema.parse({
          id: this.createLayerId(), schemaVersion: LAYER_SCHEMA_VERSION, kind: "fill",
          name: operation.name ?? "Fill", visible: true, locked: false, opacity: 1,
          transform: DEFAULT_TRANSFORM, blendMode: "normal", clipToBelow: false,
          effects: EMPTY_EFFECT_CONTAINER, animation: [], styles: EMPTY_STYLE_STACK,
          geometry: NO_GEOMETRY,
          paint: operation.paint,
          masks: [{
            id: crypto.randomUUID(),
            source: { kind: "stored", selectionId: operation.selectionId },
            featherPx: 0, density: 1, inverted: false, enabled: true,
          }],
        });
        assertRoom(layers);
        const index = operation.layerId
          ? layers.findIndex((entry) => entry.id === operation.layerId) + 1
          : layers.length;
        // Placed above the layer it was aimed at, so the fill covers it rather than hiding
        // beneath it.
        return {
          layers: [...layers.slice(0, index), layer, ...layers.slice(index)],
          label: `Fill a region with ${operation.paint.kind === "solid" ? operation.paint.colour : `a ${operation.paint.kind}`}`,
        };
      }

      case "add_adjustment_layer": {
        const layer = adjustmentLayerSchema.parse({
          id: this.createLayerId(), schemaVersion: LAYER_SCHEMA_VERSION, kind: "adjustment",
          name: operation.name ?? "Adjustment", visible: true, locked: false, opacity: 1,
          transform: DEFAULT_TRANSFORM, blendMode: "normal", masks: [], clipToBelow: false,
          effects: EMPTY_EFFECT_CONTAINER, animation: [], styles: EMPTY_STYLE_STACK,
          adjustments: { ...createDefaultAdjustments(), ...(operation.parameters ?? {}) },
        });
        assertRoom(layers);
        return { layers: [...layers, layer], label: `Add the adjustment layer “${layer.name}”` };
      }

      case "add_fill_layer": {
        const layer = fillLayerSchema.parse({
          id: this.createLayerId(), schemaVersion: LAYER_SCHEMA_VERSION, kind: "fill",
          name: operation.name ?? "Fill", visible: true, locked: false, opacity: 1,
          transform: DEFAULT_TRANSFORM, blendMode: "normal", masks: [], clipToBelow: false,
          effects: EMPTY_EFFECT_CONTAINER, animation: [], styles: EMPTY_STYLE_STACK,
          paint: operation.paint ?? { kind: "solid", colour: "#808080", opacity: 1 },
        });
        assertRoom(layers);
        return { layers: [...layers, layer], label: `Add the fill layer “${layer.name}”` };
      }

      case "add_style": {
        const found = requireUnlocked(requireLayer(operation.layerId));
        const style = layerStyleSchema.parse({ ...operation.style, id: crypto.randomUUID() });
        const styles = [...found.styles.styles, style];
        assertStyleCount(styles.length);
        return {
          layers: replaceLayer(layers, found.id, (entry) => ({
            ...entry, styles: { ...entry.styles, styles },
          })),
          label: `Add ${describeStyle(style).replace(/\.$/, "")} to “${found.name}”`,
        };
      }

      case "update_style": {
        const found = requireUnlocked(requireLayer(operation.layerId));
        const existing = found.styles.styles.find((entry) => entry.id === operation.styleId);
        if (!existing) {
          throw new ProjectError("INVALID_INPUT", `“${found.name}” has no such style.`, { fieldPath: "styleId" });
        }
        // The kind is fixed once a style is added: changing a shadow into a stroke is adding a
        // different style, not editing this one, and merging the two shapes would produce a
        // record that validates as neither.
        const style = layerStyleSchema.parse({ ...existing, ...operation.style, kind: existing.kind, id: existing.id });
        return {
          layers: replaceLayer(layers, found.id, (entry) => ({
            ...entry,
            styles: { ...entry.styles, styles: entry.styles.styles.map((one) => (one.id === style.id ? style : one)) },
          })),
          label: `Change a style on “${found.name}”`,
        };
      }

      case "remove_style": {
        const found = requireUnlocked(requireLayer(operation.layerId));
        if (!found.styles.styles.some((entry) => entry.id === operation.styleId)) {
          throw new ProjectError("INVALID_INPUT", `“${found.name}” has no such style.`, { fieldPath: "styleId" });
        }
        return {
          layers: replaceLayer(layers, found.id, (entry) => ({
            ...entry,
            styles: { ...entry.styles, styles: entry.styles.styles.filter((one) => one.id !== operation.styleId) },
          })),
          label: `Remove a style from “${found.name}”`,
        };
      }

      case "set_keyframe": {
        const layer = requireUnlocked(requireLayer(operation.layerId));
        // A typo would otherwise animate a property that does not exist, silently.
        assertAnimatable("layer", operation.propertyPath);
        const existing = layer.animation.find((entry) => entry.propertyPath === operation.propertyPath);
        const base = existing ?? keyframeTrackSchema.parse({
          id: this.createLayerId(), schemaVersion: 1, propertyPath: operation.propertyPath, enabled: true, keyframes: [],
        });
        const keyframe = keyframeSchema.parse({
          id: this.createLayerId(), time: operation.time, value: operation.value,
          interpolation: operation.interpolation ?? "linear",
          handles: { ...DEFAULT_HANDLES, ...operation.handles },
        });
        const next = setKeyframe(base, keyframe);
        return {
          layers: replaceLayer(layers, layer.id, (entry) => ({
            ...entry,
            animation: existing
              ? entry.animation.map((track) => (track.propertyPath === next.propertyPath ? next : track))
              : [...entry.animation, next],
          })),
          label: `Key ${operation.propertyPath} at ${toSeconds(operation.time).toFixed(2)}s on “${layer.name}”`,
        };
      }

      case "remove_keyframe": {
        const layer = requireUnlocked(requireLayer(operation.layerId));
        const existing = layer.animation.find((entry) => entry.propertyPath === operation.propertyPath);
        if (!existing) throw new ProjectError("INVALID_INPUT", `“${layer.name}” does not animate ${operation.propertyPath}.`, { fieldPath: "propertyPath" });
        const next = removeKeyframe(existing, operation.keyframeId);
        return {
          layers: replaceLayer(layers, layer.id, (entry) => ({
            ...entry,
            // A property with no keyframes left is not animated, so the track goes rather
            // than lingering as an empty shell that still reads as animated.
            animation: next.keyframes.length
              ? entry.animation.map((track) => (track.propertyPath === next.propertyPath ? next : track))
              : entry.animation.filter((track) => track.propertyPath !== next.propertyPath),
          })),
          label: `Remove a keyframe from ${operation.propertyPath} on “${layer.name}”`,
        };
      }

      case "set_track_enabled": {
        const layer = requireUnlocked(requireLayer(operation.layerId));
        const existing = layer.animation.find((entry) => entry.propertyPath === operation.propertyPath);
        if (!existing) throw new ProjectError("INVALID_INPUT", `“${layer.name}” does not animate ${operation.propertyPath}.`, { fieldPath: "propertyPath" });
        return {
          layers: replaceLayer(layers, layer.id, (entry) => ({
            ...entry,
            animation: entry.animation.map((track) => (track.propertyPath === operation.propertyPath ? { ...track, enabled: operation.enabled } : track)),
          })),
          label: `${operation.enabled ? "Enable" : "Disable"} the ${operation.propertyPath} animation on “${layer.name}”`,
        };
      }

      case "clear_animation": {
        const layer = requireUnlocked(requireLayer(operation.layerId));
        if (!layer.animation.some((entry) => entry.propertyPath === operation.propertyPath)) {
          throw new ProjectError("INVALID_INPUT", `“${layer.name}” does not animate ${operation.propertyPath}.`, { fieldPath: "propertyPath" });
        }
        return {
          layers: replaceLayer(layers, layer.id, (entry) => ({
            ...entry, animation: entry.animation.filter((track) => track.propertyPath !== operation.propertyPath),
          })),
          label: `Stop animating ${operation.propertyPath} on “${layer.name}”`,
        };
      }

      case "set_blend_mode": {
        const layer = requireUnlocked(requireLayer(operation.layerId));
        return {
          layers: replaceLayer(layers, layer.id, (entry) => ({ ...entry, blendMode: operation.blendMode })),
          label: `Blend “${layer.name}” with ${operation.blendMode}`,
        };
      }

      case "set_clipping": {
        const layer = requireUnlocked(requireLayer(operation.layerId));
        // Clipping needs something to clip to, and the layer below is that something.
        const siblings = flattenLayers(layers).map((entry) => entry.layer.id);
        const index = siblings.indexOf(layer.id);
        if (operation.clipToBelow && index <= 0) {
          throw new ProjectError("INVALID_INPUT", `“${layer.name}” is at the bottom of the stack, so there is nothing below it to clip to.`, { fieldPath: "layerId" });
        }
        return {
          layers: replaceLayer(layers, layer.id, (entry) => ({ ...entry, clipToBelow: operation.clipToBelow })),
          label: operation.clipToBelow ? `Clip “${layer.name}” to the layer below` : `Release “${layer.name}” from clipping`,
        };
      }

      case "add_mask": {
        const layer = requireUnlocked(requireLayer(operation.layerId));
        if (layer.masks.length >= 8) {
          throw new ProjectError("INVALID_INPUT", `“${layer.name}” already has the maximum of 8 masks.`, { fieldPath: "mask" });
        }
        const mask = maskSchema.parse({ ...operation.mask, id: this.createLayerId() });
        // A mask that refers back to its own layer has no defined result, so it is refused
        // here rather than discovered as a frozen tab during a render.
        const proposed = new Map(flattenLayers(layers).map((entry) => [entry.layer.id, entry.layer.masks]));
        proposed.set(layer.id, [...layer.masks, mask]);
        assertNoMaskCycle(proposed, layer.id);
        return {
          layers: replaceLayer(layers, layer.id, (entry) => ({ ...entry, masks: [...entry.masks, mask] })),
          label: `Mask “${layer.name}”: ${describeMask(mask).toLowerCase()}`,
        };
      }

      case "update_mask": {
        const layer = requireUnlocked(requireLayer(operation.layerId));
        const existing = layer.masks.find((entry) => entry.id === operation.maskId);
        if (!existing) throw new ProjectError("INVALID_INPUT", "That mask is not on this layer.", { fieldPath: "maskId" });
        const next = maskSchema.parse({ ...existing, ...operation.mask, id: existing.id });
        const proposed = new Map(flattenLayers(layers).map((entry) => [entry.layer.id, entry.layer.masks]));
        proposed.set(layer.id, layer.masks.map((entry) => (entry.id === next.id ? next : entry)));
        assertNoMaskCycle(proposed, layer.id);
        return {
          layers: replaceLayer(layers, layer.id, (entry) => ({
            ...entry, masks: entry.masks.map((mask) => (mask.id === next.id ? next : mask)),
          })),
          label: `Adjust the mask on “${layer.name}”`,
        };
      }

      case "remove_mask": {
        const layer = requireUnlocked(requireLayer(operation.layerId));
        if (!layer.masks.some((entry) => entry.id === operation.maskId)) {
          throw new ProjectError("INVALID_INPUT", "That mask is not on this layer.", { fieldPath: "maskId" });
        }
        return {
          layers: replaceLayer(layers, layer.id, (entry) => ({
            ...entry, masks: entry.masks.filter((mask) => mask.id !== operation.maskId),
          })),
          label: `Remove a mask from “${layer.name}”`,
        };
      }

      case "add_effect": {
        const layer = requireUnlocked(requireLayer(operation.layerId));
        assertEffectCount(layer.effects.effects.length + 1);
        const common = {
          id: this.createLayerId(), name: operation.name,
          enabled: true, blendMode: "normal" as const, opacity: 1, mask: null,
        };
        // A colour operator and the simple sliders are two kinds of the same container, so
        // one command adds either and the interface has one list rather than two.
        const effect = effectSchema.parse(operation.filter
          ? { ...common, kind: "filter", filter: operation.filter }
          : operation.colourOperation
            ? { ...common, kind: "colour", operation: operation.colourOperation }
            : {
              ...common, kind: "adjustments",
              parameters: adjustmentStackSchema.parse({ ...createDefaultAdjustments(), ...operation.parameters }),
            });
        // Surface blur and median are quadratic in radius. A large one on a large document
        // is minutes of blocked main thread, which reads as a hung tab rather than as work.
        // The guard existed and was never called; refusing here means the caller gets a
        // field-level reason instead of a frozen interface halfway through a draw.
        if (effect.kind === "filter") assertFilterCost(effect.filter, document.widthPx, document.heightPx);
        return {
          layers: replaceLayer(layers, layer.id, (entry) => ({
            ...entry, effects: { ...entry.effects, effects: [...entry.effects.effects, effect] },
          })),
          label: operation.filter
            ? `Add ${describeFilter(operation.filter).replace(/\.$/, "").toLowerCase()} to “${layer.name}”`
            : operation.colourOperation
              ? `Add ${describeColourOperation(operation.colourOperation).replace(/\.$/, "").toLowerCase()} to “${layer.name}”`
              : `Add the effect “${operation.name}” to “${layer.name}”`,
        };
      }

      case "update_effect": {
        const layer = requireUnlocked(requireLayer(operation.layerId));
        const existing = layer.effects.effects.find((entry) => entry.id === operation.effectId);
        if (!existing) throw new ProjectError("INVALID_INPUT", "That effect is not on this layer.", { fieldPath: "effectId" });
        const shared = {
          name: operation.name ?? existing.name,
          enabled: operation.enabled ?? existing.enabled,
          opacity: operation.opacity ?? existing.opacity,
          blendMode: operation.blendMode ?? existing.blendMode,
        };
        // A colour operator is replaced whole rather than merged: its shape differs by kind,
        // so there is no field-by-field merge that would mean the same thing for a curve and
        // for a lookup table.
        const next = effectSchema.parse(existing.kind === "colour"
          ? { ...existing, ...shared, operation: operation.colourOperation ?? existing.operation }
          : existing.kind === "filter"
            ? { ...existing, ...shared, filter: operation.filter ?? existing.filter }
            : { ...existing, ...shared, parameters: adjustmentStackSchema.parse({ ...existing.parameters, ...operation.parameters }) });
        if (next.kind === "filter") assertFilterCost(next.filter, document.widthPx, document.heightPx);
        return {
          layers: replaceLayer(layers, layer.id, (entry) => ({
            ...entry,
            effects: { ...entry.effects, effects: entry.effects.effects.map((effect) => (effect.id === next.id ? next : effect)) },
          })),
          label: `Adjust “${next.name}” on “${layer.name}”`,
        };
      }

      case "remove_effect": {
        const layer = requireUnlocked(requireLayer(operation.layerId));
        const existing = layer.effects.effects.find((entry) => entry.id === operation.effectId);
        if (!existing) throw new ProjectError("INVALID_INPUT", "That effect is not on this layer.", { fieldPath: "effectId" });
        return {
          layers: replaceLayer(layers, layer.id, (entry) => ({
            ...entry,
            effects: { ...entry.effects, effects: entry.effects.effects.filter((effect) => effect.id !== operation.effectId) },
          })),
          label: `Remove “${existing.name}” from “${layer.name}”`,
        };
      }

      case "reorder_effect": {
        const layer = requireUnlocked(requireLayer(operation.layerId));
        const current = [...layer.effects.effects];
        const from = current.findIndex((entry) => entry.id === operation.effectId);
        if (from === -1) throw new ProjectError("INVALID_INPUT", "That effect is not on this layer.", { fieldPath: "effectId" });
        const [moved] = current.splice(from, 1);
        current.splice(Math.min(operation.toIndex, current.length), 0, moved);
        return {
          layers: replaceLayer(layers, layer.id, (entry) => ({ ...entry, effects: { ...entry.effects, effects: current } })),
          // Order decides the result, so moving an effect is a real edit rather than tidying.
          label: `Move “${moved.name}” to position ${Math.min(operation.toIndex, current.length - 1) + 1} on “${layer.name}”`,
        };
      }

      case "set_opacity": {
        const layer = requireUnlocked(requireLayer(operation.layerId));
        return {
          layers: replaceLayer(layers, layer.id, (entry) => ({ ...entry, opacity: operation.opacity })),
          label: `Opacity ${Math.round(operation.opacity * 100)}% on “${layer.name}”`,
        };
      }
      case "transform": {
        const layer = requireUnlocked(requireLayer(operation.layerId));
        return {
          layers: replaceLayer(layers, layer.id, (entry) => ({
            ...entry,
            transform: layerTransformSchema.parse({ ...entry.transform, ...operation.transform }),
          })),
          label: `Transform “${layer.name}”`,
        };
      }
      case "crop": {
        const layer = requireUnlocked(requireLayer(operation.layerId));
        if (layer.kind !== "image") throw new ProjectError("INVALID_INPUT", "Only an image layer can be cropped.", { fieldPath: "layerId" });
        return {
          layers: replaceLayer(layers, layer.id, (entry) => ({ ...(entry as ImageLayer), crop: operation.crop })),
          label: `Crop “${layer.name}”`,
        };
      }
      case "straighten": {
        const layer = requireUnlocked(requireLayer(operation.layerId));
        return {
          layers: replaceLayer(layers, layer.id, (entry) => ({
            ...entry, transform: { ...entry.transform, rotationDeg: operation.rotationDeg },
          })),
          label: `Straighten “${layer.name}” to ${operation.rotationDeg}°`,
        };
      }
      case "flip": {
        const layer = requireUnlocked(requireLayer(operation.layerId));
        return {
          layers: replaceLayer(layers, layer.id, (entry) => ({
            ...entry,
            transform: {
              ...entry.transform,
              flipX: operation.axis === "horizontal" ? !entry.transform.flipX : entry.transform.flipX,
              flipY: operation.axis === "vertical" ? !entry.transform.flipY : entry.transform.flipY,
            },
          })),
          label: `Flip “${layer.name}” ${operation.axis}`,
        };
      }
      case "align": {
        const targets = this.imageTargets(operation.layerIds, layers, assets);
        const moves = alignedTransforms(targets, frame, operation.edge, operation.reference, operation.keyLayerId);
        if (!moves.length) {
          throw new ProjectError("INVALID_INPUT", "Every chosen layer is locked, so nothing could be aligned.", { fieldPath: "layerIds" });
        }
        let next = layers;
        for (const move of moves) {
          next = replaceLayer(next, move.layerId, (entry) => ({ ...entry, transform: { ...entry.transform, x: move.x, y: move.y } }));
        }
        const referenceLabel = operation.reference === "canvas" ? "the canvas"
          : operation.reference === "key-layer" ? "the key layer" : "the selection";
        return { layers: next, label: `Align ${moves.length} layer(s) ${operation.edge} to ${referenceLabel}` };
      }
      case "duplicate": {
        const layer = requireLayer(operation.layerId);
        const index = layers.findIndex((entry) => entry.id === layer.id);
        if (index < 0) throw new ProjectError("INVALID_INPUT", "Only a top-level layer can be duplicated.", { fieldPath: "layerId" });
        // Every copied layer needs its own identity, including everything inside a group.
        const clone = this.cloneLayer(layer, `${layer.name} copy`);
        return { layers: [...layers.slice(0, index + 1), clone, ...layers.slice(index + 1)], label: `Duplicate “${layer.name}”` };
      }
      case "fit": {
        const layer = requireUnlocked(requireLayer(operation.layerId));
        if (layer.kind !== "image") throw new ProjectError("INVALID_INPUT", "Fit and fill apply to an image layer.", { fieldPath: "layerId" });
        const asset = assets.find((entry) => entry.id === (layer as ImageLayer).assetId);
        if (!asset) throw new ProjectError("ASSET_NOT_FOUND", `“${layer.name}” points at an image that is no longer registered.`);
        const scale = operation.mode === "actual" ? 1 : fitScale(asset, frame, operation.mode);
        return {
          layers: replaceLayer(layers, layer.id, (entry) => ({
            ...entry,
            transform: { ...entry.transform, scaleX: scale, scaleY: scale, x: frame.widthPx / 2, y: frame.heightPx / 2 },
          })),
          label: operation.mode === "actual"
            ? `Show “${layer.name}” at actual size`
            : `${operation.mode === "fit" ? "Fit" : "Fill"} “${layer.name}” to the canvas`,
        };
      }
      case "set_crop_ratio": {
        const layer = requireUnlocked(requireLayer(operation.layerId));
        if (layer.kind !== "image") throw new ProjectError("INVALID_INPUT", "Only an image layer can be cropped.", { fieldPath: "layerId" });
        const asset = assets.find((entry) => entry.id === (layer as ImageLayer).assetId);
        if (!asset) throw new ProjectError("ASSET_NOT_FOUND", `“${layer.name}” points at an image that is no longer registered.`);
        const crop = operation.ratio === null
          ? { left: 0, top: 0, right: 1, bottom: 1 }
          : constrainCropToRatio((layer as ImageLayer).crop, asset.widthPx, asset.heightPx, operation.ratio);
        return {
          layers: replaceLayer(layers, layer.id, (entry) => ({ ...(entry as ImageLayer), crop })),
          label: operation.ratio === null ? `Clear the crop on “${layer.name}”` : `Crop “${layer.name}” to ${operation.ratio.toFixed(3)} : 1`,
        };
      }
      case "reset_transform": {
        const layer = requireUnlocked(requireLayer(operation.layerId));
        return {
          layers: replaceLayer(layers, layer.id, (entry) => ({
            ...entry,
            transform: {
              ...entry.transform,
              rotationDeg: 0, flipX: false, flipY: false,
              scaleX: 1, scaleY: 1, anchorX: 0.5, anchorY: 0.5,
              x: frame.widthPx / 2, y: frame.heightPx / 2,
            },
          })),
          label: `Reset the transform on “${layer.name}”`,
        };
      }
      case "rotate_quarter": {
        const layer = requireUnlocked(requireLayer(operation.layerId));
        const degrees = ((layer.transform.rotationDeg + operation.turns * 90) % 360 + 360) % 360;
        const normalized = degrees > 180 ? degrees - 360 : degrees;
        return {
          layers: replaceLayer(layers, layer.id, (entry) => ({ ...entry, transform: { ...entry.transform, rotationDeg: normalized } })),
          label: `Rotate “${layer.name}” to ${normalized}°`,
        };
      }
      case "move_into_group": {
        const layer = requireLayer(operation.layerId);
        if (operation.groupId === layer.id) {
          throw new ProjectError("INVALID_INPUT", "A group cannot be moved inside itself.", { fieldPath: "groupId" });
        }
        if (operation.groupId && layer.kind === "group" && findLayer(layer.children, operation.groupId)) {
          throw new ProjectError("INVALID_INPUT", "A group cannot be moved inside one of its own children.", { fieldPath: "groupId" });
        }
        const detached = removeLayer(layers, layer.id);
        if (!operation.groupId) {
          const index = Math.min(operation.toIndex, detached.length);
          return { layers: [...detached.slice(0, index), layer, ...detached.slice(index)], label: `Move “${layer.name}” to the top level` };
        }
        const group = findLayer(detached, operation.groupId);
        if (!group || group.kind !== "group") {
          throw new ProjectError("INVALID_INPUT", "That destination is not a group.", { fieldPath: "groupId" });
        }
        return {
          layers: replaceLayer(detached, group.id, (entry) => {
            const children = (entry as { children: Layer[] }).children;
            const index = Math.min(operation.toIndex, children.length);
            return { ...entry, children: [...children.slice(0, index), layer, ...children.slice(index)] } as Layer;
          }),
          label: `Move “${layer.name}” into “${group.name}”`,
        };
      }
      case "distribute": {
        const targets = this.imageTargets(operation.layerIds, layers, assets).filter((target) => !target.layer.locked);
        if (targets.length < 3) {
          throw new ProjectError("INVALID_INPUT", "Distributing needs at least three unlocked layers.", { fieldPath: "layerIds" });
        }
        const axis = operation.axis === "horizontal" ? "x" : "y";
        const sorted = [...targets].sort((a, b) => a.bounds[axis] - b.bounds[axis]);
        const first = sorted[0].bounds[axis];
        const last = sorted[sorted.length - 1].bounds[axis];
        const step = (last - first) / (sorted.length - 1);

        let next = layers;
        sorted.forEach((target, index) => {
          const desired = first + step * index;
          const delta = desired - target.bounds[axis];
          next = replaceLayer(next, target.layer.id, (entry) => ({
            ...entry,
            transform: {
              ...entry.transform,
              x: axis === "x" ? entry.transform.x + delta : entry.transform.x,
              y: axis === "y" ? entry.transform.y + delta : entry.transform.y,
            },
          }));
        });
        return { layers: next, label: `Distribute ${sorted.length} layers ${operation.axis}ly` };
      }
    }
  }

  /** Deep copy with fresh identities, so a duplicated group does not share child IDs. */
  private cloneLayer(layer: Layer, name?: string): Layer {
    const base = { ...layer, id: this.createLayerId(), name: name ?? layer.name };
    if (base.kind === "group") {
      return { ...base, children: base.children.map((child) => this.cloneLayer(child)) };
    }
    return base;
  }

  private imageTargets(
    layerIds: string[],
    layers: readonly Layer[],
    assets: { id: string; widthPx: number; heightPx: number }[],
  ): { layer: ImageLayer; bounds: { x: number; y: number; width: number; height: number } }[] {
    return layerIds.map((layerId) => {
      const layer = findLayer(layers, layerId);
      if (!layer) throw new ProjectError("INVALID_INPUT", "That layer is not in this document.", { fieldPath: "layerIds" });
      if (layer.kind !== "image") throw new ProjectError("INVALID_INPUT", "Alignment applies to image layers.", { fieldPath: "layerIds" });
      const asset = assets.find((entry) => entry.id === layer.assetId);
      if (!asset) throw new ProjectError("ASSET_NOT_FOUND", `“${layer.name}” points at an image that is no longer registered.`);
      return { layer, bounds: layerBounds(layer, asset) };
    });
  }
}

/** Refuses a document that would grow past the layer limit, wherever the layer came from. */
function assertRoom(layers: readonly Layer[]): void {
  if (countLayers(layers) + 1 > MAX_LAYERS_PER_DOCUMENT) {
    throw new ProjectError("INVALID_INPUT", `A document holds at most ${MAX_LAYERS_PER_DOCUMENT} layers.`, { fieldPath: "layers" });
  }
}

/** Shared by the Inspector and `explain_edit` so both give the same account of a layer. */
export function describeLayer(layer: Layer, adjustments?: AdjustmentName[]): string {
  if (layer.kind === "group") return `“${layer.name}” is a group of ${layer.children.length} layer(s).`;

  const what = layer.kind === "image" ? "an image layer"
    : layer.kind === "adjustment" ? "an adjustment layer, which changes everything beneath it"
      : layer.kind === "fill" ? "a fill layer"
        : layer.kind === "paint" ? `a painted layer of ${layer.strokes.strokes.length} stroke(s)`
          : layer.content.kind === "text" ? "a text layer" : "a vector layer";
  const parts = [`“${layer.name}” is ${what} at ${Math.round(layer.opacity * 100)}% opacity.`];
  if (!layer.visible) parts.push("It is currently hidden.");
  if (layer.locked) parts.push("It is locked against editing.");
  if (layer.blendMode !== "normal") parts.push(`It blends with ${layer.blendMode}.`);
  if (layer.masks.length) parts.push(`It has ${layer.masks.length} mask(s).`);
  if (layer.clipToBelow) parts.push("It is clipped to the layer below.");
  if (layer.animation.length) parts.push(layer.animation.map(describeTrack).join(" "));

  if (layer.styles.styles.length) parts.push(layer.styles.styles.map(describeStyle).join(" "));

  if (layer.kind === "graphics") {
    parts.push(layer.content.kind === "text" ? describeTypography(layer.content.text) : "It draws a vector shape.");
    return parts.join(" ");
  }
  if (layer.kind === "fill") {
    parts.push(`It fills with ${layer.paint.kind === "solid" ? layer.paint.colour : `a ${layer.paint.kind}`}.`);
    return parts.join(" ");
  }
  if (layer.kind === "paint") return parts.join(" ");
  for (const name of adjustments ?? []) parts.push(describeAdjustment(name, layer.adjustments[name]));
  return parts.join(" ");
}

export function summarizeLayerTree(layers: readonly Layer[]): { total: number; images: number; groups: number; depth: number } {
  const flattened = flattenLayers(layers);
  return {
    total: flattened.length,
    images: flattened.filter((entry) => entry.layer.kind === "image").length,
    groups: flattened.filter((entry) => entry.layer.kind === "group").length,
    depth: groupDepth(layers),
  };
}

/**
 * Ink that will be visible on the surface a new graphic lands on.
 *
 * A transparent document is shown over the app's own dark canvas backdrop, so white reads
 * there; a solid background needs whichever of black or white carries more contrast against
 * it. Relative luminance rather than a channel average, because #00ff00 is bright and
 * #0000ff is not, and averaging cannot tell them apart.
 */
function inkForBackground(background: DocumentBackground): string {
  if (background.type === "transparent") return "#ffffff";
  const value = parseInt(background.color.slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255]
    .map((channel) => channel / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  return luminance > 0.35 ? "#111111" : "#ffffff";
}

/**
 * 48px was the default at every document size, which is unreadably small on a print-scale
 * canvas and oversized on a thumbnail. A twelfth of the shorter edge keeps a heading looking
 * like a heading, clamped so neither extreme produces something absurd.
 */
function defaultTextSizePx(frame: { widthPx: number; heightPx: number }): number {
  const shorter = Math.min(frame.widthPx, frame.heightPx);
  return Math.max(12, Math.min(400, Math.round(shorter / 12)));
}
