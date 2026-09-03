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
  planSelectiveRevert,
  type SelectiveRevertPlan,
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
import type { Swatch } from "../domain/vector";
import type { CatalogueEntry, Collection } from "../domain/catalogue";
import type { Collaborator, Comment, Lock, Share, VersionStack } from "../domain/review";

/** The five review lists, moved together because a review pass touches several at once. */
export interface ReviewState {
  collaborators: Collaborator[];
  comments: Comment[];
  versionStacks: VersionStack[];
  locks: Lock[];
  shares: Share[];
}
import {
  PHOTO_DOCUMENT_SCHEMA_VERSION,
  createPhotoDocumentInputSchema,
  type CreatePhotoDocumentInput,
  type PhotoDocument,
} from "../domain/photo-document";
import { assetReferenceSchema, type AssetReference } from "../domain/asset";
import type { Layer } from "../domain/layer";
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
  /**
   * The revision the caller believes it is editing.
   *
   * Carried on the shared context so an optimistic-concurrency check is one implementation
   * both the interface and WebMCP go through, rather than a check the agent path performs
   * and the interface path skips.
   */
  expectedRevisionId?: string;
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
  listRevisions?(projectId: string, limit?: number): Promise<import("../domain/project-history").ProjectRevision[]>;
  getRevision?(revisionId: string): Promise<import("../domain/project-history").ProjectRevision>;
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

/**
 * The asset-layer callbacks `ProjectService` needs after an operation that changes which
 * assets a project references or which project owns them.
 */
export interface SourceReconciler {
  /** Makes runtime asset records match the restored head revision. Never deletes bytes. */
  reconcile: (projectId: string) => Promise<unknown>;
  /** Gives a copied project its own records over the same originals. */
  cloneAssets: (fromProjectId: string, toProjectId: string) => Promise<{ cloned: number; warnings: string[] }>;
  /** Drops a project's claim on its originals, deleting bytes no project references. */
  releaseSources: (projectId: string) => Promise<unknown>;
}

export class ProjectService implements ProjectLifecycleService, ProjectHistoryService, ProjectPersistenceService, ProjectAutomationService, PhotoDocumentService {
  private sourceReconciler: SourceReconciler | null = null;

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
  /** Ordered revisions, so a comparison can render a real earlier state rather than a guess. */
  listRevisions(projectId: string, limit = 200) { return this.repository.listRevisions(projectId, limit); }
  getRevision(revisionId: string) { return this.repository.getRevision(revisionId); }
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

