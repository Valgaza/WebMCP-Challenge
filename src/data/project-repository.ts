import type { EstroDatabase } from "./estro-database";
import { parseProjectRecord, type ProjectRecord } from "../domain/project";
import {
  applyProjectOperations,
  parseProjectRevision,
  parseProjectTransaction,
  projectStateSchema,
  type ProjectRevision,
  type ProjectTransaction,
} from "../domain/project-history";
import {
  parseProjectDurability,
  parseProjectProposal,
  parseProjectSnapshot,
  type ProjectDurability,
  type ProjectPersistenceSnapshot,
  type ProjectProposal,
  type RecoverableProjectSummary,
} from "../domain/project-persistence";
import { ProjectError, toProjectError } from "../domain/project-error";

export interface InitializedProject {
  project: ProjectRecord;
  revision: ProjectRevision;
  transaction: ProjectTransaction;
  durability: ProjectDurability;
}

export interface ProjectCommit {
  expectedHeadRevisionId: string;
  project: ProjectRecord;
  revision: ProjectRevision;
  transaction: ProjectTransaction;
  durabilityMode?: "draft" | "autosave" | "explicit";
  proposalId?: string;
}

export interface ProjectHistorySnapshot {
  project: ProjectRecord;
  headRevision: ProjectRevision;
  transactions: ProjectTransaction[];
}

export class ProjectRepository {
  constructor(private readonly database: EstroDatabase) {}

  async listActive(): Promise<ProjectRecord[]> {
    try {
      const projects = await this.database.projects.toArray();
      return projects
        .map(parseProjectRecord)
        .filter((project) => project.status === "active")
        .sort((left, right) => {
          const leftTime = left.lastOpenedAt ?? left.updatedAt;
          const rightTime = right.lastOpenedAt ?? right.updatedAt;
          return rightTime.localeCompare(leftTime);
        });
    } catch (error) {
      throw toProjectError(error);
    }
  }

  async getActive(projectId: string): Promise<ProjectRecord> {
    try {
      const stored = await this.database.projects.get(projectId);
      if (!stored || stored.status !== "active") {
        throw new ProjectError("PROJECT_NOT_FOUND", "This project is no longer available in this browser.");
      }
      return parseProjectRecord(stored);
    } catch (error) {
      throw toProjectError(error);
    }
  }

  async getHistory(projectId: string): Promise<ProjectHistorySnapshot> {
    try {
      return await this.database.transaction(
        "r",
        this.database.projects,
        this.database.revisions,
        this.database.transactions,
        async () => {
          const project = await this.getActive(projectId);
          const storedHead = await this.database.revisions.get(project.headRevisionId);
          if (!storedHead) {
            throw new ProjectError("HISTORY_CORRUPTED", "The current project revision is missing. The project was not changed.");
          }

          const headRevision = parseProjectRevision(storedHead);
          if (headRevision.projectId !== project.id) {
            throw new ProjectError("HISTORY_CORRUPTED", "The current revision belongs to a different project.");
          }

          const transactions = (await this.database.transactions.where("projectId").equals(projectId).toArray())
            .map(parseProjectTransaction)
            .sort((left, right) => left.sequence - right.sequence);

          this.assertProjectMirrorsState(project, headRevision.state, headRevision);
          const headTransaction = transactions.find((candidate) => candidate.id === headRevision.transactionId);
          if (!headTransaction || headTransaction.resultingRevisionId !== headRevision.id) {
            throw new ProjectError("HISTORY_CORRUPTED", "The current project transaction is missing or inconsistent.");
          }

          for (const transactionId of [...project.undoTransactionIds, ...project.redoTransactionIds]) {
            const referenced = transactions.find((candidate) => candidate.id === transactionId);
            if (!referenced || !referenced.undoable || referenced.kind !== "mutation") {
              throw new ProjectError("HISTORY_CORRUPTED", "The project Undo or Redo history contains an invalid transaction.");
            }
          }

          return { project, headRevision, transactions };
        },
      );
    } catch (error) {
      throw toProjectError(error);
    }
  }

  async getRevision(revisionId: string): Promise<ProjectRevision> {
    try {
      const revision = await this.database.revisions.get(revisionId);
      if (!revision) throw new ProjectError("HISTORY_CORRUPTED", "The requested durable revision is missing.");
      return parseProjectRevision(revision);
    } catch (error) {
      throw toProjectError(error);
    }
  }

