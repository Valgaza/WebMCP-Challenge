import { z } from "zod";
import {
  alphaMask, border, colourRangeMask, combine, createMask, describeSelection, feather, invert,
  isEmpty, lassoMask, luminanceRangeMask, marqueeMask, pathMask, resize, savedSelectionSchema,
  selectedArea, selectionBounds, selectionModeSchema, selectionSourceSchema, smooth, translate,
  wandMask, edgeContrast, shiftEdge, SELECTION_SCHEMA_VERSION,
  type PixelSource, type SavedSelection, type SelectionMask, type SelectionSource,
} from "../domain/selection";
import { shapeSchema, type Shape } from "../domain/vector";
import { ProjectError, toProjectError } from "../domain/project-error";
import type { SelectionRecord } from "../data/estro-database";

/**
 * The selection a person is working with, and the ones they have kept.
 *
 * The live selection is held in memory rather than in the project revision, and that is a
 * decision rather than an omission. A selection is where the next edit will land — tool state,
 * like a cursor — so putting it in history would fill Undo with steps that changed no pixels
 * and make "undo my crop" mean "undo my click". Anything worth keeping is saved by name, and a
 * saved selection is durable work: it cannot be recomputed once the click that made it is
 * forgotten, so it never goes in the evictable derived cache.
 */

/** How the service gets at pixels, kept as an interface so the engine stays testable. */
export interface SelectionPixelReader {
  /** The whole document as it currently looks. */
  readComposite: (projectId: string) => Promise<PixelSource>;
  /** One layer on its own, which is how a selection is taken from its transparency. */
  readLayer: (projectId: string, layerId: string) => Promise<PixelSource>;
}

export interface SelectionStore {
  put: (record: SelectionRecord) => Promise<void>;
  get: (projectId: string, id: string) => Promise<SelectionRecord | null>;
  list: (projectId: string) => Promise<SelectionRecord[]>;
  delete: (projectId: string, id: string) => Promise<void>;
  deleteForProject: (projectId: string) => Promise<void>;
}

/**
 * The refinement workspace: every global adjustment applied in one pass.
 *
 * These are separate from the individual refine operations on purpose. Someone cutting hair
 * out of a background works by nudging four sliders together and watching the result, and
 * running them as one step means the original selection is refined once rather than degraded
 * through four rounds of rounding.
 */
export const refineEdgeInputSchema = z.object({
  projectId: z.string().min(1),
  /** Cleans a ragged boundary, in pixels. */
  smoothPx: z.number().min(0).max(100).default(0),
  /** Widens the transition band. */
  featherPx: z.number().min(0).max(250).default(0),
  /** Positive hardens the edge, negative softens it, without moving it. */
  contrast: z.number().min(-1).max(1).default(0),
  /** Slides a soft boundary in or out without changing how soft it is. */
  shiftEdge: z.number().min(-1).max(1).default(0),
});
export type RefineEdgeInput = z.input<typeof refineEdgeInputSchema>;

/** How a refined selection is shown while it is being adjusted. */
export const refinePreviewSchema = z.enum(["marching_ants", "overlay", "on_black", "on_white", "mask"]);
export type RefinePreview = z.infer<typeof refinePreviewSchema>;

export const selectInputSchema = z.object({
  projectId: z.string().min(1),
  source: selectionSourceSchema,
  mode: selectionModeSchema.default("replace"),
  /** Only for a path selection, which carries its shape rather than naming one. */
  shape: shapeSchema.optional(),
});
export type SelectInput = z.input<typeof selectInputSchema>;

export const refineInputSchema = z.object({
  projectId: z.string().min(1),
  operation: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("feather"), radiusPx: z.number().min(0).max(500) }),
    z.object({ kind: z.literal("expand"), amountPx: z.number().min(0).max(500) }),
    z.object({ kind: z.literal("contract"), amountPx: z.number().min(0).max(500) }),
    z.object({ kind: z.literal("smooth"), radiusPx: z.number().min(0).max(100) }),
    z.object({ kind: z.literal("border"), widthPx: z.number().min(1).max(500) }),
    z.object({ kind: z.literal("move"), dx: z.number(), dy: z.number() }),
    z.object({ kind: z.literal("invert") }),
  ]),
});
export type RefineInput = z.input<typeof refineInputSchema>;

export interface SelectionState {
  /** Null when nothing is selected, which is not the same as everything being selected. */
  mask: SelectionMask | null;
  source: SelectionSource | null;
  areaPx: number;
  bounds: { x: number; y: number; width: number; height: number } | null;
  summary: string;
}

