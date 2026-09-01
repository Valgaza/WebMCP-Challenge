import { describe, expect, it } from "vitest";
import { createProjectInputSchema, projectRecordSchema } from "./project";

describe("project schema", () => {
  it("normalizes a valid project name", () => {
    expect(createProjectInputSchema.parse({ name: "  Anniversary film  " })).toEqual({
      name: "Anniversary film",
      kind: "unassigned",
    });
  });

  it("rejects an empty project name with actionable copy", () => {
    const result = createProjectInputSchema.safeParse({ name: "   " });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Enter a project name.");
      expect(result.error.issues[0]?.path).toEqual(["name"]);
    }
  });

  it("rejects project records from an unknown schema version", () => {
    const result = projectRecordSchema.safeParse({
      id: "project-1",
      schemaVersion: 3,
      name: "Anniversary film",
      kind: "video",
      status: "active",
      storageMode: "local",
      createdAt: "2026-09-01T08:00:00.000Z",
      updatedAt: "2026-09-01T08:00:00.000Z",
      lastOpenedAt: null,
      deletedAt: null,
      headRevisionId: "revision-1",
      undoTransactionIds: [],
      redoTransactionIds: [],
    });

    expect(result.success).toBe(false);
  });
});
