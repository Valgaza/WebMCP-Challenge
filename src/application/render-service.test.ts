import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EstroDatabase } from "../data/estro-database";
import { ProjectRepository } from "../data/project-repository";
import { createMemoryDerivedCache } from "../data/derived-cache";
import { AssetService, createMemorySourceStore } from "./asset-service";
import { JobService } from "./job-service";
import { LayerService } from "./layer-service";
import { ProjectService } from "./project-service";
import { RenderService } from "./render-service";

/*
 * Which revision "before" means.
 *
 * Compositing needs a canvas and jsdom has none, so this covers the half of RenderService that
 * only reads history — which is the half that decides what a person is shown when they press
 * Before, and the half that was wrong.
 */
describe("RenderService comparison baseline", () => {
  let database: EstroDatabase;
  let projects: ProjectService;
  let assets: AssetService;
  let layers: LayerService;
  let render: RenderService;
  let projectId: string;
  let assetId: string;

  beforeEach(async () => {
    database = new EstroDatabase(`estro-render-${crypto.randomUUID()}`);
    projects = new ProjectService(new ProjectRepository(database));
    assets = new AssetService(database, projects, new JobService(database), {
      probeDeps: { decodeSize: async () => ({ width: 400, height: 200 }), hash: async () => "hash-aaaaaaaa" },
      sourceStore: createMemorySourceStore(),
      derivedCache: createMemoryDerivedCache(),
    });
    layers = new LayerService(projects);
    render = new RenderService(projects, assets);

    const project = await projects.createProject({ name: `Render ${crypto.randomUUID()}`, kind: "photo" });
    projectId = project.id;
    /* A solid background, so an empty document is a flat colour rather than nothing at all. */
    await projects.createPhotoDocument({
      projectId, widthPx: 800, heightPx: 600, resolutionPpi: 72, orientation: "landscape",
      background: { type: "solid", color: "#101014" },
    });

    const file = new File([new Uint8Array(4)], "photo.jpg", { type: "image/jpeg" });
    Object.defineProperty(file, "size", { value: 4096 });
    assetId = (await assets.registerOne(projectId, { file })).assetId!;
  });

  afterEach(async () => database.delete());

  async function revisionSummaries() {
    const revisions = await projects.listRevisions(projectId);
    return revisions.map((entry) => ({
      id: entry.id,
      layers: entry.state.photoDocument?.layers.length ?? null,
    }));
  }

  /*
   * The bug this file was written for.
   *
   * "Original import" resolved to the first revision that had a document, which is always the
   * empty canvas created before anything was imported. Pressing Before showed a flat
   * background — a real revision, so nothing looked broken, and the wrong one.
   */
  it("compares against the picture as imported, not the empty canvas before it", async () => {
    await layers.applyOperation(projectId, { operation: "add_image", assetId, fit: "fit" });
    await layers.applyOperation(projectId, { operation: "add_text", content: "Title" });

    const state = await render.comparisonState(projectId, "original_import");
    const summaries = await revisionSummaries();
    const baseline = summaries.find((entry) => entry.id === state.baselineRevisionId);

    expect(state.available).toBe(true);
    expect(baseline?.layers).toBeGreaterThan(0);
    /* Specifically: not the empty one, which is the earliest revision holding a document. */
    const earliestWithDocument = summaries.find((entry) => entry.layers !== null);
    expect(state.baselineRevisionId).not.toBe(earliestWithDocument?.id);
  });

  it("says so rather than pretending when nothing has been imported yet", async () => {
    await layers.applyOperation(projectId, { operation: "add_text", content: "Title only" });

    const state = await render.comparisonState(projectId, "original_import");

    expect(state.reason).toMatch(/nothing has been imported/i);
  });

  it("still compares against the revision before this one when asked to", async () => {
    await layers.applyOperation(projectId, { operation: "add_image", assetId, fit: "fit" });
    await layers.applyOperation(projectId, { operation: "add_text", content: "Title" });

    const revisions = await projects.listRevisions(projectId);
    const state = await render.comparisonState(projectId, "previous_revision");

    expect(state.baselineRevisionId).toBe(revisions[revisions.length - 2].id);
    expect(state.available).toBe(true);
  });

  it("refuses a baseline that is no longer in the history", async () => {
    const state = await render.comparisonState(projectId, "chosen_revision", "not-a-revision");

    expect(state.available).toBe(false);
    expect(state.reason).toMatch(/no longer in this project/i);
  });
});
