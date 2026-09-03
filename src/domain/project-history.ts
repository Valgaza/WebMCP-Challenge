import { z } from "zod";
import { ProjectError } from "./project-error";
import { projectKindSchema, projectNameSchema, projectStatusSchema } from "./project";
import { photoDocumentSchema } from "./photo-document";
import { assetReferenceSchema } from "./asset";
import { layerSchema } from "./layer";
import { swatchSchema } from "./vector";
import { binItemSchema, binSchema, sourceMarkerSchema, subclipSchema } from "./organization";
import { MAX_COLLECTIONS_PER_PROJECT, catalogueEntrySchema, collectionSchema } from "./catalogue";
import {
  MAX_COMMENTS_PER_PROJECT, collaboratorSchema, commentSchema, lockSchema, shareSchema,
  versionStackSchema,
} from "./review";

export const HISTORY_SCHEMA_VERSION = 1 as const;

export const projectStateSchema = z.object({
  name: projectNameSchema,
  kind: projectKindSchema,
  status: projectStatusSchema,
  photoDocument: photoDocumentSchema.nullable().optional(),
  // Only the edit-relevant facts live in history. Availability and file handles are runtime
  // truth held in the assets table, so a missing file never rewrites a revision.
  assets: z.array(assetReferenceSchema).max(2000).optional(),
  // Organization is project state, not a runtime convenience: moving an asset into a bin or
  // marking a subclip must be undoable and must travel with a duplicated project.
  bins: z.array(binSchema).max(200).optional(),
  binItems: z.array(binItemSchema).max(5000).optional(),
  subclips: z.array(subclipSchema).max(1000).optional(),
  sourceMarkers: z.array(sourceMarkerSchema).max(2000).optional(),
  /**
   * Ratings, labels, favourites, tags, and notes on media.
   *
   * Project state rather than a runtime convenience, for the same reason bins are: marking a
   * shot four stars is work, it has to be undoable, and it has to travel with the project.
   */
  catalogue: z.array(catalogueEntrySchema).max(5000).optional(),
  /** Saved questions about the media, as against places to file it. */
  collections: z.array(collectionSchema).max(MAX_COLLECTIONS_PER_PROJECT).optional(),
  /**
   * Review: who is on the project, what has been said about it, which versions exist, and who
   * has claimed what.
   *
   * Project state, because a note about a shot has to travel with the project and survive being
   * duplicated — and because resolving a comment is work someone did.
   */
  collaborators: z.array(collaboratorSchema).max(200).optional(),
  comments: z.array(commentSchema).max(MAX_COMMENTS_PER_PROJECT).optional(),
  versionStacks: z.array(versionStackSchema).max(200).optional(),
  locks: z.array(lockSchema).max(500).optional(),
  shares: z.array(shareSchema).max(200).optional(),
});

export type ProjectState = z.infer<typeof projectStateSchema>;

const operationBaseSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(HISTORY_SCHEMA_VERSION),
  projectId: z.string().min(1),
});

export const createProjectOperationSchema = operationBaseSchema.extend({
  type: z.literal("project.create"),
  state: projectStateSchema,
});

export const duplicateProjectOperationSchema = operationBaseSchema.extend({
  type: z.literal("project.duplicate"),
  sourceProjectId: z.string().min(1),
  state: projectStateSchema,
});

export const renameProjectOperationSchema = operationBaseSchema.extend({
  type: z.literal("project.rename"),
  fromName: projectNameSchema,
  toName: projectNameSchema,
});

export const deleteProjectOperationSchema = operationBaseSchema.extend({
  type: z.literal("project.delete"),
  fromStatus: z.literal("active"),
  toStatus: z.literal("deleted"),
});

export const snapshotProjectOperationSchema = operationBaseSchema.extend({
  type: z.literal("project.snapshot"),
  snapshotId: z.string().min(1),
  name: projectNameSchema,
});

export const removeSnapshotProjectOperationSchema = operationBaseSchema.extend({
  type: z.literal("project.snapshot.remove"),
  snapshotId: z.string().min(1),
  name: projectNameSchema,
});

