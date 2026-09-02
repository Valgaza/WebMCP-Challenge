import {
  PROJECT_SCHEMA_VERSION,
  createProjectInputSchema,
  projectNameSchema,
  renameProjectInputSchema,
  type CreateProjectInput,
  type ProjectRecord,
  type RenameProjectInput,
} from "../domain/project";
import {
  HISTORY_SCHEMA_VERSION,
  applyProjectOperations,
  invertProjectOperations,
  projectActorSchema,
  replayProjectOperations,
  type ProjectActor,
  type ProjectOperation,
  type ProjectRevision,
  type ProjectTransaction,
} from "../domain/project-history";
import {
  PERSISTENCE_SCHEMA_VERSION,
  projectProposalSchema,
  proposeTransactionInputSchema,
  type ProjectDurability,
  type ProjectPersistenceSnapshot,
  type ProjectProposal,
  type ProposeTransactionInput,
  type RecoverableProjectSummary,
} from "../domain/project-persistence";
import { ProjectError, toProjectError } from "../domain/project-error";
import {
  PHOTO_DOCUMENT_SCHEMA_VERSION,
  createPhotoDocumentInputSchema,
  type CreatePhotoDocumentInput,
  type PhotoDocument,
} from "../domain/photo-document";
import type { ProjectHistorySnapshot, ProjectRepository } from "../data/project-repository";

export interface ProjectServiceOptions {
  now?: () => Date;
  autosaveDelayMs?: number;
  createId?: () => string;
  createRevisionId?: () => string;
  createTransactionId?: () => string;
  createOperationId?: () => string;
  createSnapshotId?: () => string;
  createProposalId?: () => string;
  createDocumentId?: () => string;
}

export interface ProjectCommandContext {
  actor?: ProjectActor;
  intent?: string;
}

export interface ProjectMutationResult extends ProjectHistorySnapshot {
  transaction: ProjectTransaction;
  canUndo: boolean;
  canRedo: boolean;
  normalizedParameters?: Record<string, unknown>;
}

export interface ProjectLifecycleService {
  listProjects(): Promise<ProjectRecord[]>;
  getProject(projectId: string): Promise<ProjectRecord>;
  createProject(input: CreateProjectInput, context?: ProjectCommandContext): Promise<ProjectRecord>;
  openProject(projectId: string): Promise<ProjectRecord>;
  renameProject(input: RenameProjectInput, context?: ProjectCommandContext): Promise<ProjectMutationResult>;
  duplicateProject(projectId: string, context?: ProjectCommandContext): Promise<ProjectRecord>;
  deleteProject(projectId: string, context?: ProjectCommandContext): Promise<void>;
}

export interface ProjectHistoryService {
  getProjectHistory(projectId: string): Promise<ProjectHistorySnapshot>;
  undoProject(projectId: string, context?: ProjectCommandContext): Promise<ProjectMutationResult>;
  redoProject(projectId: string, context?: ProjectCommandContext): Promise<ProjectMutationResult>;
}

export interface PhotoDocumentService {
  createPhotoDocument(input: CreatePhotoDocumentInput, context?: ProjectCommandContext): Promise<ProjectMutationResult>;
}

export interface ProjectObservationService {
  subscribeProject(projectId: string, listener: (result: ProjectMutationResult) => void): () => void;
}

export interface ProjectPersistenceService {
  getProjectPersistence(projectId: string): Promise<ProjectPersistenceSnapshot>;
  listRecoverableProjects(): Promise<RecoverableProjectSummary[]>;
  waitForAutosave(projectId: string): Promise<void>;
  saveProject(projectId: string): Promise<ProjectDurability>;
  autosaveProject(projectId: string): Promise<ProjectDurability>;
  saveProjectAs(projectId: string, name: string, context?: ProjectCommandContext): Promise<ProjectRecord>;
  createSnapshot(projectId: string, name: string, context?: ProjectCommandContext): Promise<ProjectMutationResult>;
  recoverDraft(projectId: string): Promise<ProjectDurability>;
  restoreDurableRevision(projectId: string, context?: ProjectCommandContext): Promise<ProjectMutationResult>;
}

