import { describe, expect, it } from "vitest";
import {
  HISTORY_SCHEMA_VERSION,
  applyProjectOperations,
  invertProjectOperations,
  replayProjectOperations,
  type ProjectOperation,
} from "./project-history";

function renameOperation(overrides: Partial<Extract<ProjectOperation, { type: "project.rename" }>> = {}) {
  return {
    id: "operation-1",
    schemaVersion: HISTORY_SCHEMA_VERSION,
    type: "project.rename" as const,
    projectId: "project-1",
    fromName: "Draft",
    toName: "Anniversary film",
    ...overrides,
  };
}

describe("project history", () => {
  it("replays the same typed operation deterministically", () => {
    const startingState = { name: "Draft", kind: "video" as const, status: "active" as const };
    const operation = renameOperation();

    expect(applyProjectOperations(startingState, [operation])).toEqual(
      applyProjectOperations(startingState, [operation]),
    );
    expect(applyProjectOperations(startingState, [operation])).toEqual({
      name: "Anniversary film",
      kind: "video",
      status: "active",
    });
  });

  it("creates safe inverse and replay operations with new stable IDs", () => {
    const operation = renameOperation();
    const inverse = invertProjectOperations([operation], () => "operation-undo");
    const replay = replayProjectOperations([operation], () => "operation-redo");

    expect(inverse).toEqual([
      expect.objectContaining({
        id: "operation-undo",
        fromName: "Anniversary film",
        toName: "Draft",
      }),
    ]);
    expect(replay).toEqual([expect.objectContaining({ id: "operation-redo", fromName: "Draft", toName: "Anniversary film" })]);
  });

  it("fails safely when replay starts from a conflicting state", () => {
    expect(() =>
      applyProjectOperations(
        { name: "Another name", kind: "video", status: "active" },
        [renameOperation()],
      ),
    ).toThrow("changed after this history operation");
  });
});