/** What a selection edge looks like, for drawing marching ants without re-tracing it. */
export interface SelectionOutline {
  widthPx: number;
  heightPx: number;
  /** One byte per pixel: non-zero where the selection edge runs. */
  edge: Uint8Array;
}

const EMPTY_STATE: SelectionState = {
  mask: null, source: null, areaPx: 0, bounds: null, summary: "Nothing is selected.",
};

export class SelectionService {
  private readonly live = new Map<string, { mask: SelectionMask; source: SelectionSource }>();

  constructor(
    private readonly pixels: SelectionPixelReader,
    private readonly store: SelectionStore,
  ) {}

  /** What is selected right now. */
  state(projectId: string): SelectionState {
    const current = this.live.get(projectId);
    if (!current || isEmpty(current.mask)) return EMPTY_STATE;
    return {
      mask: current.mask,
      source: current.source,
      areaPx: selectedArea(current.mask),
      bounds: selectionBounds(current.mask),
      summary: describeSelection(current.mask, current.source),
    };
  }

  /** The live mask, for the renderer and for any edit that has to respect it. */
  maskFor(projectId: string): SelectionMask | null {
    const current = this.live.get(projectId);
    return current && !isEmpty(current.mask) ? current.mask : null;
  }

  /**
   * Makes a selection, combining it with what is already selected.
   *
   * Every tool ends here: the difference between a marquee and a magic wand is which function
   * produces the coverage, not what happens to it afterwards. That is what keeps add, subtract,
   * and intersect working identically across all of them.
   */
  async select(input: SelectInput): Promise<SelectionState> {
    const parsed = selectInputSchema.parse(input);
    try {
      const incoming = await this.build(parsed.projectId, parsed.source, parsed.shape);
      const existing = this.live.get(parsed.projectId)?.mask;
      const mask = existing && parsed.mode !== "replace"
        ? combine(existing, incoming, parsed.mode)
        : combine(createMask(incoming.widthPx, incoming.heightPx), incoming, "replace");
      this.live.set(parsed.projectId, { mask, source: parsed.source });
      return this.state(parsed.projectId);
    } catch (error) {
      throw toProjectError(error);
    }
  }

  /** Selects the whole document, which is the starting point for subtracting from it. */
  async selectAll(projectId: string): Promise<SelectionState> {
    const composite = await this.pixels.readComposite(projectId);
    this.live.set(projectId, {
      mask: createMask(composite.widthPx, composite.heightPx, 255),
      source: { kind: "all" },
    });
    return this.state(projectId);
  }

  clear(projectId: string): SelectionState {
    this.live.delete(projectId);
    return EMPTY_STATE;
  }

  /** Grows, shrinks, softens, smooths, bands, moves, or inverts what is selected. */
  refine(input: RefineInput): SelectionState {
    const parsed = refineInputSchema.parse(input);
    const current = this.live.get(parsed.projectId);
    if (!current) {
      throw new ProjectError("INVALID_INPUT", "There is nothing selected to refine.", { fieldPath: "projectId" });
    }
    const operation = parsed.operation;
    const mask = operation.kind === "feather" ? feather(current.mask, operation.radiusPx)
      : operation.kind === "expand" ? resize(current.mask, operation.amountPx)
        : operation.kind === "contract" ? resize(current.mask, -operation.amountPx)
          : operation.kind === "smooth" ? smooth(current.mask, operation.radiusPx)
            : operation.kind === "border" ? border(current.mask, operation.widthPx)
              : operation.kind === "move" ? translate(current.mask, operation.dx, operation.dy)
                : invert(current.mask);
    this.live.set(parsed.projectId, { mask, source: current.source });
    return this.state(parsed.projectId);
  }

  /**
   * Runs the whole refinement workspace in one pass.
   *
   * The order is deliberate: smoothing first, because cleaning a ragged edge before softening
   * it produces a clean soft edge rather than a soft ragged one; then feather to set the band's
   * width, contrast to set its steepness, and the shift last, because it slides whatever band
   * the earlier steps produced.
   */
  refineEdge(input: RefineEdgeInput): SelectionState {
    const parsed = refineEdgeInputSchema.parse(input);
    const current = this.live.get(parsed.projectId);
    if (!current) {
      throw new ProjectError("INVALID_INPUT", "There is nothing selected to refine.", { fieldPath: "projectId" });
    }
    let mask = current.mask;
    if (parsed.smoothPx > 0) mask = smooth(mask, parsed.smoothPx);
    if (parsed.featherPx > 0) mask = feather(mask, parsed.featherPx);
    if (parsed.contrast !== 0) mask = edgeContrast(mask, parsed.contrast);
    if (parsed.shiftEdge !== 0) mask = shiftEdge(mask, parsed.shiftEdge);
    this.live.set(parsed.projectId, { mask, source: current.source });
    return this.state(parsed.projectId);
  }