export interface ProjectAutomationService {
  proposeTransaction(input: ProposeTransactionInput, context?: ProjectCommandContext): Promise<ProjectProposal>;
  applyProposal(proposalId: string, context?: ProjectCommandContext): Promise<ProjectMutationResult>;
  rejectProposal(proposalId: string): Promise<ProjectProposal>;
  getProposal(proposalId: string): Promise<ProjectProposal>;
  inspectTransaction(transactionId: string): Promise<ProjectTransaction>;
  undoTransaction(projectId: string, transactionId: string, context?: ProjectCommandContext): Promise<ProjectMutationResult>;
}

interface PendingAutosave {
  timer: ReturnType<typeof setTimeout> | null;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

export class ProjectService implements ProjectLifecycleService, ProjectHistoryService, ProjectPersistenceService, ProjectAutomationService, PhotoDocumentService {
  private readonly now: () => Date;
  private readonly createProjectId: () => string;
  private readonly createRevisionId: () => string;
  private readonly createTransactionId: () => string;
  private readonly createOperationId: () => string;
  private readonly createSnapshotId: () => string;
  private readonly createProposalId: () => string;
  private readonly createDocumentId: () => string;
  private readonly autosaveDelayMs: number | null;
  private readonly pendingAutosaves = new Map<string, PendingAutosave>();
  private readonly projectListeners = new Map<string, Set<(result: ProjectMutationResult) => void>>();

  constructor(private readonly repository: ProjectRepository, options: ProjectServiceOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.createProjectId = options.createId ?? (() => crypto.randomUUID());
    this.createRevisionId = options.createRevisionId ?? (() => crypto.randomUUID());
    this.createTransactionId = options.createTransactionId ?? (() => crypto.randomUUID());
    this.createOperationId = options.createOperationId ?? (() => crypto.randomUUID());
    this.createSnapshotId = options.createSnapshotId ?? (() => crypto.randomUUID());
    this.createProposalId = options.createProposalId ?? (() => crypto.randomUUID());
    this.createDocumentId = options.createDocumentId ?? (() => crypto.randomUUID());
    this.autosaveDelayMs = options.autosaveDelayMs === undefined ? null : Math.max(0, options.autosaveDelayMs);
  }

  listProjects(): Promise<ProjectRecord[]> { return this.repository.listActive(); }
  getProject(projectId: string): Promise<ProjectRecord> { return this.repository.getActive(projectId); }
  getProjectHistory(projectId: string): Promise<ProjectHistorySnapshot> { return this.repository.getHistory(projectId); }
  async getProjectPersistence(projectId: string): Promise<ProjectPersistenceSnapshot> {
    const wasPending = this.pendingAutosaves.has(projectId);
    let snapshot = await this.repository.getPersistence(projectId);
    const hasPendingAutosave = this.pendingAutosaves.has(projectId);
    if (wasPending && !hasPendingAutosave) snapshot = await this.repository.getPersistence(projectId);
    return {
      ...snapshot,
      hasPendingAutosave,
      hasRecoverableDraft: snapshot.hasRecoverableDraft && !hasPendingAutosave,
    };
  }

  async listRecoverableProjects(): Promise<RecoverableProjectSummary[]> {
    const pendingBeforeRead = new Set(this.pendingAutosaves.keys());
    const recoverable = await this.repository.listRecoverable();
    return recoverable.filter((project) =>
      !pendingBeforeRead.has(project.projectId) && !this.pendingAutosaves.has(project.projectId),
    );
  }
  getProposal(proposalId: string): Promise<ProjectProposal> { return this.repository.getProposal(proposalId); }
  inspectTransaction(transactionId: string): Promise<ProjectTransaction> { return this.repository.getTransaction(transactionId); }
  subscribeProject(projectId: string, listener: (result: ProjectMutationResult) => void): () => void {
    const listeners = this.projectListeners.get(projectId) ?? new Set();
    listeners.add(listener);
    this.projectListeners.set(projectId, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.projectListeners.delete(projectId);
    };
  }

