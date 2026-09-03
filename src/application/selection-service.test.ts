import { beforeEach, describe, expect, it } from "vitest";
import type { SelectionRecord } from "../data/estro-database";
import { selectedArea } from "../domain/selection";
import {
  SelectionService, type SelectionPixelReader, type SelectionStore,
} from "./selection-service";

const PROJECT = "project-1";

/** A document half red, half blue, with a fully transparent right edge on one layer. */
const composite = (width = 20, height = 20) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data.set(x < width / 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * width + x) * 4);
    }
  }
  return { widthPx: width, heightPx: height, data };
};

const layerPixels = (width = 20, height = 20) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4 + 3] = index % width < 5 ? 255 : 0;
  }
  return { widthPx: width, heightPx: height, data };
};

const memoryStore = (): SelectionStore => {
  const rows = new Map<string, SelectionRecord>();
  return {
    put: async (record) => { rows.set(record.id, record); },
    get: async (projectId, id) => {
      const record = rows.get(id);
      return record && record.projectId === projectId ? record : null;
    },
    list: async (projectId) => [...rows.values()].filter((record) => record.projectId === projectId),
    delete: async (projectId, id) => {
      if (rows.get(id)?.projectId === projectId) rows.delete(id);
    },
    deleteForProject: async (projectId) => {
      for (const [id, record] of rows) if (record.projectId === projectId) rows.delete(id);
    },
  };
};

const reader = (documentSize = 20): SelectionPixelReader => ({
  readComposite: async () => composite(documentSize, documentSize),
  readLayer: async () => layerPixels(documentSize, documentSize),
});

/**
 * `PH-016` through `PH-022`. Every selection tool ends at the same place: the difference
 * between a marquee and a magic wand is which function produces the coverage, never what
 * happens to it afterwards.
 */
describe("making a selection", () => {
  let service: SelectionService;
  beforeEach(() => { service = new SelectionService(reader(), memoryStore()); });

  it("starts with nothing selected, which is not the same as everything", async () => {
    expect(service.state(PROJECT)).toMatchObject({ mask: null, areaPx: 0, summary: "Nothing is selected." });
    expect(service.maskFor(PROJECT)).toBeNull();
  });

  it("selects a marquee and reports what it covers", async () => {
    const state = await service.select({
      projectId: PROJECT,
      source: { kind: "marquee", shape: "rectangle", x: 2, y: 2, width: 4, height: 4, featherPx: 0 },
    });
    expect(state.areaPx).toBe(16);
    expect(state.bounds).toEqual({ x: 2, y: 2, width: 4, height: 4 });
    expect(state.summary).toContain("rectangular marquee");
  });

  it("selects everything, and clears back to nothing", async () => {
    expect((await service.selectAll(PROJECT)).areaPx).toBe(400);
    expect(service.clear(PROJECT).mask).toBeNull();
  });

  it("spreads a wand from the point clicked", async () => {
    const state = await service.select({
      projectId: PROJECT, source: { kind: "wand", x: 1, y: 1, tolerance: 10, contiguous: true },
    });
    expect(state.areaPx).toBe(200);
  });

  it("selects a layer's own transparency", async () => {
    const state = await service.select({ projectId: PROJECT, source: { kind: "layer_alpha", layerId: "layer-1" } });
    expect(state.areaPx).toBe(100);
  });

  it("selects the area a path encloses", async () => {
    const state = await service.select({
      projectId: PROJECT,
      source: { kind: "path" },
      shape: { kind: "rectangle", x: 4, y: 4, width: 8, height: 8, cornerRadius: 0 },
    });
    expect(state.bounds).toMatchObject({ x: 4, y: 4 });
  });

  it("asks for the path rather than selecting nothing when it was not given one", async () => {
    await expect(service.select({ projectId: PROJECT, source: { kind: "path" } }))
      .rejects.toThrowError(/needs the path itself/);
  });

  /** The point of one shared combining step: every tool gains add and subtract for free. */
  it("adds a second selection to the first", async () => {
    await service.select({
      projectId: PROJECT,
      source: { kind: "marquee", shape: "rectangle", x: 0, y: 0, width: 4, height: 4, featherPx: 0 },
    });
    const state = await service.select({
      projectId: PROJECT,
      source: { kind: "marquee", shape: "rectangle", x: 10, y: 10, width: 4, height: 4, featherPx: 0 },
      mode: "add",
    });
    expect(state.areaPx).toBe(32);
  });

  it("subtracts and intersects", async () => {
    const whole = { kind: "marquee", shape: "rectangle", x: 0, y: 0, width: 10, height: 10, featherPx: 0 } as const;
    const corner = { kind: "marquee", shape: "rectangle", x: 0, y: 0, width: 5, height: 10, featherPx: 0 } as const;

    await service.select({ projectId: PROJECT, source: whole });
    expect((await service.select({ projectId: PROJECT, source: corner, mode: "subtract" })).areaPx).toBe(50);

    await service.select({ projectId: PROJECT, source: whole });
    expect((await service.select({ projectId: PROJECT, source: corner, mode: "intersect" })).areaPx).toBe(50);
  });

  it("replaces rather than combining when told to", async () => {
    await service.selectAll(PROJECT);
    const state = await service.select({
      projectId: PROJECT,
      source: { kind: "marquee", shape: "rectangle", x: 0, y: 0, width: 2, height: 2, featherPx: 0 },
      mode: "replace",
    });
    expect(state.areaPx).toBe(4);
  });

  it("reports a selection that covers nothing as nothing selected", async () => {
    const state = await service.select({
      projectId: PROJECT,
      source: { kind: "marquee", shape: "rectangle", x: 0, y: 0, width: 0, height: 0, featherPx: 0 },
    });
    expect(state.mask).toBeNull();
  });

  it("keeps each project's selection to itself", async () => {
    await service.selectAll(PROJECT);
    expect(service.state("project-2").mask).toBeNull();
  });
});