  async getTransaction(transactionId: string): Promise<ProjectTransaction> {
    try {
      const transaction = await this.database.transactions.get(transactionId);
      if (!transaction) throw new ProjectError("HISTORY_NOT_AVAILABLE", "This transaction is no longer available.");
      return parseProjectTransaction(transaction);
    } catch (error) {
      throw toProjectError(error);
    }
  }

  async create(initialized: InitializedProject): Promise<ProjectRecord> {
    const project = parseProjectRecord(initialized.project);
    const revision = parseProjectRevision(initialized.revision);
    const historyTransaction = parseProjectTransaction(initialized.transaction);
    const durability = parseProjectDurability(initialized.durability);

    try {
      await this.database.transaction(
        "rw",
        this.database.projects,
        this.database.revisions,
        this.database.transactions,
        this.database.durability,
        async () => {
          await this.assertNameAvailable(project.id, project.name);
          if (
            revision.projectId !== project.id ||
            revision.parentRevisionId !== null ||
            revision.id !== project.headRevisionId ||
            revision.transactionId !== historyTransaction.id ||
            historyTransaction.projectId !== project.id ||
            historyTransaction.sourceRevisionId !== null ||
            historyTransaction.resultingRevisionId !== revision.id ||
            durability.projectId !== project.id ||
            durability.durableRevisionId !== revision.id
          ) {
            throw new ProjectError("HISTORY_CORRUPTED", "The initial project history identifiers do not agree.");
          }

          const replayedState = applyProjectOperations(null, historyTransaction.operations);
          this.assertProjectMirrorsState(project, replayedState, revision);
          await this.database.projects.add(project);
          await this.database.transactions.add(historyTransaction);
          await this.database.revisions.add(revision);
          await this.database.durability.add(durability);
        },
      );
      return project;
    } catch (error) {
      throw toProjectError(error);
    }
  }

  async commit(commit: ProjectCommit): Promise<ProjectHistorySnapshot> {
    const nextProject = parseProjectRecord(commit.project);
    const nextRevision = parseProjectRevision(commit.revision);
    const nextTransaction = parseProjectTransaction(commit.transaction);

    try {
      return await this.database.transaction(
        "rw",
        [
          this.database.projects,
          this.database.revisions,
          this.database.transactions,
          this.database.durability,
          this.database.snapshots,
          this.database.proposals,
        ],
        async () => {
          const storedProject = await this.database.projects.get(nextProject.id);
          if (!storedProject) throw new ProjectError("PROJECT_NOT_FOUND", "This project is no longer available in this browser.");
          const currentProject = parseProjectRecord(storedProject);
          if (currentProject.headRevisionId !== commit.expectedHeadRevisionId) {
            throw new ProjectError("HISTORY_CONFLICT", "The project changed before this operation could be saved. Reload the latest revision and try again.");
          }

          if (commit.proposalId) {
            const proposal = parseProjectProposal(await this.database.proposals.get(commit.proposalId));
            if (proposal.status !== "pending" || proposal.sourceRevisionId !== currentProject.headRevisionId) {
              throw new ProjectError("PROPOSAL_STALE", "This proposal no longer matches the current project. Review the latest revision and create a new proposal.");
            }
          }

          const storedHead = await this.database.revisions.get(currentProject.headRevisionId);
          if (!storedHead) throw new ProjectError("HISTORY_CORRUPTED", "The current project revision is missing. The project was not changed.");
          const currentRevision = parseProjectRevision(storedHead);

          if (
            nextRevision.projectId !== currentProject.id ||
            nextRevision.parentRevisionId !== currentRevision.id ||
            nextRevision.sequence !== currentRevision.sequence + 1 ||
            nextRevision.transactionId !== nextTransaction.id ||
            nextTransaction.projectId !== currentProject.id ||
            nextTransaction.sourceRevisionId !== currentRevision.id ||
            nextTransaction.resultingRevisionId !== nextRevision.id ||
            nextTransaction.sequence !== nextRevision.sequence
          ) {
            throw new ProjectError("HISTORY_CORRUPTED", "The new project revision and transaction identifiers do not agree.");
          }

          const replayedState = applyProjectOperations(currentRevision.state, nextTransaction.operations);
          this.assertProjectMirrorsState(nextProject, replayedState, nextRevision);
          if (nextProject.status === "active") await this.assertNameAvailable(nextProject.id, nextProject.name);

          await this.database.transactions.add(nextTransaction);
          await this.database.revisions.add(nextRevision);
          await this.database.projects.put(nextProject);
          await this.syncSnapshotOperations(nextTransaction, nextRevision);
          await this.updateDurabilityAfterCommit(nextProject, nextRevision, nextTransaction, commit.durabilityMode ?? "draft");
          if (commit.proposalId) {
            await this.database.proposals.update(commit.proposalId, { status: "applied", appliedTransactionId: nextTransaction.id });
          }

          const transactions = (await this.database.transactions.where("projectId").equals(nextProject.id).toArray())
            .map(parseProjectTransaction)
            .sort((left, right) => left.sequence - right.sequence);
          return { project: nextProject, headRevision: nextRevision, transactions };
        },
      );
    } catch (error) {
      throw toProjectError(error);
    }
  }