  /**
   * The selection as a greyscale image, which is what a layer mask is.
   *
   * Turning a selection into a mask is how refinement work stops being temporary: the ants
   * disappear when the selection is cleared, but a mask made from it is part of the document.
   */
  toMaskImage(projectId: string): { widthPx: number; heightPx: number; greyscale: Uint8ClampedArray } {
    const mask = this.maskFor(projectId);
    if (!mask) {
      throw new ProjectError("INVALID_INPUT", "There is nothing selected to turn into a mask.", { fieldPath: "projectId" });
    }
    const greyscale = new Uint8ClampedArray(mask.coverage.length * 4);
    for (let index = 0; index < mask.coverage.length; index += 1) {
      const value = mask.coverage[index];
      greyscale.set([value, value, value, 255], index * 4);
    }
    return { widthPx: mask.widthPx, heightPx: mask.heightPx, greyscale };
  }

  /** Keeps the current selection under a name so it survives a reload. */
  async save(projectId: string, name: string): Promise<SavedSelection> {
    const current = this.live.get(projectId);
    if (!current || isEmpty(current.mask)) {
      throw new ProjectError("INVALID_INPUT", "There is nothing selected to save.", { fieldPath: "projectId" });
    }
    const trimmed = name.trim();
    if (!trimmed) {
      throw new ProjectError("INVALID_INPUT", "A saved selection needs a name.", { fieldPath: "name" });
    }
    // Saving over a name replaces it, rather than leaving two selections a person cannot tell
    // apart in a list.
    const existing = (await this.store.list(projectId)).find((entry) => entry.name === trimmed);
    const record: SelectionRecord = {
      id: existing?.id ?? crypto.randomUUID(),
      schemaVersion: SELECTION_SCHEMA_VERSION,
      projectId,
      name: trimmed,
      widthPx: current.mask.widthPx,
      heightPx: current.mask.heightPx,
      areaPx: selectedArea(current.mask),
      source: current.source,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      // A copy, so later refinements of the live selection do not rewrite what was saved.
      coverage: new Uint8Array(current.mask.coverage),
    };
    await this.store.put(record);
    const { coverage: _coverage, projectId: _projectId, ...metadata } = record;
    return savedSelectionSchema.parse(metadata);
  }

  /** Brings a saved selection back, combining it with whatever is selected now. */
  async load(projectId: string, selectionId: string, mode: SelectInput["mode"] = "replace"): Promise<SelectionState> {
    const record = await this.store.get(projectId, selectionId);
    if (!record) {
      throw new ProjectError("INVALID_INPUT", "That saved selection is no longer in the project.", { fieldPath: "selectionId" });
    }
    const composite = await this.pixels.readComposite(projectId);
    if (record.widthPx !== composite.widthPx || record.heightPx !== composite.heightPx) {
      throw new ProjectError(
        "INVALID_INPUT",
        `“${record.name}” was saved for a ${record.widthPx}×${record.heightPx} image and this one is ${composite.widthPx}×${composite.heightPx}.`,
        { fieldPath: "selectionId" },
      );
    }
    const stored: SelectionMask = {
      widthPx: record.widthPx, heightPx: record.heightPx, coverage: new Uint8Array(record.coverage),
    };
    const existing = this.live.get(projectId)?.mask;
    const mask = existing && mode !== "replace" ? combine(existing, stored, selectionModeSchema.parse(mode)) : stored;
    this.live.set(projectId, { mask, source: record.source });
    return this.state(projectId);
  }

  /**
   * A saved selection as a greyscale image, for a layer mask that points at it.
   *
   * Reads the store directly rather than the live selection: a mask refers to what was saved,
   * so changing what is selected now must not change what the mask cuts.
   */
  async readMaskImage(
    projectId: string, selectionId: string,
  ): Promise<{ widthPx: number; heightPx: number; greyscale: Uint8ClampedArray<ArrayBuffer> } | null> {
    const record = await this.store.get(projectId, selectionId);
    if (!record) return null;
    const greyscale = new Uint8ClampedArray(new ArrayBuffer(record.coverage.length * 4));
    for (let index = 0; index < record.coverage.length; index += 1) {
      const value = record.coverage[index];
      greyscale.set([value, value, value, 255], index * 4);
    }
    return { widthPx: record.widthPx, heightPx: record.heightPx, greyscale };
  }