  async createProject(input: CreateProjectInput, context: ProjectCommandContext = {}): Promise<ProjectRecord> {
    try {
      const parsed = createProjectInputSchema.parse(input);
      const timestamp = this.now().toISOString();
      const projectId = this.createProjectId();
      const revisionId = this.createRevisionId();
      const transactionId = this.createTransactionId();
      const state = { name: parsed.name, kind: parsed.kind, status: "active" as const, photoDocument: null };
      const operation: ProjectOperation = {
        id: this.createOperationId(), schemaVersion: HISTORY_SCHEMA_VERSION, type: "project.create", projectId, state,
      };
      const transaction: ProjectTransaction = {
        id: transactionId, schemaVersion: HISTORY_SCHEMA_VERSION, projectId, sequence: 0, kind: "initialize",
        targetTransactionId: null, sourceRevisionId: null, resultingRevisionId: revisionId, operations: [operation],
        actor: this.parseActor(context), intent: context.intent ?? "Create a local project.",
        summary: `Created “${parsed.name}”.`, affectedIds: [projectId], warnings: [], undoable: false, createdAt: timestamp,
      };
      const revision: ProjectRevision = {
        id: revisionId, schemaVersion: HISTORY_SCHEMA_VERSION, projectId, sequence: 0, parentRevisionId: null,
        transactionId, state, createdAt: timestamp,
      };
      const project: ProjectRecord = {
        id: projectId, schemaVersion: PROJECT_SCHEMA_VERSION, name: parsed.name, kind: parsed.kind, status: "active",
        storageMode: "local", createdAt: timestamp, updatedAt: timestamp, lastOpenedAt: null, deletedAt: null,
        headRevisionId: revisionId, undoTransactionIds: [], redoTransactionIds: [],
      };
      const durability: ProjectDurability = {
        projectId, schemaVersion: PERSISTENCE_SCHEMA_VERSION, durableRevisionId: revisionId,
        lastExplicitSaveAt: timestamp, lastAutosaveAt: null, recoveryReason: null, recoveryCreatedAt: null,
      };
      return await this.repository.create({ project, revision, transaction, durability });
    } catch (error) { throw toProjectError(error); }
  }

  async openProject(projectId: string): Promise<ProjectRecord> {
    return this.repository.markOpened(projectId, this.now().toISOString());
  }

  async createPhotoDocument(input: CreatePhotoDocumentInput, context: ProjectCommandContext = {}): Promise<ProjectMutationResult> {
    try {
      const parsed = createPhotoDocumentInputSchema.parse(input);
      const history = await this.repository.getHistory(parsed.projectId);
      if (parsed.expectedRevisionId && parsed.expectedRevisionId !== history.headRevision.id) {
        throw new ProjectError("HISTORY_CONFLICT", "The project changed before the image document could be created. Inspect the latest revision and try again.");
      }
      if (history.headRevision.state.kind === "video") {
        throw new ProjectError("INVALID_INPUT", "Create an image document in a photo or unassigned project.", { fieldPath: "projectId" });
      }
      if (history.headRevision.state.photoDocument) {
        throw new ProjectError("HISTORY_CONFLICT", "This project already has an image document.");
      }
      const document: PhotoDocument = {
        id: this.createDocumentId(),
        schemaVersion: PHOTO_DOCUMENT_SCHEMA_VERSION,
        widthPx: parsed.widthPx,
        heightPx: parsed.heightPx,
        resolutionPpi: parsed.resolutionPpi,
        orientation: parsed.orientation,
        background: parsed.background,
        createdAt: this.now().toISOString(),
      };
      const operation: ProjectOperation = {
        id: this.createOperationId(), schemaVersion: HISTORY_SCHEMA_VERSION, type: "document.create",
        projectId: parsed.projectId, fromKind: history.headRevision.state.kind, document,
      };
      return await this.commitOperations(history, [operation], {
        actor: this.parseActor(context),
        intent: context.intent ?? `Create a ${document.widthPx} × ${document.heightPx} pixel image document.`,
        summary: `Created a ${document.widthPx} × ${document.heightPx} image document.`,
        kind: "mutation", targetTransactionId: null, undoable: true,
        undoTransactionIds: [...history.project.undoTransactionIds], redoTransactionIds: [],
        affectedIds: [history.project.id, document.id],
        normalizedParameters: { ...parsed, documentId: document.id },
      });
    } catch (error) { throw toProjectError(error); }
  }

