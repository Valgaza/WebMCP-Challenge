import { z } from "zod";
import { projectOperationSchema } from "./project-history";
import { projectNameSchema } from "./project";

export const PERSISTENCE_SCHEMA_VERSION = 1 as const;

export const projectDurabilitySchema = z.object({
  projectId: z.string().min(1),
  schemaVersion: z.literal(PERSISTENCE_SCHEMA_VERSION),
  durableRevisionId: z.string().min(1),
  lastExplicitSaveAt: z.string().datetime().nullable(),
  lastAutosaveAt: z.string().datetime().nullable(),
  recoveryReason: z.string().trim().min(1).max(240).nullable(),
  recoveryCreatedAt: z.string().datetime().nullable(),
});

export type ProjectDurability = z.infer<typeof projectDurabilitySchema>;

export const projectSnapshotSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(PERSISTENCE_SCHEMA_VERSION),
  projectId: z.string().min(1),
  name: projectNameSchema,
  revisionId: z.string().min(1),
  transactionId: z.string().min(1),
  status: z.enum(["active", "removed"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ProjectSnapshot = z.infer<typeof projectSnapshotSchema>;

export const proposedOperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("rename_project"), name: projectNameSchema }),
  z.object({ type: z.literal("create_snapshot"), name: projectNameSchema }),
]);

export type ProposedOperation = z.infer<typeof proposedOperationSchema>;

export const projectProposalSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(PERSISTENCE_SCHEMA_VERSION),
  projectId: z.string().min(1),
  sourceRevisionId: z.string().min(1),
  status: z.enum(["pending", "applied", "rejected"]),
  requestedOperations: z.array(proposedOperationSchema).min(1).max(10),
  normalizedOperations: z.array(projectOperationSchema).min(1).max(10),
  summary: z.string().trim().min(1).max(240),
  warnings: z.array(z.string()),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  appliedTransactionId: z.string().min(1).nullable(),
});

export type ProjectProposal = z.infer<typeof projectProposalSchema>;

export const proposeTransactionInputSchema = z.object({
  projectId: z.string().min(1),
  operations: z.array(proposedOperationSchema).min(1).max(10),
});

export type ProposeTransactionInput = z.input<typeof proposeTransactionInputSchema>;

export interface ProjectPersistenceSnapshot {
  durability: ProjectDurability;
  snapshots: ProjectSnapshot[];
  hasRecoverableDraft: boolean;
  hasPendingAutosave: boolean;
}

export interface RecoverableProjectSummary {
  projectId: string;
  projectName: string;
  durableRevisionId: string;
  draftRevisionId: string;
  operationCount: number;
  reason: string;
  createdAt: string;
}

export function parseProjectDurability(value: unknown): ProjectDurability {
  return projectDurabilitySchema.parse(value);
}

export function parseProjectSnapshot(value: unknown): ProjectSnapshot {
  return projectSnapshotSchema.parse(value);
}

export function parseProjectProposal(value: unknown): ProjectProposal {
  return projectProposalSchema.parse(value);
}
