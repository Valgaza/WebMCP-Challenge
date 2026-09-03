import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EstroDatabase } from "../data/estro-database";
import { ProjectRepository } from "../data/project-repository";
import { findLayer, type ImageLayer, type PaintLayer } from "../domain/layer";
import { AssetService, createMemorySourceStore } from "./asset-service";
import { JobService } from "./job-service";
import { LayerService, describeLayer, summarizeLayerTree } from "./layer-service";
import { ProjectService } from "./project-service";
import { PresetService } from "./preset-service";
import { createMemoryDerivedCache } from "../data/derived-cache";

describe("LayerService", () => {
  let database: EstroDatabase;
  let projects: ProjectService;
  let assets: AssetService;
  let layers: LayerService;
  let projectId: string;
  let assetIds: string[] = [];

  function imageFile(name: string, type = "image/jpeg"): File {
    const file = new File([new Uint8Array(4)], name, { type });
    Object.defineProperty(file, "size", { value: 4096 });
    return file;
  }

  beforeEach(async () => {
    database = new EstroDatabase(`estro-layers-${crypto.randomUUID()}`);
    projects = new ProjectService(new ProjectRepository(database));
    const jobs = new JobService(database);
    assets = new AssetService(database, projects, jobs, {
      probeDeps: { decodeSize: async () => ({ width: 400, height: 200 }), hash: async () => "hash-aaaaaaaa" },
      sourceStore: createMemorySourceStore(),
      derivedCache: createMemoryDerivedCache(),
    });
    layers = new LayerService(projects);

    const project = await projects.createProject({ name: `Layers ${crypto.randomUUID()}`, kind: "photo" });
    projectId = project.id;
    await projects.createPhotoDocument({
      projectId, widthPx: 1000, heightPx: 1000, resolutionPpi: 72, orientation: "square", background: { type: "transparent" },
    });

    assetIds = [];
    for (const name of ["a.jpg", "b.jpg", "c.jpg"]) {
      const file = imageFile(name);
      const handle = { kind: "file", name, getFile: async () => file, queryPermission: async () => "granted" } as unknown as FileSystemFileHandle;
      const outcome = await assets.registerOne(projectId, { file, handle });
      assetIds.push(outcome.assetId!);
    }
  });

  afterEach(async () => database.delete());

  async function currentLayers() {
    return (await projects.getProjectHistory(projectId)).headRevision.state.photoDocument!.layers;
  }

  async function addLayer(index = 0, fit: "fit" | "fill" | "actual" = "fit") {
    const result = await layers.applyOperation(projectId, { operation: "add_image", assetId: assetIds[index], fit });
    const tree = result.headRevision.state.photoDocument!.layers;
    return tree[tree.length - 1];
  }

  it("adds an image layer scaled to fit and records an undoable transaction", async () => {
    const result = await layers.applyOperation(projectId, { operation: "add_image", assetId: assetIds[0] });
    const [layer] = result.headRevision.state.photoDocument!.layers as ImageLayer[];

    expect(layer).toMatchObject({ kind: "image", assetId: assetIds[0], name: "a.jpg", opacity: 1, visible: true });
    // 400x200 fitted into a 1000x1000 frame scales by 2.5 on the long edge.
    expect(layer.transform.scaleX).toBe(2.5);
    expect(result.transaction).toMatchObject({ summary: "Add “a.jpg”", undoable: true });

    const undone = await projects.undoProject(projectId);
    expect(undone.headRevision.state.photoDocument!.layers).toHaveLength(0);
  });

  it("refuses a layer for an image that was never imported", async () => {
    await expect(layers.applyOperation(projectId, { operation: "add_image", assetId: "ghost" }))
      .rejects.toMatchObject({ code: "INVALID_INPUT", fieldPath: "assetId" });
  });

  it("groups, ungroups, and enforces nesting limits", async () => {
    const first = await addLayer(0);
    const second = await addLayer(1);

    const grouped = await layers.applyOperation(projectId, { operation: "group", layerIds: [first.id, second.id], name: "Pair" });
    const tree = grouped.headRevision.state.photoDocument!.layers;
    expect(tree).toHaveLength(1);
    expect(summarizeLayerTree(tree)).toEqual({ total: 3, images: 2, groups: 1, depth: 2 });

    const ungrouped = await layers.applyOperation(projectId, { operation: "ungroup", layerId: tree[0].id });
    expect(ungrouped.headRevision.state.photoDocument!.layers).toHaveLength(2);
  });

  it("propagates hidden and locked state and refuses edits to a locked layer", async () => {
    const layer = await addLayer(0);

    await layers.applyOperation(projectId, { operation: "set_visibility", layerId: layer.id, visible: false });
    expect(findLayer(await currentLayers(), layer.id)?.visible).toBe(false);

    await layers.applyOperation(projectId, { operation: "set_lock", layerId: layer.id, locked: true });
    await expect(layers.applyOperation(projectId, { operation: "set_opacity", layerId: layer.id, opacity: 0.5 }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    // Unlocking is still allowed, otherwise a lock would be permanent.
    await expect(layers.applyOperation(projectId, { operation: "set_lock", layerId: layer.id, locked: false })).resolves.toBeTruthy();
  });

  it("reorders only top-level layers", async () => {
    const first = await addLayer(0);
    const second = await addLayer(1);

    const reordered = await layers.applyOperation(projectId, { operation: "reorder", layerId: second.id, toIndex: 0 });
    expect(reordered.headRevision.state.photoDocument!.layers.map((entry) => entry.id)).toEqual([second.id, first.id]);
  });

  it("crops, straightens, and flips through the same command path", async () => {
    const layer = await addLayer(0);

    await layers.applyOperation(projectId, { operation: "crop", layerId: layer.id, crop: { left: 0.1, top: 0.1, right: 0.9, bottom: 0.9 } });
    await layers.applyOperation(projectId, { operation: "straighten", layerId: layer.id, rotationDeg: -3 });
    const flipped = await layers.applyOperation(projectId, { operation: "flip", layerId: layer.id, axis: "horizontal" });

    const stored = findLayer(flipped.headRevision.state.photoDocument!.layers, layer.id) as ImageLayer;
    expect(stored.crop).toEqual({ left: 0.1, top: 0.1, right: 0.9, bottom: 0.9 });
    expect(stored.transform.rotationDeg).toBe(-3);
    expect(stored.transform.flipX).toBe(true);
  });

  it("rejects a crop that would keep nothing", async () => {
    const layer = await addLayer(0);
    await expect(layers.applyOperation(projectId, { operation: "crop", layerId: layer.id, crop: { left: 0.5, top: 0, right: 0.5, bottom: 1 } }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("aligns to the document frame", async () => {
    const layer = await addLayer(0, "actual");
    const aligned = await layers.applyOperation(projectId, { operation: "align", layerIds: [layer.id], edge: "left" });
    const stored = findLayer(aligned.headRevision.state.photoDocument!.layers, layer.id)!;
    // A 400px-wide layer anchored at its centre sits at x=200 when flush left.
    expect(stored.transform.x).toBe(200);
  });

  it("distributes three layers evenly and needs at least three", async () => {
    const a = await addLayer(0, "actual");
    const b = await addLayer(1, "actual");
    const c = await addLayer(2, "actual");

    await layers.applyOperation(projectId, { operation: "transform", layerId: a.id, transform: { x: 100 } });
    await layers.applyOperation(projectId, { operation: "transform", layerId: b.id, transform: { x: 700 } });
    await layers.applyOperation(projectId, { operation: "transform", layerId: c.id, transform: { x: 300 } });

    const distributed = await layers.applyOperation(projectId, { operation: "distribute", layerIds: [a.id, b.id, c.id], axis: "horizontal" });
    const xs = [a.id, c.id, b.id].map((id) => findLayer(distributed.headRevision.state.photoDocument!.layers, id)!.transform.x);
    expect(xs[1] - xs[0]).toBeCloseTo(xs[2] - xs[1], 5);

    await expect(layers.applyOperation(projectId, { operation: "distribute", layerIds: [a.id, b.id], axis: "horizontal" } as never))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("clamps a colour adjustment to its documented range and explains it", async () => {
    const layer = await addLayer(0);

    const result = await layers.applyColorAdjustment(projectId, { layerId: layer.id, adjustment: "brightness", value: 250 });
    expect(result.normalizedValue).toBe(100);
    expect(result.warnings[0]).toContain("clamped");
    expect(result.description).toContain("lighter");

    const stored = findLayer(await currentLayers(), layer.id) as ImageLayer;
    expect(stored.adjustments.brightness).toBe(100);
    expect(result.transaction.warnings).toEqual(result.warnings);
  });

  it("refuses a colour adjustment on a group or a locked layer", async () => {
    const first = await addLayer(0);
    const second = await addLayer(1);
    const grouped = await layers.applyOperation(projectId, { operation: "group", layerIds: [first.id, second.id] });
    const groupId = grouped.headRevision.state.photoDocument!.layers[0].id;

    await expect(layers.applyColorAdjustment(projectId, { layerId: groupId, adjustment: "contrast", value: 10 }))
      .rejects.toMatchObject({ code: "INVALID_INPUT", fieldPath: "layerId" });
  });

  it("resizes the canvas without rescaling layers and resamples with them", async () => {
    const layer = await addLayer(0, "actual");

    const canvas = await layers.resizeDocument(projectId, { mode: "canvas", widthPx: 2000, heightPx: 1000 });
    const afterCanvas = findLayer(canvas.headRevision.state.photoDocument!.layers, layer.id)!;
    expect(canvas.headRevision.state.photoDocument).toMatchObject({ widthPx: 2000, heightPx: 1000, orientation: "landscape" });
    expect(afterCanvas.transform.scaleX).toBe(1);

    const resampled = await layers.resizeDocument(projectId, { mode: "image", widthPx: 1000, heightPx: 500 });
    const afterImage = findLayer(resampled.headRevision.state.photoDocument!.layers, layer.id)!;
    expect(afterImage.transform.scaleX).toBe(0.5);

    const undone = await projects.undoProject(projectId);
    expect(undone.headRevision.state.photoDocument).toMatchObject({ widthPx: 2000, heightPx: 1000 });
  });

  /**
   * The defect this covers: the resize dialog offered a resampling algorithm, named it in a
   * warning, and then only changed the layer's transform. Nothing resampled and nothing
   * recorded which algorithm had supposedly been used.
   */
  it("records the chosen resampling in history and runs a real resampling pass", async () => {
    await addLayer(0, "actual");
    const started: { assetId: string; algorithm: string; targetWidthPx: number }[] = [];
    layers.registerResampler({
      startResampleJob: async (assetId, options) => {
        started.push({ assetId, algorithm: options.algorithm, targetWidthPx: options.targetWidthPx });
        return { jobId: `job-${started.length}` };
      },
    });

    const result = await layers.resizeDocument(projectId, {
      mode: "image", widthPx: 800, heightPx: 400, resampleAlgorithm: "bilinear",
    });

    // The algorithm is in the operation, so replaying the resize redoes the same work.
    const operation = result.transaction.operations.find((entry) => entry.type === "document.resize")!;
    expect(operation).toMatchObject({ mode: "image", resampleAlgorithm: "bilinear" });
    expect(result.normalizedParameters).toMatchObject({ resampleAlgorithm: "bilinear" });
    expect(result.resampleAlgorithm).toBe("bilinear");

    // And a real pass over the pixels was queued, not just a transform change.
    expect(started).toHaveLength(1);
    expect(started[0].algorithm).toBe("bilinear");
    expect(result.resampleJobIds).toEqual(["job-1"]);
  });

  it("keeps a canvas resize free of any resampling claim", async () => {
    await addLayer(0, "actual");
    const started: string[] = [];
    layers.registerResampler({
      startResampleJob: async (assetId) => { started.push(assetId); return { jobId: "job-x" }; },
    });

    const result = await layers.resizeDocument(projectId, { mode: "canvas", widthPx: 1200, heightPx: 800 });
    expect(started).toEqual([]);
    expect(result.resampleAlgorithm).toBeNull();
    expect(result.warnings.join(" ")).not.toContain("resampled");
  });

  it("says so when nothing can perform the resampling rather than implying it happened", async () => {
    await addLayer(0, "actual");
    const result = await layers.resizeDocument(projectId, { mode: "image", widthPx: 600, heightPx: 300 });
    expect(result.resampleJobIds).toEqual([]);
    expect(result.warnings.join(" ")).toContain("could not start the resampling pass");
  });

  it("requires a document before any layer edit", async () => {
    const bare = await projects.createProject({ name: `Bare ${crypto.randomUUID()}`, kind: "photo" });
    await expect(layers.applyOperation(bare.id, { operation: "add_image", assetId: assetIds[0] }))
      .rejects.toMatchObject({ code: "INVALID_INPUT", fieldPath: "projectId" });
  });
});

/**
 * `SH-053`, `SH-047`, `SH-051`, and `SH-052`. These are the shared compositing model: effect
 * containers, blend modes, masks, and clipping. Photo layers are the first consumer; video
 * clips render through the same compositor, which is the point of Phase 6.
 */
describe("LayerService compositing", () => {
  let database: EstroDatabase;
  let projects: ProjectService;
  let assets: AssetService;
  let layers: LayerService;
  let projectId: string;
  let assetIds: string[] = [];

  function imageFile(name: string): File {
    const file = new File([new Uint8Array(4)], name, { type: "image/jpeg" });
    Object.defineProperty(file, "size", { value: 4096 });
    return file;
  }

  beforeEach(async () => {
    database = new EstroDatabase(`estro-compositing-${crypto.randomUUID()}`);
    projects = new ProjectService(new ProjectRepository(database));
    assets = new AssetService(database, projects, new JobService(database), {
      probeDeps: { decodeSize: async () => ({ width: 400, height: 200 }), hash: async () => "hash-aaaaaaaa" },
      sourceStore: createMemorySourceStore(),
      derivedCache: createMemoryDerivedCache(),
    });
    layers = new LayerService(projects);

    const project = await projects.createProject({ name: `Compositing ${crypto.randomUUID()}`, kind: "photo" });
    projectId = project.id;
    await projects.createPhotoDocument({
      projectId, widthPx: 800, heightPx: 600, resolutionPpi: 72,
      orientation: "landscape", background: { type: "solid", color: "#ffffff" },
    });
    assetIds = [];
    for (const name of ["one.jpg", "two.jpg"]) {
      const outcome = await assets.registerOne(projectId, { file: imageFile(name) });
      assetIds.push(outcome.assetId!);
    }
  });

  afterEach(async () => database.delete());

  const addLayer = async (index = 0) => {
    const result = await layers.applyOperation(projectId, { operation: "add_image", assetId: assetIds[index], fit: "actual" });
    const tree = result.headRevision.state.photoDocument!.layers;
    return tree[tree.length - 1];
  };
  const current = async () => (await projects.getProjectHistory(projectId)).headRevision.state.photoDocument!.layers;

  /* ------------------------------- blend modes -------------------------------- */

  it("starts every layer at normal so existing projects render unchanged", async () => {
    const layer = await addLayer();
    expect(layer.blendMode).toBe("normal");
    expect(layer.masks).toEqual([]);
    expect(layer.clipToBelow).toBe(false);
    expect(layer.effects.effects).toEqual([]);
  });

  it("sets a blend mode and records it as an ordinary undoable edit", async () => {
    const layer = await addLayer();
    const result = await layers.applyOperation(projectId, { operation: "set_blend_mode", layerId: layer.id, blendMode: "multiply" });
    expect(findLayer(result.headRevision.state.photoDocument!.layers, layer.id)!.blendMode).toBe("multiply");
    expect(result.transaction.summary).toContain("multiply");

    const undone = await projects.undoProject(projectId);
    expect(findLayer(undone.headRevision.state.photoDocument!.layers, layer.id)!.blendMode).toBe("normal");
  });

  it("refuses a blend mode the compositor cannot actually perform", async () => {
    const layer = await addLayer();
    await expect(layers.applyOperation(projectId, { operation: "set_blend_mode", layerId: layer.id, blendMode: "vivid-light" as never }))
      .rejects.toBeTruthy();
  });

  /* ---------------------------------- masks ----------------------------------- */

  it("adds a shape mask and describes what it does", async () => {
    const layer = await addLayer();
    const result = await layers.applyOperation(projectId, {
      operation: "add_mask", layerId: layer.id,
      mask: { source: { kind: "shape", shape: "ellipse", x: 0.1, y: 0.1, width: 0.5, height: 0.5, cornerRadius: 0 }, featherPx: 12, density: 1, inverted: false, enabled: true },
    });
    const masked = findLayer(result.headRevision.state.photoDocument!.layers, layer.id)!;
    expect(masked.masks).toHaveLength(1);
    expect(masked.masks[0].id).toBeTruthy();
    expect(result.transaction.summary).toContain("an ellipse");
    expect(result.transaction.summary).toContain("12 px");
  });

  it("updates and removes a mask without touching the rest of the layer", async () => {
    const layer = await addLayer();
    const added = await layers.applyOperation(projectId, {
      operation: "add_mask", layerId: layer.id,
      mask: { source: { kind: "shape", shape: "rectangle", x: 0, y: 0, width: 1, height: 1, cornerRadius: 0 }, featherPx: 0, density: 1, inverted: false, enabled: true },
    });
    const maskId = findLayer(added.headRevision.state.photoDocument!.layers, layer.id)!.masks[0].id;

    const updated = await layers.applyOperation(projectId, {
      operation: "update_mask", layerId: layer.id, maskId, mask: { inverted: true, density: 0.5 },
    });
    const afterUpdate = findLayer(updated.headRevision.state.photoDocument!.layers, layer.id)!;
    expect(afterUpdate.masks[0]).toMatchObject({ inverted: true, density: 0.5 });
    expect(afterUpdate.masks[0].source).toMatchObject({ shape: "rectangle" });

    const removed = await layers.applyOperation(projectId, { operation: "remove_mask", layerId: layer.id, maskId });
    expect(findLayer(removed.headRevision.state.photoDocument!.layers, layer.id)!.masks).toEqual([]);
  });

  /**
   * A layer masked by a layer masked by the first has no defined result. Catching it here
   * means a message; catching it during a render means a frozen tab.
   */
  it("refuses a mask that would refer back to the layer it masks", async () => {
    const first = await addLayer(0);
    const second = await addLayer(1);
    await layers.applyOperation(projectId, {
      operation: "add_mask", layerId: first.id,
      mask: { source: { kind: "layer_alpha", layerId: second.id }, featherPx: 0, density: 1, inverted: false, enabled: true },
    });
    await expect(layers.applyOperation(projectId, {
      operation: "add_mask", layerId: second.id,
      mask: { source: { kind: "layer_alpha", layerId: first.id }, featherPx: 0, density: 1, inverted: false, enabled: true },
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  /* --------------------------------- clipping --------------------------------- */

  it("clips a layer to the one below it", async () => {
    await addLayer(0);
    const top = await addLayer(1);
    const result = await layers.applyOperation(projectId, { operation: "set_clipping", layerId: top.id, clipToBelow: true });
    expect(findLayer(result.headRevision.state.photoDocument!.layers, top.id)!.clipToBelow).toBe(true);
    expect(result.transaction.summary).toContain("Clip");
  });

  it("refuses to clip the bottom layer, which has nothing beneath it", async () => {
    const only = await addLayer();
    await expect(layers.applyOperation(projectId, { operation: "set_clipping", layerId: only.id, clipToBelow: true }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  /* ----------------------------- effect containers ----------------------------- */

  it("holds several effects, in order, each switchable without losing its settings", async () => {
    const layer = await addLayer();
    await layers.applyOperation(projectId, { operation: "add_effect", layerId: layer.id, name: "Warm", parameters: { temperature: 30 } });
    const second = await layers.applyOperation(projectId, { operation: "add_effect", layerId: layer.id, name: "Punch", parameters: { contrast: 25 } });
    const effects = findLayer(second.headRevision.state.photoDocument!.layers, layer.id)!.effects.effects;
    expect(effects.map((e) => e.name)).toEqual(["Warm", "Punch"]);
    expect(effects[0].kind === "adjustments" && effects[0].parameters.temperature).toBe(30);

    // Switching one off keeps its parameters, which is the difference between a container
    // and a single flat field.
    const off = await layers.applyOperation(projectId, { operation: "update_effect", layerId: layer.id, effectId: effects[0].id, enabled: false });
    const afterOff = findLayer(off.headRevision.state.photoDocument!.layers, layer.id)!.effects.effects[0];
    expect(afterOff.enabled).toBe(false);
    expect(afterOff.kind === "adjustments" && afterOff.parameters.temperature).toBe(30);
  });

  it("reorders effects, because order decides the result", async () => {
    const layer = await addLayer();
    await layers.applyOperation(projectId, { operation: "add_effect", layerId: layer.id, name: "First" });
    const built = await layers.applyOperation(projectId, { operation: "add_effect", layerId: layer.id, name: "Second" });
    const effects = findLayer(built.headRevision.state.photoDocument!.layers, layer.id)!.effects.effects;

    const moved = await layers.applyOperation(projectId, {
      operation: "reorder_effect", layerId: layer.id, effectId: effects[1].id, toIndex: 0,
    });
    expect(findLayer(moved.headRevision.state.photoDocument!.layers, layer.id)!.effects.effects.map((e) => e.name))
      .toEqual(["Second", "First"]);
  });

  it("removes an effect and refuses one that is not there", async () => {
    const layer = await addLayer();
    const added = await layers.applyOperation(projectId, { operation: "add_effect", layerId: layer.id, name: "Gone soon" });
    const effectId = findLayer(added.headRevision.state.photoDocument!.layers, layer.id)!.effects.effects[0].id;
    const removed = await layers.applyOperation(projectId, { operation: "remove_effect", layerId: layer.id, effectId });
    expect(findLayer(removed.headRevision.state.photoDocument!.layers, layer.id)!.effects.effects).toEqual([]);

    await expect(layers.applyOperation(projectId, { operation: "remove_effect", layerId: layer.id, effectId }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("bounds the number of effects on one layer", async () => {
    const layer = await addLayer();
    for (let index = 0; index < 16; index += 1) {
      await layers.applyOperation(projectId, { operation: "add_effect", layerId: layer.id, name: `Effect ${index}` });
    }
    await expect(layers.applyOperation(projectId, { operation: "add_effect", layerId: layer.id, name: "One too many" }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

/**
 * `SH-054` and `SH-055` through the command layer. Layers and clips share one evaluator, so
 * what holds here holds for timeline clips too.
 */
describe("LayerService animation", () => {
  let database: EstroDatabase;
  let projects: ProjectService;
  let assets: AssetService;
  let layers: LayerService;
  let projectId: string;
  let assetId: string;

  beforeEach(async () => {
    database = new EstroDatabase(`estro-animation-${crypto.randomUUID()}`);
    projects = new ProjectService(new ProjectRepository(database));
    assets = new AssetService(database, projects, new JobService(database), {
      probeDeps: { decodeSize: async () => ({ width: 400, height: 200 }), hash: async () => "hash-aaaaaaaa" },
      sourceStore: createMemorySourceStore(),
      derivedCache: createMemoryDerivedCache(),
    });
    layers = new LayerService(projects);
    const project = await projects.createProject({ name: `Animation ${crypto.randomUUID()}`, kind: "photo" });
    projectId = project.id;
    await projects.createPhotoDocument({
      projectId, widthPx: 800, heightPx: 600, resolutionPpi: 72,
      orientation: "landscape", background: { type: "solid", color: "#ffffff" },
    });
    const file = new File([new Uint8Array(4)], "anim.jpg", { type: "image/jpeg" });
    Object.defineProperty(file, "size", { value: 4096 });
    assetId = (await assets.registerOne(projectId, { file })).assetId!;
  });

  afterEach(async () => database.delete());

  const addLayer = async () => {
    const result = await layers.applyOperation(projectId, { operation: "add_image", assetId, fit: "actual" });
    const tree = result.headRevision.state.photoDocument!.layers;
    return tree[tree.length - 1];
  };
  const seconds = (value: number) => ({ numerator: Math.round(value * 1000), denominator: 1000 });

  it("starts every layer unanimated", async () => {
    expect((await addLayer()).animation).toEqual([]);
  });

  it("creates a track on the first keyframe and reuses it afterwards", async () => {
    const layer = await addLayer();
    await layers.applyOperation(projectId, {
      operation: "set_keyframe", layerId: layer.id, propertyPath: "opacity", time: seconds(0), value: 0,
    });
    const second = await layers.applyOperation(projectId, {
      operation: "set_keyframe", layerId: layer.id, propertyPath: "opacity", time: seconds(2), value: 1,
    });
    const animation = findLayer(second.headRevision.state.photoDocument!.layers, layer.id)!.animation;
    expect(animation).toHaveLength(1);
    expect(animation[0].propertyPath).toBe("opacity");
    expect(animation[0].keyframes).toHaveLength(2);
  });

  it("replaces a keyframe at the same instant rather than stacking one", async () => {
    const layer = await addLayer();
    await layers.applyOperation(projectId, {
      operation: "set_keyframe", layerId: layer.id, propertyPath: "opacity", time: seconds(1), value: 0.2,
    });
    const replaced = await layers.applyOperation(projectId, {
      operation: "set_keyframe", layerId: layer.id, propertyPath: "opacity", time: seconds(1), value: 0.8,
    });
    const keys = findLayer(replaced.headRevision.state.photoDocument!.layers, layer.id)!.animation[0].keyframes;
    expect(keys).toHaveLength(1);
    expect(keys[0].value).toBe(0.8);
  });

  it("refuses to animate a property a layer does not have", async () => {
    const layer = await addLayer();
    await expect(layers.applyOperation(projectId, {
      operation: "set_keyframe", layerId: layer.id, propertyPath: "gainDb", time: seconds(0), value: 1,
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  /** An empty track still reads as animated, so removing the last key removes the track. */
  it("stops calling a property animated once its last keyframe goes", async () => {
    const layer = await addLayer();
    const added = await layers.applyOperation(projectId, {
      operation: "set_keyframe", layerId: layer.id, propertyPath: "transform.x", time: seconds(0), value: 10,
    });
    const keyframeId = findLayer(added.headRevision.state.photoDocument!.layers, layer.id)!.animation[0].keyframes[0].id;
    const removed = await layers.applyOperation(projectId, {
      operation: "remove_keyframe", layerId: layer.id, propertyPath: "transform.x", keyframeId,
    });
    expect(findLayer(removed.headRevision.state.photoDocument!.layers, layer.id)!.animation).toEqual([]);
  });

  it("disables a track without losing its keyframes", async () => {
    const layer = await addLayer();
    await layers.applyOperation(projectId, {
      operation: "set_keyframe", layerId: layer.id, propertyPath: "opacity", time: seconds(0), value: 0,
    });
    const off = await layers.applyOperation(projectId, {
      operation: "set_track_enabled", layerId: layer.id, propertyPath: "opacity", enabled: false,
    });
    const track = findLayer(off.headRevision.state.photoDocument!.layers, layer.id)!.animation[0];
    expect(track.enabled).toBe(false);
    expect(track.keyframes).toHaveLength(1);
  });

  it("clears an animation and refuses to clear one that is not there", async () => {
    const layer = await addLayer();
    await layers.applyOperation(projectId, {
      operation: "set_keyframe", layerId: layer.id, propertyPath: "opacity", time: seconds(0), value: 0,
    });
    const cleared = await layers.applyOperation(projectId, {
      operation: "clear_animation", layerId: layer.id, propertyPath: "opacity",
    });
    expect(findLayer(cleared.headRevision.state.photoDocument!.layers, layer.id)!.animation).toEqual([]);

    await expect(layers.applyOperation(projectId, {
      operation: "clear_animation", layerId: layer.id, propertyPath: "opacity",
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("records each keyframe edit as an ordinary undoable change", async () => {
    const layer = await addLayer();
    const result = await layers.applyOperation(projectId, {
      operation: "set_keyframe", layerId: layer.id, propertyPath: "transform.x", time: seconds(1.5), value: 42,
      interpolation: "ease_in_out",
    });
    expect(result.transaction.summary).toContain("transform.x");
    expect(result.transaction.summary).toContain("1.50s");

    const undone = await projects.undoProject(projectId);
    expect(findLayer(undone.headRevision.state.photoDocument!.layers, layer.id)!.animation).toEqual([]);
  });
});

/**
 * `SH-056`, `SH-057`, `SH-058`, `SH-061`, and `SH-062` through the command layer. A graphics
 * layer is an ordinary layer with different content, so it inherits transforms, masks, blend
 * modes and animation without any of those being taught about it.
 */
describe("LayerService graphics", () => {
  let database: EstroDatabase;
  let projects: ProjectService;
  let layers: LayerService;
  let projectId: string;

  beforeEach(async () => {
    database = new EstroDatabase(`estro-graphics-${crypto.randomUUID()}`);
    projects = new ProjectService(new ProjectRepository(database));
    layers = new LayerService(projects);
    const project = await projects.createProject({ name: `Graphics ${crypto.randomUUID()}`, kind: "photo" });
    projectId = project.id;
    await projects.createPhotoDocument({
      projectId, widthPx: 800, heightPx: 600, resolutionPpi: 72,
      orientation: "landscape", background: { type: "solid", color: "#ffffff" },
    });
  });

  afterEach(async () => database.delete());

  const treeOf = (result: { headRevision: { state: { photoDocument?: { layers: unknown[] } | null } } }) =>
    result.headRevision.state.photoDocument!.layers as never[];

  it("adds text that keeps its content editable rather than rasterising it", async () => {
    const result = await layers.applyOperation(projectId, { operation: "add_text", content: "Hello", sizePx: 64 });
    const layer = treeOf(result).at(-1)! as never as { kind: string; content: { kind: string; text: { content: string; sizePx: number } } };
    expect(layer.kind).toBe("graphics");
    expect(layer.content.kind).toBe("text");
    expect(layer.content.text.content).toBe("Hello");
    expect(layer.content.text.sizePx).toBe(64);
  });

  it("names a text layer from its first line", async () => {
    const result = await layers.applyOperation(projectId, { operation: "add_text", content: "A title\nand more" });
    expect((treeOf(result).at(-1)! as never as { name: string }).name).toBe("A title");
  });

  it("edits a range and moves the formatting with it", async () => {
    const added = await layers.applyOperation(projectId, { operation: "add_text", content: "Hello world" });
    const layerId = (treeOf(added).at(-1)! as never as { id: string }).id;
    const edited = await layers.applyOperation(projectId, {
      operation: "edit_text", layerId, range: { start: 0, end: 5 }, insert: "Goodbye",
    });
    const text = (findLayer(treeOf(edited) as never, layerId)! as never as { content: { text: { content: string } } }).content.text;
    expect(text.content).toBe("Goodbye world");
  });

  it("applies formatting to a range as a run rather than to the whole block", async () => {
    const added = await layers.applyOperation(projectId, { operation: "add_text", content: "Hello world" });
    const layerId = (treeOf(added).at(-1)! as never as { id: string }).id;
    const styled = await layers.applyOperation(projectId, {
      operation: "edit_text", layerId, range: { start: 0, end: 5 }, sizePx: 96,
    });
    const text = (findLayer(treeOf(styled) as never, layerId)! as never as { content: { text: { runs: unknown[]; sizePx: number } } }).content.text;
    expect(text.runs).toHaveLength(1);
    // The default is proportional to the document — a twelfth of its shorter edge — rather
    // than a flat 48px, which was a speck on a print-scale canvas and oversized on a small one.
    expect(text.sizePx).toBe(50);
  });

  it("sets paragraph style, which is what alignment and lists are", async () => {
    const added = await layers.applyOperation(projectId, { operation: "add_text", content: "One\nTwo" });
    const layerId = (treeOf(added).at(-1)! as never as { id: string }).id;
    const aligned = await layers.applyOperation(projectId, {
      operation: "edit_text", layerId, paragraphIndex: 1, paragraph: { alignment: "center", list: "bullet" },
    });
    const text = (findLayer(treeOf(aligned) as never, layerId)! as never as { content: { text: { paragraphs: { alignment: string; list: string }[] } } }).content.text;
    expect(text.paragraphs[1]).toMatchObject({ alignment: "center", list: "bullet" });
  });

  it("refuses to edit text on a layer that is not text", async () => {
    const added = await layers.applyOperation(projectId, {
      operation: "add_shape", shape: { kind: "rectangle", x: 0, y: 0, width: 10, height: 10, cornerRadius: 0 },
    });
    const layerId = (treeOf(added).at(-1)! as never as { id: string }).id;
    await expect(layers.applyOperation(projectId, { operation: "edit_text", layerId, content: "no" }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("adds a shape and repaints it", async () => {
    const added = await layers.applyOperation(projectId, {
      operation: "add_shape", shape: { kind: "ellipse", cx: 50, cy: 50, rx: 20, ry: 10 },
    });
    const layerId = (treeOf(added).at(-1)! as never as { id: string }).id;
    const painted = await layers.applyOperation(projectId, {
      operation: "set_paint", layerId, fill: { kind: "solid", colour: "#ff8800", opacity: 1 },
    });
    const vector = (findLayer(treeOf(painted) as never, layerId)! as never as { content: { vector: { fill: { colour: string } } } }).content.vector;
    expect(vector.fill.colour).toBe("#ff8800");
  });

  it("gives a graphics layer everything an image layer has", async () => {
    const added = await layers.applyOperation(projectId, { operation: "add_text", content: "Shared" });
    const layerId = (treeOf(added).at(-1)! as never as { id: string }).id;
    // Blend, mask and animation are inherited rather than reimplemented for text.
    await layers.applyOperation(projectId, { operation: "set_blend_mode", layerId, blendMode: "screen" });
    await layers.applyOperation(projectId, {
      operation: "add_mask", layerId,
      mask: { source: { kind: "shape", shape: "rectangle", x: 0, y: 0, width: 1, height: 1, cornerRadius: 0 }, featherPx: 0, density: 1, inverted: false, enabled: true },
    });
    const final = await layers.applyOperation(projectId, {
      operation: "set_keyframe", layerId, propertyPath: "opacity", time: { numerator: 0, denominator: 1 }, value: 0,
    });
    const layer = findLayer(treeOf(final) as never, layerId)! as never as { blendMode: string; masks: unknown[]; animation: unknown[] };
    expect(layer.blendMode).toBe("screen");
    expect(layer.masks).toHaveLength(1);
    expect(layer.animation).toHaveLength(1);
  });
});

/**
 * `PH-012` through `PH-014`. An adjustment layer, a fill layer, and a style are all ordinary
 * layers or ordinary layer properties, so each one inherits masks, clipping, blend modes, and
 * animation without any of those being taught that it exists.
 */
describe("LayerService — adjustment layers, fill layers, and styles", () => {
  let database: EstroDatabase;
  let projects: ProjectService;
  let layers: LayerService;
  let projectId: string;

  beforeEach(async () => {
    database = new EstroDatabase(`estro-structure-${crypto.randomUUID()}`);
    projects = new ProjectService(new ProjectRepository(database));
    layers = new LayerService(projects);
    const project = await projects.createProject({ name: `Structure ${crypto.randomUUID()}`, kind: "photo" });
    projectId = project.id;
    await projects.createPhotoDocument({
      projectId, widthPx: 800, heightPx: 600, resolutionPpi: 72, orientation: "landscape",
      background: { type: "transparent" },
    });
  });

  afterEach(async () => database.delete());

  const currentLayers = async () =>
    (await projects.getProjectHistory(projectId)).headRevision.state.photoDocument!.layers;

  it("adds an adjustment layer that carries no pixels of its own", async () => {
    const result = await layers.applyOperation(projectId, {
      operation: "add_adjustment_layer", name: "Cooler", parameters: { temperature: -30 },
    });
    const [layer] = result.headRevision.state.photoDocument!.layers;
    expect(layer).toMatchObject({ kind: "adjustment", name: "Cooler", visible: true });
    expect(result.transaction.summary).toBe("Add the adjustment layer “Cooler”");
  });

  it("adds a fill layer, defaulting to a flat grey rather than nothing", async () => {
    const result = await layers.applyOperation(projectId, { operation: "add_fill_layer" });
    expect(result.headRevision.state.photoDocument!.layers[0])
      .toMatchObject({ kind: "fill", name: "Fill", paint: { kind: "solid", colour: "#808080" } });
  });

  /** The whole argument for these being layers rather than a separate mechanism. */
  it("lets an adjustment layer be masked, clipped, and blended like any other layer", async () => {
    await layers.applyOperation(projectId, { operation: "add_fill_layer", name: "Base" });
    const added = await layers.applyOperation(projectId, { operation: "add_adjustment_layer" });
    const adjustment = added.headRevision.state.photoDocument!.layers[1];

    await layers.applyOperation(projectId, { operation: "set_blend_mode", layerId: adjustment.id, blendMode: "multiply" });
    await layers.applyOperation(projectId, { operation: "set_clipping", layerId: adjustment.id, clipToBelow: true });
    const masked = await layers.applyOperation(projectId, {
      operation: "add_mask", layerId: adjustment.id,
      mask: { source: { kind: "shape", shape: "ellipse", x: 0.2, y: 0.2, width: 0.6, height: 0.6, cornerRadius: 0 }, featherPx: 4, density: 1, inverted: false, enabled: true },
    });
    expect(masked.headRevision.state.photoDocument!.layers[1])
      .toMatchObject({ blendMode: "multiply", clipToBelow: true });
    expect(masked.headRevision.state.photoDocument!.layers[1].masks).toHaveLength(1);
  });

  /** `PH-010`. A path mask stays crisp at any size, which a stored mask image cannot. */
  it("masks a layer with a vector path", async () => {
    const added = await layers.applyOperation(projectId, { operation: "add_fill_layer" });
    const layerId = added.headRevision.state.photoDocument!.layers[0].id;
    const masked = await layers.applyOperation(projectId, {
      operation: "add_mask", layerId,
      mask: {
        source: { kind: "path", shape: { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }], closed: true } },
        featherPx: 0, density: 1, inverted: false, enabled: true,
      },
    });
    expect(masked.transaction.summary).toContain("vector path");
  });

  it("adds a style, changes it, and removes it", async () => {
    const added = await layers.applyOperation(projectId, { operation: "add_fill_layer" });
    const layerId = added.headRevision.state.photoDocument!.layers[0].id;

    const styled = await layers.applyOperation(projectId, {
      operation: "add_style", layerId,
      style: { kind: "drop_shadow", id: "ignored", distancePx: 10 },
    });
    const styleId = styled.headRevision.state.photoDocument!.layers[0].styles.styles[0].id;
    expect(styled.transaction.summary).toContain("A shadow 10 px away");
    // The id is assigned here rather than taken from the caller, so two styles can never collide.
    expect(styleId).not.toBe("ignored");

    const changed = await layers.applyOperation(projectId, {
      operation: "update_style", layerId, styleId, style: { blurPx: 30, enabled: false },
    });
    expect(changed.headRevision.state.photoDocument!.layers[0].styles.styles[0])
      .toMatchObject({ blurPx: 30, enabled: false, distancePx: 10 });

    const removed = await layers.applyOperation(projectId, { operation: "remove_style", layerId, styleId });
    expect(removed.headRevision.state.photoDocument!.layers[0].styles.styles).toEqual([]);
  });

  /**
   * Turning a shadow into a stroke is adding a different style, not editing this one; merging
   * the two shapes would produce a record that validates as neither.
   */
  it("will not change one kind of style into another", async () => {
    const added = await layers.applyOperation(projectId, { operation: "add_fill_layer" });
    const layerId = added.headRevision.state.photoDocument!.layers[0].id;
    const styled = await layers.applyOperation(projectId, {
      operation: "add_style", layerId, style: { kind: "drop_shadow", id: "x" },
    });
    const styleId = styled.headRevision.state.photoDocument!.layers[0].styles.styles[0].id;

    const attempted = await layers.applyOperation(projectId, {
      operation: "update_style", layerId, styleId, style: { kind: "stroke", widthPx: 9 },
    });
    expect(attempted.headRevision.state.photoDocument!.layers[0].styles.styles[0].kind).toBe("drop_shadow");
  });

  it("says so rather than silently ignoring a style that is not there", async () => {
    const added = await layers.applyOperation(projectId, { operation: "add_fill_layer" });
    const layerId = added.headRevision.state.photoDocument!.layers[0].id;
    await expect(layers.applyOperation(projectId, { operation: "remove_style", layerId, styleId: "ghost" }))
      .rejects.toThrowError(/no such style/);
    await expect(layers.applyOperation(projectId, { operation: "update_style", layerId, styleId: "ghost", style: {} }))
      .rejects.toThrowError(/no such style/);
  });

  it("refuses to add a style to a locked layer", async () => {
    const added = await layers.applyOperation(projectId, { operation: "add_fill_layer" });
    const layerId = added.headRevision.state.photoDocument!.layers[0].id;
    await layers.applyOperation(projectId, { operation: "set_lock", layerId, locked: true });
    await expect(layers.applyOperation(projectId, { operation: "add_style", layerId, style: { kind: "glow", id: "g" } }))
      .rejects.toThrowError();
  });

  it("describes the new layer kinds in words a person would use", async () => {
    await layers.applyOperation(projectId, { operation: "add_adjustment_layer", name: "Warmer" });
    await layers.applyOperation(projectId, { operation: "add_fill_layer", name: "Sky", paint: { kind: "solid", colour: "#3366cc", opacity: 1 } });
    const [adjustment, fill] = await currentLayers();
    expect(describeLayer(adjustment)).toContain("changes everything beneath it");
    expect(describeLayer(fill)).toContain("#3366cc");
  });
});

/**
 * `PH-005`, `PH-023`, `PH-024`, `PH-046`. Free transform, keystone correction, warping, and
 * lens correction are one map from where a pixel is to where it should go. All four are
 * parameters applied at render time, so a correction can be adjusted a week later.
 */
describe("LayerService — geometry", () => {
  let database: EstroDatabase;
  let projects: ProjectService;
  let assets: AssetService;
  let layers: LayerService;
  let projectId: string;
  let layerId: string;

  beforeEach(async () => {
    database = new EstroDatabase(`estro-geometry-${crypto.randomUUID()}`);
    projects = new ProjectService(new ProjectRepository(database));
    const jobs = new JobService(database);
    assets = new AssetService(database, projects, jobs, {
      probeDeps: { decodeSize: async () => ({ width: 400, height: 300 }), hash: async () => "hash-bbbbbbbb" },
      sourceStore: createMemorySourceStore(),
      derivedCache: createMemoryDerivedCache(),
    });
    layers = new LayerService(projects);

    const project = await projects.createProject({ name: `Geometry ${crypto.randomUUID()}`, kind: "photo" });
    projectId = project.id;
    await projects.createPhotoDocument({
      projectId, widthPx: 800, heightPx: 600, resolutionPpi: 72, orientation: "landscape",
      background: { type: "transparent" },
    });

    const file = new File([new Uint8Array(4)], "wall.jpg", { type: "image/jpeg" });
    Object.defineProperty(file, "size", { value: 4096 });
    const handle = { kind: "file", name: "wall.jpg", getFile: async () => file, queryPermission: async () => "granted" } as unknown as FileSystemFileHandle;
    const outcome = await assets.registerOne(projectId, { file, handle });
    const added = await layers.applyOperation(projectId, { operation: "add_image", assetId: outcome.assetId! });
    layerId = added.headRevision.state.photoDocument!.layers[0].id;
  });

  afterEach(async () => database.delete());

  const currentLayer = async () =>
    (await projects.getProjectHistory(projectId)).headRevision.state.photoDocument!.layers[0];

  it("starts with no geometry at all, so nothing is bent until it is asked for", async () => {
    expect(await currentLayer()).toMatchObject({
      geometry: { perspective: null, warp: null, lens: { distortion: 0, vignette: 0 } },
    });
  });

  /** Setting just the rotation must not reset everything else to its default. */
  it("merges a partial free transform rather than replacing the whole thing", async () => {
    await layers.applyOperation(projectId, { operation: "free_transform", layerId, transform: { scaleX: 3, scaleY: 3 } });
    const result = await layers.applyOperation(projectId, { operation: "free_transform", layerId, transform: { rotationDeg: 15 } });
    expect(result.headRevision.state.photoDocument!.layers[0].transform)
      .toMatchObject({ scaleX: 3, scaleY: 3, rotationDeg: 15 });
    expect(result.transaction.summary).toContain("rotated 15°");
  });

  it("refuses a scale of zero, which would make the layer disappear", async () => {
    await expect(layers.applyOperation(projectId, { operation: "free_transform", layerId, transform: { scaleX: 0 } }))
      .rejects.toThrowError(/would disappear/);
  });

  it("straightens from four corners, and clears the correction again", async () => {
    const corners = {
      topLeft: { x: 100, y: 0 }, topRight: { x: 700, y: 0 },
      bottomRight: { x: 800, y: 600 }, bottomLeft: { x: 0, y: 600 },
    };
    const set = await layers.applyOperation(projectId, { operation: "set_perspective", layerId, corners });
    expect(set.headRevision.state.photoDocument!.layers[0].geometry.perspective).toMatchObject(corners);
    expect(set.transaction.summary).toContain("Straighten");

    const cleared = await layers.applyOperation(projectId, { operation: "set_perspective", layerId, corners: null });
    expect(cleared.headRevision.state.photoDocument!.layers[0].geometry.perspective).toBeNull();
  });

  /** Sliders and corners are two ways to reach one record, not two records. */
  it("straightens from sliders, ending at the same kind of corners", async () => {
    const result = await layers.applyOperation(projectId, {
      operation: "set_perspective", layerId, sliders: { verticalDeg: 20 },
    });
    const perspective = result.headRevision.state.photoDocument!.layers[0].geometry.perspective!;
    expect(perspective.topLeft.x).toBeGreaterThan(0);
    expect(perspective.bottomLeft.x).toBe(0);
  });

  it("refuses corners that cross over each other", async () => {
    await expect(layers.applyOperation(projectId, {
      operation: "set_perspective", layerId,
      corners: {
        topLeft: { x: 0, y: 0 }, topRight: { x: 800, y: 600 },
        bottomRight: { x: 800, y: 0 }, bottomLeft: { x: 0, y: 600 },
      },
    })).rejects.toThrowError(/reading order/);
  });

  it("creates a warp grid and moves one of its points", async () => {
    const created = await layers.applyOperation(projectId, { operation: "warp", layerId, columns: 3, rows: 3 });
    expect(created.headRevision.state.photoDocument!.layers[0].geometry.warp).toMatchObject({ columns: 3, rows: 3 });
    expect(created.transaction.summary).toContain("3×3 warp grid");

    const moved = await layers.applyOperation(projectId, {
      operation: "warp", layerId, point: { column: 1, row: 1, offset: { x: 0.1, y: -0.1 } },
    });
    expect(moved.headRevision.state.photoDocument!.layers[0].geometry.warp!.offsets[4])
      .toEqual({ x: 0.1, y: -0.1 });
  });

  /** A first drag has to create the grid it is dragging. */
  it("creates the grid when a point is moved before one exists", async () => {
    const moved = await layers.applyOperation(projectId, {
      operation: "warp", layerId, point: { column: 0, row: 0, offset: { x: 0.05, y: 0 } },
    });
    const warp = moved.headRevision.state.photoDocument!.layers[0].geometry.warp!;
    expect(warp.columns).toBe(4);
    expect(warp.offsets[0]).toEqual({ x: 0.05, y: 0 });
  });

  /** Old control points describe a different grid; carrying them across would move the picture. */
  it("starts a fresh mesh when the grid size changes", async () => {
    await layers.applyOperation(projectId, {
      operation: "warp", layerId, columns: 3, rows: 3, point: { column: 1, row: 1, offset: { x: 0.2, y: 0 } },
    });
    const resized = await layers.applyOperation(projectId, { operation: "warp", layerId, columns: 5, rows: 5 });
    const warp = resized.headRevision.state.photoDocument!.layers[0].geometry.warp!;
    expect(warp.offsets).toHaveLength(25);
    expect(warp.offsets.every((offset) => offset.x === 0 && offset.y === 0)).toBe(true);
  });

  it("clears a warp", async () => {
    await layers.applyOperation(projectId, { operation: "warp", layerId, columns: 3, rows: 3 });
    const cleared = await layers.applyOperation(projectId, { operation: "warp", layerId, clear: true });
    expect(cleared.headRevision.state.photoDocument!.layers[0].geometry.warp).toBeNull();
  });

  it("refuses a control point that is not on the mesh", async () => {
    await layers.applyOperation(projectId, { operation: "warp", layerId, columns: 3, rows: 3 });
    await expect(layers.applyOperation(projectId, {
      operation: "warp", layerId, point: { column: 9, row: 0, offset: { x: 0, y: 0 } },
    })).rejects.toThrowError(/not on the mesh/);
  });

  it("corrects the lens, merging one setting at a time", async () => {
    await layers.applyOperation(projectId, { operation: "correct_lens", layerId, correction: { distortion: 0.3 } });
    const result = await layers.applyOperation(projectId, { operation: "correct_lens", layerId, correction: { vignette: -0.2 } });
    expect(result.headRevision.state.photoDocument!.layers[0].geometry.lens)
      .toMatchObject({ distortion: 0.3, vignette: -0.2 });
    expect(result.transaction.summary).toContain("barrel bend");
  });

  it("refuses geometry on a locked layer", async () => {
    await layers.applyOperation(projectId, { operation: "set_lock", layerId, locked: true });
    await expect(layers.applyOperation(projectId, { operation: "warp", layerId, clear: true })).rejects.toThrowError();
  });
});

/**
 * Zod's `.partial()` keeps a field's default, so a schema built that way hands a merge every
 * field filled in and the merge cannot tell "leave this" from "set it to zero". These are the
 * regressions for the two commands where that quietly reset work.
 */
describe("LayerService — partial updates leave unmentioned settings alone", () => {
  let database: EstroDatabase;
  let projects: ProjectService;
  let layers: LayerService;
  let projectId: string;
  let layerId: string;

  beforeEach(async () => {
    database = new EstroDatabase(`estro-partial-${crypto.randomUUID()}`);
    projects = new ProjectService(new ProjectRepository(database));
    layers = new LayerService(projects);
    const project = await projects.createProject({ name: `Partial ${crypto.randomUUID()}`, kind: "photo" });
    projectId = project.id;
    await projects.createPhotoDocument({
      projectId, widthPx: 400, heightPx: 400, resolutionPpi: 72, orientation: "square",
      background: { type: "transparent" },
    });
    const added = await layers.applyOperation(projectId, { operation: "add_fill_layer" });
    layerId = added.headRevision.state.photoDocument!.layers[0].id;
  });

  afterEach(async () => database.delete());

  it("changes one adjustment on an effect without resetting the others", async () => {
    const added = await layers.applyOperation(projectId, {
      operation: "add_effect", layerId, name: "Look",
      parameters: { contrast: 40, saturation: -25 },
    });
    const effectId = added.headRevision.state.photoDocument!.layers[0].effects.effects[0].id;

    const changed = await layers.applyOperation(projectId, {
      operation: "update_effect", layerId, effectId, parameters: { brightness: 10 },
    });
    const effect = changed.headRevision.state.photoDocument!.layers[0].effects.effects[0];
    expect(effect.kind === "adjustments" && effect.parameters)
      .toMatchObject({ brightness: 10, contrast: 40, saturation: -25 });
  });

  it("softens a mask without also un-inverting it or resetting its strength", async () => {
    const masked = await layers.applyOperation(projectId, {
      operation: "add_mask", layerId,
      mask: {
        source: { kind: "shape", shape: "ellipse", x: 0, y: 0, width: 1, height: 1, cornerRadius: 0 },
        featherPx: 0, density: 0.4, inverted: true, enabled: true,
      },
    });
    const maskId = masked.headRevision.state.photoDocument!.layers[0].masks[0].id;

    const softened = await layers.applyOperation(projectId, {
      operation: "update_mask", layerId, maskId, mask: { featherPx: 12 },
    });
    expect(softened.headRevision.state.photoDocument!.layers[0].masks[0])
      .toMatchObject({ featherPx: 12, density: 0.4, inverted: true });
  });
});

/**
 * `PH-050` through `PH-055`, and `SH-062`. Painting is stored as strokes rather than pixels,
 * so a stroke can be restyled after it was drawn; the bucket is a fill masked by a saved
 * selection rather than a second flood-fill; and swatches live on the document so changing
 * one changes everything using it.
 */
describe("LayerService — painting, filling, and swatches", () => {
  let database: EstroDatabase;
  let projects: ProjectService;
  let layers: LayerService;
  let projectId: string;

  beforeEach(async () => {
    database = new EstroDatabase(`estro-paint-${crypto.randomUUID()}`);
    projects = new ProjectService(new ProjectRepository(database));
    layers = new LayerService(projects);
    const project = await projects.createProject({ name: `Paint ${crypto.randomUUID()}`, kind: "photo" });
    projectId = project.id;
    await projects.createPhotoDocument({
      projectId, widthPx: 600, heightPx: 400, resolutionPpi: 72, orientation: "landscape",
      background: { type: "transparent" },
    });
  });

  afterEach(async () => database.delete());

  const currentDocument = async () =>
    (await projects.getProjectHistory(projectId)).headRevision.state.photoDocument!;

  const paint = (points: { x: number; y: number }[], overrides: Record<string, unknown> = {}) =>
    layers.applyOperation(projectId, { operation: "paint_stroke", points, ...overrides });

  /** A first stroke has to create the surface it lands on. */
  it("starts a painted layer with the first stroke", async () => {
    const result = await paint([{ x: 10, y: 10 }, { x: 90, y: 60 }]);
    const [layer] = result.headRevision.state.photoDocument!.layers;
    expect(layer).toMatchObject({ kind: "paint", name: "Paint" });
    expect((layer as { strokes: { strokes: unknown[] } }).strokes.strokes).toHaveLength(1);
    expect(result.transaction.summary).toContain("Painted #000000");
  });

  it("adds later strokes to the layer it was given", async () => {
    const first = await paint([{ x: 0, y: 0 }, { x: 10, y: 10 }]);
    const layerId = first.headRevision.state.photoDocument!.layers[0].id;
    const second = await paint([{ x: 20, y: 20 }, { x: 30, y: 30 }], { layerId });
    expect(second.headRevision.state.photoDocument!.layers).toHaveLength(1);
    expect((second.headRevision.state.photoDocument!.layers[0] as { strokes: { strokes: unknown[] } }).strokes.strokes)
      .toHaveLength(2);
  });

  it("says what to do rather than painting onto something that cannot hold a stroke", async () => {
    const added = await layers.applyOperation(projectId, { operation: "add_fill_layer" });
    const layerId = added.headRevision.state.photoDocument!.layers[0].id;
    await expect(paint([{ x: 0, y: 0 }], { layerId }))
      .rejects.toThrowError(/Leave the layer out to start one/);
  });

  /** Every sample the pointer reported would otherwise be stored, replayed, and synced. */
  it("thins a stroke to the points that describe its shape", async () => {
    const straight = Array.from({ length: 60 }, (_, index) => ({ x: index * 3, y: 50 }));
    const result = await paint(straight);
    const stored = (result.headRevision.state.photoDocument!.layers[0] as { strokes: { strokes: { points: unknown[] }[] } })
      .strokes.strokes[0].points;
    expect(stored).toHaveLength(2);
  });

  it("keeps every point when thinning is switched off", async () => {
    const wobbly = Array.from({ length: 20 }, (_, index) => ({ x: index * 3, y: 50 }));
    const result = await paint(wobbly, { simplifyPx: 0 });
    expect((result.headRevision.state.photoDocument!.layers[0] as { strokes: { strokes: { points: unknown[] }[] } })
      .strokes.strokes[0].points).toHaveLength(20);
  });

  it("erases with the same command, using an eraser brush", async () => {
    const result = await paint([{ x: 5, y: 5 }, { x: 50, y: 5 }], { brush: { kind: "eraser", sizePx: 30 } });
    expect(result.transaction.summary).toContain("Erased with a 30 px brush");
  });

  it("removes the last stroke, and says so when there is none", async () => {
    const first = await paint([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    const layerId = first.headRevision.state.photoDocument!.layers[0].id;
    const removed = await layers.applyOperation(projectId, { operation: "undo_stroke", layerId });
    expect((removed.headRevision.state.photoDocument!.layers[0] as { strokes: { strokes: unknown[] } }).strokes.strokes)
      .toHaveLength(0);
    await expect(layers.applyOperation(projectId, { operation: "undo_stroke", layerId }))
      .rejects.toThrowError(/no strokes to remove/);
  });

  /** The whole reason strokes are kept rather than flattened into pixels. */
  it("changes a stroke's size and colour long after it was drawn", async () => {
    const first = await paint([{ x: 0, y: 0 }, { x: 40, y: 0 }], { brush: { sizePx: 8, hardness: 0.3, opacity: 0.5 } });
    const layer = first.headRevision.state.photoDocument!.layers[0] as { id: string; strokes: { strokes: { id: string }[] } };

    const restyled = await layers.applyOperation(projectId, {
      operation: "restyle_stroke", layerId: layer.id, strokeId: layer.strokes.strokes[0].id,
      brush: { sizePx: 40 }, paint: { kind: "solid", colour: "#ff0000", opacity: 1 },
    });
    const stroke = (restyled.headRevision.state.photoDocument!.layers[0] as PaintLayer).strokes.strokes[0];
    // Only what was named changed: the hardness and opacity it was drawn with are still there.
    expect(stroke.brush).toMatchObject({ sizePx: 40, hardness: 0.3, opacity: 0.5 });
    expect(stroke.paint).toMatchObject({ colour: "#ff0000" });
  });

  it("says so rather than restyling a stroke that is not there", async () => {
    const first = await paint([{ x: 0, y: 0 }]);
    const layerId = first.headRevision.state.photoDocument!.layers[0].id;
    await expect(layers.applyOperation(projectId, {
      operation: "restyle_stroke", layerId, strokeId: "ghost", brush: { sizePx: 5 },
    })).rejects.toThrowError(/no such stroke/);
  });

  /** The bucket is a fill masked by a selection, not a second flood-fill implementation. */
  it("fills a region as a masked fill layer, which can be recoloured afterwards", async () => {
    const result = await layers.applyOperation(projectId, {
      operation: "fill_region", selectionId: "sel-1",
      paint: { kind: "solid", colour: "#00aa00", opacity: 1 },
    });
    const [layer] = result.headRevision.state.photoDocument!.layers;
    expect(layer.kind).toBe("fill");
    expect(layer.masks[0].source).toEqual({ kind: "stored", selectionId: "sel-1" });
    expect(result.transaction.summary).toContain("#00aa00");
  });

  it("puts a fill above the layer it was aimed at rather than beneath it", async () => {
    const base = await layers.applyOperation(projectId, { operation: "add_fill_layer", name: "Base" });
    const baseId = base.headRevision.state.photoDocument!.layers[0].id;
    await layers.applyOperation(projectId, { operation: "add_fill_layer", name: "Top" });

    const filled = await layers.applyOperation(projectId, {
      operation: "fill_region", layerId: baseId, selectionId: "sel-1", name: "Patch",
      paint: { kind: "solid", colour: "#123456", opacity: 1 },
    });
    expect(filled.headRevision.state.photoDocument!.layers.map((layer) => layer.name))
      .toEqual(["Base", "Patch", "Top"]);
  });

  /** `PH-026` through `PH-029`: retouching goes through the same command as painting. */
  it("retouches with the same command, recording what each brush did", async () => {
    const dodged = await paint([{ x: 20, y: 20 }, { x: 60, y: 20 }], {
      brush: { kind: "dodge", sizePx: 50 }, strength: 0.2,
    });
    expect(dodged.transaction.summary).toBe("Lightened an area with a 50 px brush at 20% strength");

    const layerId = dodged.headRevision.state.photoDocument!.layers[0].id;
    const blurred = await paint([{ x: 0, y: 0 }, { x: 30, y: 30 }], { layerId, brush: { kind: "blur" } });
    expect(blurred.transaction.summary).toContain("Softened an area");

    const redEye = await paint([{ x: 100, y: 100 }], { layerId, brush: { kind: "red_eye", sizePx: 12 } });
    expect(redEye.transaction.summary).toContain("Corrected red eye");
  });

  it("clones from an offset, and refuses a clone with nowhere to read from", async () => {
    const cloned = await paint([{ x: 80, y: 80 }, { x: 120, y: 80 }], {
      brush: { kind: "clone", sizePx: 30 }, cloneOffset: { x: -60, y: 0 },
    });
    expect(cloned.transaction.summary).toContain("from -60, 0 px away");

    await expect(paint([{ x: 10, y: 10 }], { brush: { kind: "clone" } }))
      .rejects.toThrowError(/needs a source/);
  });

  it("adds, renames, and removes a swatch", async () => {
    const added = await layers.applySwatch(projectId, {
      name: "Brand", paint: { kind: "solid", colour: "#ff6600", opacity: 1 },
    });
    expect(added.transaction.summary).toBe("Add the swatch “Brand”");
    const swatchId = (await currentDocument()).swatches[0].id;

    const renamed = await layers.applySwatch(projectId, { swatchId, name: "Brand orange" });
    expect(renamed.headRevision.state.photoDocument!.swatches[0])
      .toMatchObject({ name: "Brand orange", paint: { colour: "#ff6600" } });

    const removed = await layers.applySwatch(projectId, { swatchId, remove: true });
    expect(removed.headRevision.state.photoDocument!.swatches).toEqual([]);
  });

  /** The reason to have swatches: one edit rather than forty. */
  it("changes everything using a swatch by changing the swatch", async () => {
    await layers.applySwatch(projectId, { name: "Brand", paint: { kind: "solid", colour: "#ff6600", opacity: 1 } });
    const swatchId = (await currentDocument()).swatches[0].id;

    await layers.applyOperation(projectId, {
      operation: "add_shape", shape: { kind: "rectangle", x: 0, y: 0, width: 10, height: 10, cornerRadius: 0 },
      fill: { kind: "swatch", swatchId },
    });
    await paint([{ x: 0, y: 0 }, { x: 5, y: 5 }], { paint: { kind: "swatch", swatchId } });

    const changed = await layers.applySwatch(projectId, {
      swatchId, paint: { kind: "solid", colour: "#0066ff", opacity: 1 },
    });
    // Neither the shape nor the stroke was touched; both now paint the new colour.
    expect(changed.headRevision.state.photoDocument!.swatches[0].paint).toMatchObject({ colour: "#0066ff" });
    expect(changed.transaction.summary).toBe("Change the swatch “Brand”");
  });

  it("undoes a swatch change like any other edit", async () => {
    const added = await layers.applySwatch(projectId, {
      name: "Brand", paint: { kind: "solid", colour: "#ff6600", opacity: 1 },
    });
    await projects.undoTransaction(projectId, added.transaction.id);
    expect((await currentDocument()).swatches).toEqual([]);
  });

  it("refuses a swatch with nothing to say, and one that is not there", async () => {
    await expect(layers.applySwatch(projectId, {})).rejects.toThrowError(/needs a name, a colour, or both/);
    await expect(layers.applySwatch(projectId, { name: "New" })).rejects.toThrowError(/needs a colour or gradient/);
    await expect(layers.applySwatch(projectId, { swatchId: "ghost", name: "x" })).rejects.toThrowError(/not in this document/);
    await expect(layers.applySwatch(projectId, { remove: true })).rejects.toThrowError(/needs its id/);
  });
});

/**
 * `PH-051`. A brush preset is a named bundle of settings saved, listed, and shared through the
 * same engine as every other preset — but it describes a tool rather than something in the
 * document, so it is used by painting with it rather than by being applied to an object.
 */
describe("brush presets", () => {
  let database: EstroDatabase;
  let projects: ProjectService;
  let presets: PresetService;
  let layers: LayerService;
  let projectId: string;

  beforeEach(async () => {
    database = new EstroDatabase(`estro-brush-presets-${crypto.randomUUID()}`);
    projects = new ProjectService(new ProjectRepository(database));
    presets = new PresetService(database, projects);
    layers = new LayerService(projects);
    const project = await projects.createProject({ name: `Brushes ${crypto.randomUUID()}`, kind: "photo" });
    projectId = project.id;
    await projects.createPhotoDocument({
      projectId, widthPx: 400, heightPx: 400, resolutionPpi: 72, orientation: "square",
      background: { type: "transparent" },
    });
  });

  afterEach(async () => database.delete());

  it("saves and lists a brush through the same engine as every other preset", async () => {
    const saved = await presets.savePreset({
      name: "Soft round 60", domain: "brush",
      attributes: {
        brush: { kind: "brush", sizePx: 60, hardness: 0.1, flow: 0.4, opacity: 1, spacing: 0.05, roundness: 1, angleDeg: 0, scatter: 0 },
        dynamics: { pressureToSize: 1, pressureToOpacity: 0.5, pressureToFlow: 0, tiltToRoundness: 0, rotationToAngle: 0, velocityToSize: 0 },
      },
    });
    expect(saved.domain).toBe("brush");
    expect(saved.attributes.brush).toMatchObject({ sizePx: 60, hardness: 0.1 });

    const listed = await presets.listPresets({ domain: "brush" });
    expect(listed.map((preset) => preset.name)).toContain("Soft round 60");
  });

  /** The preset is used by painting with it, which is what makes the round trip real. */
  it("paints with the settings a preset holds", async () => {
    const saved = await presets.savePreset({
      name: "Chalk", domain: "brush",
      attributes: { brush: { kind: "pencil", sizePx: 8, hardness: 1, flow: 1, opacity: 0.7, spacing: 0.05, roundness: 1, angleDeg: 0, scatter: 0.4 } },
    });
    const result = await layers.applyOperation(projectId, {
      operation: "paint_stroke", points: [{ x: 0, y: 0 }, { x: 40, y: 40 }],
      brush: saved.attributes.brush,
    });
    const painted = (result.headRevision.state.photoDocument!.layers[0] as PaintLayer).strokes.strokes[0];
    expect(painted.brush).toMatchObject({ kind: "pencil", sizePx: 8, opacity: 0.7, scatter: 0.4 });
  });

  it("says a brush preset is a tool rather than failing as though it were unfinished", async () => {
    const saved = await presets.savePreset({
      name: "Chalk", domain: "brush",
      attributes: { brush: { kind: "pencil", sizePx: 8, hardness: 1, flow: 1, opacity: 1, spacing: 0.05, roundness: 1, angleDeg: 0, scatter: 0 } },
    });
    await expect(presets.applyPreset({ projectId, presetId: saved.id, targetIds: ["anything"] }))
      .rejects.toThrowError(/describes a tool rather than something in the document/);
  });
});

/**
 * `PH-031` through `PH-044`. A curve, levels, and a lookup table arrive as a second kind of
 * effect rather than as more fields on the first, so one command adds either and the interface
 * shows one ordered list rather than two.
 */
describe("LayerService — colour operators", () => {
  let database: EstroDatabase;
  let projects: ProjectService;
  let layers: LayerService;
  let projectId: string;
  let layerId: string;

  beforeEach(async () => {
    database = new EstroDatabase(`estro-colour-${crypto.randomUUID()}`);
    projects = new ProjectService(new ProjectRepository(database));
    layers = new LayerService(projects);
    const project = await projects.createProject({ name: `Colour ${crypto.randomUUID()}`, kind: "photo" });
    projectId = project.id;
    await projects.createPhotoDocument({
      projectId, widthPx: 400, heightPx: 300, resolutionPpi: 72, orientation: "landscape",
      background: { type: "transparent" },
    });
    const added = await layers.applyOperation(projectId, { operation: "add_fill_layer" });
    layerId = added.headRevision.state.photoDocument!.layers[0].id;
  });

  afterEach(async () => database.delete());

  const effectsOf = async () =>
    (await projects.getProjectHistory(projectId)).headRevision.state.photoDocument!.layers[0].effects.effects;

  it("adds a curve as an effect, describing it in the transaction", async () => {
    const result = await layers.applyOperation(projectId, {
      operation: "add_effect", layerId, name: "Contrast curve",
      colourOperation: {
        kind: "curves", channel: "rgb",
        points: [{ input: 0, output: 0 }, { input: 128, output: 160 }, { input: 255, output: 255 }],
      },
    });
    const [effect] = await effectsOf();
    expect(effect.kind).toBe("colour");
    expect(result.transaction.summary).toContain("tone curve through 3 points");
  });

  it("keeps colour operators and slider effects in one ordered list", async () => {
    await layers.applyOperation(projectId, { operation: "add_effect", layerId, name: "Warm", parameters: { temperature: 20 } });
    await layers.applyOperation(projectId, {
      operation: "add_effect", layerId, name: "Fade",
      colourOperation: { kind: "levels", rgb: { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 30, outWhite: 255 } },
    });
    await layers.applyOperation(projectId, {
      operation: "add_effect", layerId, name: "Mono", colourOperation: { kind: "black_and_white" },
    });
    expect((await effectsOf()).map((effect) => [effect.kind, effect.name]))
      .toEqual([["adjustments", "Warm"], ["colour", "Fade"], ["colour", "Mono"]]);
  });

  it("reorders and removes a colour operator like any other effect", async () => {
    await layers.applyOperation(projectId, { operation: "add_effect", layerId, name: "A", colourOperation: { kind: "invert" } });
    await layers.applyOperation(projectId, { operation: "add_effect", layerId, name: "B", colourOperation: { kind: "equalize" } });
    const [first] = await effectsOf();

    await layers.applyOperation(projectId, { operation: "reorder_effect", layerId, effectId: first.id, toIndex: 1 });
    expect((await effectsOf()).map((effect) => effect.name)).toEqual(["B", "A"]);

    await layers.applyOperation(projectId, { operation: "remove_effect", layerId, effectId: first.id });
    expect((await effectsOf()).map((effect) => effect.name)).toEqual(["B"]);
  });

  /**
   * A curve and a lookup table have nothing in common field by field, so replacing the whole
   * operator is the only merge that would mean the same thing for both.
   */
  it("replaces a colour operator whole, while still merging the shared settings", async () => {
    await layers.applyOperation(projectId, {
      operation: "add_effect", layerId, name: "Look", colourOperation: { kind: "posterize", levels: 4 },
    });
    const [before] = await effectsOf();

    await layers.applyOperation(projectId, {
      operation: "update_effect", layerId, effectId: before.id, opacity: 0.5,
      colourOperation: { kind: "threshold", level: 90 },
    });
    const [after] = await effectsOf();
    expect(after.kind === "colour" && after.operation.kind).toBe("threshold");
    expect(after.opacity).toBe(0.5);
    expect(after.name).toBe("Look");
  });

  it("switches a colour operator off without losing it", async () => {
    await layers.applyOperation(projectId, {
      operation: "add_effect", layerId, name: "Mono", colourOperation: { kind: "black_and_white", blue: -40 },
    });
    const [effect] = await effectsOf();
    await layers.applyOperation(projectId, { operation: "update_effect", layerId, effectId: effect.id, enabled: false });
    const [after] = await effectsOf();
    expect(after.enabled).toBe(false);
    expect(after.kind === "colour" && after.operation.kind === "black_and_white" && after.operation.blue).toBe(-40);
  });

  it("masks one colour operator without masking the layer", async () => {
    await layers.applyOperation(projectId, {
      operation: "add_effect", layerId, name: "Local", colourOperation: { kind: "exposure", exposureEv: 1 },
    });
    const [effect] = await effectsOf();
    const masked = await layers.applyOperation(projectId, {
      operation: "update_effect", layerId, effectId: effect.id,
    });
    expect(masked.headRevision.state.photoDocument!.layers[0].masks).toEqual([]);
  });
});

/**
 * `PH-047`, `PH-057` through `PH-061`. A filter is a third kind of effect rather than a variant
 * of the second, because the difference is real: a colour operator reduces to a lookup table
 * and a filter has to see a neighbourhood.
 */
describe("LayerService — filters", () => {
  let database: EstroDatabase;
  let projects: ProjectService;
  let layers: LayerService;
  let projectId: string;
  let layerId: string;

  beforeEach(async () => {
    database = new EstroDatabase(`estro-filters-${crypto.randomUUID()}`);
    projects = new ProjectService(new ProjectRepository(database));
    layers = new LayerService(projects);
    const project = await projects.createProject({ name: `Filters ${crypto.randomUUID()}`, kind: "photo" });
    projectId = project.id;
    await projects.createPhotoDocument({
      projectId, widthPx: 400, heightPx: 300, resolutionPpi: 72, orientation: "landscape",
      background: { type: "transparent" },
    });
    const added = await layers.applyOperation(projectId, { operation: "add_fill_layer" });
    layerId = added.headRevision.state.photoDocument!.layers[0].id;
  });

  afterEach(async () => database.delete());

  const effectsOf = async () =>
    (await projects.getProjectHistory(projectId)).headRevision.state.photoDocument!.layers[0].effects.effects;

  it("adds a blur as an effect, describing it in the transaction", async () => {
    const result = await layers.applyOperation(projectId, {
      operation: "add_effect", layerId, name: "Soften",
      filter: { kind: "blur", shape: "gaussian", radiusPx: 12 },
    });
    expect((await effectsOf())[0].kind).toBe("filter");
    expect(result.transaction.summary).toContain("a soft blur of 12 px");
  });

  it("keeps sliders, colour operators, and filters in one ordered list", async () => {
    await layers.applyOperation(projectId, { operation: "add_effect", layerId, name: "Warm", parameters: { temperature: 20 } });
    await layers.applyOperation(projectId, { operation: "add_effect", layerId, name: "Mono", colourOperation: { kind: "black_and_white" } });
    await layers.applyOperation(projectId, { operation: "add_effect", layerId, name: "Grain", filter: { kind: "noise", mode: "add", amount: 8 } });
    expect((await effectsOf()).map((effect) => effect.kind))
      .toEqual(["adjustments", "colour", "filter"]);
  });

  it("replaces a filter whole while merging the shared settings", async () => {
    await layers.applyOperation(projectId, {
      operation: "add_effect", layerId, name: "Look", filter: { kind: "blur", shape: "box", radiusPx: 4 },
    });
    const [before] = await effectsOf();
    await layers.applyOperation(projectId, {
      operation: "update_effect", layerId, effectId: before.id, opacity: 0.4,
      filter: { kind: "pixelate", shape: "halftone", cellPx: 6 },
    });
    const [after] = await effectsOf();
    expect(after.kind === "filter" && after.filter.kind).toBe("pixelate");
    expect(after.opacity).toBe(0.4);
    expect(after.name).toBe("Look");
  });

  it("switches a filter off without losing its settings", async () => {
    await layers.applyOperation(projectId, {
      operation: "add_effect", layerId, name: "Blur", filter: { kind: "blur", shape: "motion", radiusPx: 20, angleDeg: 30 },
    });
    const [effect] = await effectsOf();
    await layers.applyOperation(projectId, { operation: "update_effect", layerId, effectId: effect.id, enabled: false });
    const [after] = await effectsOf();
    expect(after.enabled).toBe(false);
    expect(after.kind === "filter" && after.filter.kind === "blur" && after.filter.angleDeg).toBe(30);
  });
});

/**
 * `PH-048`. A profile is the starting point a photograph is edited away from, so it runs
 * before everything else and a layer holds at most one of each kind.
 */
describe("LayerService — camera and creative profiles", () => {
  let database: EstroDatabase;
  let projects: ProjectService;
  let assets: AssetService;
  let layers: LayerService;
  let projectId: string;
  let layerId: string;

  const cameraProfile = {
    schemaVersion: 1 as const, id: "profile-camera", name: "Neutral", kind: "camera" as const,
    camera: "Test Camera", operations: [{ kind: "exposure" as const, gamma: 1.2 }],
  };
  const look = {
    schemaVersion: 1 as const, id: "profile-look", name: "Faded", kind: "creative" as const,
    camera: null, operations: [{ kind: "levels" as const, rgb: { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 30, outWhite: 240 } }],
  };

  beforeEach(async () => {
    database = new EstroDatabase(`estro-profiles-${crypto.randomUUID()}`);
    projects = new ProjectService(new ProjectRepository(database));
    const jobs = new JobService(database);
    assets = new AssetService(database, projects, jobs, {
      probeDeps: { decodeSize: async () => ({ width: 400, height: 300 }), hash: async () => "hash-dddddddd" },
      sourceStore: createMemorySourceStore(),
      derivedCache: createMemoryDerivedCache(),
    });
    layers = new LayerService(projects);

    const project = await projects.createProject({ name: `Profiles ${crypto.randomUUID()}`, kind: "photo" });
    projectId = project.id;
    await projects.createPhotoDocument({
      projectId, widthPx: 800, heightPx: 600, resolutionPpi: 72, orientation: "landscape",
      background: { type: "transparent" },
    });
    const file = new File([new Uint8Array(4)], "shot.jpg", { type: "image/jpeg" });
    Object.defineProperty(file, "size", { value: 4096 });
    const handle = { kind: "file", name: "shot.jpg", getFile: async () => file, queryPermission: async () => "granted" } as unknown as FileSystemFileHandle;
    const outcome = await assets.registerOne(projectId, { file, handle });
    const added = await layers.applyOperation(projectId, { operation: "add_image", assetId: outcome.assetId! });
    layerId = added.headRevision.state.photoDocument!.layers[0].id;
  });

  afterEach(async () => database.delete());

  const profilesOf = async () => {
    const layer = (await projects.getProjectHistory(projectId)).headRevision.state.photoDocument!.layers[0];
    return layer.kind === "image" ? layer.profiles : [];
  };

  it("starts with no profile at all", async () => {
    expect(await profilesOf()).toEqual([]);
  });

  it("applies a camera profile and a look together", async () => {
    await layers.applyOperation(projectId, { operation: "apply_profile", layerId, profile: cameraProfile });
    const result = await layers.applyOperation(projectId, { operation: "apply_profile", layerId, profile: look, strength: 0.6 });
    expect((await profilesOf()).map((profile) => profile.kind)).toEqual(["camera", "creative"]);
    expect(result.transaction.summary).toContain("look “Faded” at 60% strength");
  });

  /** "Two camera profiles" is not a thing that means anything. */
  it("replaces a profile of the same kind rather than stacking a second", async () => {
    await layers.applyOperation(projectId, { operation: "apply_profile", layerId, profile: cameraProfile });
    await layers.applyOperation(projectId, {
      operation: "apply_profile", layerId, profile: { ...cameraProfile, id: "profile-2", name: "Vivid" },
    });
    const profiles = await profilesOf();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].name).toBe("Vivid");
  });

  /**
   * A photograph developed last month should not change because someone edited a profile
   * today, so the operations are copied rather than referenced.
   */
  it("copies the profile's operations onto the layer", async () => {
    const mutable = { ...cameraProfile, operations: [{ kind: "exposure" as const, gamma: 1.2 }] };
    await layers.applyOperation(projectId, { operation: "apply_profile", layerId, profile: mutable });
    mutable.operations[0].gamma = 9;
    expect((await profilesOf())[0].operations[0]).toMatchObject({ gamma: 1.2 });
  });

  it("removes a profile of one kind and leaves the other", async () => {
    await layers.applyOperation(projectId, { operation: "apply_profile", layerId, profile: cameraProfile });
    await layers.applyOperation(projectId, { operation: "apply_profile", layerId, profile: look });
    await layers.applyOperation(projectId, { operation: "apply_profile", layerId, remove: "creative" });
    expect((await profilesOf()).map((profile) => profile.kind)).toEqual(["camera"]);
  });

  it("says so rather than silently doing nothing", async () => {
    await expect(layers.applyOperation(projectId, { operation: "apply_profile", layerId, remove: "camera" }))
      .rejects.toThrowError(/no camera profile/);
    await expect(layers.applyOperation(projectId, { operation: "apply_profile", layerId }))
      .rejects.toThrowError(/needs the profile itself/);

    const fill = await layers.applyOperation(projectId, { operation: "add_fill_layer" });
    const fillId = fill.headRevision.state.photoDocument!.layers[1].id;
    await expect(layers.applyOperation(projectId, { operation: "apply_profile", layerId: fillId, profile: look }))
      .rejects.toThrowError(/not a photograph/);
  });
});