  async list(projectId: string): Promise<SavedSelection[]> {
    const records = await this.store.list(projectId);
    return records.map(({ coverage: _coverage, projectId: _projectId, ...metadata }) => savedSelectionSchema.parse(metadata));
  }

  async remove(projectId: string, selectionId: string): Promise<void> {
    await this.store.delete(projectId, selectionId);
  }

  async removeForProject(projectId: string): Promise<void> {
    this.live.delete(projectId);
    await this.store.deleteForProject(projectId);
  }

  /**
   * The edge of the selection, for drawing marching ants.
   *
   * Tracing it once here and handing back a bitmap keeps the interface from re-deriving the
   * outline every animation frame, which on a full-resolution photograph is the difference
   * between a smooth crawl and a stutter.
   */
  outline(projectId: string): SelectionOutline | null {
    const mask = this.maskFor(projectId);
    if (!mask) return null;
    const { widthPx, heightPx, coverage } = mask;
    const edge = new Uint8Array(coverage.length);
    // Halfway is the boundary a person perceives on a feathered edge, so that is where the
    // ants are drawn rather than at the outermost non-zero pixel.
    const inside = (index: number): boolean => coverage[index] >= 128;
    for (let y = 0; y < heightPx; y += 1) {
      for (let x = 0; x < widthPx; x += 1) {
        const index = y * widthPx + x;
        if (!inside(index)) continue;
        const bordered = (x === 0 || !inside(index - 1))
          || (x === widthPx - 1 || !inside(index + 1))
          || (y === 0 || !inside(index - widthPx))
          || (y === heightPx - 1 || !inside(index + widthPx));
        if (bordered) edge[index] = 255;
      }
    }
    return { widthPx, heightPx, edge };
  }

  private async build(projectId: string, source: SelectionSource, shape: Shape | undefined): Promise<SelectionMask> {
    if (source.kind === "marquee" || source.kind === "lasso" || source.kind === "path" || source.kind === "all") {
      // These need only the document's size, so they never pay for a composite render.
      const size = await this.documentSize(projectId);
      if (source.kind === "marquee") return marqueeMask(size.widthPx, size.heightPx, source);
      if (source.kind === "lasso") return lassoMask(size.widthPx, size.heightPx, source);
      if (source.kind === "all") return createMask(size.widthPx, size.heightPx, 255);
      if (!shape) {
        throw new ProjectError("INVALID_INPUT", "A selection from a path needs the path itself.", { fieldPath: "shape" });
      }
      return pathMask(size.widthPx, size.heightPx, shape);
    }

    if (source.kind === "layer_alpha") return alphaMask(await this.pixels.readLayer(projectId, source.layerId));

    const composite = await this.pixels.readComposite(projectId);
    if (source.kind === "wand") return wandMask(composite, source);
    if (source.kind === "colour_range") return colourRangeMask(composite, source);
    return luminanceRangeMask(composite, source);
  }

  private async documentSize(projectId: string): Promise<{ widthPx: number; heightPx: number }> {
    const composite = await this.pixels.readComposite(projectId);
    return { widthPx: composite.widthPx, heightPx: composite.heightPx };
  }
}

/** The durable store, backed by the project database. */
export function createSelectionStore(database: {
  selections: {
    put: (record: SelectionRecord) => Promise<unknown>;
    get: (id: string) => Promise<SelectionRecord | undefined>;
    where: (index: string) => { equals: (value: string) => { toArray: () => Promise<SelectionRecord[]>; delete: () => Promise<number> } };
    delete: (id: string) => Promise<unknown>;
  };
}): SelectionStore {
  return {
    put: async (record) => { await database.selections.put(record); },
    get: async (projectId, id) => {
      const record = await database.selections.get(id);
      // The id alone would let one project load another's selection, so the project is checked
      // rather than assumed from the key.
      return record && record.projectId === projectId ? record : null;
    },
    list: async (projectId) => {
      const records = await database.selections.where("projectId").equals(projectId).toArray();
      return records.sort((a, b) => a.name.localeCompare(b.name));
    },
    delete: async (projectId, id) => {
      const record = await database.selections.get(id);
      if (record?.projectId === projectId) await database.selections.delete(id);
    },
    deleteForProject: async (projectId) => {
      await database.selections.where("projectId").equals(projectId).delete();
    },
  };
}
