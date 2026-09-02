import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectService } from "../application/project-service";
import { WorkspaceService } from "../application/workspace-service";
import { EstroDatabase } from "../data/estro-database";
import { ProjectRepository } from "../data/project-repository";
import { webMcpActivityStore } from "./activity-store";
import type { ModelContextApi, ModelContextToolDefinition } from "./model-context";
import { createEstroSiteTools, registerEstroSiteTools } from "./site-tools";

describe("Estro Site tools", () => {
  let database: EstroDatabase;
  let service: ProjectService;
  let workspaceService: WorkspaceService;

  beforeEach(() => {
    database = new EstroDatabase(`estro-webmcp-${crypto.randomUUID()}`);
    service = new ProjectService(new ProjectRepository(database));
    workspaceService = new WorkspaceService(database);
    webMcpActivityStore.clearActivity();
  });

  afterEach(async () => database.delete());

  it("registers fifteen versioned top-level tools with read-only annotations", () => {
    const registered: ModelContextToolDefinition[] = [];
    const modelContext: ModelContextApi = { registerTool: vi.fn((tool) => registered.push(tool)) };

    expect(registerEstroSiteTools(service, workspaceService, modelContext)).toBe(15);
    expect(registerEstroSiteTools(service, workspaceService, modelContext)).toBe(0);
    expect(registered.map((tool) => tool.name)).toEqual([
      "get_capabilities", "inspect_project", "manage_project", "propose_transaction",
      "apply_transaction", "inspect_transaction", "undo_transaction",
      "inspect_document", "apply_document_operation", "inspect_workspace", "set_workspace",
      "inspect_selection", "set_selection", "focus_ui", "search_commands",
    ]);
    expect(registered.find((tool) => tool.name === "inspect_project")?.annotations).toEqual({ readOnlyHint: true });
    expect(registered.find((tool) => tool.name === "propose_transaction")?.annotations).toEqual({ readOnlyHint: true });
  });

  it("returns bounded inspection and actionable validation without mutation", async () => {
    const project = await service.createProject({ name: "Anniversary film", kind: "video" });
    const tools = createEstroSiteTools(service, workspaceService);
    const inspect = tools.find((tool) => tool.name === "inspect_project")!;
    const manage = tools.find((tool) => tool.name === "manage_project")!;

    const inspected = await inspect.execute({ projectId: project.id, historyLimit: 1 }) as { structuredContent: Record<string, unknown> };
    expect(inspected.structuredContent).toMatchObject({ ok: true, projectId: project.id, revisionId: project.headRevisionId });
    expect(inspected.structuredContent.transactions).toHaveLength(1);

    const invalid = await manage.execute({ operation: "rename", projectId: project.id, name: "" }) as { structuredContent: Record<string, unknown> };
    expect(invalid.structuredContent).toMatchObject({ ok: false, error: { code: "INVALID_INPUT", projectPreserved: true } });
    expect(webMcpActivityStore.getSnapshot().activity).toMatchObject({ stage: "failed", title: "Project command needs valid input" });
    await expect(service.getProject(project.id)).resolves.toMatchObject({ name: "Anniversary film", headRevisionId: project.headRevisionId });
  });

  it("returns transaction identity for every project-creating operation", async () => {
    const tools = createEstroSiteTools(service, workspaceService);
    const manage = tools.find((tool) => tool.name === "manage_project")!;
    const inspectTransaction = tools.find((tool) => tool.name === "inspect_transaction")!;

    const created = await manage.execute({ operation: "create", name: "Ledger" }) as { structuredContent: Record<string, unknown> };
    const projectId = created.structuredContent.projectId as string;
    const duplicated = await manage.execute({ operation: "duplicate", projectId }) as { structuredContent: Record<string, unknown> };
    const savedAs = await manage.execute({ operation: "save_as", projectId, name: "Ledger archive" }) as { structuredContent: Record<string, unknown> };

    for (const result of [created, duplicated, savedAs]) {
      expect(result.structuredContent).toMatchObject({ ok: true, undoAvailable: false, undoToken: null });
      expect(result.structuredContent.transactionId).toEqual(expect.any(String));
      expect(result.structuredContent.affectedIds).toEqual(expect.arrayContaining([result.structuredContent.projectId]));
      expect(result.structuredContent.warnings).toEqual([]);
    }

    // The reported transaction must be the one that actually committed the new identity.
    const inspected = await inspectTransaction.execute({ transactionId: created.structuredContent.transactionId }) as { structuredContent: Record<string, unknown> };
    expect(inspected.structuredContent).toMatchObject({
      ok: true, projectId, resultingRevisionId: created.structuredContent.resultingRevisionId,
    });

    // Save promotes durability rather than committing a revision, so it reports no transaction.
    const saved = await manage.execute({ operation: "save", projectId }) as { structuredContent: Record<string, unknown> };
    expect(saved.structuredContent).toMatchObject({ ok: true, transactionId: null, undoToken: null, undoAvailable: false, durability: "durable" });
  });

  it("routes WebMCP rename through the same deterministic command and gates deletion", async () => {
    const project = await service.createProject({ name: "Draft", kind: "video" });
    const manage = createEstroSiteTools(service, workspaceService).find((tool) => tool.name === "manage_project")!;

    const renamed = await manage.execute({ operation: "rename", projectId: project.id, name: "Birthday reel" }) as { structuredContent: Record<string, unknown> };
    expect(renamed.structuredContent).toMatchObject({
      ok: true,
      projectId: project.id,
      summary: "Renamed project to “Birthday reel”.",
      undoAvailable: true,
      durability: "durable",
    });
    expect(webMcpActivityStore.getSnapshot().activity).toMatchObject({ stage: "complete", projectId: project.id });
    await expect(service.getProject(project.id)).resolves.toMatchObject({ name: "Birthday reel" });
    await expect(service.getProjectPersistence(project.id)).resolves.toMatchObject({ hasRecoverableDraft: false });

    const deletion = await manage.execute({ operation: "request_delete", projectId: project.id }) as { structuredContent: Record<string, unknown> };
    expect(deletion.structuredContent).toMatchObject({ ok: false, status: "confirmation_required", projectPreserved: true });
    expect(webMcpActivityStore.getSnapshot().confirmation).toMatchObject({ projectId: project.id, status: "pending" });
    await expect(service.getProject(project.id)).resolves.toMatchObject({ status: "active" });
    webMcpActivityStore.cancelConfirmation();
  });

  it("makes transaction inspection and Undo visible while using immutable IDs", async () => {
    const project = await service.createProject({ name: "Draft", kind: "video" });
    const tools = createEstroSiteTools(service, workspaceService);
    const manage = tools.find((tool) => tool.name === "manage_project")!;
    const inspect = tools.find((tool) => tool.name === "inspect_transaction")!;
    const undo = tools.find((tool) => tool.name === "undo_transaction")!;

    const renamed = await manage.execute({ operation: "rename", projectId: project.id, name: "Review cut" }) as { structuredContent: Record<string, unknown> };
    const transactionId = renamed.structuredContent.transactionId as string;

    const inspected = await inspect.execute({ transactionId }) as { structuredContent: Record<string, unknown> };
    expect(inspected.structuredContent).toMatchObject({ ok: true, transactionId, projectId: project.id, undoAvailable: true });
    expect(webMcpActivityStore.getSnapshot().activity).toMatchObject({ stage: "complete", title: "Transaction inspected", transactionId });

    const undone = await undo.execute({ projectId: project.id, transactionId }) as { structuredContent: Record<string, unknown> };
    expect(undone.structuredContent).toMatchObject({ ok: true, projectId: project.id, durability: "durable" });
    expect(webMcpActivityStore.getSnapshot().activity).toMatchObject({ stage: "complete", projectId: project.id });
    await expect(service.getProject(project.id)).resolves.toMatchObject({ name: "Draft" });
    await expect(service.getProjectPersistence(project.id)).resolves.toMatchObject({ hasRecoverableDraft: false });
  });

  it("creates the same document state through WebMCP and keeps workspace navigation revision-free", async () => {
    const project = await service.createProject({ name: "Poster", kind: "unassigned" });
    const tools = createEstroSiteTools(service, workspaceService);
    const applyDocument = tools.find((tool) => tool.name === "apply_document_operation")!;
    const inspectDocument = tools.find((tool) => tool.name === "inspect_document")!;
    const setWorkspace = tools.find((tool) => tool.name === "set_workspace")!;
    const inspectWorkspace = tools.find((tool) => tool.name === "inspect_workspace")!;

    const applied = await applyDocument.execute({
      projectId: project.id,
      expectedRevisionId: project.headRevisionId,
      widthPx: 1920,
      heightPx: 1080,
      resolutionPpi: 72,
      orientation: "landscape",
      background: { type: "transparent" },
    }) as { structuredContent: Record<string, unknown> };
    expect(applied.structuredContent).toMatchObject({ ok: true, projectId: project.id, projectChanged: true, undoAvailable: true, durability: "durable" });
    const resultingRevisionId = applied.structuredContent.resultingRevisionId as string;

    const inspected = await inspectDocument.execute({ projectId: project.id }) as { structuredContent: Record<string, unknown> };
    expect(inspected.structuredContent).toMatchObject({ ok: true, revisionId: resultingRevisionId, hasDocument: true, document: { widthPx: 1920, heightPx: 1080 } });

    const changedView = await setWorkspace.execute({
      projectId: project.id,
      change: { type: "viewport", viewport: { zoom: 1.25, panX: 12, panY: -8, rotationDeg: 90, mode: "custom" } },
    }) as { structuredContent: Record<string, unknown> };
    expect(changedView.structuredContent).toMatchObject({ ok: true, revisionId: resultingRevisionId, projectChanged: false, revisionUnchanged: true });
    const changedDock = await setWorkspace.execute({ projectId: project.id, change: { type: "dock", leadingPanel: "inspector" } }) as { structuredContent: Record<string, unknown> };
    expect(changedDock.structuredContent).toMatchObject({ ok: true, revisionId: resultingRevisionId, projectChanged: false, revisionUnchanged: true, workspace: { leadingPanel: "inspector" } });

    const workspace = await inspectWorkspace.execute({ projectId: project.id }) as { structuredContent: Record<string, unknown> };
    expect(workspace.structuredContent).toMatchObject({ workspace: { viewport: { zoom: 1.25, panX: 12, panY: -8, rotationDeg: 90 }, leadingPanel: "inspector" }, revisionId: resultingRevisionId });
  });

  it("validates stable selection and focus IDs and searches the shared command index", async () => {
    const project = await service.createProject({ name: "Poster", kind: "photo" });
    const created = await service.createPhotoDocument({ projectId: project.id, expectedRevisionId: project.headRevisionId, widthPx: 1000, heightPx: 1000, resolutionPpi: 72, orientation: "square", background: { type: "solid", color: "#ffffff" } });
    const tools = createEstroSiteTools(service, workspaceService);
    const setSelection = tools.find((tool) => tool.name === "set_selection")!;
    const focus = tools.find((tool) => tool.name === "focus_ui")!;
    const search = tools.find((tool) => tool.name === "search_commands")!;

    const selected = await setSelection.execute({ projectId: project.id, selectionType: "document", targetId: created.headRevision.state.photoDocument?.id }) as { structuredContent: Record<string, unknown> };
    expect(selected.structuredContent).toMatchObject({ ok: true, projectChanged: false, selection: { type: "document" } });

    const invalid = await setSelection.execute({ projectId: project.id, selectionType: "document", targetId: "position-0" }) as { structuredContent: Record<string, unknown> };
    expect(invalid.structuredContent).toMatchObject({ ok: false, error: { code: "INVALID_INPUT", fieldPath: "targetId", projectPreserved: true } });

    const focused = await focus.execute({ projectId: project.id, targetId: "inspector-document-width" }) as { structuredContent: Record<string, unknown> };
    expect(focused.structuredContent).toMatchObject({ ok: true, target: { id: "inspector-document-width", region: "inspector" }, projectChanged: false });

    const results = await search.execute({ query: "grid" }) as { structuredContent: Record<string, unknown> };
    expect(results.structuredContent).toMatchObject({ ok: true, projectChanged: false });
    expect(results.structuredContent.resultCount as number).toBeGreaterThan(0);
  });
});