export const restoreProjectOperationSchema = operationBaseSchema.extend({
  type: z.literal("project.restore"),
  sourceRevisionId: z.string().min(1),
  fromState: projectStateSchema,
  toState: projectStateSchema,
});

export const createPhotoDocumentOperationSchema = operationBaseSchema.extend({
  type: z.literal("document.create"),
  fromKind: z.enum(["photo", "unassigned"]),
  document: photoDocumentSchema,
});

export const removePhotoDocumentOperationSchema = operationBaseSchema.extend({
  type: z.literal("document.remove"),
  restoreKind: z.enum(["photo", "unassigned"]),
  document: photoDocumentSchema,
});

export const registerAssetOperationSchema = operationBaseSchema.extend({
  type: z.literal("asset.register"),
  asset: assetReferenceSchema,
});

export const removeAssetOperationSchema = operationBaseSchema.extend({
  type: z.literal("asset.remove"),
  asset: assetReferenceSchema,
});

/**
 * Replacing a source keeps the logical asset ID, so this operation carries both references
 * and inverts cleanly back to the previous media without disturbing anything that points
 * at the asset.
 */
export const replaceAssetSourceOperationSchema = operationBaseSchema.extend({
  type: z.literal("asset.replace_source"),
  fromAsset: assetReferenceSchema,
  toAsset: assetReferenceSchema,
});

/**
 * Layer edits carry the complete before and after tree. That keeps replay and inversion
 * trivially deterministic and avoids a family of fine-grained operations that would each
 * need their own inverse — the shared engine stays small.
 */
export const applyLayersOperationSchema = operationBaseSchema.extend({
  type: z.literal("layers.apply"),
  documentId: z.string().min(1),
  label: z.string().min(1).max(160),
  fromLayers: z.array(layerSchema).max(500),
  toLayers: z.array(layerSchema).max(500),
});

/**
 * Marking media, and the saved questions about it.
 *
 * One operation for both, because they are the same kind of change — a fact about the media
 * rather than about the edit — and separating them would give two undo steps to what a person
 * experiences as one act of organising.
 */
/**
 * Review state: people, comments, version stacks, locks, and shares.
 *
 * One operation for all five, because they are one kind of change — what is being said *about*
 * the project rather than what the project is — and because a review pass touches several of
 * them at once and should be one thing to undo.
 */
export const reviewOperationSchema = operationBaseSchema.extend({
  type: z.literal("project.review"),
  label: z.string().min(1).max(160),
  from: z.object({
    collaborators: z.array(collaboratorSchema).max(200),
    comments: z.array(commentSchema).max(MAX_COMMENTS_PER_PROJECT),
    versionStacks: z.array(versionStackSchema).max(200),
    locks: z.array(lockSchema).max(500),
    shares: z.array(shareSchema).max(200),
  }),
  to: z.object({
    collaborators: z.array(collaboratorSchema).max(200),
    comments: z.array(commentSchema).max(MAX_COMMENTS_PER_PROJECT),
    versionStacks: z.array(versionStackSchema).max(200),
    locks: z.array(lockSchema).max(500),
    shares: z.array(shareSchema).max(200),
  }),
});

export const catalogueOperationSchema = operationBaseSchema.extend({
  type: z.literal("project.catalogue"),
  label: z.string().min(1).max(160),
  fromEntries: z.array(catalogueEntrySchema).max(5000),
  toEntries: z.array(catalogueEntrySchema).max(5000),
  fromCollections: z.array(collectionSchema).max(MAX_COLLECTIONS_PER_PROJECT),
  toCollections: z.array(collectionSchema).max(MAX_COLLECTIONS_PER_PROJECT),
});

/**
 * The document's named colours and gradients.
 *
 * A separate operation from a layer edit because a swatch belongs to the document rather than
 * to any one layer — that is the whole point of it: changing a brand colour changes every
 * shape, stroke, and fill using it in one edit rather than in forty. Whole before and after
 * lists are carried, so the undo is the same operation with the two swapped.
 */
