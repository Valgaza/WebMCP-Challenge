import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectService } from "../application/project-service";
import { WorkspaceService } from "../application/workspace-service";
import { AssetService, createMemorySourceStore } from "../application/asset-service";
import { JobService } from "../application/job-service";
import { LayerService } from "../application/layer-service";
import { RenderService } from "../application/render-service";
import { OrganizationService } from "../application/organization-service";
import { OutputService } from "../application/output-service";
import { PresetService } from "../application/preset-service";
import { createLayerAdapter } from "../application/attribute-adapters";
import { createMemoryOutputStore } from "../data/output-store";
import { ASSET_SCHEMA_VERSION, type AssetReference } from "../domain/asset";
import { EstroDatabase } from "../data/estro-database";
import { ProjectRepository } from "../data/project-repository";
import { webMcpActivityStore } from "./activity-store";
import type { ModelContextApi, ModelContextToolDefinition } from "./model-context";
import { ESTRO_TOOL_COUNT, createEstroSiteTools, registerEstroSiteTools, type EstroToolServices } from "./site-tools";
import { SelectionService, createSelectionStore } from "../application/selection-service";
import { ChannelService } from "../application/channel-service";
import { BatchExportService } from "../application/batch-export-service";
import { CatalogueService } from "../application/catalogue-service";
import { PackageService } from "../application/package-service";
import { ReviewService } from "../application/review-service";

