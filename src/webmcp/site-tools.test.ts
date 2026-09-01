import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectService } from "../application/project-service";
import { EstroDatabase } from "../data/estro-database";
import { ProjectRepository } from "../data/project-repository";
import { webMcpActivityStore } from "./activity-store";
import type { ModelContextApi, ModelContextToolDefinition } from "./model-context";
import { createEstroSiteTools, registerEstroSiteTools } from "./site-tools";

describe("Estro Site tools", () => {
  let database: EstroDatabase;
  let service: ProjectService;

  beforeEach(() => {
    database = new EstroDatabase(`estro-webmcp-${crypto.randomUUID()}`);
    service = new ProjectService(new ProjectRepository(database));
    webMcpActivityStore.clearActivity();
  });

  afterEach(async () => database.delete());

  it("registers seven versioned top-level tools with read-only annotations", () => {
    const registered: ModelContextToolDefinition[] = [];
    const modelContext: ModelContextApi = { registerTool: vi.fn((tool) => registered.push(tool)) };

    expect(registerEstroSiteTools(service, modelContext)).toBe(7);
    expect(registerEstroSiteTools(service, modelContext)).toBe(0);
    expect(registered.map((tool) => tool.name)).toEqual([
      "get_capabilities", "inspect_project", "manage_project", "propose_transaction",
      "apply_transaction", "inspect_transaction", "undo_transaction",
    ]);
    expect(registered.find((tool) => tool.name === "inspect_project")?.annotations).toEqual({ readOnlyHint: true });
    expect(registered.find((tool) => tool.name === "propose_transaction")?.annotations).toEqual({ readOnlyHint: true });
  });

  it("returns bounded inspection and actionable validation without mutation", async () => {
    const project = await service.createProject({ name: "Anniversary film", kind: "video" });
    const tools = createEstroSiteTools(service);
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

  it("routes WebMCP rename through the same deterministic command and gates deletion", async () => {
    const project = await service.createProject({ name: "Draft", kind: "video" });
    const manage = createEstroSiteTools(service).find((tool) => tool.name === "manage_project")!;

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
    const tools = createEstroSiteTools(service);
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
});
