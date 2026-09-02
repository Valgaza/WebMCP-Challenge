import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EstroDatabase } from "../data/estro-database";
import { ProjectRepository } from "../data/project-repository";
import { ProjectError } from "../domain/project-error";
import { ProjectService } from "./project-service";

describe("ProjectService", () => {
  let database: EstroDatabase;
  let service: ProjectService;
  let idCounter: number;
  let revisionCounter: number;
  let transactionCounter: number;
  let operationCounter: number;
  let documentCounter: number;
  let now: Date;

  beforeEach(() => {
    database = new EstroDatabase(`estro-test-${crypto.randomUUID()}`);
    idCounter = 0;
    revisionCounter = 0;
    transactionCounter = 0;
    operationCounter = 0;
    documentCounter = 0;
    now = new Date("2026-09-01T08:00:00.000Z");
    service = new ProjectService(new ProjectRepository(database), {
      now: () => now,
      createId: () => `project-${++idCounter}`,
      createRevisionId: () => `revision-${++revisionCounter}`,
      createTransactionId: () => `transaction-${++transactionCounter}`,
      createOperationId: () => `operation-${++operationCounter}`,
      createDocumentId: () => `document-${++documentCounter}`,
    });
  });

  afterEach(async () => {
    await database.delete();
  });

  it("creates, persists, and opens a local project", async () => {
    const created = await service.createProject({ name: "Anniversary film", kind: "video" });

    expect(created).toMatchObject({
      id: "project-1",
      schemaVersion: 2,
      name: "Anniversary film",
      kind: "video",
      status: "active",
      storageMode: "local",
      lastOpenedAt: null,
      headRevisionId: "revision-1",
      undoTransactionIds: [],
      redoTransactionIds: [],
    });

    now = new Date("2026-09-01T08:05:00.000Z");
    const opened = await service.openProject(created.id);
    expect(opened.lastOpenedAt).toBe("2026-09-01T08:05:00.000Z");

    const projects = await service.listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0]?.id).toBe(created.id);
  });

  it("renames and duplicates projects with separate identities", async () => {
    const created = await service.createProject({ name: "Portrait study", kind: "photo" });

    now = new Date("2026-09-01T08:02:00.000Z");
    const renamed = await service.renameProject({ projectId: created.id, name: "Portrait study final" });
    const duplicate = await service.duplicateProject(created.id);

    expect(renamed.project.name).toBe("Portrait study final");
    expect(renamed.transaction).toMatchObject({
      id: "transaction-2",
      sourceRevisionId: "revision-1",
      resultingRevisionId: "revision-2",
      actor: { type: "user", id: "local-user", displayName: "You" },
      undoable: true,
    });
    expect(duplicate).toMatchObject({
      id: "project-2",
      name: "Portrait study final copy",
      kind: "photo",
    });
    expect(duplicate.id).not.toBe(renamed.project.id);
  });

  it("appends immutable revisions for rename, Undo, and Redo", async () => {
    const created = await service.createProject({ name: "Draft", kind: "video" });

    now = new Date("2026-09-01T08:01:00.000Z");
    const renamed = await service.renameProject({ projectId: created.id, name: "Anniversary film" });
    const undone = await service.undoProject(created.id);
    const redone = await service.redoProject(created.id);

    expect(renamed.project).toMatchObject({
      name: "Anniversary film",
      headRevisionId: "revision-2",
      undoTransactionIds: ["transaction-2"],
      redoTransactionIds: [],
    });
    expect(undone.project).toMatchObject({
      name: "Draft",
      headRevisionId: "revision-3",
      undoTransactionIds: [],
      redoTransactionIds: ["transaction-2"],
    });
    expect(redone.project).toMatchObject({
      name: "Anniversary film",
      headRevisionId: "revision-4",
      undoTransactionIds: ["transaction-2"],
      redoTransactionIds: [],
    });
    expect(redone.transactions.map((transaction) => transaction.kind)).toEqual([
      "initialize",
      "mutation",
      "undo",
      "redo",
    ]);
    expect(redone.transactions.map((transaction) => transaction.id)).toEqual([
      "transaction-1",
      "transaction-2",
      "transaction-3",
      "transaction-4",
    ]);

    const reloadedService = new ProjectService(new ProjectRepository(database));
    await expect(reloadedService.getProjectHistory(created.id)).resolves.toMatchObject({
      project: { name: "Anniversary film", headRevisionId: "revision-4" },
      headRevision: { sequence: 3, state: { name: "Anniversary film" } },
    });
  });

  it("clears Redo when a new mutation branches from an undone revision", async () => {
    const created = await service.createProject({ name: "Draft", kind: "video" });
    await service.renameProject({ projectId: created.id, name: "First name" });
    await service.undoProject(created.id);
    const branched = await service.renameProject({ projectId: created.id, name: "Second name" });

    expect(branched.project.redoTransactionIds).toEqual([]);
    await expect(service.redoProject(created.id)).rejects.toMatchObject({ code: "HISTORY_NOT_AVAILABLE" });
  });

  it("creates, undoes, and redoes an empty image document through immutable revisions", async () => {
    const created = await service.createProject({ name: "Poster", kind: "unassigned" });
    const documentResult = await service.createPhotoDocument({
      projectId: created.id,
      expectedRevisionId: created.headRevisionId,
      widthPx: 1920,
      heightPx: 1080,
      resolutionPpi: 72,
      orientation: "landscape",
      background: { type: "transparent" },
    });

    expect(documentResult.project).toMatchObject({ kind: "photo", headRevisionId: "revision-2" });
    expect(documentResult.headRevision.state.photoDocument).toMatchObject({
      id: "document-1", widthPx: 1920, heightPx: 1080, orientation: "landscape",
    });
    expect(documentResult.transaction).toMatchObject({
      summary: "Created a 1920 × 1080 image document.",
      affectedIds: [created.id, "document-1"],
      undoable: true,
    });

    const undone = await service.undoProject(created.id);
    expect(undone.project.kind).toBe("unassigned");
    expect(undone.headRevision.state.photoDocument).toBeNull();

    const redone = await service.redoProject(created.id);
    expect(redone.project.kind).toBe("photo");
    expect(redone.headRevision.state.photoDocument).toMatchObject({ id: "document-1" });
  });

  it("rejects stale, mismatched, and duplicate image-document commands without mutation", async () => {
    const project = await service.createProject({ name: "Poster", kind: "photo" });
    await expect(service.createPhotoDocument({
      projectId: project.id, expectedRevisionId: "stale-revision", widthPx: 1000, heightPx: 1000,
      resolutionPpi: 72, orientation: "square", background: { type: "solid", color: "#ffffff" },
    })).rejects.toMatchObject({ code: "HISTORY_CONFLICT" });

    const created = await service.createPhotoDocument({
      projectId: project.id, expectedRevisionId: project.headRevisionId, widthPx: 1000, heightPx: 1000,
      resolutionPpi: 72, orientation: "square", background: { type: "solid", color: "#ffffff" },
    });
    await expect(service.createPhotoDocument({
      projectId: project.id, expectedRevisionId: created.headRevision.id, widthPx: 1000, heightPx: 1000,
      resolutionPpi: 72, orientation: "square", background: { type: "transparent" },
    })).rejects.toMatchObject({ code: "HISTORY_CONFLICT" });
    await expect(service.getProjectHistory(project.id)).resolves.toMatchObject({ headRevision: { id: created.headRevision.id } });
  });

  it("does not mutate the project when its Undo target is corrupted", async () => {
    const created = await service.createProject({ name: "Draft", kind: "video" });
    await service.renameProject({ projectId: created.id, name: "Anniversary film" });
    await database.transactions.delete("transaction-2");

    await expect(service.undoProject(created.id)).rejects.toMatchObject({ code: "HISTORY_CORRUPTED" });
    await expect(service.getProject(created.id)).resolves.toMatchObject({
      name: "Anniversary film",
      headRevisionId: "revision-2",
    });
  });

  it("rejects a duplicate active project name", async () => {
    await service.createProject({ name: "Coastal reel", kind: "video" });

    await expect(service.createProject({ name: "coastal reel", kind: "video" })).rejects.toMatchObject({
      code: "PROJECT_NAME_CONFLICT",
      fieldPath: "name",
    } satisfies Partial<ProjectError>);
  });

  it("soft-deletes the selected project from active results", async () => {
    const created = await service.createProject({ name: "Temporary project", kind: "unassigned" });
    await service.deleteProject(created.id);

    await expect(service.getProject(created.id)).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    await expect(service.listProjects()).resolves.toEqual([]);
  });
});
