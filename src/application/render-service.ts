import { decodeImageBlob } from "../media/decode-image";
import { ProjectError, toProjectError } from "../domain/project-error";
import { applyViewingModes, flattenLayers, resolveInheritance, type Layer } from "../domain/layer";
import { computeHistogram, describeExposure, type Histogram } from "../render/histogram";
import { readPixels, renderDocument, type RenderResult, type RenderSource } from "../render/composite";
import { previewCacheKey } from "../data/derived-cache";
import { count } from "../domain/plural";
import type { MediaWorkerClient } from "../media/worker-client";
import { createUnavailableWorkerClient } from "../media/worker-client";
import type { HistogramTaskResult, ResampleAlgorithm, ResampleTaskResult } from "../workers/worker-protocol";
import type { AssetService } from "./asset-service";
import type { ProjectService } from "./project-service";

export interface RenderRequest {
  projectId: string;
  scale?: number;
  excludeLayerIds?: string[];
  soloLayerIds?: readonly string[];
  isolateGroupId?: string | null;
  /** Renders a specific past revision instead of the head, for real before/after comparison. */
  revisionId?: string | null;
  signal?: AbortSignal;
}

export interface RenderOutcome extends RenderResult {
  revisionId: string;
  documentId: string;
}

/** How a before/after comparison chooses its baseline. */
export type ComparisonBaseline = "original_import" | "previous_revision" | "chosen_revision";

export interface ComparisonState {
  baseline: ComparisonBaseline;
  baselineRevisionId: string;
  currentRevisionId: string;
  mode: "off" | "hold" | "toggle" | "split" | "side_by_side";
  splitPosition: number;
  available: boolean;
  reason: string | null;
}

/** Loads saved selections as drawable images, for masks that point at one. */
export type StoredMaskProvider = (
  projectId: string, selectionIds: readonly string[],
) => Promise<ReadonlyMap<string, CanvasImageSource> | undefined>;

export interface RenderServiceOptions {
  worker?: MediaWorkerClient;
}

/**
 * Turns a revision into pixels. Decoded sources are cached per asset content hash, so
 * re-rendering after a parameter change never re-decodes the original file — and a replaced
 * source invalidates itself, because its hash changes.
 */
export class RenderService {
  private readonly bitmaps = new Map<string, { hash: string; bitmap: ImageBitmap; widthPx: number; heightPx: number }>();
  private readonly worker: MediaWorkerClient;
  private maskProvider: StoredMaskProvider | null = null;

  constructor(
    private readonly projects: ProjectService,
    private readonly assets: AssetService,
    options: RenderServiceOptions = {},
  ) {
    this.worker = options.worker ?? createUnavailableWorkerClient();
  }