  async renameProject(input: RenameProjectInput, context: ProjectCommandContext = {}): Promise<ProjectMutationResult> {
    try {
      const parsed = renameProjectInputSchema.parse(input);
      const history = await this.repository.getHistory(parsed.projectId);
      if (history.headRevision.state.name === parsed.name) {
        throw new ProjectError("INVALID_INPUT", "Enter a different project name.", { fieldPath: "name" });
      }
      const operation: ProjectOperation = {
        id: this.createOperationId(), schemaVersion: HISTORY_SCHEMA_VERSION, type: "project.rename",
        projectId: history.project.id, fromName: history.headRevision.state.name, toName: parsed.name,
      };
      return await this.commitOperations(history, [operation], {
        actor: this.parseActor(context), intent: context.intent ?? `Rename the project to “${parsed.name}”.`,
        summary: `Renamed project to “${parsed.name}”.`, kind: "mutation", targetTransactionId: null,
        undoable: true, undoTransactionIds: [...history.project.undoTransactionIds], redoTransactionIds: [],
        normalizedParameters: { projectId: parsed.projectId, name: parsed.name },
      });
    } catch (error) { throw toProjectError(error); }
  }

  async duplicateProject(projectId: string, context: ProjectCommandContext = {}): Promise<ProjectRecord> {
    const history = await this.repository.getHistory(projectId);
    return this.createCopy(history, projectNameSchema.parse(`${history.headRevision.state.name} copy`), context, "Duplicate");
  }

  async saveProjectAs(projectId: string, name: string, context: ProjectCommandContext = {}): Promise<ProjectRecord> {
    const history = await this.repository.getHistory(projectId);
    return this.createCopy(history, projectNameSchema.parse(name), context, "Save As");
  }

  async deleteProject(projectId: string, context: ProjectCommandContext = {}): Promise<void> {
    try {
      const history = await this.repository.getHistory(projectId);
      const operation: ProjectOperation = {
        id: this.createOperationId(), schemaVersion: HISTORY_SCHEMA_VERSION, type: "project.delete", projectId,
        fromStatus: "active", toStatus: "deleted",
      };
      await this.commitOperations(history, [operation], {
        actor: this.parseActor(context), intent: context.intent ?? `Delete “${history.project.name}” from this browser.`,
        summary: `Deleted “${history.project.name}” from this browser.`, kind: "mutation", targetTransactionId: null,
        undoable: false, undoTransactionIds: history.project.undoTransactionIds, redoTransactionIds: [],
        normalizedParameters: { projectId }, durabilityMode: "explicit",
      });
    } catch (error) { throw toProjectError(error); }
  }

  saveProject(projectId: string): Promise<ProjectDurability> {
    return this.checkpointProject(projectId, "explicit");
  }

  autosaveProject(projectId: string): Promise<ProjectDurability> {
    return this.checkpointProject(projectId, "autosave");
  }

  recoverDraft(projectId: string): Promise<ProjectDurability> {
    return this.checkpointProject(projectId, "explicit");
  }

  async waitForAutosave(projectId: string): Promise<void> {
    const pending = this.pendingAutosaves.get(projectId);
    if (pending) return pending.promise;
    const persistence = await this.repository.getPersistence(projectId);
    if (persistence.hasRecoverableDraft) await this.autosaveProject(projectId);
  }

  async createSnapshot(projectId: string, name: string, context: ProjectCommandContext = {}): Promise<ProjectMutationResult> {
    try {
      const history = await this.repository.getHistory(projectId);
      const parsedName = projectNameSchema.parse(name);
      const snapshotId = this.createSnapshotId();
      const operation: ProjectOperation = {
        id: this.createOperationId(), schemaVersion: HISTORY_SCHEMA_VERSION, type: "project.snapshot", projectId,
        snapshotId, name: parsedName,
      };
      return await this.commitOperations(history, [operation], {
        actor: this.parseActor(context), intent: context.intent ?? `Create the snapshot “${parsedName}”.`,
        summary: `Saved snapshot “${parsedName}”.`, kind: "mutation", targetTransactionId: null, undoable: true,
        undoTransactionIds: [...history.project.undoTransactionIds], redoTransactionIds: [],
        affectedIds: [projectId, snapshotId], normalizedParameters: { projectId, name: parsedName, snapshotId },
        durabilityMode: "explicit",
      });
    } catch (error) { throw toProjectError(error); }
  }

