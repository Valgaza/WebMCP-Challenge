import Dexie, { type EntityTable } from "dexie";
import { PROJECT_SCHEMA_VERSION, type ProjectRecord } from "../domain/project";
import {
  HISTORY_SCHEMA_VERSION,
  type ProjectRevision,
  type ProjectTransaction,
} from "../domain/project-history";
import {
  PERSISTENCE_SCHEMA_VERSION,
  type ProjectDurability,
  type ProjectProposal,
  type ProjectSnapshot,
} from "../domain/project-persistence";
import type { WorkspacePreference } from "../domain/workspace";

interface LegacyProjectRecord extends Omit<ProjectRecord, "headRevisionId" | "undoTransactionIds" | "redoTransactionIds"> {}

export class EstroDatabase extends Dexie {
  projects!: EntityTable<ProjectRecord, "id">;
  revisions!: EntityTable<ProjectRevision, "id">;
  transactions!: EntityTable<ProjectTransaction, "id">;
  durability!: EntityTable<ProjectDurability, "projectId">;
  snapshots!: EntityTable<ProjectSnapshot, "id">;
  proposals!: EntityTable<ProjectProposal, "id">;
  workspaces!: EntityTable<WorkspacePreference, "projectId">;

  constructor(name = "estro") {
    super(name);

    this.version(1).stores({
      projects: "id, name, kind, status, updatedAt, lastOpenedAt",
    });

    this.version(2)
      .stores({
        projects: "id, name, kind, status, updatedAt, lastOpenedAt, headRevisionId",
        revisions: "id, projectId, parentRevisionId, transactionId, createdAt",
        transactions: "id, projectId, resultingRevisionId, kind, createdAt",
      })
      .upgrade(async (transaction) => {
        const projects = (await transaction.table("projects").toArray()) as LegacyProjectRecord[];

        for (const project of projects) {
          const revisionId = `migration-revision-${project.id}`;
          const transactionId = `migration-transaction-${project.id}`;
          const operationId = `migration-operation-${project.id}`;
          const state = { name: project.name, kind: project.kind, status: project.status, photoDocument: null };

          const historyTransaction: ProjectTransaction = {
            id: transactionId,
            schemaVersion: HISTORY_SCHEMA_VERSION,
            projectId: project.id,
            sequence: 0,
            kind: "initialize",
            targetTransactionId: null,
            sourceRevisionId: null,
            resultingRevisionId: revisionId,
            operations: [
              {
                id: operationId,
                schemaVersion: HISTORY_SCHEMA_VERSION,
                type: "project.create",
                projectId: project.id,
                state,
              },
            ],
            actor: { type: "system", id: "estro-migration", displayName: "Estro migration" },
            intent: "Migrate the existing local project into revision-backed history.",
            summary: "Created the initial revision for this existing local project.",
            affectedIds: [project.id],
            warnings: [],
            undoable: false,
            createdAt: project.createdAt,
          };

          const revision: ProjectRevision = {
            id: revisionId,
            schemaVersion: HISTORY_SCHEMA_VERSION,
            projectId: project.id,
            sequence: 0,
            parentRevisionId: null,
            transactionId,
            state,
            createdAt: project.createdAt,
          };

          await transaction.table("transactions").add(historyTransaction);
          await transaction.table("revisions").add(revision);
          await transaction.table("projects").put({
            ...project,
            schemaVersion: PROJECT_SCHEMA_VERSION,
            headRevisionId: revisionId,
            undoTransactionIds: [],
            redoTransactionIds: [],
          });
        }
      });

    this.version(3)
      .stores({
        projects: "id, name, kind, status, updatedAt, lastOpenedAt, headRevisionId",
        revisions: "id, projectId, parentRevisionId, transactionId, createdAt",
        transactions: "id, projectId, resultingRevisionId, kind, createdAt",
      })
      .upgrade(async (transaction) => {
        const projects = await transaction.table("projects").toArray();

        for (const project of projects) {
          if (project.schemaVersion !== PROJECT_SCHEMA_VERSION) {
            await transaction.table("projects").update(project.id, {
              schemaVersion: PROJECT_SCHEMA_VERSION,
            });
          }
        }
      });

    this.version(4)
      .stores({
        projects: "id, name, kind, status, updatedAt, lastOpenedAt, headRevisionId",
        revisions: "id, projectId, parentRevisionId, transactionId, createdAt",
        transactions: "id, projectId, resultingRevisionId, kind, createdAt",
        durability: "projectId, durableRevisionId, recoveryCreatedAt",
        snapshots: "id, projectId, revisionId, transactionId, status, createdAt",
        proposals: "id, projectId, sourceRevisionId, status, expiresAt",
      })
      .upgrade(async (transaction) => {
        const projects = (await transaction.table("projects").toArray()) as ProjectRecord[];

        for (const project of projects) {
          await transaction.table("durability").put({
            projectId: project.id,
            schemaVersion: PERSISTENCE_SCHEMA_VERSION,
            durableRevisionId: project.headRevisionId,
            lastExplicitSaveAt: project.updatedAt,
            lastAutosaveAt: null,
            recoveryReason: null,
            recoveryCreatedAt: null,
          } satisfies ProjectDurability);
        }
      });

    this.version(5)
      .stores({
        projects: "id, name, kind, status, updatedAt, lastOpenedAt, headRevisionId",
        revisions: "id, projectId, parentRevisionId, transactionId, createdAt",
        transactions: "id, projectId, resultingRevisionId, kind, createdAt",
        durability: "projectId, durableRevisionId, recoveryCreatedAt",
        snapshots: "id, projectId, revisionId, transactionId, status, createdAt",
        proposals: "id, projectId, sourceRevisionId, status, expiresAt",
        workspaces: "projectId, updatedAt",
      })
      .upgrade(async (transaction) => {
        const revisions = await transaction.table("revisions").toArray();
        for (const revision of revisions) {
          if (!("photoDocument" in revision.state)) {
            await transaction.table("revisions").put({ ...revision, state: { ...revision.state, photoDocument: null } });
          }
        }
        const transactions = await transaction.table("transactions").toArray();
        for (const historyTransaction of transactions) {
          const operations = historyTransaction.operations.map((operation: Record<string, unknown>) => {
            if (operation.type === "project.create" || operation.type === "project.duplicate") {
              const state = operation.state as Record<string, unknown>;
              return { ...operation, state: { ...state, photoDocument: state.photoDocument ?? null } };
            }
            if (operation.type === "project.restore") {
              const fromState = operation.fromState as Record<string, unknown>;
              const toState = operation.toState as Record<string, unknown>;
              return {
                ...operation,
                fromState: { ...fromState, photoDocument: fromState.photoDocument ?? null },
                toState: { ...toState, photoDocument: toState.photoDocument ?? null },
              };
            }
            return operation;
          });
          await transaction.table("transactions").put({ ...historyTransaction, operations });
        }
      });
  }
}

export const estroDatabase = new EstroDatabase();