  async getPersistence(projectId: string): Promise<ProjectPersistenceSnapshot> {
    try {
      return await this.database.transaction("r", this.database.projects, this.database.durability, this.database.snapshots, async () => {
        const project = await this.getActive(projectId);
        const durability = parseProjectDurability(await this.database.durability.get(projectId));
        const snapshots = (await this.database.snapshots.where("projectId").equals(projectId).toArray())
          .map(parseProjectSnapshot)
          .filter((snapshot) => snapshot.status === "active")
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
        return {
          durability,
          snapshots,
          hasRecoverableDraft: durability.durableRevisionId !== project.headRevisionId,
          hasPendingAutosave: false,
        };
      });
    } catch (error) {
      throw toProjectError(error);
    }
  }

  async checkpoint(projectId: string, mode: "autosave" | "explicit", savedAt: string): Promise<ProjectDurability> {
    try {
      return await this.database.transaction("rw", this.database.projects, this.database.durability, async () => {
        const project = await this.getActive(projectId);
        const current = parseProjectDurability(await this.database.durability.get(projectId));
        const updated = parseProjectDurability({
          ...current,
          durableRevisionId: project.headRevisionId,
          lastExplicitSaveAt: mode === "explicit" ? savedAt : current.lastExplicitSaveAt,
          lastAutosaveAt: mode === "autosave" ? savedAt : current.lastAutosaveAt,
          recoveryReason: null,
          recoveryCreatedAt: null,
        });
        await this.database.durability.put(updated);
        return updated;
      });
    } catch (error) {
      throw toProjectError(error);
    }
  }

  async listRecoverable(): Promise<RecoverableProjectSummary[]> {
    try {
      const projects = await this.listActive();
      const summaries = await Promise.all(projects.map(async (project) => {
        const durability = parseProjectDurability(await this.database.durability.get(project.id));
        if (durability.durableRevisionId === project.headRevisionId) return null;
        const [durableRevision, draftRevision] = await Promise.all([
          this.getRevision(durability.durableRevisionId),
          this.getRevision(project.headRevisionId),
        ]);
        return {
          projectId: project.id,
          projectName: project.name,
          durableRevisionId: durability.durableRevisionId,
          draftRevisionId: project.headRevisionId,
          operationCount: Math.max(1, draftRevision.sequence - durableRevision.sequence),
          reason: durability.recoveryReason ?? "This edit was preserved before autosave made it durable.",
          createdAt: durability.recoveryCreatedAt ?? project.updatedAt,
        } satisfies RecoverableProjectSummary;
      }));
      return summaries
        .filter((summary): summary is RecoverableProjectSummary => summary !== null)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    } catch (error) {
      throw toProjectError(error);
    }
  }

  async createProposal(proposal: ProjectProposal): Promise<ProjectProposal> {
    try {
      const parsed = parseProjectProposal(proposal);
      await this.database.proposals.add(parsed);
      return parsed;
    } catch (error) {
      throw toProjectError(error);
    }
  }

  async getProposal(proposalId: string): Promise<ProjectProposal> {
    try {
      const proposal = await this.database.proposals.get(proposalId);
      if (!proposal) throw new ProjectError("PROPOSAL_NOT_FOUND", "This proposal is no longer available.");
      return parseProjectProposal(proposal);
    } catch (error) {
      throw toProjectError(error);
    }
  }