  /**
   * Lets the asset layer keep runtime media state in step with history without this service
   * depending on it. History decides which assets a project references; only the asset layer
   * knows whether their bytes are reachable, and the two have to agree after every operation
   * that rewrites the head revision.
   */
  registerSourceReconciler(reconciler: SourceReconciler): void {
    this.sourceReconciler = reconciler;
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
        layers: [],
      swatches: [],
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

  /**
   * Asset registration is a project mutation like any other, so a dragged file and a WebMCP
   * import produce the same revision, transaction, summary, and Undo token.
   */
  async registerAsset(
    input: { projectId: string; asset: AssetReference; expectedRevisionId?: string },
    context: ProjectCommandContext = {},
  ): Promise<ProjectMutationResult> {
    try {
      const asset = assetReferenceSchema.parse(input.asset);
      const history = await this.repository.getHistory(input.projectId);
      if (input.expectedRevisionId && input.expectedRevisionId !== history.headRevision.id) {
        throw new ProjectError("HISTORY_CONFLICT", "The project changed before this asset could be registered. Inspect the latest revision and try again.");
      }
      const operation: ProjectOperation = {
        id: this.createOperationId(), schemaVersion: HISTORY_SCHEMA_VERSION, type: "asset.register",
        projectId: input.projectId, asset,
      };
      return await this.commitOperations(history, [operation], {
        actor: this.parseActor(context),
        intent: context.intent ?? `Add “${asset.name}” to the project.`,
        summary: `Added “${asset.name}” (${asset.widthPx} × ${asset.heightPx}).`,
        kind: "mutation", targetTransactionId: null, undoable: true,
        undoTransactionIds: [...history.project.undoTransactionIds], redoTransactionIds: [],
        affectedIds: [history.project.id, asset.id],
        normalizedParameters: { assetId: asset.id, mediaType: asset.mediaType },
      });
    } catch (error) { throw toProjectError(error); }
  }

  async removeAsset(
    input: { projectId: string; asset: AssetReference },
    context: ProjectCommandContext = {},
  ): Promise<ProjectMutationResult> {
    try {
      const asset = assetReferenceSchema.parse(input.asset);
      const history = await this.repository.getHistory(input.projectId);
      this.assertExpectedRevision(history, context);
      const operation: ProjectOperation = {
        id: this.createOperationId(), schemaVersion: HISTORY_SCHEMA_VERSION, type: "asset.remove",
        projectId: input.projectId, asset,
      };
      return await this.commitOperations(history, [operation], {
        actor: this.parseActor(context),
        intent: context.intent ?? `Remove “${asset.name}” from the project.`,
        summary: `Removed “${asset.name}” from the project.`,
        kind: "mutation", targetTransactionId: null, undoable: true,
        undoTransactionIds: [...history.project.undoTransactionIds], redoTransactionIds: [],
        affectedIds: [history.project.id, asset.id],
        normalizedParameters: { assetId: asset.id },
      });
    } catch (error) { throw toProjectError(error); }
  }

  /**
   * The logical asset ID is deliberately preserved so every edit that points at this asset
   * survives the source change. Compatibility losses travel with the transaction as warnings.
   */
  async replaceAssetSource(
    input: { projectId: string; fromAsset: AssetReference; toAsset: AssetReference; warnings?: string[] },
    context: ProjectCommandContext = {},
  ): Promise<ProjectMutationResult> {
    try {
      const fromAsset = assetReferenceSchema.parse(input.fromAsset);
      const toAsset = assetReferenceSchema.parse(input.toAsset);
      if (fromAsset.id !== toAsset.id) {
        throw new ProjectError("INVALID_INPUT", "Replacing a source must keep the same asset identity.", { fieldPath: "toAsset.id" });
      }
      const history = await this.repository.getHistory(input.projectId);
      this.assertExpectedRevision(history, context);
      const operation: ProjectOperation = {
        id: this.createOperationId(), schemaVersion: HISTORY_SCHEMA_VERSION, type: "asset.replace_source",
        projectId: input.projectId, fromAsset, toAsset,
      };
      return await this.commitOperations(history, [operation], {
        actor: this.parseActor(context),
        intent: context.intent ?? `Replace the source for “${fromAsset.name}”.`,
        summary: `Replaced the source for “${toAsset.name}”. Existing edits were preserved.`,
        kind: "mutation", targetTransactionId: null, undoable: true,
        undoTransactionIds: [...history.project.undoTransactionIds], redoTransactionIds: [],
        affectedIds: [history.project.id, toAsset.id],
        warnings: input.warnings ?? [],
        normalizedParameters: { assetId: toAsset.id, contentHash: toAsset.contentHash },
      });
    } catch (error) { throw toProjectError(error); }
  }

  /**
   * Commits a complete layer-tree change. Carrying both trees keeps replay and inversion
   * deterministic without a family of fine-grained operations.
   */
  async applyLayers(
    input: { projectId: string; documentId: string; label: string; fromLayers: Layer[]; toLayers: Layer[]; warnings?: string[] },
    context: ProjectCommandContext = {},
  ): Promise<ProjectMutationResult> {
    try {
      const history = await this.repository.getHistory(input.projectId);
      this.assertExpectedRevision(history, context);
      const operation: ProjectOperation = {
        id: this.createOperationId(), schemaVersion: HISTORY_SCHEMA_VERSION, type: "layers.apply",
        projectId: input.projectId, documentId: input.documentId, label: input.label,
        fromLayers: input.fromLayers, toLayers: input.toLayers,
      };
      return await this.commitOperations(history, [operation], {
        actor: this.parseActor(context),
        intent: context.intent ?? input.label,
        summary: input.label,
        kind: "mutation", targetTransactionId: null, undoable: true,
        undoTransactionIds: [...history.project.undoTransactionIds], redoTransactionIds: [],
        affectedIds: [history.project.id, input.documentId],
        warnings: input.warnings ?? [],
        normalizedParameters: { documentId: input.documentId, layerCount: input.toLayers.length },
      });
    } catch (error) { throw toProjectError(error); }
  }

  /**
   * The document's named colours and gradients.
   *
   * Separate from a layer edit because a swatch belongs to the document: changing one changes
   * every shape, stroke, and fill using it, which is the reason to have swatches at all.
   */
  async applySwatches(
    input: { projectId: string; documentId: string; label: string; fromSwatches: Swatch[]; toSwatches: Swatch[] },
    context: ProjectCommandContext = {},
  ): Promise<ProjectMutationResult> {
    try {
      const history = await this.repository.getHistory(input.projectId);
      this.assertExpectedRevision(history, context);
      const operation: ProjectOperation = {
        id: this.createOperationId(), schemaVersion: HISTORY_SCHEMA_VERSION, type: "document.swatches",
        projectId: input.projectId, documentId: input.documentId, label: input.label,
        fromSwatches: input.fromSwatches, toSwatches: input.toSwatches,
      };
      return await this.commitOperations(history, [operation], {
        actor: this.parseActor(context),
        intent: context.intent ?? input.label,
        summary: input.label,
        kind: "mutation", targetTransactionId: null, undoable: true,
        undoTransactionIds: [...history.project.undoTransactionIds], redoTransactionIds: [],
        affectedIds: [history.project.id, input.documentId],
        warnings: [],
        normalizedParameters: { documentId: input.documentId, swatchCount: input.toSwatches.length },
      });
    } catch (error) { throw toProjectError(error); }
  }

  /**
   * Marking media, and the saved questions about it.
   *
   * One command for both because they are the same kind of change — a fact about the media
   * rather than about the edit — and separating them would give two undo steps to what a
   * person experiences as one act of organising.
   */
  async applyCatalogue(
    input: {
      projectId: string; label: string;
      fromEntries: CatalogueEntry[]; toEntries: CatalogueEntry[];
      fromCollections: Collection[]; toCollections: Collection[];
    },
    context: ProjectCommandContext = {},
  ): Promise<ProjectMutationResult> {
    try {
      const history = await this.repository.getHistory(input.projectId);
      this.assertExpectedRevision(history, context);
      const operation: ProjectOperation = {
        id: this.createOperationId(), schemaVersion: HISTORY_SCHEMA_VERSION, type: "project.catalogue",
        projectId: input.projectId, label: input.label,
        fromEntries: input.fromEntries, toEntries: input.toEntries,
        fromCollections: input.fromCollections, toCollections: input.toCollections,
      };
      return await this.commitOperations(history, [operation], {
        actor: this.parseActor(context),
        intent: context.intent ?? input.label,
        summary: input.label,
        kind: "mutation", targetTransactionId: null, undoable: true,
        undoTransactionIds: [...history.project.undoTransactionIds], redoTransactionIds: [],
        affectedIds: [history.project.id],
        warnings: [],
        normalizedParameters: {
          markedCount: input.toEntries.length,
          collectionCount: input.toCollections.length,
        },
      });
    } catch (error) { throw toProjectError(error); }
  }

  /**
   * Review state: people, comments, version stacks, locks, and shares.
   *
   * One command for all five, because a review pass touches several at once and should be one
   * thing to undo — resolving a comment and marking a version approved is one act, not two.
   */
  async applyReview(
    input: {
      projectId: string; label: string;
      from: ReviewState; to: ReviewState;
    },
    context: ProjectCommandContext = {},
  ): Promise<ProjectMutationResult> {
    try {
      const history = await this.repository.getHistory(input.projectId);
      this.assertExpectedRevision(history, context);
      const operation: ProjectOperation = {
        id: this.createOperationId(), schemaVersion: HISTORY_SCHEMA_VERSION, type: "project.review",
        projectId: input.projectId, label: input.label,
        from: input.from, to: input.to,
      };
      return await this.commitOperations(history, [operation], {
        actor: this.parseActor(context),
        intent: context.intent ?? input.label,
        summary: input.label,
        kind: "mutation", targetTransactionId: null, undoable: true,
        undoTransactionIds: [...history.project.undoTransactionIds], redoTransactionIds: [],
        affectedIds: [history.project.id],
        warnings: [],
        normalizedParameters: {
          commentCount: input.to.comments.length,
          collaboratorCount: input.to.collaborators.length,
        },
      });
    } catch (error) { throw toProjectError(error); }
  }

  async resizeDocument(
    input: {
      projectId: string; documentId: string; mode: "canvas" | "image";
      fromWidthPx: number; fromHeightPx: number; toWidthPx: number; toHeightPx: number;
      fromLayers: Layer[]; toLayers: Layer[];
      resampleAlgorithm?: "nearest" | "bilinear" | "lanczos3" | "browser-smooth";
    },
    context: ProjectCommandContext = {},
  ): Promise<ProjectMutationResult> {
    try {
      const history = await this.repository.getHistory(input.projectId);
      this.assertExpectedRevision(history, context);
      const operation: ProjectOperation = {
        id: this.createOperationId(), schemaVersion: HISTORY_SCHEMA_VERSION, type: "document.resize",
        projectId: input.projectId, documentId: input.documentId, mode: input.mode,
        fromWidthPx: input.fromWidthPx, fromHeightPx: input.fromHeightPx,
        toWidthPx: input.toWidthPx, toHeightPx: input.toHeightPx,
        fromLayers: input.fromLayers, toLayers: input.toLayers,
        resampleAlgorithm: input.resampleAlgorithm ?? "lanczos3",
      };
      const label = input.mode === "canvas"
        ? `Resize canvas to ${input.toWidthPx} × ${input.toHeightPx}`
        : `Resample image to ${input.toWidthPx} × ${input.toHeightPx}`;
      return await this.commitOperations(history, [operation], {
        actor: this.parseActor(context),
        intent: context.intent ?? label,
        summary: label,
        kind: "mutation", targetTransactionId: null, undoable: true,
        undoTransactionIds: [...history.project.undoTransactionIds], redoTransactionIds: [],
        affectedIds: [history.project.id, input.documentId],
        normalizedParameters: {
          mode: input.mode, widthPx: input.toWidthPx, heightPx: input.toHeightPx,
          resampleAlgorithm: input.mode === "image" ? operation.resampleAlgorithm : null,
        },
      });
    } catch (error) { throw toProjectError(error); }
  }

  /**
   * Commits a whole organization change: bins, membership, storyboard positions, subclips,
   * and source markers, using the same before/after pattern as layers and sequences.
   */
  async applyOrganization(
    input: {
      projectId: string;
      label: string;
      from: { bins: unknown[]; items: unknown[]; subclips: unknown[]; sourceMarkers: unknown[] };
      to: { bins: unknown[]; items: unknown[]; subclips: unknown[]; sourceMarkers: unknown[] };
      warnings?: string[];
    },
    context: ProjectCommandContext = {},
  ): Promise<ProjectMutationResult> {
    try {
      const history = await this.repository.getHistory(input.projectId);
      this.assertExpectedRevision(history, context);
      const operation: ProjectOperation = {
        id: this.createOperationId(), schemaVersion: HISTORY_SCHEMA_VERSION, type: "organization.apply",
        projectId: input.projectId, label: input.label,
        fromBins: input.from.bins as never, toBins: input.to.bins as never,
        fromItems: input.from.items as never, toItems: input.to.items as never,
        fromSubclips: input.from.subclips as never, toSubclips: input.to.subclips as never,
        fromSourceMarkers: input.from.sourceMarkers as never, toSourceMarkers: input.to.sourceMarkers as never,
      };
      return await this.commitOperations(history, [operation], {
        actor: this.parseActor(context), intent: context.intent ?? input.label, summary: input.label,
        kind: "mutation", targetTransactionId: null, undoable: true,
        undoTransactionIds: [...history.project.undoTransactionIds], redoTransactionIds: [],
        affectedIds: [history.project.id],
        warnings: input.warnings ?? [],
        normalizedParameters: { binCount: input.to.bins.length, subclipCount: input.to.subclips.length },
      });
    } catch (error) { throw toProjectError(error); }
  }

  async renameProject(input: RenameProjectInput, context: ProjectCommandContext = {}): Promise<ProjectMutationResult> {
    try {
      const parsed = renameProjectInputSchema.parse(input);
      const history = await this.repository.getHistory(parsed.projectId);
      this.assertExpectedRevision(history, context);
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
      this.assertExpectedRevision(history, context);
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
      this.assertExpectedRevision(history, context);
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
      this.assertExpectedRevision(history, context);
      if (!persistence.hasRecoverableDraft) {
        throw new ProjectError("HISTORY_NOT_AVAILABLE", "This project has no recoverable draft.");
      }
      const durable = await this.repository.getRevision(persistence.durability.durableRevisionId);
      const operation: ProjectOperation = {
        id: this.createOperationId(), schemaVersion: HISTORY_SCHEMA_VERSION, type: "project.restore", projectId,
        sourceRevisionId: durable.id, fromState: history.headRevision.state, toState: durable.state,
      };
      const result = await this.commitOperations(history, [operation], {
        actor: this.parseActor(context), intent: context.intent ?? "Open the last durable project revision.",
        summary: `Restored the last durable revision of “${history.project.name}”.`, kind: "mutation",
        targetTransactionId: null, undoable: true, undoTransactionIds: [...history.project.undoTransactionIds],
        redoTransactionIds: [], normalizedParameters: { projectId, durableRevisionId: durable.id }, durabilityMode: "explicit",
      });
      // Restoring an older revision changes which assets — and which source revisions of
      // them — the project references. Runtime media state has to follow, or preview and
      // export would keep reading the bytes the user just moved away from.
      await this.sourceReconciler?.reconcile(projectId).catch(() => undefined);
      return result;
    } catch (error) { throw toProjectError(error); }
  }

  async undoProject(projectId: string, context: ProjectCommandContext = {}): Promise<ProjectMutationResult> {
    try {
      const history = await this.repository.getHistory(projectId);
      this.assertExpectedRevision(history, context);
      const targetTransactionId = history.project.undoTransactionIds.at(-1);
      if (!targetTransactionId) throw new ProjectError("HISTORY_NOT_AVAILABLE", "There is no project change to undo.");
      const target = history.transactions.find((transaction) => transaction.id === targetTransactionId);
      if (!target || !target.undoable || target.kind !== "mutation") {
        throw new ProjectError("HISTORY_CORRUPTED", "The next Undo transaction is missing or cannot be safely reverted.");
      }
      const operations = invertProjectOperations(target.operations, this.createOperationId);
      const result = await this.commitOperations(history, operations, {
        actor: this.parseActor(context), intent: context.intent ?? `Undo: ${target.summary}`, summary: `Undid: ${target.summary}`,
        kind: "undo", targetTransactionId: target.id, undoable: false,
        undoTransactionIds: history.project.undoTransactionIds.slice(0, -1),
        redoTransactionIds: [...history.project.redoTransactionIds, target.id],
        normalizedParameters: { projectId, transactionId: target.id },
      });
      // An undone import or relink must give back the earlier media state, not just the
      // earlier document.
      await this.sourceReconciler?.reconcile(projectId).catch(() => undefined);
      return result;
    } catch (error) { throw toProjectError(error); }
  }

  async undoTransaction(projectId: string, transactionId: string, context: ProjectCommandContext = {}): Promise<ProjectMutationResult> {
    const history = await this.repository.getHistory(projectId);
    this.assertExpectedRevision(history, context);
    if (history.project.undoTransactionIds.at(-1) !== transactionId) {
      throw new ProjectError("HISTORY_CONFLICT", "This transaction is not the latest safe Undo target. Undo newer changes first.");
    }
    return this.undoProject(projectId, context);
  }

  async redoProject(projectId: string, context: ProjectCommandContext = {}): Promise<ProjectMutationResult> {
    try {
      const history = await this.repository.getHistory(projectId);
      this.assertExpectedRevision(history, context);
      const targetTransactionId = history.project.redoTransactionIds.at(-1);
      if (!targetTransactionId) throw new ProjectError("HISTORY_NOT_AVAILABLE", "There is no project change to redo.");
      const target = history.transactions.find((transaction) => transaction.id === targetTransactionId);
      if (!target || !target.undoable || target.kind !== "mutation") {
        throw new ProjectError("HISTORY_CORRUPTED", "The next Redo transaction is missing or cannot be safely replayed.");
      }
      const operations = replayProjectOperations(target.operations, this.createOperationId);
      const result = await this.commitOperations(history, operations, {
        actor: this.parseActor(context), intent: context.intent ?? `Redo: ${target.summary}`, summary: `Redid: ${target.summary}`,
        kind: "redo", targetTransactionId: target.id, undoable: false,
        undoTransactionIds: [...history.project.undoTransactionIds, target.id],
        redoTransactionIds: history.project.redoTransactionIds.slice(0, -1),
        normalizedParameters: { projectId, transactionId: target.id },
      });
      await this.sourceReconciler?.reconcile(projectId).catch(() => undefined);
      return result;
    } catch (error) { throw toProjectError(error); }
  }

  /**
   * Returns the project to the state a named snapshot recorded.
   *
   * Like a revert, this is committed forward as a new transaction rather than by moving a
   * pointer backwards, so the work done since the snapshot stays in the record and can itself
   * be undone. The ledger names this as the safe fallback when a selective revert is refused.
   */
  async restoreSnapshot(
    projectId: string,
    snapshotId: string,
    context: ProjectCommandContext = {},
  ): Promise<ProjectMutationResult> {
    try {
      const [history, persistence] = await Promise.all([
        this.repository.getHistory(projectId), this.repository.getPersistence(projectId),
      ]);
      if (context.expectedRevisionId && context.expectedRevisionId !== history.headRevision.id) {
        throw new ProjectError("HISTORY_CONFLICT", "The project changed before this snapshot could be restored. Inspect the latest revision and try again.");
      }
      const snapshot = persistence.snapshots.find((entry) => entry.id === snapshotId && entry.status === "active");
      if (!snapshot) {
        throw new ProjectError("HISTORY_NOT_AVAILABLE", "That snapshot is not available in this project.", { fieldPath: "snapshotId" });
      }
      if (snapshot.revisionId === history.headRevision.id) {
        throw new ProjectError("INVALID_INPUT", `The project is already at “${snapshot.name}”.`, { fieldPath: "snapshotId" });
      }

      const target = await this.repository.getRevision(snapshot.revisionId);
      const operation: ProjectOperation = {
        id: this.createOperationId(), schemaVersion: HISTORY_SCHEMA_VERSION, type: "project.restore",
        projectId, sourceRevisionId: target.id,
        fromState: history.headRevision.state, toState: target.state,
      };
      const summary = `Restored the snapshot “${snapshot.name}”.`;
      const result = await this.commitOperations(history, [operation], {
        actor: this.parseActor(context), intent: context.intent ?? summary, summary,
        kind: "mutation", targetTransactionId: null, undoable: true,
        undoTransactionIds: [...history.project.undoTransactionIds], redoTransactionIds: [],
        normalizedParameters: { projectId, snapshotId, revisionId: snapshot.revisionId },
        durabilityMode: "explicit",
      });
      await this.sourceReconciler?.reconcile(projectId).catch(() => undefined);
      return result;
    } catch (error) { throw toProjectError(error); }
  }

  /**
   * Reports what reverting one past change would do, without doing it.
   *
   * Separate from the mutation because a revert from the middle of history can be refused,
   * and a caller — a person looking at the History panel, or an agent — deserves to see the
   * refusal and its reasons before committing to anything.
   */
  async planRevert(projectId: string, transactionId: string): Promise<SelectiveRevertPlan> {
    try {
      const history = await this.repository.getHistory(projectId);
      return planSelectiveRevert(history.transactions, transactionId, this.createOperationId);
    } catch (error) { throw toProjectError(error); }
  }

  /**
   * Reverts one past change, which need not be the most recent.
   *
   * The inverse is committed as a *new* transaction rather than by rewriting the log: history
   * records what happened, and editing it would make that record untrue. An unsafe revert is
   * refused with the blocking changes named, never merged silently.
   */
  async revertTransaction(
    projectId: string,
    transactionId: string,
    context: ProjectCommandContext = {},
  ): Promise<ProjectMutationResult & { plan: SelectiveRevertPlan }> {
    try {
      const history = await this.repository.getHistory(projectId);
      if (context.expectedRevisionId && context.expectedRevisionId !== history.headRevision.id) {
        throw new ProjectError("HISTORY_CONFLICT", "The project changed before this revert could be applied. Inspect the latest revision and try again.");
      }

      const plan = planSelectiveRevert(history.transactions, transactionId, this.createOperationId);
      if (!plan.safe) {
        throw new ProjectError("HISTORY_CONFLICT", plan.reason ?? "That change cannot be reverted on its own.", { fieldPath: "transactionId" });
      }

      const summary = `Reverted: ${plan.summary}`;
      const result = await this.commitOperations(history, plan.operations, {
        actor: this.parseActor(context), intent: context.intent ?? summary, summary,
        kind: "mutation", targetTransactionId: transactionId,
        // The revert is itself ordinary work, so it can be undone like anything else.
        undoable: true,
        undoTransactionIds: [...history.project.undoTransactionIds],
        redoTransactionIds: [],
        affectedIds: plan.affectedIds.length ? plan.affectedIds : [projectId],
        normalizedParameters: { projectId, revertedTransactionId: transactionId },
      });
      await this.sourceReconciler?.reconcile(projectId).catch(() => undefined);
      return { ...result, plan };
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
      this.assertExpectedRevision(history, context);
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

      // A copied project must open on its own, so its media library is cloned before the
      // project row exists. Copying only the document would produce a project whose history
      // references assets this browser has no runtime record for — an empty library beside a
      // timeline full of clips. Original bytes are shared by reference, not duplicated.
      const cloned = await this.sourceReconciler?.cloneAssets(sourceHistory.project.id, projectId);
      transaction.warnings = [...transaction.warnings, ...(cloned?.warnings ?? [])];

      try {
        return await this.repository.create({ project, revision, transaction, durability });
      } catch (error) {
        // The copy never became a project, so its cloned records must not outlive it.
        await this.sourceReconciler?.releaseSources(projectId).catch(() => undefined);
        throw error;
      }
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

  /**
   * Refuses a command whose caller was reading an older revision.
   *
   * The WebMCP tools used to compare the declared revision against the head themselves and
   * then call the service, which left a window: the interface could commit in between, and
   * the agent's edit landed on a revision it had never seen. Checking here — against the
   * history this method is about to commit onto, immediately before it does — closes that
   * window to the same width as the repository's own compare-and-set.
   */
  private assertExpectedRevision(history: ProjectHistorySnapshot, context: ProjectCommandContext): void {
    if (!context.expectedRevisionId) return;
    if (context.expectedRevisionId === history.headRevision.id) return;
    throw new ProjectError(
      "HISTORY_CONFLICT",
      `This project has moved on to revision ${history.headRevision.id} since ${context.expectedRevisionId} was read. Inspect the current revision and apply the change again.`,
      { fieldPath: "expectedRevisionId" },
    );
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