describe("refining a selection", () => {
  let service: SelectionService;
  beforeEach(async () => {
    service = new SelectionService(reader(), memoryStore());
    await service.select({
      projectId: PROJECT,
      source: { kind: "marquee", shape: "rectangle", x: 6, y: 6, width: 8, height: 8, featherPx: 0 },
    });
  });

  it("grows, shrinks, softens, and bands", () => {
    expect(service.refine({ projectId: PROJECT, operation: { kind: "expand", amountPx: 2 } }).areaPx).toBeGreaterThan(64);
    expect(service.refine({ projectId: PROJECT, operation: { kind: "contract", amountPx: 2 } }).areaPx).toBeLessThan(120);
    expect(service.refine({ projectId: PROJECT, operation: { kind: "feather", radiusPx: 2 } }).mask).not.toBeNull();
    expect(service.refine({ projectId: PROJECT, operation: { kind: "smooth", radiusPx: 1 } }).mask).not.toBeNull();
    expect(service.refine({ projectId: PROJECT, operation: { kind: "border", widthPx: 2 } }).mask).not.toBeNull();
  });

  it("moves a selection without reshaping it", () => {
    expect(service.refine({ projectId: PROJECT, operation: { kind: "move", dx: 2, dy: 0 } }).bounds)
      .toEqual({ x: 8, y: 6, width: 8, height: 8 });
  });

  it("inverts to everything else in the document", () => {
    expect(service.refine({ projectId: PROJECT, operation: { kind: "invert" } }).areaPx).toBe(400 - 64);
  });

  it("says so rather than refining nothing", () => {
    service.clear(PROJECT);
    expect(() => service.refine({ projectId: PROJECT, operation: { kind: "invert" } }))
      .toThrowError(/nothing selected to refine/);
  });
});