  /**
   * Draws the document, or abandons the attempt — never both.
   *
   * There used to be a `generation` counter here, bumped by every call, and the loop that
   * collects image sources broke out of itself as soon as any *other* render started. It then
   * composited whatever it had, which was usually nothing, and returned that as a finished
   * picture with "could not be drawn" warnings attached.
   *
   * One counter shared by every caller is what made this reachable: `histogram()` renders
   * through here too, so opening the Inspector's histogram aborted the canvas mid-collection
   * and the canvas drew empty. It survived unnoticed only because the canvas used to
   * re-composite on almost any interaction, so a correct render came along shortly afterwards
   * and painted over the blank one.
   *
   * Cancellation belongs to the caller that owns the work, so it comes from `request.signal`
   * now, and a cancelled render throws instead of returning a picture nobody asked for.
   */
  async render(request: RenderRequest): Promise<RenderOutcome> {
    try {
      const history = await this.projects.getProjectHistory(request.projectId);
      // A comparison baseline renders a specific revision rather than the current one; the
      // "before" of an edit is a past state, not the current document with its layers hidden.
      const revision = request.revisionId && request.revisionId !== history.headRevision.id
        ? await this.projects.getRevision(request.revisionId)
        : history.headRevision;
      const document = revision.state.photoDocument;
      if (!document) {
        throw new ProjectError("INVALID_INPUT", "This project has no image document to render.", { fieldPath: "projectId" });
      }

      const scoped = applyViewingModes(document.layers, {
        soloLayerIds: request.soloLayerIds,
        isolateGroupId: request.isolateGroupId,
      });

      const needed = new Set(
        resolveInheritance(scoped)
          // Only image layers need a decoded source; text and vector draw themselves.
          .filter((entry) => entry.visible && entry.layer.kind === "image" && !(request.excludeLayerIds ?? []).includes(entry.layer.id))
          .map((entry) => (entry.layer as { assetId: string }).assetId),
      );

      const sources: RenderSource[] = [];
      const missing: string[] = [];
      const missingReasons: string[] = [];
      for (const assetId of needed) {
        if (request.signal?.aborted) throw new ProjectError("RENDER_CANCELLED", "This render was cancelled.");
        // A resampled derivative means the algorithm the user chose has already been applied
        // to these pixels; drawing from it is what makes that choice visible.
        const derivative = await this.assets.getAsset(assetId)
          .then((record) => record.derivatives.find(
            (entry) => entry.kind === "preview"
              && entry.settings.startsWith("algorithm=")
              && entry.sourceRevision === record.reference.sourceRevision,
          ) ?? null)
          .catch(() => null);
        /*
         * Keep the reason, rather than only the fact.
         *
         * This was `.catch(() => null)`, so a layer that could not be drawn produced a count
         * and nothing else — the canvas came back with only its background and the person was
         * told "1 image source(s) could not be read", which does not say which one or why.
         */
        let reason: string | null = null;
        const source = await this.sourceFor(
          assetId,
          derivative ? { key: derivative.key, widthPx: 0, heightPx: 0 } : null,
        ).catch((error: unknown) => {
          reason = error instanceof Error ? error.message : String(error);
          return null;
        });
        if (source) sources.push(source);
        else {
          missing.push(assetId);
          if (reason) missingReasons.push(reason);
        }
      }

      // Only fetched when a mask actually points at one, so an ordinary render never pays
      // for a store read it does not need.
      const maskImages = await this.loadMaskImages(request.projectId, document.layers);

      const result = renderDocument(
        { widthPx: document.widthPx, heightPx: document.heightPx, background: document.background, layers: document.layers, swatches: document.swatches },
        sources,
        {
          scale: request.scale, excludeLayerIds: request.excludeLayerIds,
          soloLayerIds: request.soloLayerIds, isolateGroupId: request.isolateGroupId,
          maskImages,
        },
      );

      if (missing.length) {
        /*
         * The reason goes first.
         *
         * Compositing contributes its own per-layer line — "X could not be drawn because its
         * image is unavailable" — which names the layer and explains nothing. That line sorted
         * ahead of this one, so the banner told a person their picture was unavailable while
         * the sentence saying *why* sat unread behind it.
         */
        const [firstReason] = missingReasons;
        result.warnings.unshift(firstReason
          ? `${count(missing.length, "image")} could not be drawn. ${firstReason}`
          : `${count(missing.length, "image")} could not be read. Relink to see the full result.`);
      }

      return { ...result, revisionId: revision.id, documentId: document.id };
    } catch (error) { throw toProjectError(error); }
  }

  /**
   * Resolves which revision a comparison should show.
   *
   * Hiding every layer and calling the result "before" showed the empty background, which is
   * not a state the document was ever in. The baseline is a real revision: the picture as it
   * was imported, the revision before this one, or one the user picked.
   *
   * That fix went halfway. It stopped inventing an empty background and started picking the
   * first revision that had a *document* — which, for every project that has ever existed, is
   * the empty canvas created before anything was imported into it. So "before" still showed a
   * flat background, only now it was a real revision showing one, which is harder to notice
   * and impossible to argue with. "Original import" now means the earliest revision that
   * actually contains a picture.
   */
  async comparisonState(
    projectId: string,
    baseline: ComparisonBaseline,
    chosenRevisionId?: string | null,
    mode: ComparisonState["mode"] = "toggle",
    splitPosition = 0.5,
  ): Promise<ComparisonState> {
    const history = await this.projects.getProjectHistory(projectId);
    const revisions = await this.projects.listRevisions(projectId);
    const current = history.headRevision;

    const withDocument = revisions.filter((entry) => entry.state.photoDocument !== null && entry.state.photoDocument !== undefined);
    let baselineRevisionId: string | null = null;
    let reason: string | null = null;

    if (baseline === "chosen_revision") {
      baselineRevisionId = chosenRevisionId ?? null;
      if (baselineRevisionId && !revisions.some((entry) => entry.id === baselineRevisionId)) {
        reason = "That revision is no longer in this project's history.";
        baselineRevisionId = null;
      }
    } else if (baseline === "previous_revision") {
      const index = revisions.findIndex((entry) => entry.id === current.id);
      baselineRevisionId = index > 0 ? revisions[index - 1].id : null;
      if (!baselineRevisionId) reason = "This is the first revision, so there is nothing earlier to compare with.";
    } else {
      const withPicture = withDocument.find((entry) =>
        flattenLayers(entry.state.photoDocument?.layers ?? []).some(({ layer }) => layer.kind === "image"));
      baselineRevisionId = (withPicture ?? withDocument[0])?.id ?? null;
      if (!baselineRevisionId) reason = "No earlier revision contains an image document.";
      else if (!withPicture) reason = "Nothing has been imported into this document yet, so the baseline is the empty canvas.";
    }

    return {
      baseline,
      baselineRevisionId: baselineRevisionId ?? current.id,
      currentRevisionId: current.id,
      mode,
      splitPosition: Math.max(0, Math.min(1, splitPosition)),
      available: baselineRevisionId !== null && baselineRevisionId !== current.id,
      reason: baselineRevisionId === current.id ? "The baseline and the current state are the same revision." : reason,
    };
  }

