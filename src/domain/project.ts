import { z } from "zod";

export const PROJECT_SCHEMA_VERSION = 2 as const;

export const projectKindSchema = z.enum(["photo", "video", "unassigned"]);
export type ProjectKind = z.infer<typeof projectKindSchema>;

export const projectStatusSchema = z.enum(["active", "deleted"]);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

export const projectNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a project name.")
  .max(120, "Use a project name with 120 characters or fewer.");

export const projectRecordSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  name: projectNameSchema,
  kind: projectKindSchema,
  status: projectStatusSchema,
  storageMode: z.literal("local"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastOpenedAt: z.string().datetime().nullable(),
  deletedAt: z.string().datetime().nullable(),
  headRevisionId: z.string().min(1),
  undoTransactionIds: z.array(z.string().min(1)),
  redoTransactionIds: z.array(z.string().min(1)),
});

export type ProjectRecord = z.infer<typeof projectRecordSchema>;

export const createProjectInputSchema = z.object({
  name: projectNameSchema,
  kind: projectKindSchema.default("unassigned"),
});

export type CreateProjectInput = z.input<typeof createProjectInputSchema>;

export const renameProjectInputSchema = z.object({
  projectId: z.string().min(1),
  name: projectNameSchema,
});

export type RenameProjectInput = z.input<typeof renameProjectInputSchema>;

export function parseProjectRecord(value: unknown): ProjectRecord {
  return projectRecordSchema.parse(value);
}
