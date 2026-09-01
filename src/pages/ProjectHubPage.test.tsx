import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { ProjectLifecycleService } from "../application/project-service";
import type { ProjectRecord } from "../domain/project";
import { ProjectHub } from "./ProjectHubPage";

function project(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: "project-1",
    schemaVersion: 2,
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
    ...overrides,
  };
}

function renderHub(service: ProjectLifecycleService) {
  return render(
    <MemoryRouter initialEntries={["/projects"]}>
      <Routes>
        <Route path="/projects" element={<ProjectHub service={service} />} />
        <Route path="/editor/:projectId" element={<h1>Opened project workspace</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProjectHub", () => {
  it("orients an empty project library and creates a project", async () => {
    const user = userEvent.setup();
    const projects: ProjectRecord[] = [];
    const created = project();
    const service: ProjectLifecycleService = {
      listProjects: vi.fn(async () => [...projects]),
      getProject: vi.fn(),
      openProject: vi.fn(),
      createProject: vi.fn(async () => {
        projects.push(created);
        return created;
      }),
      renameProject: vi.fn(),
      duplicateProject: vi.fn(),
      deleteProject: vi.fn(),
    };

    renderHub(service);

    expect(await screen.findByRole("heading", { name: "No projects yet" })).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: /create project/i })[0]!);
    await user.type(screen.getByLabelText("Project name"), "Anniversary film");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Create project" }));

    await waitFor(() => expect(service.createProject).toHaveBeenCalledWith({ name: "Anniversary film", kind: "unassigned" }));
    expect(await screen.findByRole("heading", { name: "Opened project workspace" })).toBeInTheDocument();
  });

  it("keeps search recoverable when no project matches", async () => {
    const user = userEvent.setup();
    const service: ProjectLifecycleService = {
      listProjects: vi.fn(async () => [project(), project({ id: "project-2", name: "Portrait study", kind: "photo" })]),
      getProject: vi.fn(),
      openProject: vi.fn(),
      createProject: vi.fn(),
      renameProject: vi.fn(),
      duplicateProject: vi.fn(),
      deleteProject: vi.fn(),
    };

    renderHub(service);
    await screen.findByRole("link", { name: "Open project Anniversary film" });
    await user.type(screen.getByRole("searchbox", { name: "Search projects" }), "missing");

    expect(screen.getByRole("heading", { name: "No projects match “missing”" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByRole("link", { name: "Open project Portrait study" })).toBeInTheDocument();
  });

  it("closes the create dialog with Escape and returns focus to its trigger", async () => {
    const user = userEvent.setup();
    const service: ProjectLifecycleService = {
      listProjects: vi.fn(async () => []),
      getProject: vi.fn(),
      openProject: vi.fn(),
      createProject: vi.fn(),
      renameProject: vi.fn(),
      duplicateProject: vi.fn(),
      deleteProject: vi.fn(),
    };

    renderHub(service);
    await screen.findByRole("heading", { name: "No projects yet" });
    const trigger = screen.getByRole("button", { name: "New project" });

    await user.click(trigger);
    expect(screen.getByLabelText("Project name")).toHaveFocus();
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("requires an explicit confirmation before deletion", async () => {
    const user = userEvent.setup();
    const selected = project({ name: "Coastal reel" });
    const service: ProjectLifecycleService = {
      listProjects: vi.fn(async () => [selected]),
      getProject: vi.fn(),
      openProject: vi.fn(),
      createProject: vi.fn(),
      renameProject: vi.fn(),
      duplicateProject: vi.fn(),
      deleteProject: vi.fn(async () => undefined),
    };

    renderHub(service);
    await screen.findByRole("link", { name: "Open project Coastal reel" });
    const actionsTrigger = screen.getByRole("button", { name: "Project actions for Coastal reel" });
    await user.click(actionsTrigger);
    await user.click(screen.getByRole("menuitem", { name: "Delete project" }));

    expect(screen.getByRole("heading", { name: "Delete “Coastal reel”?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(service.deleteProject).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(service.deleteProject).not.toHaveBeenCalled();
    await waitFor(() => expect(actionsTrigger).toHaveFocus());
  });

  it("returns keyboard focus to the project actions trigger when its menu closes", async () => {
    const user = userEvent.setup();
    const selected = project({ name: "Keyboard project" });
    const service: ProjectLifecycleService = {
      listProjects: vi.fn(async () => [selected]),
      getProject: vi.fn(),
      openProject: vi.fn(),
      createProject: vi.fn(),
      renameProject: vi.fn(),
      duplicateProject: vi.fn(),
      deleteProject: vi.fn(),
    };

    renderHub(service);
    await screen.findByRole("link", { name: "Open project Keyboard project" });
    const trigger = screen.getByRole("button", { name: "Project actions for Keyboard project" });
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Rename project" })).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("opens a project from its primary row action with one click or Enter", async () => {
    const user = userEvent.setup();
    const selected = project({ name: "Direct open project" });
    const service: ProjectLifecycleService = {
      listProjects: vi.fn(async () => [selected]),
      getProject: vi.fn(),
      openProject: vi.fn(),
      createProject: vi.fn(),
      renameProject: vi.fn(),
      duplicateProject: vi.fn(),
      deleteProject: vi.fn(),
    };

    const { unmount } = renderHub(service);
    const rowLink = await screen.findByRole("link", { name: "Open project Direct open project" });
    rowLink.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("heading", { name: "Opened project workspace" })).toBeInTheDocument();

    unmount();
    renderHub(service);
    await user.click(await screen.findByRole("link", { name: "Open project Direct open project" }));
    expect(await screen.findByRole("heading", { name: "Opened project workspace" })).toBeInTheDocument();
  });
});