describe("saving and reloading a selection", () => {
  let service: SelectionService;
  beforeEach(async () => {
    service = new SelectionService(reader(), memoryStore());
    await service.select({
      projectId: PROJECT,
      source: { kind: "marquee", shape: "rectangle", x: 4, y: 4, width: 6, height: 6, featherPx: 0 },
    });
  });

  it("keeps a selection under a name and brings it back", async () => {
    const saved = await service.save(PROJECT, "Sky");
    expect(saved.name).toBe("Sky");
    expect(saved.areaPx).toBe(36);

    service.clear(PROJECT);
    const state = await service.load(PROJECT, saved.id);
    expect(state.areaPx).toBe(36);
    expect(state.bounds).toEqual({ x: 4, y: 4, width: 6, height: 6 });
  });

  /** Without the copy, refining the live selection would silently rewrite what was saved. */
  it("does not change what was saved when the live selection is refined afterwards", async () => {
    const saved = await service.save(PROJECT, "Sky");
    service.refine({ projectId: PROJECT, operation: { kind: "expand", amountPx: 3 } });
    service.clear(PROJECT);
    expect((await service.load(PROJECT, saved.id)).areaPx).toBe(36);
  });

  it("loads a saved selection combined with the current one", async () => {
    const saved = await service.save(PROJECT, "Sky");
    await service.select({
      projectId: PROJECT,
      source: { kind: "marquee", shape: "rectangle", x: 14, y: 14, width: 4, height: 4, featherPx: 0 },
    });
    expect((await service.load(PROJECT, saved.id, "add")).areaPx).toBe(52);
  });

  it("replaces a selection saved under the same name rather than listing two alike", async () => {
    const first = await service.save(PROJECT, "Sky");
    await service.selectAll(PROJECT);
    const second = await service.save(PROJECT, "Sky");
    expect(second.id).toBe(first.id);
    expect(await service.list(PROJECT)).toHaveLength(1);
    expect((await service.load(PROJECT, second.id)).areaPx).toBe(400);
  });

  it("trims a name and refuses an empty one", async () => {
    expect((await service.save(PROJECT, "  Sky  ")).name).toBe("Sky");
    await expect(service.save(PROJECT, "   ")).rejects.toThrowError(/needs a name/);
  });

  it("refuses to save when nothing is selected", async () => {
    service.clear(PROJECT);
    await expect(service.save(PROJECT, "Sky")).rejects.toThrowError(/nothing selected to save/);
  });

  /**
   * A selection is coordinates in a specific document. Loading one into a differently sized
   * image would silently land it in the wrong place.
   */
  it("refuses a selection saved for a different image size, and says both sizes", async () => {
    const saved = await service.save(PROJECT, "Sky");
    const smaller = new SelectionService(reader(10), {
      ...memoryStore(),
      get: async () => ({ ...saved, projectId: PROJECT, coverage: new Uint8Array(400) }),
    });
    await expect(smaller.load(PROJECT, saved.id)).rejects.toThrowError(/20×20 image and this one is 10×10/);
  });

  it("says so when a saved selection has gone", async () => {
    await expect(service.load(PROJECT, "missing")).rejects.toThrowError(/no longer in the project/);
  });

  it("never loads another project's saved selection", async () => {
    const saved = await service.save(PROJECT, "Sky");
    await expect(service.load("project-2", saved.id)).rejects.toThrowError(/no longer in the project/);
  });

  it("lists, deletes one, and clears them all with the project", async () => {
    const saved = await service.save(PROJECT, "Sky");
    await service.selectAll(PROJECT);
    await service.save(PROJECT, "Everything");
    expect(await service.list(PROJECT)).toHaveLength(2);

    await service.remove(PROJECT, saved.id);
    expect(await service.list(PROJECT)).toHaveLength(1);

    await service.removeForProject(PROJECT);
    expect(await service.list(PROJECT)).toHaveLength(0);
    expect(service.state(PROJECT).mask).toBeNull();
  });
});

describe("the selection outline", () => {
  it("traces the edge and leaves the middle alone, so marching ants need no re-tracing", async () => {
    const service = new SelectionService(reader(), memoryStore());
    await service.select({
      projectId: PROJECT,
      source: { kind: "marquee", shape: "rectangle", x: 5, y: 5, width: 10, height: 10, featherPx: 0 },
    });
    const outline = service.outline(PROJECT)!;
    expect(outline.edge[10 * 20 + 10]).toBe(0);
    expect(outline.edge[5 * 20 + 5]).toBe(255);
    // The band is the boundary of a 10×10 square: 36 pixels, not its 100.
    expect(outline.edge.reduce((total, value) => total + (value ? 1 : 0), 0)).toBe(36);
  });

  it("has no outline when nothing is selected", () => {
    expect(new SelectionService(reader(), memoryStore()).outline(PROJECT)).toBeNull();
  });

  /** A feathered edge has no single boundary pixel, so the ants run at half coverage. */
  it("puts the edge at half coverage on a soft selection", async () => {
    const service = new SelectionService(reader(40), memoryStore());
    await service.select({
      projectId: PROJECT,
      source: { kind: "marquee", shape: "rectangle", x: 10, y: 10, width: 20, height: 20, featherPx: 4 },
    });
    const outline = service.outline(PROJECT)!;
    const mask = service.maskFor(PROJECT)!;
    const traced = [...outline.edge.keys()].filter((index) => outline.edge[index]);
    expect(traced.every((index) => mask.coverage[index] >= 128)).toBe(true);
    expect(selectedArea(mask)).toBeGreaterThan(0);
  });
});

/**
 * `PH-020`. The refinement workspace runs every global adjustment in one pass, so the original
 * selection is refined once rather than degraded through four rounds of rounding.
 */
