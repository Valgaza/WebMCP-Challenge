import { z } from "zod";
import { ProjectError } from "./project-error";
import { projectKindSchema, projectNameSchema, projectStatusSchema } from "./project";
import { photoDocumentSchema } from "./photo-document";

export const HISTORY_SCHEMA_VERSION = 1 as const;

export const projectStateSchema = z.object({
  name: projectNameSchema,
  kind: projectKindSchema,
  status: projectStatusSchema,
  photoDocument: photoDocumentSchema.nullable().optional(),
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