export const setSwatchesOperationSchema = operationBaseSchema.extend({
  type: z.literal("document.swatches"),
  documentId: z.string().min(1),
  label: z.string().min(1).max(160),
  fromSwatches: z.array(swatchSchema).max(256),
  toSwatches: z.array(swatchSchema).max(256),
});

/** Document geometry changes (canvas resize, image resample) are separate from layer edits. */
export const resizeDocumentOperationSchema = operationBaseSchema.extend({
  type: z.literal("document.resize"),
  documentId: z.string().min(1),
  mode: z.enum(["canvas", "image"]),
  fromWidthPx: z.number().int().min(1).max(32768),
  fromHeightPx: z.number().int().min(1).max(32768),
  toWidthPx: z.number().int().min(1).max(32768),
  toHeightPx: z.number().int().min(1).max(32768),
  fromLayers: z.array(layerSchema).max(500),
  toLayers: z.array(layerSchema).max(500),
  /**
   * The resampling the user chose.
   *
   * It belongs in history because the operation is not reproducible without it: replaying a
   * resize has to redo the same interpolation, and an interface that offers a choice and
   * then does not record it is offering a choice it does not honour.
   */
  resampleAlgorithm: z.enum(["nearest", "bilinear", "lanczos3", "browser-smooth"]).default("lanczos3"),
});




/**
 * Bins, subclips, storyboard positions, and source markers change together often enough that
 * one before/after operation is simpler and safer than a family of fine-grained ones, and it
 * inverts without a per-shape inverse.
 */
export const applyOrganizationOperationSchema = operationBaseSchema.extend({
  type: z.literal("organization.apply"),
  label: z.string().min(1).max(160),
  fromBins: z.array(binSchema).max(200),
  toBins: z.array(binSchema).max(200),
  fromItems: z.array(binItemSchema).max(5000),
  toItems: z.array(binItemSchema).max(5000),
  fromSubclips: z.array(subclipSchema).max(1000),
  toSubclips: z.array(subclipSchema).max(1000),
  fromSourceMarkers: z.array(sourceMarkerSchema).max(2000),
  toSourceMarkers: z.array(sourceMarkerSchema).max(2000),
});

export const projectOperationSchema = z.discriminatedUnion("type", [
  createProjectOperationSchema,
  duplicateProjectOperationSchema,
  renameProjectOperationSchema,
  deleteProjectOperationSchema,
  snapshotProjectOperationSchema,
  removeSnapshotProjectOperationSchema,
  restoreProjectOperationSchema,
  createPhotoDocumentOperationSchema,
  removePhotoDocumentOperationSchema,
  registerAssetOperationSchema,
  removeAssetOperationSchema,
  replaceAssetSourceOperationSchema,
  applyLayersOperationSchema,
  catalogueOperationSchema,
  reviewOperationSchema,
  setSwatchesOperationSchema,
  resizeDocumentOperationSchema,
  applyOrganizationOperationSchema,
]);

export type ProjectOperation = z.infer<typeof projectOperationSchema>;

export const projectActorSchema = z.object({
  type: z.enum(["user", "agent", "system"]),
  id: z.string().min(1),
  displayName: z.string().trim().min(1).max(120),
});

export type ProjectActor = z.infer<typeof projectActorSchema>;

export const projectTransactionSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(HISTORY_SCHEMA_VERSION),
  projectId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  kind: z.enum(["initialize", "mutation", "undo", "redo"]),
  targetTransactionId: z.string().min(1).nullable(),
  sourceRevisionId: z.string().min(1).nullable(),
  resultingRevisionId: z.string().min(1),
  operations: z.array(projectOperationSchema).min(1),
  actor: projectActorSchema,
  intent: z.string().trim().min(1).max(240),
  summary: z.string().trim().min(1).max(240),
  affectedIds: z.array(z.string().min(1)).min(1),
  warnings: z.array(z.string()),
  undoable: z.boolean(),
  createdAt: z.string().datetime(),
});

export type ProjectTransaction = z.infer<typeof projectTransactionSchema>;

export const projectRevisionSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(HISTORY_SCHEMA_VERSION),
  projectId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  parentRevisionId: z.string().min(1).nullable(),
  transactionId: z.string().min(1),
  state: projectStateSchema,
  createdAt: z.string().datetime(),
});

