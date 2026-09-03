import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type {
  ProjectHistoryService,
  ProjectLifecycleService,
  ProjectMutationResult,
} from "../application/project-service";
import type { ProjectHistorySnapshot } from "../data/project-repository";
import type { ProjectRecord } from "../domain/project";
import type { ProjectRevision, ProjectTransaction } from "../domain/project-history";
import { createDefaultWorkspacePreference, type WorkspaceChange, type WorkspacePreference } from "../domain/workspace";
import { ProjectWorkspace } from "./ProjectWorkspacePage";

type WorkspaceService = ProjectLifecycleService & ProjectHistoryService;

function project(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: "project-1",
    schemaVersion: 2,
    name: "Anniversary film",
    kind: "video",
    status: "active",
    storageMode: "local",
    createdAt: "2026-09-01T08:00:00.000Z",
    updatedAt: "2026-09-01T08:01:00.000Z",
    lastOpenedAt: "2026-09-01T08:01:00.000Z",
    deletedAt: null,
    headRevisionId: "revision-2",
    undoTransactionIds: ["transaction-2"],
    redoTransactionIds: [],
    ...overrides,
  };
}

function revision(overrides: Partial<ProjectRevision> = {}): ProjectRevision {
  return {
    id: "revision-2",
    schemaVersion: 1,
    projectId: "project-1",
    sequence: 1,
    parentRevisionId: "revision-1",
    transactionId: "transaction-2",
    state: { name: "Anniversary film", kind: "video", status: "active" },
    createdAt: "2026-09-01T08:01:00.000Z",
    ...overrides,
  };
}

function transaction(overrides: Partial<ProjectTransaction> = {}): ProjectTransaction {
  return {
    id: "transaction-2",
    schemaVersion: 1,
    projectId: "project-1",
    sequence: 1,
    kind: "mutation",
    targetTransactionId: null,
    sourceRevisionId: "revision-1",
    resultingRevisionId: "revision-2",
    operations: [
      {
        id: "operation-2",
        schemaVersion: 1,
        type: "project.rename",
        projectId: "project-1",
        fromName: "Draft",
        toName: "Anniversary film",
      },
    ],
    actor: { type: "user", id: "local-user", displayName: "You" },
    intent: "Rename the project.",
    summary: "Renamed project to “Anniversary film”.",
    affectedIds: ["project-1"],
    warnings: [],
    undoable: true,
    createdAt: "2026-09-01T08:01:00.000Z",
    ...overrides,
  };
}

function snapshot(overrides: Partial<ProjectHistorySnapshot> = {}): ProjectHistorySnapshot {
  return {
    project: project(),
    headRevision: revision(),
    transactions: [transaction()],
    ...overrides,
  };
}

function result(history: ProjectHistorySnapshot, latest: ProjectTransaction): ProjectMutationResult {
  return {
    ...history,
    transaction: latest,
    canUndo: history.project.undoTransactionIds.length > 0,
    canRedo: history.project.redoTransactionIds.length > 0,
  };
}

function createWorkspaceApi() {
  let workspace = createDefaultWorkspacePreference("project-1", "2026-09-01T08:00:00.000Z");
  const listeners = new Set<(value: WorkspacePreference) => void>();
  return {
    getWorkspace: vi.fn(async () => workspace),
    applyWorkspaceChange: vi.fn(async (_projectId: string, input: WorkspaceChange) => {
      const change = input as Exclude<WorkspaceChange, undefined>;
      if (change.type === "viewport") workspace = { ...workspace, viewport: change.viewport, updatedAt: "2026-09-01T08:02:00.000Z" };
      else if (change.type === "tool") workspace = { ...workspace, activeTool: change.tool };
      else if (change.type === "overlay") workspace = { ...workspace, overlays: { ...workspace.overlays, [change.overlay]: change.enabled } };
      else if (change.type === "distraction_free") workspace = { ...workspace, distractionFree: change.enabled };
      else if (change.type === "selection") workspace = { ...workspace, selection: { type: change.selectionType, targetId: change.targetId, targetIds: change.targetIds ?? [] } };
      else if (change.type === "dock") workspace = { ...workspace, leadingPanel: change.leadingPanel };
      else if (change.type === "panel") workspace = { ...workspace, panels: { ...workspace.panels, [change.panel]: { ...workspace.panels[change.panel], ...(change.open === undefined ? {} : { open: change.open }), ...(change.widthPx === undefined ? {} : { widthPx: change.widthPx }) } } };
      listeners.forEach((listener) => listener(workspace));
      return workspace;
    }),
    subscribe: vi.fn((_projectId: string, listener: (value: WorkspacePreference) => void) => { listeners.add(listener); return () => listeners.delete(listener); }),
  };
}

