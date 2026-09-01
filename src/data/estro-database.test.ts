import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { EstroDatabase } from "./estro-database";
import { ProjectRepository } from "./project-repository";

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
});