  async restoreDurableRevision(projectId: string, context: ProjectCommandContext = {}): Promise<ProjectMutationResult> {
    try {
      const [history, persistence] = await Promise.all([
        this.repository.getHistory(projectId), this.repository.getPersistence(projectId),
      ]);
      if (!persistence.hasRecoverableDraft) {
        throw new ProjectError("HISTORY_NOT_AVAILABLE", "This project has no recoverable draft.");
      }
      const durable = await this.repository.getRevision(persistence.durability.durableRevisionId);
      const operation: ProjectOperation = {
        id: this.createOperationId(), schemaVersion: HISTORY_SCHEMA_VERSION, type: "project.restore", projectId,
        sourceRevisionId: durable.id, fromState: history.headRevision.state, toState: durable.state,
      };
      return await this.commitOperations(history, [operation], {
        actor: this.parseActor(context), intent: context.intent ?? "Open the last durable project revision.",
        summary: `Restored the last durable revision of “${history.project.name}”.`, kind: "mutation",
        targetTransactionId: null, undoable: true, undoTransactionIds: [...history.project.undoTransactionIds],
        redoTransactionIds: [], normalizedParameters: { projectId, durableRevisionId: durable.id }, durabilityMode: "explicit",
      });
    } catch (error) { throw toProjectError(error); }
  }

  async undoProject(projectId: string, context: ProjectCommandContext = {}): Promise<ProjectMutationResult> {
    try {
      const history = await this.repository.getHistory(projectId);
      const targetTransactionId = history.project.undoTransactionIds.at(-1);
      if (!targetTransactionId) throw new ProjectError("HISTORY_NOT_AVAILABLE", "There is no project change to undo.");
      const target = history.transactions.find((transaction) => transaction.id === targetTransactionId);
      if (!target || !target.undoable || target.kind !== "mutation") {
        throw new ProjectError("HISTORY_CORRUPTED", "The next Undo transaction is missing or cannot be safely reverted.");
      }
      const operations = invertProjectOperations(target.operations, this.createOperationId);
      return await this.commitOperations(history, operations, {
        actor: this.parseActor(context), intent: context.intent ?? `Undo: ${target.summary}`, summary: `Undid: ${target.summary}`,
        kind: "undo", targetTransactionId: target.id, undoable: false,
        undoTransactionIds: history.project.undoTransactionIds.slice(0, -1),
        redoTransactionIds: [...history.project.redoTransactionIds, target.id],
        normalizedParameters: { projectId, transactionId: target.id },
      });
    } catch (error) { throw toProjectError(error); }
  }

  async undoTransaction(projectId: string, transactionId: string, context: ProjectCommandContext = {}): Promise<ProjectMutationResult> {
    const history = await this.repository.getHistory(projectId);
    if (history.project.undoTransactionIds.at(-1) !== transactionId) {
      throw new ProjectError("HISTORY_CONFLICT", "This transaction is not the latest safe Undo target. Undo newer changes first.");
    }
    return this.undoProject(projectId, context);
  }

