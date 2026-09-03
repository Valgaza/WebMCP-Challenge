import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EstroDatabase } from "../data/estro-database";
import { ProjectRepository } from "../data/project-repository";
import type { ImageProbeDeps } from "../media/image-probe";
import { AssetService, createMemorySourceStore } from "./asset-service";
import { createMemoryDerivedCache } from "../data/derived-cache";
import { createMemorySourceStore as createMemoryOriginalStore } from "../data/source-store";
import type { RasterizeDeps } from "../media/image-derivatives";
import { JobService } from "./job-service";
import { ProjectService } from "./project-service";

function imageFile(name: string, type = "image/jpeg", size = 4096): File {
  const file = new File([new Uint8Array(4)], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

/** A handle stub good enough to exercise availability without a real filesystem. */
function handleFor(file: File, permission: "granted" | "denied" = "granted"): FileSystemFileHandle {
  return {
    kind: "file", name: file.name,
    getFile: async () => { if (permission === "denied") throw new DOMException("denied", "NotAllowedError"); return file; },
    queryPermission: async () => permission,
  } as unknown as FileSystemFileHandle;
}

describe("AssetService", () => {
  let database: EstroDatabase;
  let projects: ProjectService;
  let jobs: JobService;
  let assets: AssetService;
  let probeDeps: ImageProbeDeps;
  let dimensions = { width: 1920, height: 1080 };
  let hashValue = "hash-aaaaaaaa";
  let cache: ReturnType<typeof createMemoryDerivedCache>;
  let originals: ReturnType<typeof createMemoryOriginalStore>;
  let rasterizeDeps: RasterizeDeps;

  beforeEach(() => {
    dimensions = { width: 1920, height: 1080 };
    hashValue = "hash-aaaaaaaa";
    probeDeps = { decodeSize: async () => dimensions, hash: async () => hashValue };
    database = new EstroDatabase(`estro-assets-${crypto.randomUUID()}`);
    projects = new ProjectService(new ProjectRepository(database));
    jobs = new JobService(database);
    cache = createMemoryDerivedCache();
    originals = createMemoryOriginalStore();
    rasterizeDeps = {
      decode: async () => ({ width: 1920, height: 1080, close: () => undefined }) as unknown as ImageBitmap,
      createCanvas: (width, height) => ({
        width, height,
        getContext: () => ({ drawImage: () => undefined }),
        convertToBlob: async ({ type }: { type: string }) => new Blob([new Uint8Array(8)], { type }),
      }) as unknown as OffscreenCanvas,
    };
    assets = new AssetService(database, projects, jobs, {
      probeDeps,
      handleStore: createMemorySourceStore(),
      // Originals live in their own store, so the test proves the separation rather than
      // sharing one bucket with the evictable derivative cache.
      originalStore: originals,
      derivedCache: cache,
      rasterizeDeps,
    });
  });

  afterEach(async () => database.delete());

  async function project() {
    return projects.createProject({ name: `Assets ${crypto.randomUUID()}`, kind: "photo" });
  }

  it("registers an asset as an undoable project mutation", async () => {
    const created = await project();
    const file = imageFile("beach.jpg");
    const outcome = await assets.registerOne(created.id, { file, handle: handleFor(file) });
    expect(outcome.imported).toBe(true);

    const history = await projects.getProjectHistory(created.id);
    expect(history.headRevision.state.assets).toHaveLength(1);
    expect(history.headRevision.state.assets?.[0]).toMatchObject({ name: "beach.jpg", widthPx: 1920, heightPx: 1080 });

    const transaction = history.transactions.at(-1)!;
    expect(transaction.summary).toBe("Added “beach.jpg” (1920 × 1080).");
    expect(transaction.undoable).toBe(true);
    expect(transaction.affectedIds).toContain(outcome.assetId);

    const undone = await projects.undoProject(created.id);
    expect(undone.headRevision.state.assets).toHaveLength(0);
  });

  it("imports many files in one cancellable job and warns without discarding the batch", async () => {
    const created = await project();
    const good = imageFile("a.jpg");
    const bad = imageFile("notes.txt", "text/plain");
    const alsoGood = imageFile("b.png", "image/png");

    const { jobId } = await assets.startImportJob(created.id, [
      { file: good, handle: handleFor(good) },
      { file: bad, handle: handleFor(bad) },
      { file: alsoGood, handle: handleFor(alsoGood) },
    ]);
    const finished = await jobs.waitForJob(jobId);

    expect(finished.status).toBe("complete");
    expect(finished.outputIds).toHaveLength(2);
    expect(finished.warnings).toHaveLength(1);
    expect(finished.warnings[0]).toContain("notes.txt");
    expect(await assets.listAssets(created.id)).toHaveLength(2);
  });

  it("refuses an empty import request", async () => {
    const created = await project();
    await expect(assets.startImportJob(created.id, [])).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("copies the bytes when no durable handle exists so the asset stays usable", async () => {
    const created = await project();
    const file = imageFile("dragged.png", "image/png");
    const outcome = await assets.registerOne(created.id, { file, handle: null });

    const stored = await assets.getAsset(outcome.assetId!);
    expect(stored.locator).toMatchObject({ locatorType: "opfs-copy", fileName: "dragged.png" });
    expect(stored.availability).toBe("available");

    // The original is readable without a handle, which is what makes rendering work.
    await expect(assets.readAssetFile(outcome.assetId!)).resolves.toBeInstanceOf(File);
    expect(await assets.refreshAvailability(created.id)).toHaveLength(0);
  });

  it("reports missing when the stored copy is gone from private storage", async () => {
    const created = await project();
    const file = imageFile("dragged.png", "image/png");
    const outcome = await assets.registerOne(created.id, { file, handle: null });
    const stored = await assets.getAsset(outcome.assetId!);

    await originals.remove((stored.locator as { sourceKey: string }).sourceKey);
    const updated = await assets.refreshAvailability(created.id);
    expect(updated[0]).toMatchObject({ availability: "missing" });
    expect(updated[0].availabilityReason).toContain("private storage");
  });

  it("separates a permission problem from a missing file", async () => {
    const created = await project();
    const file = imageFile("locked.jpg");
    await assets.registerOne(created.id, { file, handle: handleFor(file, "denied") });

    const updated = await assets.refreshAvailability(created.id);
    expect(updated[0].availability).toBe("permission_required");
  });

  it("relinks a source while preserving the logical asset identity and reporting losses", async () => {
    const created = await project();
    const original = imageFile("beach.jpg");
    const outcome = await assets.registerOne(created.id, { file: original, handle: handleFor(original) });
    const assetId = outcome.assetId!;

    dimensions = { width: 1280, height: 720 };
    hashValue = "hash-bbbbbbbb";
    const replacement = imageFile("beach-v2.png", "image/png");
    const { result, losses } = await assets.relinkAsset(assetId, { file: replacement, handle: handleFor(replacement) });

    // Identity survives, which is the whole point: edits keep pointing at the same asset.
    const stored = await assets.getAsset(assetId);
    expect(stored.id).toBe(assetId);
    expect(stored.reference.id).toBe(assetId);
    expect(stored.reference).toMatchObject({ name: "beach-v2.png", mediaType: "image/png", widthPx: 1280 });
    expect(stored.availability).toBe("available");
    // The old thumbnail belonged to source revision 1 and is gone; a fresh one is generated
    // from the new bytes rather than leaving the library showing the previous image.
    expect(stored.reference.sourceRevision).toBe(2);
    expect(stored.derivatives.every((entry) => entry.sourceRevision === 2)).toBe(true);
    expect(stored.thumbnailCacheKey).toContain("r2");

    expect(losses.length).toBeGreaterThan(0);
    expect(result.transaction.warnings).toEqual(losses);
    expect(result.transaction.summary).toContain("Existing edits were preserved");

    const state = (await projects.getProjectHistory(created.id)).headRevision.state;
    expect(state.assets).toHaveLength(1);
    expect(state.assets?.[0].id).toBe(assetId);
  });

  it("undoes a replacement back to the original media", async () => {
    const created = await project();
    const original = imageFile("beach.jpg");
    const assetId = (await assets.registerOne(created.id, { file: original, handle: handleFor(original) })).assetId!;

    dimensions = { width: 800, height: 800 };
    hashValue = "hash-cccccccc";
    await assets.relinkAsset(assetId, { file: imageFile("square.png", "image/png"), handle: handleFor(imageFile("square.png", "image/png")) });

    const undone = await projects.undoProject(created.id);
    expect(undone.headRevision.state.assets?.[0]).toMatchObject({ name: "beach.jpg", widthPx: 1920, mediaType: "image/jpeg" });
  });

  it("removes an asset and restores it on undo", async () => {
    const created = await project();
    const file = imageFile("temp.jpg");
    const assetId = (await assets.registerOne(created.id, { file, handle: handleFor(file) })).assetId!;

    await assets.removeAsset(assetId);
    expect(await assets.listAssets(created.id)).toHaveLength(0);

    const undone = await projects.undoProject(created.id);
    expect(undone.headRevision.state.assets).toHaveLength(1);
    // Undo must restore a usable asset, not a reference with no readable source, so the
    // library shows it again and its derived data survives.
    const restored = await assets.listAssets(created.id);
    expect(restored).toHaveLength(1);
    expect(restored[0].id).toBe(assetId);
    await expect(assets.readAssetFile(assetId)).resolves.toBeInstanceOf(File);
  });

  it("hides a removed asset from the library without destroying its runtime record", async () => {
    const created = await project();
    const file = imageFile("temp.jpg");
    const assetId = (await assets.registerOne(created.id, { file, handle: handleFor(file) })).assetId!;

    await assets.removeAsset(assetId);
    expect(await assets.listAssets(created.id)).toHaveLength(0);
    // The record is retained on purpose; membership is decided by project history.
    await expect(assets.getAsset(assetId)).resolves.toMatchObject({ id: assetId });
  });

  it("searches and tags without touching project history", async () => {
    const created = await project();
    for (const [name, type] of [["beach.jpg", "image/jpeg"], ["logo.png", "image/png"]] as const) {
      const file = imageFile(name, type);
      await assets.registerOne(created.id, { file, handle: handleFor(file) });
    }
    const before = (await projects.getProjectHistory(created.id)).headRevision.id;

    expect(await assets.listAssets(created.id, { query: "logo" })).toHaveLength(1);
    expect(await assets.listAssets(created.id, { mediaTypes: ["image/jpeg"] })).toHaveLength(1);

    const [first] = await assets.listAssets(created.id, { query: "beach" });
    const tagged = await assets.updateTags(first.id, ["summer", "summer", " holiday "]);
    expect(tagged.tags).toEqual(["summer", "holiday"]);
    expect(await assets.listAssets(created.id, { query: "holiday" })).toHaveLength(1);

    expect((await projects.getProjectHistory(created.id)).headRevision.id).toBe(before);
  });

  it("builds a thumbnail as a job and records its cache key", async () => {
    const created = await project();
    const file = imageFile("beach.jpg");
    const assetId = (await assets.registerOne(created.id, { file, handle: handleFor(file) })).assetId!;
    const before = (await projects.getProjectHistory(created.id)).headRevision.id;

    const { jobId } = await assets.startThumbnailJob(assetId);
    const finished = await jobs.waitForJob(jobId);

    expect(finished.status).toBe("complete");
    // A thumbnail is a derivative, not a delivery, so it is reported as one.
    expect(finished.derivativeIds).toHaveLength(1);
    expect(finished.outputIds).toHaveLength(0);
    expect((await assets.getAsset(assetId)).thumbnailCacheKey).toBe(finished.derivativeIds[0]);
    await expect(assets.readDerived(finished.derivativeIds[0])).resolves.toBeInstanceOf(Blob);
    // Derived data is cache, never an edit.
    expect((await projects.getProjectHistory(created.id)).headRevision.id).toBe(before);
  });

  /**
   * A still image has no duration to preserve, so what it gets is a poster: one downscaled
   * picture. Calling that a video proxy was the defect — it could not be scrubbed and had no
   * timing, so nothing that actually needed a proxy could use it. Timed media takes the
   * separate path that encodes a real reduced copy at the source duration.
   */
  it("builds a poster for a still image at a bounded quality and refuses one at full quality", async () => {
    const created = await project();
    const file = imageFile("beach.jpg");
    const assetId = (await assets.registerOne(created.id, { file, handle: handleFor(file) })).assetId!;

    const { jobId } = await assets.startProxyJob(assetId, "draft");
    const finished = await jobs.waitForJob(jobId);
    expect(finished.status).toBe("complete");

    const record = await assets.getAsset(assetId);
    const derivative = record.derivatives.find((entry) => entry.key === finished.derivativeIds[0])!;
    expect(derivative.kind).toBe("thumbnail");
    expect(derivative.settings).toContain("edge=");
    expect(derivative.settings).not.toContain("timed=true");
    // A still image is never given a video proxy key it could not honour.
    expect(record.proxyCacheKey).toBeNull();
    await expect(assets.readDerived(finished.derivativeIds[0])).resolves.toBeInstanceOf(Blob);

    await expect(assets.startProxyJob(assetId, "full")).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("fails the derivative job, not the asset, when the source cannot be read", async () => {
    const created = await project();
    const file = imageFile("dragged.png", "image/png");
    const assetId = (await assets.registerOne(created.id, { file, handle: null })).assetId!;

    const stored = await assets.getAsset(assetId);
    await originals.remove((stored.locator as { sourceKey: string }).sourceKey);

    const { jobId } = await assets.startThumbnailJob(assetId);
    const finished = await jobs.waitForJob(jobId);

    expect(finished).toMatchObject({ status: "failed", failureCode: "ASSET_SOURCE_UNAVAILABLE" });
    // The asset itself survives so it can be relinked, and the thumbnail the import already
    // built is left alone: a failed re-derivation is not a reason to throw away a preview
    // that is still perfectly good.
    await expect(assets.getAsset(assetId)).resolves.toMatchObject({
      id: assetId,
      thumbnailCacheKey: (await assets.getAsset(assetId)).thumbnailCacheKey,
    });
    expect((await assets.getAsset(assetId)).thumbnailCacheKey).not.toBeNull();
  });

  it("builds thumbnails during import so files without a durable handle still preview", async () => {
    const created = await project();
    const file = imageFile("dropped.png", "image/png");

    // No handle: the file input and drag-and-drop fallbacks provide none.
    const { jobId } = await assets.startImportJob(created.id, [{ file, handle: null }]);
    const finished = await jobs.waitForJob(jobId);

    expect(finished.status).toBe("complete");
    const [asset] = await assets.listAssets(created.id);
    expect(asset.thumbnailCacheKey).not.toBeNull();
    await expect(assets.readDerived(asset.thumbnailCacheKey!)).resolves.toBeInstanceOf(Blob);

    // A copied original keeps the asset available rather than stranding it.
    expect(await assets.refreshAvailability(created.id)).toHaveLength(0);
    expect((await assets.listAssets(created.id))[0]).toMatchObject({ availability: "available" });
  });

  function directoryOf(entries: Record<string, File | Record<string, File>>, name = "shoot"): FileSystemDirectoryHandle {
    const values = async function* () {
      for (const [key, value] of Object.entries(entries)) {
        if (value instanceof File) {
          yield { kind: "file", name: key, getFile: async () => value } as unknown as FileSystemHandle;
        } else {
          yield directoryOf(value as Record<string, File>, key) as unknown as FileSystemHandle;
        }
      }
    };
    return { kind: "directory", name, values } as unknown as FileSystemDirectoryHandle;
  }

  it("walks a folder, imports what it can decode, and reports the rest", async () => {
    const created = await project();
    const directory = directoryOf({
      "a.jpg": imageFile("a.jpg"),
      "notes.txt": imageFile("notes.txt", "text/plain"),
      nested: { "b.png": imageFile("b.png", "image/png") },
    });

    const { jobId } = await assets.startFolderImportJob(created.id, directory);
    const finished = await jobs.waitForJob(jobId);

    expect(finished.status).toBe("complete");
    expect(finished.outputIds).toHaveLength(2);
    expect(finished.warnings.join(" ")).toContain("notes.txt");
    expect(await assets.listAssets(created.id)).toHaveLength(2);
  });

  it("warns rather than failing when a folder holds nothing readable", async () => {
    const created = await project();
    const { jobId } = await assets.startFolderImportJob(created.id, directoryOf({}));
    const finished = await jobs.waitForJob(jobId);
    expect(finished.status).toBe("complete");
    expect(finished.warnings[0]).toContain("No readable files");
  });

  it("returns a preview with the revision it was taken from and reuses the cache", async () => {
    const created = await project();
    const file = imageFile("beach.jpg");
    const assetId = (await assets.registerOne(created.id, { file, handle: handleFor(file) })).assetId!;
    const revisionId = (await projects.getProjectHistory(created.id)).headRevision.id;

    const first = await assets.renderPreview(assetId, "draft");
    expect(first).toMatchObject({ revisionId, width: 640, height: 360 });

    // A second call is served from cache rather than decoding again.
    const second = await assets.renderPreview(assetId, "draft");
    expect(second.key).toBe(first.key);
  });

  it("keeps an original out of the evictable derivative cache", async () => {
    const created = await project();
    const file = imageFile("keeper.png", "image/png");
    const assetId = (await assets.registerOne(created.id, { file, handle: null })).assetId!;
    const stored = await assets.getAsset(assetId);

    // The original has its own key in its own store; nothing about it lives in the cache.
    const cacheKeys = (await cache.list()).map((entry) => entry.key);
    const sourceKey = (stored.locator as { sourceKey: string }).sourceKey;
    expect(cacheKeys).not.toContain(sourceKey);
    expect((await originals.list(created.id)).map((entry) => entry.key)).toContain(sourceKey);

    // Emptying the whole derivative cache leaves the original readable.
    for (const key of cacheKeys) await cache.remove(key);
    await expect(assets.readAssetFile(assetId)).resolves.toBeInstanceOf(File);
  });

  it("invalidates only the derivatives of a superseded source revision on relink", async () => {
    const created = await project();
    const file = imageFile("first.png", "image/png");
    const assetId = (await assets.registerOne(created.id, { file, handle: null })).assetId!;
    const before = await assets.getAsset(assetId);
    expect(before.reference.sourceRevision).toBe(1);

    dimensions = { width: 800, height: 600 };
    hashValue = "hash-bbbbbbbb";
    const outcome = await assets.relinkAsset(assetId, { file: imageFile("second.png", "image/png"), handle: null });

    const after = await assets.getAsset(assetId);
    expect(after.id).toBe(assetId);
    expect(after.reference.sourceRevision).toBe(2);
    expect(outcome.losses.join(" ")).toContain("Dimensions change");
    // Every derivative still recorded belongs to the current source revision.
    expect(after.derivatives.every((entry) => entry.sourceRevision === 2)).toBe(true);
  });
});

/**
 * The source lifecycle is where a bug destroys work rather than merely inconveniencing it,
 * so each of these injects a failure at one boundary and asserts the two things that must
 * always hold: no committed revision claims an asset is available when it is not, and no
 * failure destroys the last readable copy of a file.
 */
describe("AssetService source lifecycle", () => {
  let database: EstroDatabase;
  let projects: ProjectService;
  let jobs: JobService;
  let assets: AssetService;
  let cache: ReturnType<typeof createMemoryDerivedCache>;
  let originals: ReturnType<typeof createMemoryOriginalStore>;

  const probeDeps: ImageProbeDeps = {
    decodeSize: async () => ({ width: 640, height: 480 }),
    hash: async () => "hash-bbbbbbbb",
  };

  function build() {
    database = new EstroDatabase(`estro-lifecycle-${crypto.randomUUID()}`);
    projects = new ProjectService(new ProjectRepository(database));
    jobs = new JobService(database);
    cache = createMemoryDerivedCache();
    originals = createMemoryOriginalStore();
    assets = new AssetService(database, projects, jobs, {
      probeDeps, handleStore: createMemorySourceStore(),
      originalStore: originals, derivedCache: cache,
    });
  }

  beforeEach(build);
  afterEach(async () => database.delete());

  const file = (name: string, bytes = 2048) => {
    const created = new File([new Uint8Array(4)], name, { type: "image/jpeg" });
    Object.defineProperty(created, "size", { value: bytes });
    return created;
  };

  it("leaves no project reference and no stored bytes when the original cannot be read back", async () => {
    const created = await projects.createProject({ name: "Import failure", kind: "photo" });
    // The write reports success but the read-back does not, which is exactly the case a
    // storage layer must never let through as an available asset.
    originals.verify = async () => ({ ok: false, byteSize: 0 });

    await expect(assets.registerOne(created.id, { file: file("broken.jpg") }))
      .rejects.toMatchObject({ code: "STORAGE_WRITE_FAILED" });

    const history = await projects.getProjectHistory(created.id);
    expect(history.headRevision.state.assets ?? []).toHaveLength(0);
    expect(await database.sourceIndex.count()).toBe(0);
    expect(await database.sourceIntents.count()).toBe(0);
    expect(await originals.totalBytes()).toBe(0);
  });

  it("finishes an import whose runtime record was interrupted after the revision committed", async () => {
    const created = await projects.createProject({ name: "Interrupted import", kind: "photo" });
    const source = file("halfway.jpg");

    // Fail the runtime write, the way a tab closing between the two stores would.
    const put = database.assetRecords.put.bind(database.assetRecords);
    database.assetRecords.put = (() => Promise.reject(new Error("closed"))) as unknown as typeof database.assetRecords.put;
    await expect(assets.registerOne(created.id, { file: source })).rejects.toBeTruthy();
    database.assetRecords.put = put;

    // History kept the import — undoing it silently would rewrite what the user did — and
    // the intent is still there describing the work left to finish.
    const history = await projects.getProjectHistory(created.id);
    expect(history.headRevision.state.assets ?? []).toHaveLength(1);
    const intents = await database.sourceIntents.toArray();
    expect(intents).toHaveLength(1);
    expect(intents[0].state).toBe("projectCommitted");
    // Until it is finished the library shows nothing, rather than an entry claiming to work.
    expect(await assets.listAssets(created.id)).toHaveLength(0);

    // A reload finishes it, and the asset comes back available with its bytes intact.
    const reopened = new AssetService(database, projects, jobs, {
      probeDeps, handleStore: createMemorySourceStore(), originalStore: originals, derivedCache: cache,
    });
    const recovery = await reopened.hydrate();
    expect(recovery.finishedImports).toBe(1);
    expect(await database.sourceIntents.count()).toBe(0);

    const listed = await reopened.listAssets(created.id);
    expect(listed).toHaveLength(1);
    expect(listed[0].availability).toBe("available");
    expect(listed[0].locator.locatorType).toBe("opfs-copy");
    expect(await reopened.readAssetFile(listed[0].id)).toBeTruthy();
  });

  it("discards an interrupted import that never reached a project commit", async () => {
    const created = await projects.createProject({ name: "Abandoned import", kind: "photo" });
    // A crash between staging and the revision commit leaves a prepared intent behind.
    await originals.stage({
      key: "src_orphan_r1", assetId: "orphan", projectId: created.id,
      blob: new Blob([new Uint8Array(8)]), mediaType: "image/jpeg", sourceRevision: 1,
    });
    await database.sourceIndex.put({
      key: "src_orphan_r1", assetId: "orphan", projectId: created.id, projectIds: [created.id],
      byteSize: 8, mediaType: "image/jpeg", state: "staging", createdAt: Date.now(), sourceRevision: 1,
    });
    await database.sourceIntents.put({
      id: "intent_import_orphan", kind: "import", assetId: "orphan", projectId: created.id,
      stagedKey: "src_orphan_r1", previousKey: null, hadHandle: false, state: "prepared",
      createdAt: Date.now(),
      record: (await database.assetRecords.toArray())[0] ?? ({} as never),
    });

    const reopened = new AssetService(database, projects, jobs, {
      probeDeps, handleStore: createMemorySourceStore(), originalStore: originals, derivedCache: cache,
    });
    const recovery = await reopened.hydrate();
    expect(recovery.rolledBackImports).toBe(1);
    expect(await database.sourceIndex.count()).toBe(0);
    expect(await originals.read("src_orphan_r1")).toBeNull();
    expect((await projects.getProjectHistory(created.id)).headRevision.state.assets ?? []).toHaveLength(0);
  });

  it("keeps the previous source usable when a relink fails after staging", async () => {
    const created = await projects.createProject({ name: "Relink failure", kind: "photo" });
    const outcome = await assets.registerOne(created.id, { file: file("original.jpg") });
    const record = await assets.getAsset(outcome.assetId!);
    const originalKey = record.locator.locatorType === "opfs-copy" ? record.locator.sourceKey : "";
    expect(await originals.read(originalKey)).toBeTruthy();

    // The replacement stages, then the revision refuses to commit.
    const replace = projects.replaceAssetSource.bind(projects);
    projects.replaceAssetSource = (async () => { throw new Error("conflict"); }) as typeof projects.replaceAssetSource;
    await expect(assets.relinkAsset(outcome.assetId!, { file: file("replacement.jpg", 4096) })).rejects.toBeTruthy();
    projects.replaceAssetSource = replace;

    // The old bytes survive, the new staged bytes are gone, and the asset still resolves.
    expect(await originals.read(originalKey)).toBeTruthy();
    expect(await originals.read("src_" + outcome.assetId!.replace(/[^a-z0-9_-]/gi, "").slice(0, 64) + "_r2")).toBeNull();
    const after = await assets.getAsset(outcome.assetId!);
    expect(after.reference.sourceRevision).toBe(1);
    expect(after.availability).toBe("available");
    expect(await database.sourceIntents.count()).toBe(0);
  });

  it("releases the superseded source only once the new record is durable", async () => {
    const created = await projects.createProject({ name: "Relink success", kind: "photo" });
    const outcome = await assets.registerOne(created.id, { file: file("v1.jpg") });
    const before = await assets.getAsset(outcome.assetId!);
    const oldKey = before.locator.locatorType === "opfs-copy" ? before.locator.sourceKey : "";

    await assets.relinkAsset(outcome.assetId!, { file: file("v2.jpg", 8192) });

    const after = await assets.getAsset(outcome.assetId!);
    expect(after.reference.sourceRevision).toBe(2);
    expect(after.locator.locatorType).toBe("opfs-copy");
    // The old copy is released only after the replacement is committed and written.
    expect(await originals.read(oldKey)).toBeNull();
    expect(await database.sourceIndex.get(oldKey)).toBeUndefined();
    expect(await assets.readAssetFile(outcome.assetId!)).toBeTruthy();
  });

  it("restores the earlier media state when an import is undone and redone", async () => {
    const created = await projects.createProject({ name: "Undo import", kind: "photo" });
    const outcome = await assets.registerOne(created.id, { file: file("undoable.jpg") });
    expect(await assets.listAssets(created.id)).toHaveLength(1);

    await projects.undoProject(created.id);
    expect(await assets.listAssets(created.id)).toHaveLength(0);
    // Undo must never destroy bytes: Redo has to be able to bring the asset back.
    expect(await originals.totalBytes()).toBeGreaterThan(0);

    await projects.redoProject(created.id);
    const restored = await assets.listAssets(created.id);
    expect(restored).toHaveLength(1);
    expect(restored[0].availability).toBe("available");
    expect(await assets.readAssetFile(outcome.assetId!)).toBeTruthy();
  });

  it("rebuilds a runtime record that history references but this browser has lost", async () => {
    const created = await projects.createProject({ name: "Reconcile", kind: "photo" });
    const outcome = await assets.registerOne(created.id, { file: file("orphaned.jpg") });
    await database.assetRecords.delete([created.id, outcome.assetId!] as unknown as string);
    expect(await assets.listAssets(created.id)).toHaveLength(0);

    const result = await assets.reconcile(created.id);
    expect(result.repaired).toEqual([outcome.assetId]);
    const listed = await assets.listAssets(created.id);
    expect(listed).toHaveLength(1);
    expect(listed[0].availability).toBe("available");
  });

  it("gives a duplicated project its own library over the same original bytes", async () => {
    const created = await projects.createProject({ name: "Original project", kind: "video" });
    const outcome = await assets.registerOne(created.id, { file: file("shared.jpg") });
    const bytesBefore = await originals.totalBytes();

    const copy = await projects.duplicateProject(created.id);

    const copied = await assets.listAssets(copy.id);
    expect(copied).toHaveLength(1);
    expect(copied[0].projectId).toBe(copy.id);
    expect(copied[0].availability).toBe("available");
    // The copy must not duplicate the media itself.
    expect(await originals.totalBytes()).toBe(bytesBefore);
    expect(await assets.readAssetFile(copied[0].id)).toBeTruthy();

    // Discarding one copy must not strand the other.
    await assets.releaseProjectSources(copy.id);
    expect(await assets.listAssets(created.id)).toHaveLength(1);
    expect(await assets.readAssetFile(outcome.assetId!)).toBeTruthy();
  });

  it("moves a pre-v9 original into the source store and verifies it before claiming it", async () => {
    const created = await projects.createProject({ name: "Migration", kind: "photo" });
    const outcome = await assets.registerOne(created.id, { file: file("legacy.jpg", 12) });
    const record = await assets.getAsset(outcome.assetId!);

    // Recreate the old layout: bytes in the derived cache, no source-store entry.
    await originals.remove((record.locator as { sourceKey: string }).sourceKey);
    await database.sourceIndex.clear();
    await cache.write({
      key: "legacy-cache-key", kind: "preview", assetId: outcome.assetId!, projectId: created.id,
      sourceRevision: 1, settings: "legacy", blob: new Blob([new Uint8Array(12)], { type: "image/jpeg" }),
      widthPx: 640, heightPx: 480, durationSeconds: null, channels: null,
    });
    await database.assetRecords.put({
      ...record,
      locator: { locatorType: "unavailable", fileName: "legacy.jpg" },
      availability: "missing", availabilityReason: "Being moved.",
    });
    await database.sourceMigrations.put({
      assetId: outcome.assetId!, projectId: created.id, legacyCacheKey: "legacy-cache-key",
      targetKey: `src_${outcome.assetId!.replace(/[^a-z0-9_-]/gi, "").slice(0, 64)}_r1`,
      fileName: "legacy.jpg", mediaType: "image/jpeg", byteSize: 12, sourceRevision: 1,
      state: "pending", reason: null, createdAt: Date.now(),
    });

    const reopened = new AssetService(database, projects, jobs, {
      probeDeps, handleStore: createMemorySourceStore(), originalStore: originals, derivedCache: cache,
    });
    const recovery = await reopened.hydrate();
    expect(recovery.migratedSources).toBe(1);

    const migrated = await reopened.getAsset(outcome.assetId!);
    expect(migrated.availability).toBe("available");
    expect(migrated.locator.locatorType).toBe("opfs-copy");
    expect(await reopened.readAssetFile(outcome.assetId!)).toBeTruthy();

    // Re-running the migration must be a no-op rather than a second copy.
    const again = await new AssetService(database, projects, jobs, {
      probeDeps, handleStore: createMemorySourceStore(), originalStore: originals, derivedCache: cache,
    }).hydrate();
    expect(again.migratedSources).toBe(0);
  });

  it("marks an asset offline when its legacy bytes are already gone", async () => {
    const created = await projects.createProject({ name: "Lost migration", kind: "photo" });
    const outcome = await assets.registerOne(created.id, { file: file("lost.jpg") });
    const record = await assets.getAsset(outcome.assetId!);
    await originals.remove((record.locator as { sourceKey: string }).sourceKey);
    await database.sourceIndex.clear();
    await database.sourceMigrations.put({
      assetId: outcome.assetId!, projectId: created.id, legacyCacheKey: "nothing-here",
      targetKey: "src_lost_r1", fileName: "lost.jpg", mediaType: "image/jpeg", byteSize: 2048,
      sourceRevision: 1, state: "pending", reason: null, createdAt: Date.now(),
    });

    const reopened = new AssetService(database, projects, jobs, {
      probeDeps, handleStore: createMemorySourceStore(), originalStore: originals, derivedCache: cache,
    });
    const recovery = await reopened.hydrate();
    expect(recovery.offlineAfterMigration).toBe(1);

    const migrated = await reopened.getAsset(outcome.assetId!);
    expect(migrated.availability).toBe("missing");
    expect(migrated.availabilityReason).toContain("Relink");
  });
});