export type ProjectRevision = z.infer<typeof projectRevisionSchema>;

export function parseProjectRevision(value: unknown): ProjectRevision {
  return projectRevisionSchema.parse(value);
}

export function parseProjectTransaction(value: unknown): ProjectTransaction {
  return projectTransactionSchema.parse(value);
}

export function applyProjectOperations(
  startingState: ProjectState | null,
  operations: readonly ProjectOperation[],
): ProjectState {
  let state = startingState ? projectStateSchema.parse(startingState) : null;

  for (const unparsedOperation of operations) {
    const operation = projectOperationSchema.parse(unparsedOperation);

    if (operation.type === "project.create" || operation.type === "project.duplicate") {
      if (state !== null) {
        throw new ProjectError("HISTORY_CONFLICT", "This initialization operation cannot be applied to an existing project state.");
      }
      state = operation.state;
      continue;
    }

    if (!state) {
      throw new ProjectError("HISTORY_CORRUPTED", "This project history is missing its initial state.");
    }

    if (operation.type === "project.rename") {
      if (state.name !== operation.fromName) {
        throw new ProjectError(
          "HISTORY_CONFLICT",
          "The project name changed after this history operation. Reload the latest revision before trying again.",
        );
      }
      state = projectStateSchema.parse({ ...state, name: operation.toName });
      continue;
    }

    if (operation.type === "project.snapshot" || operation.type === "project.snapshot.remove") {
      continue;
    }

    if (operation.type === "document.create") {
      if (state.photoDocument != null) {
        throw new ProjectError("HISTORY_CONFLICT", "This project already has an image document.");
      }
      if (state.kind !== operation.fromKind) {
        throw new ProjectError("HISTORY_CONFLICT", "The project type changed before the image document could be created.");
      }
      state = projectStateSchema.parse({ ...state, kind: "photo", photoDocument: operation.document });
      continue;
    }

    if (operation.type === "document.remove") {
      if (state.photoDocument?.id !== operation.document.id) {
        throw new ProjectError("HISTORY_CONFLICT", "The image document changed before this operation could be undone.");
      }
      state = projectStateSchema.parse({ ...state, kind: operation.restoreKind, photoDocument: null });
      continue;
    }

    if (operation.type === "asset.register") {
      const assets = state.assets ?? [];
      if (assets.some((asset) => asset.id === operation.asset.id)) {
        throw new ProjectError("HISTORY_CONFLICT", "That asset is already registered in this project.");
      }
      state = projectStateSchema.parse({ ...state, assets: [...assets, operation.asset] });
      continue;
    }

    if (operation.type === "asset.remove") {
      const assets = state.assets ?? [];
      if (!assets.some((asset) => asset.id === operation.asset.id)) {
        throw new ProjectError("HISTORY_CONFLICT", "That asset is no longer registered in this project.");
      }
      state = projectStateSchema.parse({ ...state, assets: assets.filter((asset) => asset.id !== operation.asset.id) });
      continue;
    }

    if (operation.type === "asset.replace_source") {
      const assets = state.assets ?? [];
      const existing = assets.find((asset) => asset.id === operation.fromAsset.id);
      if (!existing) {
        throw new ProjectError("HISTORY_CONFLICT", "That asset is no longer registered in this project.");
      }
      if (existing.contentHash !== operation.fromAsset.contentHash) {
        throw new ProjectError("HISTORY_CONFLICT", "The asset source changed before this operation could be applied.");
      }
      state = projectStateSchema.parse({
        ...state,
        assets: assets.map((asset) => (asset.id === operation.fromAsset.id ? operation.toAsset : asset)),
      });
      continue;
    }

    if (operation.type === "layers.apply") {
      if (state.photoDocument?.id !== operation.documentId) {
        throw new ProjectError("HISTORY_CONFLICT", "The image document changed before this layer edit could be applied.");
      }
      if (JSON.stringify(state.photoDocument.layers) !== JSON.stringify(operation.fromLayers)) {
        throw new ProjectError("HISTORY_CONFLICT", "The layers changed after this edit was prepared. Reload the latest revision and try again.");
      }
      state = projectStateSchema.parse({
        ...state,
        photoDocument: { ...state.photoDocument, layers: operation.toLayers },
      });
      continue;
    }

    if (operation.type === "project.review") {
      state = projectStateSchema.parse({ ...state, ...operation.to });
      continue;
    }

    if (operation.type === "project.catalogue") {
      state = projectStateSchema.parse({
        ...state,
        catalogue: operation.toEntries,
        collections: operation.toCollections,
      });
      continue;
    }

    if (operation.type === "document.swatches") {
      if (state.photoDocument?.id !== operation.documentId) {
        throw new ProjectError("HISTORY_CONFLICT", "The image document changed before these swatches could be applied.");
      }
      state = projectStateSchema.parse({
        ...state,
        photoDocument: { ...state.photoDocument, swatches: operation.toSwatches },
      });
      continue;
    }

    if (operation.type === "document.resize") {
      if (state.photoDocument?.id !== operation.documentId) {
        throw new ProjectError("HISTORY_CONFLICT", "The image document changed before this resize could be applied.");
      }
      if (state.photoDocument.widthPx !== operation.fromWidthPx || state.photoDocument.heightPx !== operation.fromHeightPx) {
        throw new ProjectError("HISTORY_CONFLICT", "The document size changed after this resize was prepared.");
      }
      state = projectStateSchema.parse({
        ...state,
        photoDocument: {
          ...state.photoDocument,
          widthPx: operation.toWidthPx,
          heightPx: operation.toHeightPx,
          orientation: operation.toWidthPx === operation.toHeightPx ? "square" : operation.toWidthPx > operation.toHeightPx ? "landscape" : "portrait",
          layers: operation.toLayers,
        },
      });
      continue;
    }




    if (operation.type === "organization.apply") {
      const bins = state.bins ?? [];
      const items = state.binItems ?? [];
      const subclips = state.subclips ?? [];
      const sourceMarkers = state.sourceMarkers ?? [];
      if (
        JSON.stringify(bins) !== JSON.stringify(operation.fromBins)
        || JSON.stringify(items) !== JSON.stringify(operation.fromItems)
        || JSON.stringify(subclips) !== JSON.stringify(operation.fromSubclips)
        || JSON.stringify(sourceMarkers) !== JSON.stringify(operation.fromSourceMarkers)
      ) {
        throw new ProjectError("HISTORY_CONFLICT", "The project organization changed after this edit was prepared. Reload the latest revision and try again.");
      }
      state = projectStateSchema.parse({
        ...state,
        bins: operation.toBins,
        binItems: operation.toItems,
        subclips: operation.toSubclips,
        sourceMarkers: operation.toSourceMarkers,
      });
      continue;
    }

    if (operation.type === "project.restore") {
      if (
        state.name !== operation.fromState.name ||
        state.kind !== operation.fromState.kind ||
        state.status !== operation.fromState.status ||
        state.photoDocument?.id !== operation.fromState.photoDocument?.id
      ) {
        throw new ProjectError(
          "HISTORY_CONFLICT",
          "The project changed after this recovery operation was prepared. Reload the latest revision and try again.",
        );
      }
      state = projectStateSchema.parse(operation.toState);
      continue;
    }

    if (state.status !== operation.fromStatus) {
      throw new ProjectError(
        "HISTORY_CONFLICT",
        "The project lifecycle changed after this history operation. Reload the latest revision before trying again.",
      );
    }
    state = projectStateSchema.parse({ ...state, status: operation.toStatus });
  }

  if (!state) {
    throw new ProjectError("HISTORY_CORRUPTED", "This project history does not produce a project state.");
  }

  return state;
}