  async redoProject(projectId: string, context: ProjectCommandContext = {}): Promise<ProjectMutationResult> {
    try {
      const history = await this.repository.getHistory(projectId);
      const targetTransactionId = history.project.redoTransactionIds.at(-1);
      if (!targetTransactionId) throw new ProjectError("HISTORY_NOT_AVAILABLE", "There is no project change to redo.");
      const target = history.transactions.find((transaction) => transaction.id === targetTransactionId);
      if (!target || !target.undoable || target.kind !== "mutation") {
        throw new ProjectError("HISTORY_CORRUPTED", "The next Redo transaction is missing or cannot be safely replayed.");
      }
      const operations = replayProjectOperations(target.operations, this.createOperationId);
      return await this.commitOperations(history, operations, {
        actor: this.parseActor(context), intent: context.intent ?? `Redo: ${target.summary}`, summary: `Redid: ${target.summary}`,
        kind: "redo", targetTransactionId: target.id, undoable: false,
        undoTransactionIds: [...history.project.undoTransactionIds, target.id],
        redoTransactionIds: history.project.redoTransactionIds.slice(0, -1),
        normalizedParameters: { projectId, transactionId: target.id },
      });
    } catch (error) { throw toProjectError(error); }
  }

  async proposeTransaction(input: ProposeTransactionInput, context: ProjectCommandContext = {}): Promise<ProjectProposal> {
    try {
      const parsed = proposeTransactionInputSchema.parse(input);
      const history = await this.repository.getHistory(parsed.projectId);
      let currentName = history.headRevision.state.name;
      const normalizedOperations: ProjectOperation[] = [];
      const affectedIds = new Set<string>([parsed.projectId]);

      for (const requested of parsed.operations) {
        if (requested.type === "rename_project") {
          if (requested.name === currentName) throw new ProjectError("INVALID_INPUT", "Enter a different project name.", { fieldPath: "operations.name" });
          normalizedOperations.push({
            id: this.createOperationId(), schemaVersion: HISTORY_SCHEMA_VERSION, type: "project.rename",
            projectId: parsed.projectId, fromName: currentName, toName: requested.name,
          });
          currentName = requested.name;
        } else {
          const snapshotId = this.createSnapshotId();
          normalizedOperations.push({
            id: this.createOperationId(), schemaVersion: HISTORY_SCHEMA_VERSION, type: "project.snapshot",
            projectId: parsed.projectId, snapshotId, name: requested.name,
          });
          affectedIds.add(snapshotId);
        }
      }

      await this.repository.validateNameAvailable(parsed.projectId, currentName);
      applyProjectOperations(history.headRevision.state, normalizedOperations);
      const timestamp = this.now();
      const proposal = projectProposalSchema.parse({
        id: this.createProposalId(), schemaVersion: PERSISTENCE_SCHEMA_VERSION, projectId: parsed.projectId,
        sourceRevisionId: history.headRevision.id, status: "pending", requestedOperations: parsed.operations,
        normalizedOperations, summary: this.summarizeOperations(normalizedOperations, true), warnings: [],
        createdAt: timestamp.toISOString(), expiresAt: new Date(timestamp.getTime() + 10 * 60_000).toISOString(),
        appliedTransactionId: null,
      });
      void context;
      void affectedIds;
      return await this.repository.createProposal(proposal);
    } catch (error) { throw toProjectError(error); }
  }

  async applyProposal(proposalId: string, context: ProjectCommandContext = {}): Promise<ProjectMutationResult> {
    try {
      const proposal = await this.repository.getProposal(proposalId);
      if (proposal.status !== "pending") throw new ProjectError("PROPOSAL_STALE", "This proposal has already been resolved.");
      if (new Date(proposal.expiresAt).getTime() <= this.now().getTime()) {
        throw new ProjectError("PROPOSAL_EXPIRED", "This proposal expired. Review the latest project and create a new proposal.");
      }
      const history = await this.repository.getHistory(proposal.projectId);
      if (history.headRevision.id !== proposal.sourceRevisionId) {
        throw new ProjectError("PROPOSAL_STALE", "The project changed after this proposal was prepared. Review the latest revision first.");
      }
      const affectedIds = [proposal.projectId, ...proposal.normalizedOperations.flatMap((operation) =>
        operation.type === "project.snapshot" ? [operation.snapshotId] : [],
      )];
      return await this.commitOperations(history, proposal.normalizedOperations, {
        actor: this.parseActor(context, "agent"), intent: context.intent ?? "Apply the reviewed project proposal.",
        summary: this.summarizeOperations(proposal.normalizedOperations, false), kind: "mutation", targetTransactionId: null,
        undoable: true, undoTransactionIds: [...history.project.undoTransactionIds], redoTransactionIds: [],
        affectedIds, normalizedParameters: { proposalId, operations: proposal.requestedOperations }, proposalId,
      });
    } catch (error) { throw toProjectError(error); }
  }