  async rejectProposal(proposalId: string): Promise<ProjectProposal> {
    try {
      return await this.database.transaction("rw", this.database.proposals, async () => {
        const proposal = await this.getProposal(proposalId);
        if (proposal.status !== "pending") return proposal;
        const updated = parseProjectProposal({ ...proposal, status: "rejected" });
        await this.database.proposals.put(updated);
        return updated;
      });
    } catch (error) {
      throw toProjectError(error);
    }
  }

  async validateNameAvailable(projectId: string, name: string): Promise<void> {
    try {
      await this.assertNameAvailable(projectId, name);
    } catch (error) {
      throw toProjectError(error);
    }
  }

  async markOpened(projectId: string, openedAt: string): Promise<ProjectRecord> {
    try {
      return await this.database.transaction("rw", this.database.projects, async () => {
        const project = await this.getActive(projectId);
        const updated = parseProjectRecord({ ...project, lastOpenedAt: openedAt });
        await this.database.projects.put(updated);
        return updated;
      });
    } catch (error) {
      throw toProjectError(error);
    }
  }

  private async syncSnapshotOperations(transaction: ProjectTransaction, revision: ProjectRevision): Promise<void> {
    for (const operation of transaction.operations) {
      if (operation.type === "project.snapshot") {
        const existing = await this.database.snapshots.get(operation.snapshotId);
        await this.database.snapshots.put(parseProjectSnapshot({
          id: operation.snapshotId,
          schemaVersion: 1,
          projectId: transaction.projectId,
          name: operation.name,
          revisionId: revision.id,
          transactionId: transaction.id,
          status: "active",
          createdAt: existing?.createdAt ?? transaction.createdAt,
          updatedAt: transaction.createdAt,
        }));
      }
      if (operation.type === "project.snapshot.remove") {
        const existing = await this.database.snapshots.get(operation.snapshotId);
        if (!existing) throw new ProjectError("HISTORY_CORRUPTED", "The snapshot referenced by Undo is missing.");
        await this.database.snapshots.put(parseProjectSnapshot({ ...existing, status: "removed", updatedAt: transaction.createdAt }));
      }
    }
  }

  private async updateDurabilityAfterCommit(
    project: ProjectRecord,
    revision: ProjectRevision,
    transaction: ProjectTransaction,
    mode: "draft" | "autosave" | "explicit",
  ): Promise<void> {
    const current = parseProjectDurability(await this.database.durability.get(project.id));
    const isDurable = mode !== "draft";
    await this.database.durability.put(parseProjectDurability({
      ...current,
      durableRevisionId: isDurable ? revision.id : current.durableRevisionId,
      lastExplicitSaveAt: mode === "explicit" ? transaction.createdAt : current.lastExplicitSaveAt,
      lastAutosaveAt: mode === "autosave" ? transaction.createdAt : current.lastAutosaveAt,
      recoveryReason: isDurable ? null : "This edit was preserved before autosave made it durable.",
      recoveryCreatedAt: isDurable ? null : transaction.createdAt,
    }));
  }

  private async assertNameAvailable(projectId: string, name: string): Promise<void> {
    const conflictingProject = await this.database.projects
      .filter((candidate) =>
        candidate.id !== projectId &&
        candidate.status === "active" &&
        candidate.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0,
      )
      .first();
    if (conflictingProject) {
      throw new ProjectError("PROJECT_NAME_CONFLICT", "Use a different project name. A local project already uses this name.", { fieldPath: "name" });
    }
  }

  private assertProjectMirrorsState(
    project: ProjectRecord,
    replayedState: ReturnType<typeof projectStateSchema.parse>,
    revision: ProjectRevision,
  ): void {
    const storedState = projectStateSchema.parse(revision.state);
    if (
      storedState.name !== replayedState.name ||
      storedState.kind !== replayedState.kind ||
      storedState.status !== replayedState.status ||
      project.name !== replayedState.name ||
      project.kind !== replayedState.kind ||
      project.status !== replayedState.status ||
      project.headRevisionId !== revision.id
    ) {
      throw new ProjectError("HISTORY_CORRUPTED", "The project record does not match its immutable revision state.");
    }
  }
}