export function invertProjectOperations(
  operations: readonly ProjectOperation[],
  createOperationId: () => string,
): ProjectOperation[] {
  return [...operations].reverse().map((operation) => {
    if (operation.type === "project.rename") {
      return renameProjectOperationSchema.parse({
        ...operation,
        id: createOperationId(),
        fromName: operation.toName,
        toName: operation.fromName,
      });
    }

    if (operation.type === "project.snapshot") {
      return removeSnapshotProjectOperationSchema.parse({
        ...operation,
        id: createOperationId(),
        type: "project.snapshot.remove",
      });
    }

    if (operation.type === "project.snapshot.remove") {
      return snapshotProjectOperationSchema.parse({
        ...operation,
        id: createOperationId(),
        type: "project.snapshot",
      });
    }

    if (operation.type === "organization.apply") {
      return applyOrganizationOperationSchema.parse({
        ...operation, id: createOperationId(),
        fromBins: operation.toBins, toBins: operation.fromBins,
        fromItems: operation.toItems, toItems: operation.fromItems,
        fromSubclips: operation.toSubclips, toSubclips: operation.fromSubclips,
        fromSourceMarkers: operation.toSourceMarkers, toSourceMarkers: operation.fromSourceMarkers,
        label: `Undo: ${operation.label}`,
      });
    }

    if (operation.type === "project.restore") {
      return restoreProjectOperationSchema.parse({
        ...operation,
        id: createOperationId(),
        fromState: operation.toState,
        toState: operation.fromState,
      });
    }

    if (operation.type === "document.create") {
      return removePhotoDocumentOperationSchema.parse({
        ...operation,
        id: createOperationId(),
        type: "document.remove",
        restoreKind: operation.fromKind,
      });
    }

    if (operation.type === "document.remove") {
      return createPhotoDocumentOperationSchema.parse({
        ...operation,
        id: createOperationId(),
        type: "document.create",
        fromKind: operation.restoreKind,
      });
    }




    if (operation.type === "layers.apply") {
      return applyLayersOperationSchema.parse({
        ...operation, id: createOperationId(),
        fromLayers: operation.toLayers, toLayers: operation.fromLayers,
        label: `Undo: ${operation.label}`,
      });
    }

    if (operation.type === "project.review") {
      return reviewOperationSchema.parse({
        ...operation, id: createOperationId(),
        from: operation.to, to: operation.from,
        label: `Undo: ${operation.label}`,
      });
    }

    if (operation.type === "project.catalogue") {
      return catalogueOperationSchema.parse({
        ...operation, id: createOperationId(),
        fromEntries: operation.toEntries, toEntries: operation.fromEntries,
        fromCollections: operation.toCollections, toCollections: operation.fromCollections,
        label: `Undo: ${operation.label}`,
      });
    }

    if (operation.type === "document.swatches") {
      return setSwatchesOperationSchema.parse({
        ...operation, id: createOperationId(),
        fromSwatches: operation.toSwatches, toSwatches: operation.fromSwatches,
        label: `Undo: ${operation.label}`,
      });
    }

    if (operation.type === "document.resize") {
      return resizeDocumentOperationSchema.parse({
        ...operation, id: createOperationId(),
        fromWidthPx: operation.toWidthPx, fromHeightPx: operation.toHeightPx,
        toWidthPx: operation.fromWidthPx, toHeightPx: operation.fromHeightPx,
        fromLayers: operation.toLayers, toLayers: operation.fromLayers,
      });
    }

    if (operation.type === "asset.register") {
      return removeAssetOperationSchema.parse({ ...operation, id: createOperationId(), type: "asset.remove" });
    }

    if (operation.type === "asset.remove") {
      return registerAssetOperationSchema.parse({ ...operation, id: createOperationId(), type: "asset.register" });
    }

    if (operation.type === "asset.replace_source") {
      return replaceAssetSourceOperationSchema.parse({
        ...operation,
        id: createOperationId(),
        fromAsset: operation.toAsset,
        toAsset: operation.fromAsset,
      });
    }

    {
      throw new ProjectError(
        "HISTORY_CONFLICT",
        "This transaction cannot be safely undone in the current project history.",
      );
    }
  });
}

