import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EstroDatabase } from "../data/estro-database";
import { ProjectRepository } from "../data/project-repository";
import { createLayerAdapter } from "./attribute-adapters";
import { AssetService, createMemorySourceStore } from "./asset-service";
import { JobService } from "./job-service";
import { LayerService } from "./layer-service";
import { PresetService } from "./preset-service";
import { ProjectService } from "./project-service";

/**
 * `PH-049`. `applyBundle` applies to many objects within one project, because it commits one
 * before/after state and a project is what that state belongs to. Synchronising across
 * photographs therefore has to be many transactions, and this is honest about that.
 */
describe("PresetService — matching photographs across projects", () => {
  let database: EstroDatabase;
  let projects: ProjectService;
  let assets: AssetService;
  let layers: LayerService;
  let presets: PresetService;

  const photograph = async (name: string) => {
    const project = await projects.createProject({ name: `${name} ${crypto.randomUUID()}`, kind: "photo" });
    await projects.createPhotoDocument({
      projectId: project.id, widthPx: 400, heightPx: 300, resolutionPpi: 72,
      orientation: "landscape", background: { type: "transparent" },
    });
    const file = new File([new Uint8Array(4)], `${name}.jpg`, { type: "image/jpeg" });
    Object.defineProperty(file, "size", { value: 4096 });
    const handle = { kind: "file", name: `${name}.jpg`, getFile: async () => file, queryPermission: async () => "granted" } as unknown as FileSystemFileHandle;
    const outcome = await assets.registerOne(project.id, { file, handle });
    const added = await layers.applyOperation(project.id, { operation: "add_image", assetId: outcome.assetId! });
    return { projectId: project.id, layerId: added.headRevision.state.photoDocument!.layers[0].id };
  };

  beforeEach(() => {
    database = new EstroDatabase(`estro-sync-${crypto.randomUUID()}`);
    projects = new ProjectService(new ProjectRepository(database));
    const jobs = new JobService(database);
    assets = new AssetService(database, projects, jobs, {
      probeDeps: { decodeSize: async () => ({ width: 400, height: 300 }), hash: async () => "hash-eeeeeeee" },
      sourceStore: createMemorySourceStore(),
    });
    layers = new LayerService(projects);
    presets = new PresetService(database, projects);
    presets.registerAdapter(createLayerAdapter(projects));
  });

  afterEach(async () => database.delete());

  it("plans without writing anything", async () => {
    const source = await photograph("Source");
    const target = await photograph("Target");
    await layers.applyOperation(source.projectId, { operation: "set_opacity", layerId: source.layerId, opacity: 0.4 });

    const before = (await projects.getProjectHistory(target.projectId)).headRevision.id;
    const result = await presets.syncAcrossProjects({
      sourceProjectId: source.projectId, sourceLayerId: source.layerId,
      targets: [{ projectId: target.projectId, layerId: target.layerId }],
      dryRun: true,
    });
    expect(result.applied).toEqual([]);
    expect(result.summary).toContain("would be brought into line");
    expect((await projects.getProjectHistory(target.projectId)).headRevision.id).toBe(before);
  });

  it("brings other photographs into line, one transaction each", async () => {
    const source = await photograph("Source");
    const first = await photograph("First");
    const second = await photograph("Second");
    await layers.applyOperation(source.projectId, { operation: "set_opacity", layerId: source.layerId, opacity: 0.4 });

    const result = await presets.syncAcrossProjects({
      sourceProjectId: source.projectId, sourceLayerId: source.layerId,
      targets: [
        { projectId: first.projectId, layerId: first.layerId },
        { projectId: second.projectId, layerId: second.layerId },
      ],
      attributes: ["opacity"],
    });

    expect(result.applied).toHaveLength(2);
    // Two transactions, not one: each project keeps its own history.
    expect(new Set(result.applied.map((entry) => entry.transactionId)).size).toBe(2);
    expect(result.summary).toContain("its own Undo step");

    for (const target of [first, second]) {
      const layer = (await projects.getProjectHistory(target.projectId)).headRevision.state.photoDocument!.layers[0];
      expect(layer.opacity).toBe(0.4);
    }
  });

  it("copies only the attributes it was asked for", async () => {
    const source = await photograph("Source");
    const target = await photograph("Target");
    await layers.applyOperation(source.projectId, { operation: "set_opacity", layerId: source.layerId, opacity: 0.2 });
    await layers.applyOperation(source.projectId, { operation: "set_visibility", layerId: source.layerId, visible: false });

    await presets.syncAcrossProjects({
      sourceProjectId: source.projectId, sourceLayerId: source.layerId,
      targets: [{ projectId: target.projectId, layerId: target.layerId }],
      attributes: ["opacity"],
    });
    const layer = (await projects.getProjectHistory(target.projectId)).headRevision.state.photoDocument!.layers[0];
    expect(layer.opacity).toBe(0.2);
    expect(layer.visible).toBe(true);
  });

  /** Nobody should be left with half a set synchronised. */
  it("refuses a strict batch before writing anything when one photograph has gone", async () => {
    const source = await photograph("Source");
    const target = await photograph("Target");
    const before = (await projects.getProjectHistory(target.projectId)).headRevision.id;

    await expect(presets.syncAcrossProjects({
      sourceProjectId: source.projectId, sourceLayerId: source.layerId,
      targets: [
        { projectId: target.projectId, layerId: target.layerId },
        { projectId: target.projectId, layerId: "ghost" },
      ],
      policy: "all_or_nothing",
    })).rejects.toThrowError();

    expect((await projects.getProjectHistory(target.projectId)).headRevision.id).toBe(before);
  });

  it("does what it can under best effort, and names what it could not", async () => {
    const source = await photograph("Source");
    const target = await photograph("Target");
    await layers.applyOperation(source.projectId, { operation: "set_opacity", layerId: source.layerId, opacity: 0.7 });

    const result = await presets.syncAcrossProjects({
      sourceProjectId: source.projectId, sourceLayerId: source.layerId,
      targets: [
        { projectId: target.projectId, layerId: target.layerId },
        { projectId: target.projectId, layerId: "ghost" },
      ],
      policy: "best_effort",
    });
    expect(result.applied).toHaveLength(1);
    expect(result.plan.items.find((item) => item.targetId === "ghost")?.reason)
      .toContain("no longer in its project");
  });

  it("says so when the photograph being copied from has gone", async () => {
    const source = await photograph("Source");
    await expect(presets.syncAcrossProjects({
      sourceProjectId: source.projectId, sourceLayerId: "ghost", targets: [],
    })).rejects.toThrowError();
  });
});
