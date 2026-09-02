import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EstroDatabase } from "../data/estro-database";
import { ProjectRepository } from "../data/project-repository";
import { ProjectService } from "./project-service";
import { WorkspaceService } from "./workspace-service";

describe("WorkspaceService", () => {
  let database: EstroDatabase;
  let projectService: ProjectService;
  let workspaceService: WorkspaceService;

  beforeEach(() => {
    database = new EstroDatabase(`estro-workspace-${crypto.randomUUID()}`);
    projectService = new ProjectService(new ProjectRepository(database));
    workspaceService = new WorkspaceService(database, { createGuideId: () => "guide-1" });
  });

  afterEach(async () => database.delete());

  it("persists bounded view-only workspace state without changing the project revision", async () => {
    const project = await projectService.createProject({ name: "Canvas", kind: "photo" });
    const initial = await workspaceService.getWorkspace(project.id);
    expect(initial).toMatchObject({
      viewport: { zoom: 1, panX: 0, panY: 0, rotationDeg: 0, mode: "fit" },
      panels: { left: { widthPx: 280 }, inspector: { widthPx: 304 } },
      leadingPanel: "left",
      selection: { type: "canvas", targetId: "canvas-stage" },
    });

    await workspaceService.applyWorkspaceChange(project.id, {
      type: "viewport",
      viewport: { zoom: 1.5, panX: 24, panY: -18, rotationDeg: 90, mode: "custom" },
    });
    await workspaceService.applyWorkspaceChange(project.id, { type: "panel", panel: "left", widthPx: 360 });
    await workspaceService.applyWorkspaceChange(project.id, { type: "dock", leadingPanel: "inspector" });

    const reloaded = await new WorkspaceService(database).getWorkspace(project.id);
    expect(reloaded).toMatchObject({ viewport: { zoom: 1.5, panX: 24, panY: -18, rotationDeg: 90 }, panels: { left: { widthPx: 360 } }, leadingPanel: "inspector" });
    await expect(projectService.getProjectHistory(project.id)).resolves.toMatchObject({ headRevision: { id: project.headRevisionId, sequence: 0 } });
  });

  it("validates panel and viewport bounds and preserves the previous workspace", async () => {
    const project = await projectService.createProject({ name: "Canvas", kind: "photo" });
    await expect(workspaceService.applyWorkspaceChange(project.id, { type: "panel", panel: "left", widthPx: 500 })).rejects.toMatchObject({ code: "INVALID_INPUT", fieldPath: "widthPx" });
    await expect(workspaceService.applyWorkspaceChange(project.id, { type: "viewport", viewport: { zoom: 40, panX: 0, panY: 0, rotationDeg: 0, mode: "custom" } })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(workspaceService.getWorkspace(project.id)).resolves.toMatchObject({ panels: { left: { widthPx: 280 } }, viewport: { zoom: 1 } });
  });

  it("stores stable guides and snaps their positions to the configured grid", async () => {
    const project = await projectService.createProject({ name: "Canvas", kind: "photo" });
    const added = await workspaceService.applyWorkspaceChange(project.id, { type: "guide", action: "add", axis: "x", positionPx: 111 });
    expect(added.guides).toEqual([{ id: "guide-1", axis: "x", positionPx: 128 }]);
    const cleared = await workspaceService.applyWorkspaceChange(project.id, { type: "guide", action: "clear" });
    expect(cleared.guides).toEqual([]);
  });

  it("replaces an unsupported workspace record with safe defaults without touching project history", async () => {
    const project = await projectService.createProject({ name: "Canvas", kind: "photo" });
    await database.table("workspaces").put({ projectId: project.id, schemaVersion: 99, updatedAt: "invalid" });
    const workspace = await workspaceService.getWorkspace(project.id);
    expect(workspace).toMatchObject({ schemaVersion: 1, projectId: project.id, viewport: { mode: "fit" }, leadingPanel: "left" });
    await expect(projectService.getProjectHistory(project.id)).resolves.toMatchObject({ headRevision: { id: project.headRevisionId, sequence: 0 } });
  });
});