export function replayProjectOperations(
  operations: readonly ProjectOperation[],
  createOperationId: () => string,
): ProjectOperation[] {
  return operations.map((operation) => projectOperationSchema.parse({ ...operation, id: createOperationId() }));
}

/* --------------------------- selective revert (SH-014) -------------------------- */

/** A later transaction that stands between a target and a safe revert. */
export interface RevertConflict {
  transactionId: string;
  summary: string;
  /** The objects both transactions touched, which is why the revert is unsafe. */
  sharedIds: string[];
}

/**
 * What reverting one transaction would do, decided before anything is committed.
 *
 * A plan is either safe and carries the inverse operations, or unsafe and names exactly which
 * later transactions block it and over which objects.
 */
export interface SelectiveRevertPlan {
  transactionId: string;
  summary: string;
  safe: boolean;
  /** Empty when the plan is unsafe; nothing half-formed is ever handed back. */
  operations: ProjectOperation[];
  conflicts: RevertConflict[];
  affectedIds: string[];
  /** Plain-language reason a plan is unsafe, or null when it is safe. */
  reason: string | null;
}

/**
 * Plans the reversal of one transaction that is not necessarily the latest.
 *
 * Undo walks backwards from the head, so it never has to ask whether the step it is removing
 * still makes sense. Reverting something from the middle does: any later work that touched the
 * same objects was built on the very state this would remove, and applying the inverse anyway
 * would silently discard or corrupt it.
 *
 * So the rule is deliberately strict rather than clever. A transaction can be reverted alone
 * only when nothing after it touched anything it touched. Where that does not hold, the plan
 * comes back unsafe with the blocking transactions named, and the caller restores a snapshot
 * or reverts the newer work first — which is what the ledger requires instead of a silent
 * merge.
 *
 * The revert is committed as a new transaction. History is a record of what happened, and
 * removing an entry from it would make that record a lie.
 */