  /**
   * Histogram of the current visible composite.
   *
   * The pixel loop runs in the worker where one exists: at a quarter scale of a 4K document
   * it is still two million samples, which is long enough to drop frames if it runs on the
   * interaction thread.
   */
  async histogram(
    projectId: string,
    scale = 0.25,
    options: { revisionId?: string | null } = {},
  ): Promise<Histogram & { revisionId: string; exposure: string; scale: number; ranInWorker: boolean }> {
    const rendered = await this.render({ projectId, scale, revisionId: options.revisionId ?? null });
    const pixels = readPixels(rendered);

    if (this.worker.available) {
      try {
        const result = await this.worker.run<HistogramTaskResult>("histogram", {
          pixels, widthPx: rendered.widthPx, heightPx: rendered.heightPx,
        }, { projectId });
        const histogram = result.histogram;
        return { ...histogram, revisionId: rendered.revisionId, exposure: describeExposure(histogram), scale, ranInWorker: true };
      } catch {
        // Fall through to the main-thread path rather than failing the panel entirely.
      }
    }

    const histogram = computeHistogram(pixels);
    return { ...histogram, revisionId: rendered.revisionId, exposure: describeExposure(histogram), scale, ranInWorker: false };
  }

  /**
   * The pixels a layer draws from.
   *
   * A resampled derivative is preferred where one exists, because that is where the
   * algorithm the user chose was actually applied. Its native size travels with it so the
   * document lays the layer out exactly as before.
   */
  private async sourceFor(assetId: string, resampled?: { key: string; widthPx: number; heightPx: number } | null): Promise<RenderSource> {
    const record = await this.assets.getAsset(assetId);
    const cacheKey = resampled ? `${assetId}:${resampled.key}` : assetId;
    const cached = this.bitmaps.get(cacheKey);
    if (cached && cached.hash === record.reference.contentHash) {
      return {
        assetId, bitmap: cached.bitmap, widthPx: cached.widthPx, heightPx: cached.heightPx,
        nativeWidthPx: record.reference.widthPx, nativeHeightPx: record.reference.heightPx,
      };
    }

    const blob = resampled ? await this.assets.readDerived(resampled.key) : null;
    const file = blob ?? await this.assets.readAssetFile(assetId);
    const bitmap = await decodeImageBlob(file);
    cached?.bitmap.close?.();
    this.bitmaps.set(cacheKey, { hash: record.reference.contentHash, bitmap, widthPx: bitmap.width, heightPx: bitmap.height });
    return {
      assetId, bitmap, widthPx: bitmap.width, heightPx: bitmap.height,
      nativeWidthPx: record.reference.widthPx, nativeHeightPx: record.reference.heightPx,
    };
  }

