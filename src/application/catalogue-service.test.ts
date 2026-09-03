import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EstroDatabase } from "../data/estro-database";
import { ProjectRepository } from "../data/project-repository";
import { ASSET_SCHEMA_VERSION, type AssetReference } from "../domain/asset";
import { rational } from "../domain/time";
import { CatalogueService } from "./catalogue-service";
import { ProjectService } from "./project-service";

/**
 * `SH-037`. Everything here goes through the project's own command path, so a rating is
 * undoable and travels with a duplicated project — a four-hour session of marking selects is
 * work, and work Undo cannot reach can be lost in a way nothing else in this editor can be.
 */
describe("CatalogueService", () => {
  let database: EstroDatabase;
  let projects: ProjectService;
  let catalogue: CatalogueService;
  let projectId: string;

  const registerAsset = async (id: string, name: string, kind: "video" | "audio" | "image" = "video", durationSeconds: number | null = 60) => {
    const asset: AssetReference = {
      id, schemaVersion: ASSET_SCHEMA_VERSION, name,
      mediaType: kind === "image" ? "image/jpeg" : "video/mp4",
      byteSize: 1024, widthPx: 1920, heightPx: 1080,
      contentHash: `hash-${id}-eeee`, sourceRevision: 1,
      addedAt: "2026-09-03T10:00:00.000Z", kind,
      durationSeconds, frameRate: null, hasAudio: kind !== "image", hasVideo: kind !== "audio",
      streams: {
        container: kind === "image" ? "image/jpeg" : "video/mp4",
        video: { widthPx: 1920, heightPx: 1080, frameRate: null, codec: null },
        audio: { channels: 2, sampleRateHz: 48000, codec: null },
        videoPresence: "present" as const, audioPresence: "present" as const, presenceSource: "container" as const,
      },
    };
    await projects.registerAsset({ projectId, asset });
    return id;
  };

  beforeEach(async () => {
    database = new EstroDatabase(`estro-catalogue-${crypto.randomUUID()}`);
    projects = new ProjectService(new ProjectRepository(database));
    catalogue = new CatalogueService(projects);
    const project = await projects.createProject({ name: `Doc ${crypto.randomUUID()}`, kind: "video" });
    projectId = project.id;
  });

  afterEach(async () => database.delete());

  it("marks an item and reports how it is marked", async () => {
    await registerAsset("a", "Wide shot");
    const result = await catalogue.mark({ projectId, items: [{ itemId: "a" }], rating: 5, favourite: true });
    expect(result.transaction.summary).toBe("rated 5, favourited");
    expect(await catalogue.describe(projectId, "a")).toBe("5 stars, a favourite.");
  });

  /** Fifteen shots rated together should be one press of Undo, not fifteen. */
  it("marks many items as one transaction", async () => {
    await registerAsset("a", "One");
    await registerAsset("b", "Two");
    await registerAsset("c", "Three");
    const result = await catalogue.mark({
      projectId, items: [{ itemId: "a" }, { itemId: "b" }, { itemId: "c" }], rating: 4,
    });
    expect(result.transaction.summary).toBe("rated 4 on 3 items");
    for (const id of ["a", "b", "c"]) {
      expect((await catalogue.entryFor(projectId, id)).rating).toBe(4);
    }
  });

  it("is undoable, like every other kind of work", async () => {
    await registerAsset("a", "Shot");
    const marked = await catalogue.mark({ projectId, items: [{ itemId: "a" }], rating: 5 });
    await projects.undoTransaction(projectId, marked.transaction.id);
    expect((await catalogue.entryFor(projectId, "a")).rating).toBe(0);
  });

  /** Marking fifteen shots "wide" should not strip whatever else each was tagged. */
  it("adds and removes tags rather than replacing them", async () => {
    await registerAsset("a", "Shot");
    await catalogue.mark({ projectId, items: [{ itemId: "a" }], addTags: ["interview", "wide"] });
    await catalogue.mark({ projectId, items: [{ itemId: "a" }], addTags: ["day"], removeTags: ["wide"] });
    expect((await catalogue.entryFor(projectId, "a")).tags).toEqual(["interview", "day"]);
  });

  it("does not add a tag twice, whatever the capitalisation", async () => {
    await registerAsset("a", "Shot");
    await catalogue.mark({ projectId, items: [{ itemId: "a" }], addTags: ["Interview"] });
    await catalogue.mark({ projectId, items: [{ itemId: "a" }], addTags: ["interview"] });
    expect((await catalogue.entryFor(projectId, "a")).tags).toEqual(["Interview"]);
  });

  it("leaves everything it was not asked about alone", async () => {
    await registerAsset("a", "Shot");
    await catalogue.mark({ projectId, items: [{ itemId: "a" }], rating: 3, label: "blue", addTags: ["x"] });
    await catalogue.mark({ projectId, items: [{ itemId: "a" }], favourite: true });
    expect(await catalogue.entryFor(projectId, "a"))
      .toMatchObject({ rating: 3, label: "blue", favourite: true, tags: ["x"] });
  });

  it("can clear a rating and a label rather than only setting them", async () => {
    await registerAsset("a", "Shot");
    await catalogue.mark({ projectId, items: [{ itemId: "a" }], rating: 5, label: "red" });
    const cleared = await catalogue.mark({ projectId, items: [{ itemId: "a" }], rating: 0, label: null });
    expect(cleared.transaction.summary).toContain("cleared the rating");
    expect(await catalogue.entryFor(projectId, "a")).toMatchObject({ rating: 0, label: null });
  });

  it("says so rather than committing a command that marks nothing", async () => {
    await registerAsset("a", "Shot");
    await expect(catalogue.mark({ projectId, items: [{ itemId: "a" }] }))
      .rejects.toThrowError(/marks nothing/);
  });

  /** "Is it used" changes without anyone marking anything, so it is never stored. */
  describe("what the catalogue sees", () => {
    it("reports every asset with its kind, length, and whether anything uses it", async () => {
      await registerAsset("a", "Take", "video", 60);
      await registerAsset("b", "Still", "image", null);
      const subjects = await catalogue.subjects(projectId);
      expect(subjects.map((entry) => entry.name).sort()).toEqual(["Still", "Take"]);
      expect(subjects.find((entry) => entry.itemId === "b")).toMatchObject({ kind: "image", durationSeconds: null });
      expect(subjects.every((entry) => !entry.used)).toBe(true);
    });

  });

  /** A bin says where something is filed; a collection says what is true about it. */
  describe("collections", () => {
    it("saves a question and answers it against what is there now", async () => {
      await registerAsset("a", "Good take");
      await registerAsset("b", "Bad take");
      await catalogue.mark({ projectId, items: [{ itemId: "a" }], rating: 5 });

      const added = await catalogue.manageCollection({
        projectId, name: "Selects", rules: [{ field: "rating", comparison: "at_least", value: 4 }],
      });
      const collectionId = added.headRevision.state.collections![0].id;

      const run = await catalogue.runCollection(projectId, collectionId);
      expect(run.items.map((entry) => entry.itemId)).toEqual(["a"]);
      expect(run.summary).toContain("1 item(s) match right now");
    });

    /** Nothing is moved in, so a shot that stops matching leaves on its own. */
    it("stops holding something the moment it stops matching", async () => {
      await registerAsset("a", "Take");
      await catalogue.mark({ projectId, items: [{ itemId: "a" }], rating: 5 });
      const added = await catalogue.manageCollection({
        projectId, name: "Selects", rules: [{ field: "rating", comparison: "at_least", value: 4 }],
      });
      const collectionId = added.headRevision.state.collections![0].id;
      expect((await catalogue.runCollection(projectId, collectionId)).items).toHaveLength(1);

      await catalogue.mark({ projectId, items: [{ itemId: "a" }], rating: 1 });
      expect((await catalogue.runCollection(projectId, collectionId)).items).toHaveLength(0);
    });

    it("changes and removes a collection", async () => {
      const added = await catalogue.manageCollection({
        projectId, name: "Selects", rules: [{ field: "favourite", value: true }],
      });
      const collectionId = added.headRevision.state.collections![0].id;

      const renamed = await catalogue.manageCollection({ projectId, collectionId, name: "Picks" });
      expect(renamed.headRevision.state.collections![0].name).toBe("Picks");
      // Everything not named is left alone.
      expect(renamed.headRevision.state.collections![0].rules).toHaveLength(1);

      const removed = await catalogue.manageCollection({ projectId, collectionId, remove: true });
      expect(removed.headRevision.state.collections).toEqual([]);
    });

    it("refuses a new collection with no rules, and says why", async () => {
      await expect(catalogue.manageCollection({ projectId, name: "Empty" }))
        .rejects.toThrowError(/a question rather than a place/);
    });

    it("says so rather than acting on a collection that is not there", async () => {
      await expect(catalogue.manageCollection({ projectId, collectionId: "ghost", name: "x" }))
        .rejects.toThrowError(/not in this project/);
      await expect(catalogue.runCollection(projectId, "ghost")).rejects.toThrowError(/not in this project/);
    });

    it("lists collections with how many things each holds now", async () => {
      await registerAsset("a", "Take");
      await catalogue.mark({ projectId, items: [{ itemId: "a" }], favourite: true });
      await catalogue.manageCollection({
        projectId, name: "Favourites", rules: [{ field: "favourite", value: true }],
      });
      const listed = await catalogue.listCollections(projectId);
      expect(listed[0].count).toBe(1);
      expect(listed[0].summary).toContain("a favourite");
    });
  });

  describe("browsing without a collection", () => {
    beforeEach(async () => {
      await registerAsset("a", "Alpha");
      await registerAsset("b", "Beta");
      await catalogue.mark({ projectId, items: [{ itemId: "a" }], rating: 5, addTags: ["wide"] });
      await catalogue.mark({ projectId, items: [{ itemId: "b" }], rating: 2, favourite: true });
    });

    it("filters by rating, favourite, and tag", async () => {
      expect((await catalogue.browse(projectId, { minimumRating: 4 })).items.map((e) => e.itemId)).toEqual(["a"]);
      expect((await catalogue.browse(projectId, { favouritesOnly: true })).items.map((e) => e.itemId)).toEqual(["b"]);
      expect((await catalogue.browse(projectId, { tag: "WIDE" })).items.map((e) => e.itemId)).toEqual(["a"]);
    });

    it("sorts, putting unrated media last when the best is asked for first", async () => {
      await registerAsset("c", "Gamma");
      const sorted = await catalogue.browse(projectId, { sort: { field: "rating", direction: "descending" } });
      expect(sorted.items.map((entry) => entry.itemId)).toEqual(["a", "b", "c"]);
    });
  });
});