describe("the refinement workspace", () => {
  let service: SelectionService;
  beforeEach(async () => {
    service = new SelectionService(reader(40), memoryStore());
    await service.select({
      projectId: PROJECT,
      source: { kind: "marquee", shape: "rectangle", x: 10, y: 10, width: 20, height: 20, featherPx: 0 },
    });
  });

  it("leaves the selection alone when every slider is at rest", () => {
    const before = service.maskFor(PROJECT)!.coverage.slice();
    service.refineEdge({ projectId: PROJECT });
    expect(service.maskFor(PROJECT)!.coverage).toEqual(before);
  });

  it("softens, then hardens the same edge back up", () => {
    service.refineEdge({ projectId: PROJECT, featherPx: 4 });
    const soft = [...service.maskFor(PROJECT)!.coverage].filter((v) => v > 0 && v < 255).length;
    service.refineEdge({ projectId: PROJECT, contrast: 0.9 });
    const hard = [...service.maskFor(PROJECT)!.coverage].filter((v) => v > 0 && v < 255).length;
    expect(hard).toBeLessThan(soft);
  });

  it("slides a soft boundary outwards", () => {
    service.refineEdge({ projectId: PROJECT, featherPx: 4 });
    const areaBefore = selectedArea(service.maskFor(PROJECT)!);
    service.refineEdge({ projectId: PROJECT, shiftEdge: 0.25 });
    expect(selectedArea(service.maskFor(PROJECT)!)).toBeGreaterThan(areaBefore);
    service.refineEdge({ projectId: PROJECT, shiftEdge: -0.5 });
    expect(selectedArea(service.maskFor(PROJECT)!)).toBeLessThan(areaBefore);
  });

  /**
   * The difference between sliding an edge and growing a selection: a hard edge has no
   * transition band to slide, so the slider correctly does nothing to one.
   */
  it("leaves a hard edge exactly where it is, which growing does not", () => {
    const before = service.maskFor(PROJECT)!.coverage.slice();
    service.refineEdge({ projectId: PROJECT, shiftEdge: 0.5 });
    expect(service.maskFor(PROJECT)!.coverage).toEqual(before);

    service.refine({ projectId: PROJECT, operation: { kind: "expand", amountPx: 3 } });
    expect(selectedArea(service.maskFor(PROJECT)!)).toBeGreaterThan(400);
  });

  it("turns a selection into a greyscale mask image", () => {
    const image = service.toMaskImage(PROJECT);
    expect(image.widthPx).toBe(40);
    const centre = (20 * 40 + 20) * 4;
    expect([...image.greyscale.slice(centre, centre + 4)]).toEqual([255, 255, 255, 255]);
    expect([...image.greyscale.slice(0, 4)]).toEqual([0, 0, 0, 255]);
  });

  it("says so rather than making an empty mask", () => {
    service.clear(PROJECT);
    expect(() => service.toMaskImage(PROJECT)).toThrowError(/nothing selected to turn into a mask/);
    expect(() => service.refineEdge({ projectId: PROJECT })).toThrowError(/nothing selected to refine/);
  });
});

/**
 * `PH-009`. A layer mask is a named greyscale image the same size as the document, which is
 * exactly what a saved selection is — so a mask points at one rather than storing a second
 * copy that could drift from it.
 */
describe("a saved selection used as a layer mask", () => {
  let service: SelectionService;
  beforeEach(async () => {
    service = new SelectionService(reader(), memoryStore());
    await service.select({
      projectId: PROJECT,
      source: { kind: "marquee", shape: "rectangle", x: 2, y: 2, width: 6, height: 6, featherPx: 0 },
    });
  });

  it("reads a saved selection back as a greyscale image", async () => {
    const saved = await service.save(PROJECT, "Cutout");
    const image = (await service.readMaskImage(PROJECT, saved.id))!;
    expect(image).toMatchObject({ widthPx: 20, heightPx: 20 });
    const inside = (4 * 20 + 4) * 4;
    expect([...image.greyscale.slice(inside, inside + 4)]).toEqual([255, 255, 255, 255]);
    expect([...image.greyscale.slice(0, 4)]).toEqual([0, 0, 0, 255]);
  });

  /** A mask cuts what was saved. Changing what is selected now must not change the mask. */
  it("keeps cutting what was saved even after the live selection changes", async () => {
    const saved = await service.save(PROJECT, "Cutout");
    await service.selectAll(PROJECT);
    const image = (await service.readMaskImage(PROJECT, saved.id))!;
    expect([...image.greyscale.slice(0, 4)]).toEqual([0, 0, 0, 255]);
  });

  it("returns nothing when the saved selection has gone, rather than an empty mask", async () => {
    expect(await service.readMaskImage(PROJECT, "missing")).toBeNull();
  });
});