function renderWorkspace(service: WorkspaceService) {
  return render(
    <MemoryRouter initialEntries={["/editor/project-1"]}>
      <Routes>
        <Route path="/editor/:projectId" element={<ProjectWorkspace service={service} workspaceApi={createWorkspaceApi()} />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProjectWorkspace", () => {
  it("shows provenance and appends Undo and Redo results", async () => {
    const user = userEvent.setup();
    const initial = snapshot();
    const undoTransaction = transaction({
      id: "transaction-3",
      sequence: 2,
      kind: "undo",
      targetTransactionId: "transaction-2",
      sourceRevisionId: "revision-2",
      resultingRevisionId: "revision-3",
      summary: "Undid: Renamed project to “Anniversary film”.",
      undoable: false,
    });
    const undone = snapshot({
      project: project({
        name: "Draft",
        headRevisionId: "revision-3",
        undoTransactionIds: [],
        redoTransactionIds: ["transaction-2"],
      }),
      headRevision: revision({
        id: "revision-3",
        sequence: 2,
        parentRevisionId: "revision-2",
        transactionId: "transaction-3",
        state: { name: "Draft", kind: "video", status: "active" },
      }),
      transactions: [transaction(), undoTransaction],
    });
    const redoTransaction = transaction({
      id: "transaction-4",
      sequence: 3,
      kind: "redo",
      targetTransactionId: "transaction-2",
      sourceRevisionId: "revision-3",
      resultingRevisionId: "revision-4",
      summary: "Redid: Renamed project to “Anniversary film”.",
      undoable: false,
    });
    const redone = snapshot({
      project: project({ headRevisionId: "revision-4" }),
      headRevision: revision({
        id: "revision-4",
        sequence: 3,
        parentRevisionId: "revision-3",
        transactionId: "transaction-4",
      }),
      transactions: [transaction(), undoTransaction, redoTransaction],
    });

    const service: WorkspaceService = {
      listProjects: vi.fn(),
      getProject: vi.fn(),
      createProject: vi.fn(),
      openProject: vi.fn(async () => initial.project),
      renameProject: vi.fn(),
      duplicateProject: vi.fn(),
      deleteProject: vi.fn(),
      getProjectHistory: vi.fn(async () => initial),
      undoProject: vi.fn(async () => result(undone, undoTransaction)),
      redoProject: vi.fn(async () => result(redone, redoTransaction)),
    };

    renderWorkspace(service);
    await screen.findByRole("heading", { name: "Layers" });
    await user.click(screen.getByRole("tab", { name: "History" }));
    expect(await screen.findByRole("heading", { name: "History" })).toBeInTheDocument();
    expect(screen.getByText("Renamed project to “Anniversary film”.")).toBeInTheDocument();
    expect(screen.getByText(/You ·/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Undo last project change" }));
    expect(
      await within(screen.getByRole("complementary", { name: "History" })).findByText(
        "Undid: Renamed project to “Anniversary film”.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Redo last undone project change" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Redo last undone project change" }));
    expect(
      await within(screen.getByRole("complementary", { name: "History" })).findByText(
        "Redid: Renamed project to “Anniversary film”.",
      ),
    ).toBeInTheDocument();
    expect(service.undoProject).toHaveBeenCalledWith("project-1");
    expect(service.redoProject).toHaveBeenCalledWith("project-1");
  });

  it("renames from the workspace through the shared project service", async () => {
    const user = userEvent.setup();
    const initial = snapshot();
    const renamedTransaction = transaction({ summary: "Renamed project to “Birthday reel”." });
    const renamed = snapshot({
      project: project({ name: "Birthday reel" }),
      headRevision: revision({ state: { name: "Birthday reel", kind: "video", status: "active" } }),
      transactions: [renamedTransaction],
    });
    const service: WorkspaceService = {
      listProjects: vi.fn(),
      getProject: vi.fn(),
      createProject: vi.fn(),
      openProject: vi.fn(async () => initial.project),
      renameProject: vi.fn(async () => result(renamed, renamedTransaction)),
      duplicateProject: vi.fn(),
      deleteProject: vi.fn(),
      getProjectHistory: vi.fn(async () => initial),
      undoProject: vi.fn(),
      redoProject: vi.fn(),
    };

    renderWorkspace(service);
    await screen.findByRole("heading", { name: "Layers" });
    await user.click(screen.getByRole("button", { name: "Rename project" }));
    const input = screen.getByLabelText("Project name");
    await user.clear(input);
    await user.type(input, "Birthday reel");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Rename project" }));

    await waitFor(() =>
      expect(service.renameProject).toHaveBeenCalledWith({ projectId: "project-1", name: "Birthday reel" }),
    );
    await waitFor(() => expect(screen.getAllByText("Birthday reel").length).toBeGreaterThan(0));
  });
});
