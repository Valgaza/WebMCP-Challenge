import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { EstroDatabase } from "./estro-database";
import { ProjectRepository } from "./project-repository";
import { WorkspaceService } from "../application/workspace-service";

describe("EstroDatabase migrations", () => {
  let databaseName: string | null = null;

  afterEach(async () => {
    if (databaseName) await Dexie.delete(databaseName);
  });

  it("migrates a Slice 1 project into revision-backed history", async () => {
    databaseName = `estro-migration-${crypto.randomUUID()}`;
    const legacy = new Dexie(databaseName);
    legacy.version(1).stores({ projects: "id, name, kind, status, updatedAt, lastOpenedAt" });
    await legacy.table("projects").add({
      id: "project-legacy",
      schemaVersion: 1,
      name: "Existing project",
      kind: "unassigned",
      status: "active",
      storageMode: "local",
      createdAt: "2026-09-01T08:00:00.000Z",
      updatedAt: "2026-09-01T08:00:00.000Z",
      lastOpenedAt: null,
      deletedAt: null,
    });
    legacy.close();

    const upgraded = new EstroDatabase(databaseName);
    const history = await new ProjectRepository(upgraded).getHistory("project-legacy");

    expect(history.project).toMatchObject({
      headRevisionId: "migration-revision-project-legacy",
      undoTransactionIds: [],
      redoTransactionIds: [],
    });
    expect(history.headRevision).toMatchObject({
      id: "migration-revision-project-legacy",
      sequence: 0,
      state: { name: "Existing project", status: "active" },
    });
    expect(history.transactions).toHaveLength(1);
    upgraded.close();
  });

  it("repairs a project stamped with the intermediate schema version", async () => {
    databaseName = `estro-repair-${crypto.randomUUID()}`;
    const intermediate = new Dexie(databaseName);
    intermediate.version(2).stores({
      projects: "id, name, kind, status, updatedAt, lastOpenedAt, headRevisionId",
      revisions: "id, projectId, parentRevisionId, transactionId, createdAt",
      transactions: "id, projectId, resultingRevisionId, kind, createdAt",
    });

    const createdAt = "2026-09-01T08:00:00.000Z";
    await intermediate.transaction(
      "rw",
      intermediate.table("projects"),
      intermediate.table("revisions"),
      intermediate.table("transactions"),
      async () => {
        await intermediate.table("projects").add({
          id: "project-intermediate",
          schemaVersion: 1,
          name: "Preserved project",
          kind: "unassigned",
          status: "active",
          storageMode: "local",
          createdAt,
          updatedAt: createdAt,
          lastOpenedAt: null,
          deletedAt: null,
          headRevisionId: "revision-intermediate",
          undoTransactionIds: [],
          redoTransactionIds: [],
        });
        await intermediate.table("revisions").add({
          id: "revision-intermediate",
          schemaVersion: 1,
          projectId: "project-intermediate",
          sequence: 0,
          parentRevisionId: null,
          transactionId: "transaction-intermediate",
          state: { name: "Preserved project", kind: "unassigned", status: "active" },
          createdAt,
        });
        await intermediate.table("transactions").add({
          id: "transaction-intermediate",
          schemaVersion: 1,
          projectId: "project-intermediate",
          sequence: 0,
          kind: "initialize",
          targetTransactionId: null,
          sourceRevisionId: null,
          resultingRevisionId: "revision-intermediate",
          operations: [
            {
              id: "operation-intermediate",
              schemaVersion: 1,
              type: "project.create",
              projectId: "project-intermediate",
              state: { name: "Preserved project", kind: "unassigned", status: "active" },
            },
          ],
          actor: { type: "system", id: "estro-migration", displayName: "Estro migration" },
          intent: "Migrate the existing local project into revision-backed history.",
          summary: "Created the initial revision for this existing local project.",
          affectedIds: ["project-intermediate"],
          warnings: [],
          undoable: false,
          createdAt,
        });
      },
    );
    intermediate.close();

    const repaired = new EstroDatabase(databaseName);
    const history = await new ProjectRepository(repaired).getHistory("project-intermediate");

    expect(history.project).toMatchObject({
      schemaVersion: 2,
      id: "project-intermediate",
      name: "Preserved project",
      headRevisionId: "revision-intermediate",
    });
    expect(history.transactions).toHaveLength(1);
    expect(history.headRevision.id).toBe("revision-intermediate");
    repaired.close();
  });

  it("normalizes Phase 1 revisions and creates workspace preferences in schema version 5", async () => {
    databaseName = `estro-phase-2-migration-${crypto.randomUUID()}`;
    const phaseOne = new Dexie(databaseName);
    phaseOne.version(4).stores({
      projects: "id, name, kind, status, updatedAt, lastOpenedAt, headRevisionId",
      revisions: "id, projectId, parentRevisionId, transactionId, createdAt",
      transactions: "id, projectId, resultingRevisionId, kind, createdAt",
      durability: "projectId, durableRevisionId, recoveryCreatedAt",
      snapshots: "id, projectId, revisionId, transactionId, status, createdAt",
      proposals: "id, projectId, sourceRevisionId, status, expiresAt",
    });
    const createdAt = "2026-09-01T08:00:00.000Z";
    await phaseOne.transaction("rw", phaseOne.table("projects"), phaseOne.table("revisions"), phaseOne.table("transactions"), phaseOne.table("durability"), async () => {
      await phaseOne.table("projects").add({ id: "phase-1-project", schemaVersion: 2, name: "Existing canvas", kind: "unassigned", status: "active", storageMode: "local", createdAt, updatedAt: createdAt, lastOpenedAt: null, deletedAt: null, headRevisionId: "phase-1-revision", undoTransactionIds: [], redoTransactionIds: [] });
      await phaseOne.table("revisions").add({ id: "phase-1-revision", schemaVersion: 1, projectId: "phase-1-project", sequence: 0, parentRevisionId: null, transactionId: "phase-1-transaction", state: { name: "Existing canvas", kind: "unassigned", status: "active" }, createdAt });
      await phaseOne.table("transactions").add({ id: "phase-1-transaction", schemaVersion: 1, projectId: "phase-1-project", sequence: 0, kind: "initialize", targetTransactionId: null, sourceRevisionId: null, resultingRevisionId: "phase-1-revision", operations: [{ id: "phase-1-operation", schemaVersion: 1, type: "project.create", projectId: "phase-1-project", state: { name: "Existing canvas", kind: "unassigned", status: "active" } }], actor: { type: "system", id: "phase-1", displayName: "Phase 1" }, intent: "Create project.", summary: "Created project.", affectedIds: ["phase-1-project"], warnings: [], undoable: false, createdAt });
      await phaseOne.table("durability").add({ projectId: "phase-1-project", schemaVersion: 1, durableRevisionId: "phase-1-revision", lastExplicitSaveAt: createdAt, lastAutosaveAt: null, recoveryReason: null, recoveryCreatedAt: null });
    });
    phaseOne.close();

    const upgraded = new EstroDatabase(databaseName);
    const history = await new ProjectRepository(upgraded).getHistory("phase-1-project");
    expect(history.headRevision.state.photoDocument).toBeNull();
    expect(history.transactions[0]?.operations[0]).toMatchObject({ state: { photoDocument: null } });
    await expect(new WorkspaceService(upgraded).getWorkspace("phase-1-project")).resolves.toMatchObject({ projectId: "phase-1-project", schemaVersion: 1, viewport: { mode: "fit" } });
    upgraded.close();
  });
});
