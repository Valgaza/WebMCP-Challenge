import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectService } from "../application/project-service";
import { WorkspaceService } from "../application/workspace-service";
import { EstroDatabase } from "../data/estro-database";
import { ProjectRepository } from "../data/project-repository";
import type { ProjectRecord } from "../domain/project";
import { focusStore } from "../webmcp/focus-store";
import { ProjectWorkspace } from "./ProjectWorkspacePage";

describe("Phase 2 editor workspace", () => {
  let database: EstroDatabase;
  let projectService: ProjectService;
  let workspaceService: WorkspaceService;
  let project: ProjectRecord;

  beforeEach(async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1440 });
    database = new EstroDatabase(`estro-phase-2-ui-${crypto.randomUUID()}`);
    projectService = new ProjectService(new ProjectRepository(database), { autosaveDelayMs: 0, createDocumentId: () => "document-1" });
    workspaceService = new WorkspaceService(database);
    project = await projectService.createProject({ name: "Editorial canvas", kind: "unassigned" });
  });

  afterEach(async () => database.delete());

  function renderEditor() {
    return render(<MemoryRouter initialEntries={[`/editor/${project.id}`]}><Routes><Route path="/editor/:projectId" element={<ProjectWorkspace service={projectService} workspaceApi={workspaceService} />} /></Routes></MemoryRouter>);
  }

  it("creates an empty image document through the UI and supports Undo and Redo", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(await screen.findByRole("button", { name: "Create image document" }));
    const dialog = screen.getByRole("dialog", { name: "Create image document" });
    expect(within(dialog).getByLabelText(/Width/)).toHaveValue(1920);
    expect(within(dialog).getByRole("button", { name: "landscape" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(dialog).getByRole("button", { name: "Create document" }));

    expect(await screen.findByRole("button", { name: /Image document, 1920 by 1080 pixels/ })).toBeInTheDocument();
    expect(await screen.findByText("1,920 px")).toBeInTheDocument();
    await expect(projectService.getProjectHistory(project.id)).resolves.toMatchObject({
      project: { kind: "photo" },
      headRevision: { sequence: 1, state: { photoDocument: { id: "document-1", widthPx: 1920, heightPx: 1080 } } },
    });

    await user.click(screen.getByRole("button", { name: "Undo last project change" }));
    expect(await screen.findByRole("heading", { name: "Create the first image document" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Redo last undone project change" }));
    expect(await screen.findByRole("button", { name: /Image document, 1920 by 1080 pixels/ })).toBeInTheDocument();
  });

  it("uses the command palette and keyboard resizing without creating project revisions", async () => {
    const user = userEvent.setup();
    await projectService.createPhotoDocument({ projectId: project.id, expectedRevisionId: project.headRevisionId, widthPx: 1200, heightPx: 800, resolutionPpi: 72, orientation: "landscape", background: { type: "transparent" } });
    const sourceRevision = (await projectService.getProjectHistory(project.id)).headRevision.id;
    renderEditor();
    await screen.findByRole("button", { name: /Image document, 1200 by 800 pixels/ });

    await user.keyboard("{Control>}k{/Control}");
    const search = await screen.findByRole("searchbox", { name: "Search commands" });
    await user.type(search, "grid");
    await user.keyboard("{Enter}");
    await waitFor(async () => expect((await workspaceService.getWorkspace(project.id)).overlays.grid).toBe(true));

    const separator = screen.getByRole("separator", { name: "Resize left panel" });
    fireEvent.keyDown(separator, { key: "End" });
    await waitFor(async () => expect((await workspaceService.getWorkspace(project.id)).panels.left.widthPx).toBe(360));
    await user.click(screen.getByRole("button", { name: "Swap panel sides" }));
    await waitFor(async () => expect((await workspaceService.getWorkspace(project.id)).leadingPanel).toBe("inspector"));
    await expect(projectService.getProjectHistory(project.id)).resolves.toMatchObject({ headRevision: { id: sourceRevision } });
  });

  it("reveals and visibly focuses semantic targets requested by WebMCP", async () => {
    await projectService.createPhotoDocument({ projectId: project.id, expectedRevisionId: project.headRevisionId, widthPx: 1000, heightPx: 1000, resolutionPpi: 72, orientation: "square", background: { type: "solid", color: "#ffffff" } });
    renderEditor();
    await screen.findByRole("button", { name: /Image document, 1000 by 1000 pixels/ });
    focusStore.request(project.id, "inspector-document-width", "webmcp");
    await waitFor(() => expect(document.activeElement).toHaveAttribute("data-semantic-id", "inspector-document-width"));
    expect(document.activeElement).toHaveAttribute("data-agent-target", "true");
  });

  it("keeps a keyboard path for canvas zoom and announces semantic state", async () => {
    await projectService.createPhotoDocument({ projectId: project.id, expectedRevisionId: project.headRevisionId, widthPx: 1600, heightPx: 900, resolutionPpi: 72, orientation: "landscape", background: { type: "transparent" } });
    renderEditor();
    const canvas = await screen.findByRole("group", { name: "Image canvas" });
    canvas.focus();
    fireEvent.keyDown(canvas, { key: "+" });
    await waitFor(async () => expect((await workspaceService.getWorkspace(project.id)).viewport.zoom).toBeGreaterThan(1));
    expect(screen.getByRole("navigation", { name: "Editor tools" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Inspector" })).toBeInTheDocument();
  });

  it("keeps only the contextual side panel open at compact widths", async () => {
    await projectService.createPhotoDocument({ projectId: project.id, expectedRevisionId: project.headRevisionId, widthPx: 1200, heightPx: 800, resolutionPpi: 72, orientation: "landscape", background: { type: "transparent" } });
    const documentId = (await projectService.getProjectHistory(project.id)).headRevision.state.photoDocument?.id ?? null;
    await workspaceService.applyWorkspaceChange(project.id, { type: "selection", selectionType: "document", targetId: documentId });
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 820 });
    renderEditor();
    expect(await screen.findByRole("complementary", { name: "Inspector" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Layers" })).not.toBeInTheDocument());
    await expect(workspaceService.getWorkspace(project.id)).resolves.toMatchObject({ panels: { left: { open: false }, inspector: { open: true } } });
  });

  it("supports pointer panning and the in-page distraction-free fallback without changing the project", async () => {
    const user = userEvent.setup();
    await projectService.createPhotoDocument({ projectId: project.id, expectedRevisionId: project.headRevisionId, widthPx: 1200, heightPx: 800, resolutionPpi: 72, orientation: "landscape", background: { type: "transparent" } });
    const sourceRevision = (await projectService.getProjectHistory(project.id)).headRevision.id;
    renderEditor();
    const canvas = await screen.findByRole("group", { name: "Image canvas" });
    await user.click(screen.getByRole("button", { name: "Hand tool (H)" }));
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: "pen", button: 0, clientX: 100, clientY: 100, pressure: 0.5 });
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: "pen", clientX: 132, clientY: 120, pressure: 0.5 });
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: "pen", clientX: 132, clientY: 120 });
    await waitFor(async () => expect((await workspaceService.getWorkspace(project.id)).viewport).toMatchObject({ panX: 32, panY: 20, mode: "custom" }));

    await user.click(screen.getByRole("button", { name: "Enter distraction-free preview" }));
    expect(await screen.findByRole("button", { name: "Exit distraction-free preview" })).toBeInTheDocument();
    expect(document.querySelector(".editor-shell--distraction-free")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Exit distraction-free preview" }));
    expect(document.querySelector(".editor-shell--distraction-free")).not.toBeInTheDocument();
    await expect(projectService.getProjectHistory(project.id)).resolves.toMatchObject({ headRevision: { id: sourceRevision } });
  });
});
