import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EstroDatabase } from "../data/estro-database";
import { ProjectRepository } from "../data/project-repository";
import { AssetService, createMemorySourceStore } from "./asset-service";
import { BatchExportService, fileNameFor } from "./batch-export-service";
import { JobService } from "./job-service";
import { OutputService } from "./output-service";
import { createMemoryOutputStore } from "../data/output-store";
import { ProjectService } from "./project-service";
import { RenderService } from "./render-service";

/**
 * `PH-065`. A hundred photographs at three sizes is three hundred encodes, so a batch export
 * runs as a job with progress and a cancel rather than blocking, and everything it needs lives
 * in the job's serializable intent so it survives a reload.
 */
describe("BatchExportService", () => {
  let database: EstroDatabase;
  let projects: ProjectService;
  let jobs: JobService;
  let renders: RenderService;
  let outputs: OutputService;
  let service: BatchExportService;
  let encoded: string[];

  const photoProject = async (name: string) => {
    const project = await projects.createProject({ name: `${name} ${crypto.randomUUID()}`, kind: "photo" });
    await projects.createPhotoDocument({
      projectId: project.id, widthPx: 200, heightPx: 100, resolutionPpi: 72,
      orientation: "landscape", background: { type: "transparent" },
    });
    return project.id;
  };

  beforeEach(() => {
    database = new EstroDatabase(`estro-batch-export-${crypto.randomUUID()}`);
    projects = new ProjectService(new ProjectRepository(database));
    jobs = new JobService(database);
    const assets = new AssetService(database, projects, jobs, {
      probeDeps: { decodeSize: async () => ({ width: 200, height: 100 }), hash: async () => "hash-cccccccc" },
      sourceStore: createMemorySourceStore(),
    });
    renders = new RenderService(projects, assets);
    outputs = new OutputService(database, { store: createMemoryOutputStore() });

    // The renderer needs a canvas this environment does not have, so the one call the batch
    // makes into it is stood in for. What is under test is the batching, not the encoder.
    encoded = [];
    renders.previewExport = (async (projectId: string, options: { mediaType: string }) => {
      encoded.push(`${projectId}:${options.mediaType}`);
      const revision = (await projects.getProjectHistory(projectId)).headRevision;
      return {
        blob: new Blob([new Uint8Array(2048)], { type: options.mediaType }),
        revisionId: revision.id, requestedMediaType: options.mediaType, mediaType: options.mediaType,
        byteSize: 2048, widthPx: 200, heightPx: 100, substituted: false,
        resampleAlgorithm: "lanczos3", hasAlpha: false, warnings: [],
      };
    }) as unknown as RenderService["previewExport"];

    service = new BatchExportService(projects, renders, outputs, jobs);
  });

  afterEach(async () => database.delete());

  const variants = [
    { name: "Full", mediaType: "image/png" as const },
    { name: "Web", mediaType: "image/jpeg" as const, maxEdgePx: 1200 },
  ];

  it("costs the batch before it runs", async () => {
    const first = await photoProject("A");
    const second = await photoProject("B");
    const plan = await service.plan({ projectId: first, projectIds: [first, second], variants });
    expect(plan).toMatchObject({ fileCount: 4, blocked: 0, canRun: true });
    expect(plan.summary).toBe("4 file(s) from 2 project(s).");
  });

  it("names the projects it cannot export rather than quietly leaving them out", async () => {
    const photo = await photoProject("A");
    const empty = await projects.createProject({ name: `Empty ${crypto.randomUUID()}`, kind: "photo" });
    const plan = await service.plan({ projectId: photo, projectIds: [photo, empty.id, "ghost"], variants });
    expect(plan.blocked).toBe(2);
    expect(plan.items[1].reason).toContain("no image document");
    expect(plan.items[2].reason).toContain("no longer available");
    expect(plan.fileCount).toBe(2);
  });

  /** A short set nobody was told about is worse than a refusal. */
  it("refuses to start a strict batch that could not include everything", async () => {
    const photo = await photoProject("A");
    const empty = await projects.createProject({ name: `Empty ${crypto.randomUUID()}`, kind: "photo" });
    const plan = await service.plan({ projectId: photo, projectIds: [photo, empty.id], variants, onFailure: "stop" });
    expect(plan.canRun).toBe(false);
    await expect(service.start({ projectId: photo, projectIds: [photo, empty.id], variants, onFailure: "stop" }))
      .rejects.toThrowError(/Set onFailure to continue/);
  });

  it("refuses a batch with nothing to export", async () => {
    const empty = await projects.createProject({ name: `Empty ${crypto.randomUUID()}`, kind: "photo" });
    await expect(service.start({ projectId: empty.id, projectIds: [empty.id], variants }))
      .rejects.toThrowError(/None of those projects has an image document/);
  });

  it("produces one file per project per size, and saves each as an output", async () => {
    const first = await photoProject("Alpha");
    const second = await photoProject("Beta");
    const { jobId } = await service.start({ projectId: first, projectIds: [first, second], variants });
    await jobs.waitForJob(jobId);

    expect(encoded).toHaveLength(4);
    const saved = [...await outputs.listOutputs(first), ...await outputs.listOutputs(second)];
    expect(saved).toHaveLength(4);
    expect(saved.map((output) => output.name).some((name) => name.includes("— Full"))).toBe(true);
    expect(saved.every((output) => output.jobId === jobId)).toBe(true);
  });

  it("names files from the pattern it was given", async () => {
    expect(fileNameFor("{project} — {variant}", "Sunset", "Web")).toBe("Sunset — Web");
    expect(fileNameFor("{variant}/{project}.jpg", "Sunset", "thumb")).toBe("thumb/Sunset.jpg");
    // A pattern that names neither still has to produce something a person can tell apart.
    expect(fileNameFor("   ", "Sunset", "Web")).toBe("Sunset — Web");

    const project = await photoProject("Sunset");
    const { jobId } = await service.start({
      projectId: project, projectIds: [project],
      variants: [{ name: "thumb", mediaType: "image/webp" }],
      namePattern: "{variant} of {project}",
    });
    await jobs.waitForJob(jobId);
    expect((await outputs.listOutputs(project))[0].name).toContain("thumb of Sunset");
  });

  /** Ninety-six finished encodes should not be thrown away because four failed. */
  it("carries on past a project it cannot export, and reports which", async () => {
    const good = await photoProject("Good");
    const { jobId } = await service.start({
      projectId: good, projectIds: [good, "ghost"], variants, onFailure: "continue",
    });
    const job = await jobs.waitForJob(jobId);

    expect(await outputs.listOutputs(good)).toHaveLength(2);
    expect(job.status).toBe("complete");
    expect(job.warnings.join(" ")).toContain("ghost");
  });

  /**
   * A batch that stops has still done real work. Throwing the finished files away would be
   * worse than leaving a partial set the person can see and finish.
   */
  it("keeps what it has already written when a strict batch stops part-way", async () => {
    const good = await photoProject("Good");
    const bad = await photoProject("Bad");
    // Both plan cleanly; the second only fails once its encode is attempted, which is the
    // case `stop` exists for.
    const encode = renders.previewExport.bind(renders);
    renders.previewExport = (async (projectId: string, options: { mediaType: string }) => {
      if (projectId === bad) throw new Error("The encoder gave up.");
      return encode(projectId, options as never);
    }) as unknown as RenderService["previewExport"];

    const { jobId } = await service.start({
      projectId: good, projectIds: [good, bad], variants, onFailure: "stop",
    });
    await jobs.waitForJob(jobId);
    expect(await outputs.listOutputs(good)).toHaveLength(2);
    expect(await outputs.listOutputs(bad)).toHaveLength(0);
  });

  it("reports progress as a count of files rather than of projects", async () => {
    const first = await photoProject("A");
    const second = await photoProject("B");
    const { jobId } = await service.start({ projectId: first, projectIds: [first, second], variants });
    const job = await jobs.waitForJob(jobId);
    expect(job.progress.totalUnits).toBe(4);
    expect(job.progress.completedUnits).toBe(4);
  });

  it("describes what a finished batch produced", () => {
    expect(BatchExportService.describe({ produced: [], failed: [], summary: "" }))
      .toBe("No files were produced.");
    expect(BatchExportService.describe({
      produced: [
        { projectId: "a", variant: "Full", outputId: "1", byteSize: 2 * 1024 * 1024, mediaType: "image/png" },
        { projectId: "b", variant: "Full", outputId: "2", byteSize: 1024 * 1024, mediaType: "image/png" },
      ],
      failed: [], summary: "",
    })).toBe("2 file(s), 3.0 MB in total.");
    expect(BatchExportService.describe({
      produced: [{ projectId: "a", variant: "Full", outputId: "1", byteSize: 4096, mediaType: "image/png" }],
      failed: [{ projectId: "b", variant: "Full", reason: "no" }], summary: "",
    })).toContain("1 could not be produced");
  });
});
