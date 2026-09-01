import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EstroDatabase } from "../data/estro-database";
import { ProjectRepository } from "../data/project-repository";
import { ProjectService } from "./project-service";

describe("Phase 1 persistence and transaction foundation", () => {
  let database: EstroDatabase;
  let service: ProjectService;
  let projectCounter: number;
  let revisionCounter: number;
  let transactionCounter: number;
  let operationCounter: number;
  let snapshotCounter: number;
  let proposalCounter: number;
  let now: Date;

  beforeEach(() => {
    database = new EstroDatabase(`estro-phase-1-${crypto.randomUUID()}`);
    projectCounter = revisionCounter = transactionCounter = operationCounter = snapshotCounter = proposalCounter = 0;
    now = new Date("2026-09-01T10:00:00.000Z");
    service = new ProjectService(new ProjectRepository(database), {
      now: () => now,
      createId: () => `project-${++projectCounter}`,
      createRevisionId: () => `revision-${++revisionCounter}`,
      createTransactionId: () => `transaction-${++transactionCounter}`,
      createOperationId: () => `operation-${++operationCounter}`,
      createSnapshotId: () => `snapshot-${++snapshotCounter}`,
      createProposalId: () => `proposal-${++proposalCounter}`,
    });
  });

  afterEach(async () => database.delete());

  it("keeps a recoverable draft until autosave promotes its revision", async () => {
    const project = await service.createProject({ name: "Draft", kind: "video" });
    now = new Date("2026-09-01T10:01:00.000Z");
    const renamed = await service.renameProject({ projectId: project.id, name: "Anniversary film" });

    await expect(service.getProjectPersistence(project.id)).resolves.toMatchObject({
      hasRecoverableDraft: true,
      durability: { durableRevisionId: "revision-1", recoveryCreatedAt: "2026-09-01T10:01:00.000Z" },
    });
    await expect(service.listRecoverableProjects()).resolves.toMatchObject([
      { projectId: project.id, draftRevisionId: renamed.headRevision.id, durableRevisionId: "revision-1", operationCount: 1 },
    ]);

    now = new Date("2026-09-01T10:02:00.000Z");
    await service.autosaveProject(project.id);
    await expect(service.getProjectPersistence(project.id)).resolves.toMatchObject({
      hasRecoverableDraft: false,
      durability: { durableRevisionId: renamed.headRevision.id, lastAutosaveAt: "2026-09-01T10:02:00.000Z" },
    });
  });

  it("shows an in-session autosave as pending and recovery only after an interrupted reload", async () => {
    const coordinatedService = new ProjectService(new ProjectRepository(database), { autosaveDelayMs: 10_000 });
    const project = await coordinatedService.createProject({ name: "Draft", kind: "video" });
    await coordinatedService.renameProject({ projectId: project.id, name: "Autosaving edit" });

    await expect(coordinatedService.getProjectPersistence(project.id)).resolves.toMatchObject({
      hasPendingAutosave: true,
      hasRecoverableDraft: false,
    });
    await expect(coordinatedService.listRecoverableProjects()).resolves.toEqual([]);

    const reloadedService = new ProjectService(new ProjectRepository(database));
    await expect(reloadedService.getProjectPersistence(project.id)).resolves.toMatchObject({
      hasPendingAutosave: false,
      hasRecoverableDraft: true,
    });

    const autosaveCompleted = coordinatedService.waitForAutosave(project.id);
    await coordinatedService.autosaveProject(project.id);
    await autosaveCompleted;
    await expect(coordinatedService.getProjectPersistence(project.id)).resolves.toMatchObject({
      hasPendingAutosave: false,
      hasRecoverableDraft: false,
    });
  });

  it("creates separate Save As identity and same-project named snapshot", async () => {
    const project = await service.createProject({ name: "Original", kind: "photo" });
    const copy = await service.saveProjectAs(project.id, "Separate version");
    const snapshot = await service.createSnapshot(project.id, "Color approved");

    expect(copy.id).not.toBe(project.id);
    expect(copy.name).toBe("Separate version");
    expect(snapshot.transaction.operations).toMatchObject([{ type: "project.snapshot", name: "Color approved" }]);
    await expect(service.getProjectPersistence(project.id)).resolves.toMatchObject({
      hasRecoverableDraft: false,
      snapshots: [{ id: "snapshot-1", name: "Color approved", revisionId: snapshot.headRevision.id }],
    });
  });

  it("restores the durable revision without deleting the interrupted draft history", async () => {
    const project = await service.createProject({ name: "Durable name", kind: "video" });
    await service.renameProject({ projectId: project.id, name: "Interrupted draft" });
    const restored = await service.restoreDurableRevision(project.id);

    expect(restored.project.name).toBe("Durable name");
    expect(restored.transactions).toHaveLength(3);
    expect(restored.transaction.operations[0]).toMatchObject({ type: "project.restore", sourceRevisionId: "revision-1" });
    await expect(service.getProjectPersistence(project.id)).resolves.toMatchObject({ hasRecoverableDraft: false });
  });

  it("dry-runs rename plus snapshot, commits once, and undoes once", async () => {
    const project = await service.createProject({ name: "Draft", kind: "video" });
    const proposal = await service.proposeTransaction({
      projectId: project.id,
      operations: [
        { type: "rename_project", name: "Anniversary film" },
        { type: "create_snapshot", name: "Before export" },
      ],
    });

    expect(proposal).toMatchObject({ id: "proposal-1", sourceRevisionId: "revision-1", status: "pending" });
    await expect(service.getProject(project.id)).resolves.toMatchObject({ name: "Draft", headRevisionId: "revision-1" });

    const applied = await service.applyProposal(proposal.id);
    expect(applied).toMatchObject({ project: { name: "Anniversary film" }, headRevision: { id: "revision-2" } });
    expect(applied.transaction.operations).toHaveLength(2);
    expect(applied.transaction.id).toBe("transaction-2");
    await expect(service.getProjectPersistence(project.id)).resolves.toMatchObject({
      snapshots: [{ name: "Before export" }],
    });

    const undone = await service.undoTransaction(project.id, applied.transaction.id);
    expect(undone.project.name).toBe("Draft");
    await expect(service.getProjectPersistence(project.id)).resolves.toMatchObject({ snapshots: [] });
  });

  it("rejects a stale proposal without partially applying its operations", async () => {
    const project = await service.createProject({ name: "Draft", kind: "video" });
    const proposal = await service.proposeTransaction({
      projectId: project.id,
      operations: [{ type: "rename_project", name: "Proposed name" }],
    });
    await service.renameProject({ projectId: project.id, name: "Newer user edit" });

    await expect(service.applyProposal(proposal.id)).rejects.toMatchObject({ code: "PROPOSAL_STALE" });
    await expect(service.getProject(project.id)).resolves.toMatchObject({ name: "Newer user edit", headRevisionId: "revision-2" });
  });
});