describe("Estro Site tools", () => {
  let database: EstroDatabase;
  let service: ProjectService;
  let workspaceService: WorkspaceService;
  let assetService: AssetService;
  let jobService: JobService;
  let layerService: LayerService;
  let renderService: RenderService;
  let organizationService: OrganizationService;
  let outputService: OutputService;
  let presetService: PresetService;
  let selectionService: SelectionService;
  let channelService: ChannelService;
  let batchExportService: BatchExportService;
  let catalogueService: CatalogueService;
  let packageService: PackageService;
  let reviewService: ReviewService;

  /** Every tool call takes the same set of services; naming it once keeps the calls readable. */
  const toolServices = (): EstroToolServices => ({
    service, workspaceService, assetService, jobService, layerService, renderService,
    organizationService, outputService, presetService, batchExportService,
    catalogueService, packageService, reviewService, selectionService, channelService,
  });

  beforeEach(() => {
    database = new EstroDatabase(`estro-webmcp-${crypto.randomUUID()}`);
    service = new ProjectService(new ProjectRepository(database));
    workspaceService = new WorkspaceService(database);
    jobService = new JobService(database);
    assetService = new AssetService(database, service, jobService, {
      probeDeps: { decodeSize: async () => ({ width: 1920, height: 1080 }), hash: async () => "hash-aaaaaaaa" },
      handleStore: createMemorySourceStore(),
    });
    layerService = new LayerService(service);
    renderService = new RenderService(service, assetService);
    organizationService = new OrganizationService(service);
    outputService = new OutputService(database, { store: createMemoryOutputStore() });
    presetService = new PresetService(database, service);
    presetService.registerAdapter(createLayerAdapter(service));
    batchExportService = new BatchExportService(service, renderService, outputService, jobService);
    catalogueService = new CatalogueService(service);
    packageService = new PackageService(service, assetService);
    reviewService = new ReviewService(service);
    selectionService = new SelectionService(
      {
        readComposite: async () => ({ widthPx: 64, heightPx: 64, data: new Uint8ClampedArray(64 * 64 * 4) }),
        readLayer: async () => ({ widthPx: 64, heightPx: 64, data: new Uint8ClampedArray(64 * 64 * 4) }),
      },
      createSelectionStore(database),
    );
    channelService = new ChannelService(selectionService, {
      readComposite: async () => ({ widthPx: 64, heightPx: 64, data: new Uint8ClampedArray(64 * 64 * 4) }),
      readLayer: async () => ({ widthPx: 64, heightPx: 64, data: new Uint8ClampedArray(64 * 64 * 4) }),
    });
    webMcpActivityStore.clearActivity();
  });

  afterEach(async () => database.delete());

  /**
   * A clip can only reference media the project holds, so a timeline fixture registers its
   * asset first. That validation is the point: an unregistered ID would place a clip that
   * could never be rendered.
   */

  it("registers every versioned top-level tool with honest read-only annotations", () => {
    const registered: ModelContextToolDefinition[] = [];
    const modelContext: ModelContextApi = { registerTool: vi.fn((tool) => registered.push(tool)) };

    expect(registerEstroSiteTools(toolServices(), modelContext)).toBe(ESTRO_TOOL_COUNT);
    expect(registerEstroSiteTools(toolServices(), modelContext)).toBe(0);
    expect(registered.map((tool) => tool.name)).toEqual([
      "get_capabilities", "list_projects", "inspect_project", "manage_project", "propose_transaction",
      "apply_transaction", "inspect_transaction",
      "list_presets", "save_preset", "apply_batch",
      "inspect_history", "revert_transaction", "undo_transaction",
      "inspect_document", "apply_document_operation", "resize_document",
      "inspect_workspace", "set_workspace", "inspect_selection", "set_selection", "focus_ui",
      "search_commands",
      "inspect_assets", "inspect_asset", "manage_asset", "preview_revision",
      "inspect_organization", "manage_organization", "inspect_job", "manage_job",
      "inspect_layers", "apply_layer_operation", "inspect_color_state", "apply_color_adjustment",
      "inspect_histogram", "compare_revisions", "explain_edit", "guided_step",
     
     
      "export_image", "inspect_outputs", "manage_output",
      "select_region", "refine_selection", "manage_selections", "manage_channels", "exchange_svg", "manage_swatches",
      "match_photos", "batch_export",
      "resolve_phrase", "list_phrases",
     
      "mark_media", "manage_collections", "manage_package",
      "manage_review", "inspect_accessibility",
    ]);
    // Every registered tool is accounted for by the advertised count.
    expect(registered).toHaveLength(ESTRO_TOOL_COUNT);
    for (const name of ["inspect_assets", "inspect_asset", "inspect_job", "preview_revision", "inspect_organization", "inspect_layers", "inspect_color_state", "inspect_histogram", "explain_edit", "guided_step", "inspect_outputs"]) {
      expect(registered.find((tool) => tool.name === name)?.annotations?.readOnlyHint).toBe(true);
    }
    /*
     * A mutating tool has to say so outright.
     *
     * An absent `readOnlyHint` used to be how a mutation was distinguished from an
     * inspection, which is not a distinction at all: a host reading annotations to decide
     * what needs confirming cannot tell "changes the project" from "the author forgot".
     * Every tool now declares the answer, and the destructive ones declare that too.
     */
    for (const name of ["manage_asset", "manage_job", "manage_organization", "manage_output", "resize_document", "export_image"]) {
      expect(registered.find((tool) => tool.name === name)?.annotations?.readOnlyHint).toBe(false);
    }
    // Nothing is left undeclared, in either direction.
    for (const tool of registered) {
      expect(typeof tool.annotations?.readOnlyHint, `${tool.name} declares readOnlyHint`).toBe("boolean");
    }
    // A tool whose result can carry a project name, a file name, or a comment says so, so a
    // host knows to treat that text as data rather than as instructions.
    for (const name of ["list_projects", "inspect_project", "inspect_assets", "manage_review"]) {
      expect(registered.find((tool) => tool.name === name)?.annotations?.untrustedContentHint).toBe(true);
    }
    expect(registered.find((tool) => tool.name === "inspect_project")?.annotations)
      .toEqual({ readOnlyHint: true, untrustedContentHint: true });
    // A proposal is prepared, not applied, so it stays read-only — and it carries no text a
    // person typed, so it needs no untrusted-content hint.
    expect(registered.find((tool) => tool.name === "propose_transaction")?.annotations)
      .toEqual({ readOnlyHint: true });
  });

  it("returns transaction identity for every project-creating operation", async () => {
    const tools = createEstroSiteTools(toolServices());
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

  it("brings an SVG in as one layer per object and writes the shapes back out", async () => {
    const project = await service.createProject({ name: "Badge", kind: "unassigned" });
    const tools = createEstroSiteTools(toolServices());
    const applyDocument = tools.find((tool) => tool.name === "apply_document_operation")!;
    const exchange = tools.find((tool) => tool.name === "exchange_svg")!;
    const inspectLayers = tools.find((tool) => tool.name === "inspect_layers")!;

    await applyDocument.execute({
      projectId: project.id, widthPx: 400, heightPx: 300, resolutionPpi: 72,
      orientation: "landscape", background: { type: "transparent" },
    });

    // A <script> is not a shape, so it must not survive the round trip in any form.
    const imported = await exchange.execute({
      projectId: project.id,
      action: "import",
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">`
        + `<rect x="20" y="20" width="160" height="120" fill="#e2574c"/>`
        + `<circle cx="300" cy="120" r="70" fill="#2f6fed"/>`
        + `<script>alert(1)</script></svg>`,
    }) as { structuredContent: Record<string, unknown> };

    expect(imported.structuredContent).toMatchObject({ ok: true, projectChanged: true, shapeCount: 2 });

    // One layer each, rather than one layer holding a picture of the file.
    const layers = await inspectLayers.execute({ projectId: project.id }) as { structuredContent: Record<string, unknown> };
    const names = (layers.structuredContent.layers as { name: string }[]).map((layer) => layer.name);
    expect(names).toEqual(expect.arrayContaining(["Rectangle", "Ellipse"]));

    const exported = await exchange.execute({ projectId: project.id, action: "export" }) as { structuredContent: Record<string, unknown> };
    expect(exported.structuredContent).toMatchObject({ ok: true, projectChanged: false, shapeCount: 2 });
    const svg = exported.structuredContent.svg as string;
    expect(svg).toContain("#e2574c");
    expect(svg).not.toContain("script");
  });

  it("refuses to write out shapes a document does not have", async () => {
    const project = await service.createProject({ name: "Empty", kind: "unassigned" });
    const tools = createEstroSiteTools(toolServices());
    const applyDocument = tools.find((tool) => tool.name === "apply_document_operation")!;
    const exchange = tools.find((tool) => tool.name === "exchange_svg")!;

    await applyDocument.execute({
      projectId: project.id, widthPx: 100, heightPx: 100, resolutionPpi: 72,
      orientation: "square", background: { type: "transparent" },
    });

    const result = await exchange.execute({ projectId: project.id, action: "export" }) as { structuredContent: Record<string, unknown> };
    expect(result.structuredContent).toMatchObject({ ok: false });
  });

  it("creates the same document state through WebMCP and keeps workspace navigation revision-free", async () => {
    const project = await service.createProject({ name: "Poster", kind: "unassigned" });
    const tools = createEstroSiteTools(toolServices());
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
    const tools = createEstroSiteTools(toolServices());
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

  it("inspects assets and jobs without mutating, and gates asset removal through Undo", async () => {
    const project = await service.createProject({ name: "Asset tools", kind: "photo" });
    const tools = createEstroSiteTools(toolServices());
    const inspectAssets = tools.find((tool) => tool.name === "inspect_assets")!;
    const inspectAsset = tools.find((tool) => tool.name === "inspect_asset")!;
    const manageAsset = tools.find((tool) => tool.name === "manage_asset")!;
    const inspectJob = tools.find((tool) => tool.name === "inspect_job")!;

    const file = new File([new Uint8Array(4)], "beach.jpg", { type: "image/jpeg" });
    Object.defineProperty(file, "size", { value: 4096 });
    const handle = { kind: "file", name: "beach.jpg", getFile: async () => file, queryPermission: async () => "granted" } as unknown as FileSystemFileHandle;
    const { assetId } = await assetService.registerOne(project.id, { file, handle });

    const before = (await service.getProjectHistory(project.id)).headRevision.id;

    const listed = await inspectAssets.execute({ projectId: project.id, query: "beach" }) as { structuredContent: Record<string, unknown> };
    expect(listed.structuredContent).toMatchObject({ ok: true, projectChanged: false, resultCount: 1 });
    expect((listed.structuredContent.assets as Record<string, unknown>[])[0]).toMatchObject({ assetId, name: "beach.jpg", widthPx: 1920, availability: "available" });

    const one = await inspectAsset.execute({ assetId }) as { structuredContent: Record<string, unknown> };
    expect(one.structuredContent).toMatchObject({ ok: true, assetId, projectChanged: false, mediaType: "image/jpeg" });

    const tagged = await manageAsset.execute({ operation: "update_tags", assetId, tags: ["summer"] }) as { structuredContent: Record<string, unknown> };
    expect(tagged.structuredContent).toMatchObject({ ok: true, tags: ["summer"], revisionUnchanged: true, projectChanged: false });
    // Tagging is library metadata, not an edit, so it must not create a revision.
    expect((await service.getProjectHistory(project.id)).headRevision.id).toBe(before);

    const jobs = await inspectJob.execute({ projectId: project.id }) as { structuredContent: Record<string, unknown> };
    expect(jobs.structuredContent).toMatchObject({ ok: true, projectChanged: false });

    const removed = await manageAsset.execute({ operation: "remove", assetId }) as { structuredContent: Record<string, unknown> };
    expect(removed.structuredContent).toMatchObject({ ok: true, projectChanged: true, undoAvailable: true, assetId });
    expect(removed.structuredContent.undoToken).toEqual(expect.any(String));

    const undo = tools.find((tool) => tool.name === "undo_transaction")!;
    await undo.execute({ projectId: project.id, transactionId: removed.structuredContent.undoToken });
    expect((await service.getProjectHistory(project.id)).headRevision.state.assets).toHaveLength(1);
  });

  it("reports availability changes as runtime state rather than a revision", async () => {
    const project = await service.createProject({ name: "Availability", kind: "photo" });
    const tools = createEstroSiteTools(toolServices());
    const manageAsset = tools.find((tool) => tool.name === "manage_asset")!;

    const file = new File([new Uint8Array(4)], "dragged.png", { type: "image/png" });
    Object.defineProperty(file, "size", { value: 2048 });
    await assetService.registerOne(project.id, { file, handle: null });
    const before = (await service.getProjectHistory(project.id)).headRevision.id;

    const refreshed = await manageAsset.execute({ operation: "refresh_availability", projectId: project.id }) as { structuredContent: Record<string, unknown> };
    expect(refreshed.structuredContent).toMatchObject({ ok: true, projectChanged: false, changedCount: 1 });
    expect((refreshed.structuredContent.changed as Record<string, unknown>[])[0]).toMatchObject({ availability: "missing" });
    expect((await service.getProjectHistory(project.id)).headRevision.id).toBe(before);
  });

  it("cancels a job idempotently and reports what actually happened", async () => {
    const project = await service.createProject({ name: "Job tools", kind: "photo" });
    const tools = createEstroSiteTools(toolServices());
    const manageJob = tools.find((tool) => tool.name === "manage_job")!;
    const inspectJob = tools.find((tool) => tool.name === "inspect_job")!;

    jobService.registerRunner("thumbnail", async () => ({}));
    const job = await jobService.startJob({ projectId: project.id, kind: "thumbnail", label: "Build thumbnail", stage: "Working", intent: { kind: "thumbnail", payloadVersion: 1, payload: {} } });
    await jobService.waitForJob(job.id);

    const first = await manageJob.execute({ operation: "cancel", jobId: job.id }) as { structuredContent: Record<string, unknown> };
    expect(first.structuredContent).toMatchObject({ ok: true, accepted: false, status: "complete" });
    const second = await manageJob.execute({ operation: "cancel", jobId: job.id }) as { structuredContent: Record<string, unknown> };
    expect(second.structuredContent).toMatchObject({ ok: true, accepted: false });

    const inspected = await inspectJob.execute({ jobId: job.id }) as { structuredContent: Record<string, unknown> };
    expect(inspected.structuredContent).toMatchObject({ ok: true, projectChanged: false });
    expect(inspected.structuredContent.summary).toContain("finished");

    const missing = await inspectJob.execute({ jobId: "nope" }) as { structuredContent: Record<string, unknown> };
    expect(missing.structuredContent).toMatchObject({ ok: false, error: { code: "JOB_NOT_FOUND" } });
  });

  async function photoProjectWithLayer() {
    const project = await service.createProject({ name: `Photo ${crypto.randomUUID()}`, kind: "photo" });
    await service.createPhotoDocument({
      projectId: project.id, widthPx: 1000, heightPx: 1000, resolutionPpi: 72,
      orientation: "square", background: { type: "transparent" },
    });
    const file = new File([new Uint8Array(4)], "beach.jpg", { type: "image/jpeg" });
    Object.defineProperty(file, "size", { value: 4096 });
    const handle = { kind: "file", name: "beach.jpg", getFile: async () => file, queryPermission: async () => "granted" } as unknown as FileSystemFileHandle;
    const { assetId } = await assetService.registerOne(project.id, { file, handle });
    return { projectId: project.id, assetId: assetId! };
  }

  it("edits layers through one consolidated tool and keeps Undo working", async () => {
    const { projectId, assetId } = await photoProjectWithLayer();
    const tools = createEstroSiteTools(toolServices());
    const inspect = tools.find((tool) => tool.name === "inspect_layers")!;
    const apply = tools.find((tool) => tool.name === "apply_layer_operation")!;
    const undo = tools.find((tool) => tool.name === "undo_transaction")!;

    const empty = await inspect.execute({ projectId }) as { structuredContent: Record<string, unknown> };
    expect(empty.structuredContent).toMatchObject({ ok: true, hasDocument: true, projectChanged: false });
    expect(empty.structuredContent.layers).toHaveLength(0);

    const added = await apply.execute({ projectId, operation: "add_image", assetId }) as { structuredContent: Record<string, unknown> };
    expect(added.structuredContent).toMatchObject({ ok: true, projectChanged: true, undoAvailable: true, operation: "add_image" });

    const listed = await inspect.execute({ projectId }) as { structuredContent: Record<string, unknown> };
    const layers = listed.structuredContent.layers as Record<string, unknown>[];
    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({ kind: "image", assetId, visible: true, opacity: 1, depth: 0 });

    await undo.execute({ projectId, transactionId: added.structuredContent.undoToken });
    const afterUndo = await inspect.execute({ projectId }) as { structuredContent: Record<string, unknown> };
    expect(afterUndo.structuredContent.layers).toHaveLength(0);
  });

  it("clamps a colour adjustment to its documented range and explains the result", async () => {
    const { projectId, assetId } = await photoProjectWithLayer();
    const tools = createEstroSiteTools(toolServices());
    const apply = tools.find((tool) => tool.name === "apply_layer_operation")!;
    const colour = tools.find((tool) => tool.name === "apply_color_adjustment")!;
    const state = tools.find((tool) => tool.name === "inspect_color_state")!;

    const added = await apply.execute({ projectId, operation: "add_image", assetId }) as { structuredContent: Record<string, unknown> };
    const layerId = (added.structuredContent.affectedIds as string[])[1] ?? null;
    const listed = await (tools.find((tool) => tool.name === "inspect_layers")!).execute({ projectId }) as { structuredContent: Record<string, unknown> };
    const realLayerId = (listed.structuredContent.layers as Record<string, unknown>[])[0].layerId as string;

    const result = await colour.execute({ projectId, layerId: realLayerId, adjustment: "brightness", value: 400 }) as { structuredContent: Record<string, unknown> };
    expect(result.structuredContent).toMatchObject({ ok: true, normalizedValue: 100, projectChanged: true });
    expect(result.structuredContent.warnings).toEqual([expect.stringContaining("clamped")]);
    expect(result.structuredContent.description).toContain("lighter");

    const inspected = await state.execute({ projectId, layerId: realLayerId }) as { structuredContent: Record<string, unknown> };
    const adjustments = inspected.structuredContent.adjustments as Record<string, unknown>[];
    expect(adjustments.find((entry) => entry.name === "brightness")).toMatchObject({ value: 100, min: -100, max: 100, unit: "percent" });
    expect(layerId === null || typeof layerId === "string").toBe(true);
  });

  it("returns an exact revision pair for comparison", async () => {
    const { projectId, assetId } = await photoProjectWithLayer();
    const tools = createEstroSiteTools(toolServices());
    const apply = tools.find((tool) => tool.name === "apply_layer_operation")!;
    const compare = tools.find((tool) => tool.name === "compare_revisions")!;

    const added = await apply.execute({ projectId, operation: "add_image", assetId }) as { structuredContent: Record<string, unknown> };
    const compared = await compare.execute({ projectId }) as { structuredContent: Record<string, unknown> };

    expect(compared.structuredContent).toMatchObject({
      ok: true, projectChanged: false,
      transactionId: added.structuredContent.transactionId,
      afterRevisionId: added.structuredContent.resultingRevisionId,
      undoAvailable: true,
    });
    expect(compared.structuredContent.beforeRevisionId).not.toBe(compared.structuredContent.afterRevisionId);
  });

  it("explains a transaction, a layer, and a parameter without mutating", async () => {
    const { projectId, assetId } = await photoProjectWithLayer();
    const tools = createEstroSiteTools(toolServices());
    const apply = tools.find((tool) => tool.name === "apply_layer_operation")!;
    const explain = tools.find((tool) => tool.name === "explain_edit")!;

    await apply.execute({ projectId, operation: "add_image", assetId });
    const listed = await (tools.find((tool) => tool.name === "inspect_layers")!).execute({ projectId }) as { structuredContent: Record<string, unknown> };
    const layerId = (listed.structuredContent.layers as Record<string, unknown>[])[0].layerId as string;
    const before = (await service.getProjectHistory(projectId)).headRevision.id;

    const transaction = await explain.execute({ projectId }) as { structuredContent: Record<string, unknown> };
    expect(transaction.structuredContent).toMatchObject({ ok: true, subject: "transaction", projectChanged: false });

    const layer = await explain.execute({ projectId, layerId }) as { structuredContent: Record<string, unknown> };
    expect(layer.structuredContent).toMatchObject({ ok: true, subject: "layer", focusTargetId: "panel-layers" });

    const parameter = await explain.execute({ projectId, layerId, adjustment: "contrast" }) as { structuredContent: Record<string, unknown> };
    expect(parameter.structuredContent).toMatchObject({ ok: true, subject: "adjustment", currentValue: 0 });
    expect(parameter.structuredContent.consequence).toContain("default");

    // Explaining must never change a revision.
    expect((await service.getProjectHistory(projectId)).headRevision.id).toBe(before);
  });

  it("teaches a step without performing the edit", async () => {
    const { projectId } = await photoProjectWithLayer();
    const tools = createEstroSiteTools(toolServices());
    const guided = tools.find((tool) => tool.name === "guided_step")!;
    const before = (await service.getProjectHistory(projectId)).headRevision.id;

    const first = await guided.execute({ projectId, goal: "adjust_brightness", step: 1 }) as { structuredContent: Record<string, unknown> };
    expect(first.structuredContent).toMatchObject({ ok: true, complete: false, step: 1, projectChanged: false });
    expect(first.structuredContent.instruction).toBeTruthy();
    expect(first.structuredContent.verify).toBeTruthy();
    expect(first.structuredContent.focusRequestId).toEqual(expect.any(String));

    const past = await guided.execute({ projectId, goal: "adjust_brightness", step: 6 }) as { structuredContent: Record<string, unknown> };
    expect(past.structuredContent).toMatchObject({ complete: true });

    // Teaching is a read: no revision moved.
    expect((await service.getProjectHistory(projectId)).headRevision.id).toBe(before);
  });


  /**
   * `PH-016` through `PH-022`. A selection decides where the next edit lands; it is not an
   * edit, so it must not appear in Undo and must say so to an agent looking for a transaction.
   */
  it("selects a region without producing anything to undo", async () => {
    const project = await service.createProject({ name: `Photo ${crypto.randomUUID()}`, kind: "photo" });
    const tools = createEstroSiteTools(toolServices());
    const call = async (name: string, input: unknown) =>
      (await tools.find((tool) => tool.name === name)!.execute(input)) as { structuredContent: Record<string, unknown> };

    const before = (await service.getProjectHistory(project.id)).headRevision.id;
    const selected = await call("select_region", {
      projectId: project.id,
      source: { kind: "marquee", shape: "rectangle", x: 8, y: 8, width: 16, height: 16 },
    });
    expect(selected.structuredContent).toMatchObject({ ok: true, projectChanged: false, undoAvailable: false, areaPx: 256 });
    expect((await service.getProjectHistory(project.id)).headRevision.id).toBe(before);
  });

  it("builds a selection up rather than restarting it", async () => {
    const project = await service.createProject({ name: `Photo ${crypto.randomUUID()}`, kind: "photo" });
    const tools = createEstroSiteTools(toolServices());
    const call = async (name: string, input: unknown) =>
      (await tools.find((tool) => tool.name === name)!.execute(input)) as { structuredContent: Record<string, unknown> };

    await call("select_region", { projectId: project.id, source: { kind: "marquee", shape: "rectangle", x: 0, y: 0, width: 10, height: 10 } });
    const added = await call("select_region", {
      projectId: project.id, mode: "add",
      source: { kind: "marquee", shape: "rectangle", x: 20, y: 20, width: 10, height: 10 },
    });
    expect(added.structuredContent.areaPx).toBe(200);

    const grown = await call("refine_selection", { projectId: project.id, operation: { kind: "expand", amountPx: 1 } });
    expect(grown.structuredContent.areaPx as number).toBeGreaterThan(200);
  });

  it("saves a selection, brings it back, and lists it", async () => {
    const project = await service.createProject({ name: `Photo ${crypto.randomUUID()}`, kind: "photo" });
    const tools = createEstroSiteTools(toolServices());
    const call = async (name: string, input: unknown) =>
      (await tools.find((tool) => tool.name === name)!.execute(input)) as { structuredContent: Record<string, unknown> };

    await call("select_region", { projectId: project.id, source: { kind: "marquee", shape: "ellipse", x: 4, y: 4, width: 20, height: 20 } });
    const saved = await call("manage_selections", { projectId: project.id, action: "save", name: "Face" });
    expect(saved.structuredContent.summary).toContain("Face");

    await call("manage_selections", { projectId: project.id, action: "clear" });
    expect((await call("manage_selections", { projectId: project.id, action: "inspect" })).structuredContent.selected).toBe(false);

    const reloaded = await call("manage_selections", {
      projectId: project.id, action: "load", selectionId: saved.structuredContent.selectionId,
    });
    expect(reloaded.structuredContent.selected).toBe(true);

    const listed = await call("manage_selections", { projectId: project.id, action: "list" });
    expect(listed.structuredContent.selections).toHaveLength(1);
  });

  it("says what went wrong rather than silently selecting nothing", async () => {
    const project = await service.createProject({ name: `Photo ${crypto.randomUUID()}`, kind: "photo" });
    const tools = createEstroSiteTools(toolServices());
    const call = async (name: string, input: unknown) =>
      (await tools.find((tool) => tool.name === name)!.execute(input)) as { structuredContent: Record<string, unknown> };

    const refined = await call("refine_selection", { projectId: project.id, operation: { kind: "invert" } });
    expect(refined.structuredContent.ok).toBe(false);
    expect((refined.structuredContent.error as { message: string }).message).toContain("nothing selected to refine");

    const unnamed = await call("manage_selections", { projectId: project.id, action: "save" });
    expect(unnamed.structuredContent.ok).toBe(false);
    expect((unnamed.structuredContent.error as { message: string }).message).toContain("needs a name");
  });
  /**
   * The parity method the repair guide asks for: build the same starting revision twice,
   * make the same edit through the application service the UI calls and through the WebMCP
   * tool, then compare the normalized project state, the history operation, and the Undo
   * result. Only identifiers and timestamps are allowed to differ.
   *
   * This is the check that stops the two paths drifting. A tool that produces a similar
   * result through its own code is not parity; it is a second implementation waiting to
   * disagree with the first.
   */
  describe("UI and WebMCP parity", () => {
    const allTools = () => createEstroSiteTools(toolServices());

    /** The shape a tool returns, so a test can read a result without casting at each site. */
    type ToolResponse = { content: { text: string }[] };
    const readPayload = (response: unknown): Record<string, unknown> =>
      JSON.parse((response as ToolResponse).content[0].text);

    /** Strips the identifiers and clocks that are expected to differ between two runs. */
    function normalize(value: unknown): unknown {
      if (Array.isArray(value)) return value.map(normalize);
      if (value && typeof value === "object") {
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .filter(([key]) => !["id", "createdAt", "updatedAt", "addedAt", "projectId", "transactionId", "resultingRevisionId", "parentRevisionId", "headRevisionId", "groupId", "assetId", "documentId", "layerId"].includes(key))
            .map(([key, entry]) => [key, normalize(entry)]),
        );
      }
      return value;
    }

    async function photoProject(name: string) {
      const project = await service.createProject({ name, kind: "photo" });
      await service.createPhotoDocument({
        projectId: project.id, widthPx: 1200, heightPx: 800, resolutionPpi: 72,
        orientation: "landscape", background: { type: "solid", color: "#ffffff" },
      });
      return project.id;
    }

    const addShape = {
      operation: "add_shape" as const,
      shape: { kind: "ellipse" as const, cx: 0, cy: 0, rx: 120, ry: 80 },
    };

    /**
     * The claim the whole product rests on: an edit made by a person and the same edit made
     * by an agent are not merely similar, they are the same command producing the same state.
     * Comparing the resulting layer trees is how that stops being a claim.
     */
    it("produces the same document state from a layer edit through either path", async () => {
      const throughUi = await photoProject("parity-ui");
      await layerService.applyOperation(throughUi, addShape);

      const throughTools = await photoProject("parity-tools");
      const tools = allTools();
      const payload = readPayload(await tools.find((tool) => tool.name === "apply_layer_operation")!
        .execute({ projectId: throughTools, ...addShape }));
      expect(payload.ok).toBe(true);

      const [uiState, toolState] = await Promise.all([
        service.getProjectHistory(throughUi),
        service.getProjectHistory(throughTools),
      ]);
      expect(normalize(toolState.headRevision.state.photoDocument?.layers))
        .toEqual(normalize(uiState.headRevision.state.photoDocument?.layers));
    });

    it("leaves both projects in the same state after Undo", async () => {
      const throughUi = await photoProject("undo-ui");
      await layerService.applyOperation(throughUi, addShape);
      await service.undoProject(throughUi);

      const throughTools = await photoProject("undo-tools");
      const tools = allTools();
      const applied = readPayload(await tools.find((tool) => tool.name === "apply_layer_operation")!
        .execute({ projectId: throughTools, ...addShape }));
      await tools.find((tool) => tool.name === "undo_transaction")!
        .execute({ projectId: throughTools, transactionId: applied.transactionId as string });

      const [uiState, toolState] = await Promise.all([
        service.getProjectHistory(throughUi),
        service.getProjectHistory(throughTools),
      ]);
      expect(normalize(toolState.headRevision.state.photoDocument?.layers))
        .toEqual(normalize(uiState.headRevision.state.photoDocument?.layers));
      expect(toolState.headRevision.state.photoDocument?.layers).toHaveLength(0);
    });

    it("refuses the same stale edit through either path", async () => {
      const projectId = await photoProject("stale");
      const before = await service.getProjectHistory(projectId);
      // Something else commits, so the revision the caller quotes is no longer the head.
      await layerService.applyOperation(projectId, addShape);

      const tools = allTools();
      const refused = readPayload(await tools.find((tool) => tool.name === "apply_layer_operation")!
        .execute({ projectId, expectedRevisionId: before.headRevision.id, ...addShape }));
      expect(refused).toMatchObject({ ok: false, error: { code: "HISTORY_CONFLICT" } });

      await expect(layerService.applyOperation(projectId, addShape, { expectedRevisionId: before.headRevision.id }))
        .rejects.toMatchObject({ code: "HISTORY_CONFLICT" });
    });
  });
});