export function planSelectiveRevert(
  transactions: readonly ProjectTransaction[],
  targetTransactionId: string,
  createOperationId: () => string,
): SelectiveRevertPlan {
  const ordered = [...transactions].sort((a, b) => a.sequence - b.sequence);
  const index = ordered.findIndex((entry) => entry.id === targetTransactionId);
  const target = index === -1 ? null : ordered[index];

  if (!target) {
    throw new ProjectError("HISTORY_NOT_AVAILABLE", "That change is not in this project's history.", { fieldPath: "transactionId" });
  }
  const empty = { transactionId: target.id, summary: target.summary, operations: [], affectedIds: [...target.affectedIds] };

  if (target.kind !== "mutation" || !target.undoable) {
    return {
      ...empty, safe: false, conflicts: [],
      reason: target.kind === "initialize"
        ? "This is the change that created the project, so there is nothing before it to return to."
        : "This entry records an Undo or Redo rather than an edit, so it cannot be reverted on its own.",
    };
  }

  // The project ID appears on every transaction, so treating it as a shared object would
  // make everything conflict with everything. But a change whose *only* subject is the
  // project — a rename, say — really does conflict with a later one, because both write the
  // same field. So the project counts as shared exactly when both sides are project-scoped.
  const objectsOf = (entry: ProjectTransaction) => entry.affectedIds.filter((id) => id !== entry.projectId);
  const targetObjects = new Set(objectsOf(target));
  const targetIsProjectScoped = targetObjects.size === 0;
  const conflicts: RevertConflict[] = [];

  for (const later of ordered.slice(index + 1)) {
    if (later.kind !== "mutation") continue;
    const laterObjects = objectsOf(later);
    const shared = laterObjects.filter((id) => targetObjects.has(id));
    if (targetIsProjectScoped && laterObjects.length === 0) shared.push(later.projectId);
    if (shared.length) conflicts.push({ transactionId: later.id, summary: later.summary, sharedIds: shared });
  }

  if (conflicts.length) {
    const names = conflicts.slice(0, 3).map((entry) => `“${entry.summary}”`).join(", ");
    return {
      ...empty, safe: false, conflicts,
      reason: `${conflicts.length} later change${conflicts.length === 1 ? "" : "s"} built on this one (${names}). Revert ${conflicts.length === 1 ? "it" : "those"} first, or restore a snapshot from before this point.`,
    };
  }

  return {
    ...empty,
    safe: true,
    operations: invertProjectOperations(target.operations, createOperationId),
    conflicts: [],
    reason: null,
  };
}