  rejectProposal(proposalId: string): Promise<ProjectProposal> { return this.repository.rejectProposal(proposalId); }

  private async createCopy(
    sourceHistory: ProjectHistorySnapshot,
    name: string,
    context: ProjectCommandContext,
    mode: "Duplicate" | "Save As",
  ): Promise<ProjectRecord> {
    try {
      const timestamp = this.now().toISOString();
      const projectId = this.createProjectId();
      const revisionId = this.createRevisionId();
      const transactionId = this.createTransactionId();
      const state = { ...sourceHistory.headRevision.state, name, status: "active" as const };
      const operation: ProjectOperation = {
        id: this.createOperationId(), schemaVersion: HISTORY_SCHEMA_VERSION, type: "project.duplicate", projectId,
        sourceProjectId: sourceHistory.project.id, state,
      };
      const transaction: ProjectTransaction = {
        id: transactionId, schemaVersion: HISTORY_SCHEMA_VERSION, projectId, sequence: 0, kind: "initialize",
        targetTransactionId: null, sourceRevisionId: null, resultingRevisionId: revisionId, operations: [operation],
        actor: this.parseActor(context), intent: context.intent ?? `${mode} “${sourceHistory.project.name}”.`,
        summary: `Created “${name}” as a separate project.`, affectedIds: [sourceHistory.project.id, projectId],
        warnings: [], undoable: false, createdAt: timestamp,
      };
      const revision: ProjectRevision = {
        id: revisionId, schemaVersion: HISTORY_SCHEMA_VERSION, projectId, sequence: 0, parentRevisionId: null,
        transactionId, state, createdAt: timestamp,
      };
      const project: ProjectRecord = {
        ...sourceHistory.project, id: projectId, name, status: "active", createdAt: timestamp, updatedAt: timestamp,
        lastOpenedAt: null, deletedAt: null, headRevisionId: revisionId, undoTransactionIds: [], redoTransactionIds: [],
      };
      const durability: ProjectDurability = {
        projectId, schemaVersion: PERSISTENCE_SCHEMA_VERSION, durableRevisionId: revisionId,
        lastExplicitSaveAt: timestamp, lastAutosaveAt: null, recoveryReason: null, recoveryCreatedAt: null,
      };
      return await this.repository.create({ project, revision, transaction, durability });
    } catch (error) { throw toProjectError(error); }
  }

  private parseActor(context: ProjectCommandContext, defaultType: ProjectActor["type"] = "user"): ProjectActor {
    return projectActorSchema.parse(context.actor ?? {
      type: defaultType,
      id: defaultType === "agent" ? "webmcp-agent" : "local-user",
      displayName: defaultType === "agent" ? "WebMCP agent" : "You",
    });
  }

  private summarizeOperations(operations: ProjectOperation[], proposed: boolean): string {
    const parts = operations.map((operation) => {
      if (operation.type === "project.rename") return `rename the project to “${operation.toName}”`;
      if (operation.type === "project.snapshot") return `save snapshot “${operation.name}”`;
      if (operation.type === "document.create") return `create a ${operation.document.widthPx} × ${operation.document.heightPx} image document`;
      if (operation.type === "document.remove") return "remove the image document";
      return operation.type.replace("project.", "");
    });
    const joined = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
    return `${proposed ? "Proposed" : "Applied"}: ${joined}.`;
  }

