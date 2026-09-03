import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EstroDatabase } from "../data/estro-database";
import { ProjectRepository } from "../data/project-repository";
import { AssetService, createMemorySourceStore } from "./asset-service";
import { JobService } from "./job-service";
import { LayerService } from "./layer-service";
import { PackageService, revisionChain } from "./package-service";
import { ProjectService } from "./project-service";

/**
 * `SH-006`, `SH-008`, `SH-009`. There is no server, so a package *is* the sync mechanism. What
 * this owes the person in exchange for that weaker promise is complete honesty about what a
 * package contains, what it costs, and what opening one will do to the project already here.
 */
describe("PackageService", () => {
  let database: EstroDatabase;
  let projects: ProjectService;
  let assets: AssetService;
  let layers: LayerService;
  let packages: PackageService;
  let projectId: string;

  const imageFile = (name: string) => {
    const file = new File([new Uint8Array(2048)], name, { type: "image/jpeg" });
    Object.defineProperty(file, "size", { value: 2048 });
    return file;
  };

  const importAsset = async (name: string) => {
    const file = imageFile(name);
    const handle = {
      kind: "file", name, getFile: async () => file, queryPermission: async () => "granted",
    } as unknown as FileSystemFileHandle;
    const outcome = await assets.registerOne(projectId, { file, handle });
    return outcome.assetId!;
  };

  beforeEach(async () => {
    database = new EstroDatabase(`estro-package-${crypto.randomUUID()}`);
    projects = new ProjectService(new ProjectRepository(database));
    const jobs = new JobService(database);
    assets = new AssetService(database, projects, jobs, {
      probeDeps: { decodeSize: async () => ({ width: 800, height: 600 }), hash: async () => "hash-ffffffff" },
      sourceStore: createMemorySourceStore(),
    });
    layers = new LayerService(projects);
    packages = new PackageService(projects, assets);

    const project = await projects.createProject({ name: `Doc ${crypto.randomUUID()}`, kind: "photo" });
    projectId = project.id;
    await projects.createPhotoDocument({
      projectId, widthPx: 800, heightPx: 600, resolutionPpi: 72,
      orientation: "landscape", background: { type: "transparent" },
    });
  });

  afterEach(async () => database.delete());

  /** The transactions *are* the history; a separate list could disagree with them. */
  describe("the revision chain", () => {
    it("is oldest first, in the order the edits happened", () => {
      expect(revisionChain([
        { sequence: 2, resultingRevisionId: "b" },
        { sequence: 1, resultingRevisionId: "a" },
        { sequence: 3, resultingRevisionId: "c" },
      ])).toEqual(["a", "b", "c"]);
    });

    it("never lists one revision twice, however it was reached", () => {
      expect(revisionChain([
        { sequence: 1, resultingRevisionId: "a" },
        { sequence: 2, resultingRevisionId: "b" },
        { sequence: 3, resultingRevisionId: "a" },
      ])).toEqual(["a", "b"]);
    });
  });

  /** "Everything" on a documentary is hundreds of gigabytes; finding out during the write is late. */
  describe("costing a package before writing it", () => {
    it("says what it will contain and how large it will be", async () => {
      const assetId = await importAsset("shot.jpg");
      await layers.applyOperation(projectId, { operation: "add_image", assetId });

      const estimate = await packages.estimate({ projectId, writtenBy: "Studio Mac" });
      expect(estimate.manifest.media).toHaveLength(1);
      expect(estimate.byteSize).toBe(2048);
      expect(estimate.summary).toContain("Studio Mac");
    });

    it("leaves out media nothing uses when asked only for what is used", async () => {
      const used = await importAsset("used.jpg");
      await importAsset("spare.jpg");
      await layers.applyOperation(projectId, { operation: "add_image", assetId: used });

      const estimate = await packages.estimate({ projectId, mediaPolicy: "used_only" });
      expect(estimate.manifest.media.filter((entry) => entry.included)).toHaveLength(1);
      expect(estimate.byteSize).toBe(2048);
    });

    it("includes everything registered when asked to", async () => {
      await importAsset("one.jpg");
      await importAsset("two.jpg");
      const estimate = await packages.estimate({ projectId, mediaPolicy: "everything" });
      expect(estimate.manifest.media.filter((entry) => entry.included)).toHaveLength(2);
    });

    /** A package that opened elsewhere looking complete and missing a shot is the failure. */
    it("still lists media it cannot include, and says why", async () => {
      await importAsset("one.jpg");
      const estimate = await packages.estimate({ projectId, mediaPolicy: "none" });
      expect(estimate.manifest.media).toHaveLength(1);
      expect(estimate.manifest.media[0].included).toBe(false);
      expect(estimate.summary).toContain("have to already be on the machine that opens it");
    });
  });

  describe("writing one", () => {
    it("carries the whole history, not just where the project is now", async () => {
      const assetId = await importAsset("shot.jpg");
      await layers.applyOperation(projectId, { operation: "add_image", assetId });

      const written = await packages.write({ projectId, writtenBy: "Laptop" });
      const parsed = JSON.parse(written.project) as { transactions: unknown[]; headRevision: unknown };
      expect(parsed.transactions.length).toBeGreaterThan(1);
      expect(parsed.headRevision).toBeTruthy();
      expect(written.media.size).toBe(1);
    });

    it("records that the project has been written out, so unshared work can be counted", async () => {
      await importAsset("shot.jpg");
      expect((await packages.offlineState(projectId)).shared).toBe(false);
      await packages.write({ projectId });
      expect((await packages.offlineState(projectId)).shared).toBe(true);
    });
  });

  /**
   * The whole point is that a person sees the relationship — behind, ahead, diverged,
   * unrelated — before deciding anything, because those four need different things offered.
   */
  describe("reading one back", () => {
    it("says nothing has to be decided when both are at the same point", async () => {
      await importAsset("shot.jpg");
      const written = await packages.write({ projectId });
      const inspected = await packages.inspect(written.project);
      expect(inspected.comparison?.relation).toBe("same");
      expect(inspected.knownHere).toBe(true);
    });

    it("knows when this copy has moved on since the package was written", async () => {
      await importAsset("shot.jpg");
      const written = await packages.write({ projectId });
      await projects.renameProject({ projectId, name: "Changed here" });

      const inspected = await packages.inspect(written.project);
      expect(inspected.comparison?.relation).toBe("local_ahead");
      expect(inspected.summary).toContain("nothing to take");
    });

    it("says a project it has never seen is added rather than changing anything", async () => {
      await importAsset("shot.jpg");
      const written = await packages.write({ projectId });
      await projects.deleteProject(projectId);

      const inspected = await packages.inspect(written.project);
      expect(inspected.knownHere).toBe(false);
      expect(inspected.summary).toContain("adds it rather than changing anything");
    });

    it("refuses a file that is not a package, without guessing at it", async () => {
      await expect(packages.inspect("this is not JSON")).rejects.toThrowError(/not a readable Estro package/);
      await expect(packages.inspect('{"manifest":{"nope":true}}')).rejects.toThrowError();
    });
  });

  /** "Take the package" sounds harmless until it means an afternoon's work is not the open project. */
  describe("saying what opening one will do", () => {
    it("warns about work made here before it stops being the open project", async () => {
      await importAsset("shot.jpg");
      const written = await packages.write({ projectId });
      // Both ends move on from the same point.
      await projects.renameProject({ projectId, name: "Changed here" });

      const inspected = await packages.inspect(written.project);
      expect(inspected.comparison?.relation).toBe("local_ahead");

      const plan = await packages.planOpen(written.project, "keep_local");
      expect(plan.outcome).toContain("kept unchanged");
    });

    it("says nothing existing is touched for a project not on this machine", async () => {
      await importAsset("shot.jpg");
      const written = await packages.write({ projectId });
      await projects.deleteProject(projectId);
      const plan = await packages.planOpen(written.project, "take_incoming");
      expect(plan.warnings).toEqual([]);
      expect(plan.outcome).toContain("nothing existing is touched");
    });
  });

  /** "Is my work anywhere but here" is a different question from "did it save". */
  describe("what is only on this machine", () => {
    it("counts the edits made since the last package", async () => {
      await importAsset("shot.jpg");
      await packages.write({ projectId });
      await projects.renameProject({ projectId, name: "After" });
      await projects.renameProject({ projectId, name: "After again" });

      const state = await packages.offlineState(projectId);
      expect(state.shared).toBe(false);
      expect(state.unsharedEdits).toBe(2);
      expect(state.summary).toContain("only on this machine");
    });

    it("can be told a project was shared elsewhere", async () => {
      await importAsset("shot.jpg");
      const history = await projects.getProjectHistory(projectId);
      packages.markShared(projectId, history.headRevision.id);
      expect((await packages.offlineState(projectId)).shared).toBe(true);
    });
  });
});