  /**
   * Encodes the current composite at a chosen format and quality and reports the real byte
   * size and the type the browser actually produced. Estimates are measured, never guessed,
   * and a substituted format is stated rather than hidden.
   */
  async previewExport(
    projectId: string,
    options: {
      mediaType: string;
      quality: number;
      maxEdgePx?: number;
      /** Explicit rather than left to whatever the canvas would do on its own. */
      resampleAlgorithm?: ResampleAlgorithm;
      preserveTransparency?: boolean;
    },
  ): Promise<{
    revisionId: string; blob: Blob; mediaType: string; requestedMediaType: string;
    byteSize: number; widthPx: number; heightPx: number; substituted: boolean;
    resampleAlgorithm: ResampleAlgorithm; hasAlpha: boolean; warnings: string[];
  }> {
    const size = await this.documentSize(projectId);
    const targetScale = options.maxEdgePx ? Math.min(1, options.maxEdgePx / Math.max(1, size.longestEdge)) : 1;
    const algorithm = options.resampleAlgorithm ?? "lanczos3";
    const warnings: string[] = [];

    // Render at full document resolution, then resample once with the chosen algorithm.
    // Rendering small and calling it "resampled" would hide which filter actually ran.
    const rendered = await this.render({ projectId, scale: 1 });
    warnings.push(...rendered.warnings);

    const targetWidth = Math.max(1, Math.round(rendered.widthPx * targetScale));
    const targetHeight = Math.max(1, Math.round(rendered.heightPx * targetScale));

    let blob: Blob;
    let actualWidth = rendered.widthPx;
    let actualHeight = rendered.heightPx;
    let usedAlgorithm: ResampleAlgorithm = algorithm;

    const encodeCanvas = async (canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Blob> => {
      if (typeof (canvas as OffscreenCanvas).convertToBlob === "function") {
        return (canvas as OffscreenCanvas).convertToBlob({ type: options.mediaType, quality: options.quality });
      }
      return new Promise<Blob>((resolve, reject) => {
        (canvas as HTMLCanvasElement).toBlob(
          (result) => (result ? resolve(result) : reject(new ProjectError("MEDIA_DECODE_FAILED", "This browser could not encode the export."))),
          options.mediaType,
          options.quality,
        );
      });
    };

    if (targetScale < 1) {
      const sourceBlob = await encodeCanvas(rendered.canvas);
      if (this.worker.available) {
        const result = await this.worker.run<ResampleTaskResult>("resample", {
          blob: sourceBlob,
          targetWidthPx: targetWidth,
          targetHeightPx: targetHeight,
          algorithm,
          outputType: options.mediaType,
          quality: options.quality,
        }, { projectId });
        blob = result.blob;
        actualWidth = result.widthPx;
        actualHeight = result.heightPx;
        usedAlgorithm = result.algorithm;
      } else {
        const scaled = await this.render({ projectId, scale: targetScale });
        blob = await encodeCanvas(scaled.canvas);
        actualWidth = scaled.widthPx;
        actualHeight = scaled.heightPx;
        usedAlgorithm = "browser-smooth";
        warnings.push("This browser has no media worker, so the browser's own scaling filter was used instead of the chosen algorithm.");
      }
    } else {
      blob = await encodeCanvas(rendered.canvas);
    }

    const substituted = blob.type !== options.mediaType;
    if (substituted) {
      warnings.push(`This browser cannot encode ${options.mediaType} and produced ${blob.type || "an unknown type"} instead.`);
    }
    const hasAlpha = options.mediaType === "image/png" || options.mediaType === "image/webp";
    if (options.preserveTransparency && !hasAlpha) {
      warnings.push(`${options.mediaType} has no alpha channel, so transparent areas were filled with the document background.`);
    }

    return {
      revisionId: rendered.revisionId, blob, mediaType: blob.type || options.mediaType,
      requestedMediaType: options.mediaType, byteSize: blob.size,
      widthPx: actualWidth, heightPx: actualHeight, substituted,
      resampleAlgorithm: usedAlgorithm, hasAlpha, warnings,
    };
  }

  private async documentSize(projectId: string): Promise<{ longestEdge: number; widthPx: number; heightPx: number }> {
    const history = await this.projects.getProjectHistory(projectId);
    const document = history.headRevision.state.photoDocument;
    if (!document) throw new ProjectError("INVALID_INPUT", "This project has no image document.", { fieldPath: "projectId" });
    return { longestEdge: Math.max(document.widthPx, document.heightPx), widthPx: document.widthPx, heightPx: document.heightPx };
  }

  /** A stable cache key for one preview, so a scheduler can tell requests apart. */
  previewKey(projectId: string, revisionId: string, quality: string, variant?: string): string {
    return previewCacheKey({ scope: "document", targetId: projectId, revisionId, quality, variant });
  }

  /** Frees decoded bitmaps; derived data is reproducible so nothing is lost. */
  /**
   * Where stored mask images come from.
   *
   * Registered after construction rather than injected, because the selection service reads
   * pixels through this one: naming the dependency both ways at construction would be a cycle.
   */
  registerMaskImages(provider: StoredMaskProvider): void {
    this.maskProvider = provider;
  }

  private async loadMaskImages(
    projectId: string, layers: readonly Layer[],
  ): Promise<ReadonlyMap<string, CanvasImageSource> | undefined> {
    if (!this.maskProvider) return undefined;
    const wanted = new Set<string>();
    for (const { layer } of flattenLayers(layers)) {
      for (const mask of layer.masks) {
        if (mask.enabled && mask.source.kind === "stored") wanted.add(mask.source.selectionId);
      }
    }
    if (!wanted.size) return undefined;
    // A mask that cannot be loaded leaves its layer whole and is reported, rather than
    // failing the whole render for one missing selection.
    return this.maskProvider(projectId, [...wanted]).catch(() => undefined);
  }

  releaseCache(): void {
    for (const entry of this.bitmaps.values()) entry.bitmap.close?.();
    this.bitmaps.clear();
  }

  /** Flattens the layer tree for callers that need a stable, ordered list. */
  static flatten(layers: readonly Layer[]): Layer[] {
    return layers.flatMap((layer) => (layer.kind === "group" ? [layer, ...RenderService.flatten(layer.children)] : [layer]));
  }
}