  private async commitOperations(
    history: ProjectHistorySnapshot,
    operations: ProjectOperation[],
    metadata: {
      actor: ProjectActor;
      intent: string;
      summary: string;
      kind: ProjectTransaction["kind"];
      targetTransactionId: string | null;
      undoable: boolean;
      undoTransactionIds: string[];
      redoTransactionIds: string[];
      affectedIds?: string[];
      warnings?: string[];
      normalizedParameters: Record<string, unknown>;
      durabilityMode?: "draft" | "autosave" | "explicit";
      proposalId?: string;
    },
  ): Promise<ProjectMutationResult> {
    const timestamp = this.now().toISOString();
    const transactionId = this.createTransactionId();
    const revisionId = this.createRevisionId();
    const state = applyProjectOperations(history.headRevision.state, operations);
    const sequence = history.headRevision.sequence + 1;
    const transaction: ProjectTransaction = {
      id: transactionId, schemaVersion: HISTORY_SCHEMA_VERSION, projectId: history.project.id, sequence,
      kind: metadata.kind, targetTransactionId: metadata.targetTransactionId, sourceRevisionId: history.headRevision.id,
      resultingRevisionId: revisionId, operations, actor: metadata.actor, intent: metadata.intent, summary: metadata.summary,
      affectedIds: metadata.affectedIds ?? [history.project.id], warnings: metadata.warnings ?? [],
      undoable: metadata.undoable, createdAt: timestamp,
    };
    const revision: ProjectRevision = {
      id: revisionId, schemaVersion: HISTORY_SCHEMA_VERSION, projectId: history.project.id, sequence,
      parentRevisionId: history.headRevision.id, transactionId, state, createdAt: timestamp,
    };
    const project: ProjectRecord = {
      ...history.project, name: state.name, kind: state.kind, status: state.status, updatedAt: timestamp,
      deletedAt: state.status === "deleted" ? timestamp : null, headRevisionId: revisionId,
      undoTransactionIds: metadata.undoable ? [...metadata.undoTransactionIds, transactionId] : metadata.undoTransactionIds,
      redoTransactionIds: metadata.redoTransactionIds,
    };
    const committed = await this.repository.commit({
      expectedHeadRevisionId: history.headRevision.id, project, revision, transaction,
      durabilityMode: metadata.durabilityMode, proposalId: metadata.proposalId,
    });
    if ((metadata.durabilityMode ?? "draft") === "draft") this.scheduleAutosave(history.project.id);
    else this.resolvePendingAutosave(history.project.id);
    const result = {
      ...committed, transaction, canUndo: committed.project.undoTransactionIds.length > 0,
      canRedo: committed.project.redoTransactionIds.length > 0, normalizedParameters: metadata.normalizedParameters,
    };
    this.projectListeners.get(history.project.id)?.forEach((listener) => listener(result));
    return result;
  }

  private scheduleAutosave(projectId: string): void {
    if (this.autosaveDelayMs === null) return;
    let pending = this.pendingAutosaves.get(projectId);
    if (pending?.timer !== null && pending?.timer !== undefined) clearTimeout(pending.timer);
    if (!pending) {
      let resolve!: () => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<void>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      void promise.catch(() => undefined);
      pending = { timer: null, promise, resolve, reject };
    }
    pending.timer = setTimeout(() => {
      void this.checkpointProject(projectId, "autosave").catch(() => undefined);
    }, this.autosaveDelayMs);
    this.pendingAutosaves.set(projectId, pending);
  }

  private async checkpointProject(projectId: string, mode: "autosave" | "explicit"): Promise<ProjectDurability> {
    const pending = this.pendingAutosaves.get(projectId);
    if (pending?.timer !== null && pending?.timer !== undefined) {
      clearTimeout(pending.timer);
      pending.timer = null;
    }
    try {
      const durability = await this.repository.checkpoint(projectId, mode, this.now().toISOString());
      this.resolvePendingAutosave(projectId);
      return durability;
    } catch (error) {
      this.rejectPendingAutosave(projectId, error);
      throw error;
    }
  }

  private resolvePendingAutosave(projectId: string): void {
    const pending = this.pendingAutosaves.get(projectId);
    if (!pending) return;
    if (pending.timer !== null) clearTimeout(pending.timer);
    this.pendingAutosaves.delete(projectId);
    pending.resolve();
  }

  private rejectPendingAutosave(projectId: string, error: unknown): void {
    const pending = this.pendingAutosaves.get(projectId);
    if (!pending) return;
    if (pending.timer !== null) clearTimeout(pending.timer);
    this.pendingAutosaves.delete(projectId);
    pending.reject(toProjectError(error));
  }
}
