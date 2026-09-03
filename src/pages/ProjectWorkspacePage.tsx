import {
  ArrowLeft, BookmarkPlus, Check, ChevronDown, CloudOff, Command, Crop, Focus, Grid2X2, Grid3X3, Hand, ImagePlus,
  History, Layers3, Maximize2, Minimize2, MousePointer2, PanelLeft, PanelRight, Pencil,
  Redo2, Ruler, Save, Shield, Sparkles, SplitSquareHorizontal, Undo2, ZoomIn,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { Link, useParams } from "react-router-dom";
import {
  assetService as defaultAssetService, jobService as defaultJobService,
  layerService as defaultLayerService, organizationService as defaultOrganizationService,
  outputService as defaultOutputService, projectService, reconcileAfterReload,
  catalogueService as defaultCatalogueService, selectionService as defaultSelectionService,
  presetService as defaultPresetService, renderService as defaultRenderService,
  workspaceService as defaultWorkspaceService, channelService as defaultChannelService,
  batchExportService as defaultBatchExportService, packageService as defaultPackageService,
  reviewService as defaultReviewService,
} from "../app/services";
import type { PhotoDocumentService, ProjectAutomationService, ProjectHistoryService, ProjectLifecycleService, ProjectMutationResult, ProjectObservationService, ProjectPersistenceService } from "../application/project-service";
import type { WorkspaceService } from "../application/workspace-service";
import type { AssetService } from "../application/asset-service";
import type { JobService } from "../application/job-service";
import type { LayerService } from "../application/layer-service";
import type { RenderService } from "../application/render-service";
import { MediaLibraryPanel, type MediaView } from "../components/MediaLibraryPanel";
import { JobCenter } from "../components/JobCenter";
import { LayersPanel } from "../components/LayersPanel";
import { LayerCanvas } from "../components/LayerCanvas";
import { AdjustmentInspector } from "../components/AdjustmentInspector";
import { EffectStackPanel } from "../components/EffectStackPanel";
import { ContentPanel } from "../components/ContentPanel";
import { CorrectionsPanel } from "../components/CorrectionsPanel";
import { MasksPanel } from "../components/MasksPanel";
import { PresetsPanel } from "../components/PresetsPanel";
import { LayerPropertiesPanel } from "../components/LayerPropertiesPanel";
import { LayerStylesPanel } from "../components/LayerStylesPanel";
import { HistoryPanel } from "../components/HistoryPanel";
import { InspectorSection } from "../components/InspectorSection";
import { GeometryPanel } from "../components/GeometryPanel";
import { ExportPanel } from "../components/ExportPanel";
import { CropOverlay } from "../components/CropOverlay";
import { CanvasToolOverlay, type CanvasTool, type DocumentPoint } from "../components/CanvasToolOverlay";
import { PaintAndSelectPanel } from "../components/PaintAndSelectPanel";
import { ChannelsPanel } from "../components/ChannelsPanel";
import { BatchPanel } from "../components/BatchPanel";
import { SharingPanel } from "../components/SharingPanel";
import { SwatchesPanel } from "../components/SwatchesPanel";
import { ProfilesPanel } from "../components/ProfilesPanel";
import { channelFilterCss, ChannelFilterDefs } from "../components/ChannelFilterDefs";
import { DEFAULT_CHANNEL_VIEW, type ChannelView } from "../domain/channel";
import { parseSvg, toSvgDocument } from "../domain/vector";
import type { ProjectRecord } from "../domain/project";
import type { BrushKind } from "../domain/brush";
import type { SelectionOutline } from "../application/selection-service";
import type { OrganizationService } from "../application/organization-service";
import type { OutputService } from "../application/output-service";
import type { WaveformData } from "../application/asset-service";
import type { ComparisonState } from "../application/render-service";
import { addTime, frameDuration, rational, subtractTime, toSeconds, ZERO, type Rational } from "../domain/time";
import { findLayer, flattenLayers, type AlignEdge, type AlignReference, type CanvasAnchor, type ImageLayer, type LayerCrop } from "../domain/layer";

import type { AssetRecord } from "../domain/asset";
import type { ResampleAlgorithm } from "../workers/worker-protocol";
import type { AdjustmentName } from "../domain/adjustment";
import { CommandPalette } from "../components/CommandPalette";
import { CreateDocumentDialog } from "../components/CreateDocumentDialog";
import { ModalDialog } from "../components/ModalDialog";
import { ProjectNameDialog } from "../components/ProjectNameDialog";
import { TransactionProposalDialog } from "../components/TransactionProposalDialog";
import type { ProjectHistorySnapshot } from "../data/project-repository";
import { ProjectError } from "../domain/project-error";
import type { CreatePhotoDocumentInput } from "../domain/photo-document";
import type { ProjectTransaction } from "../domain/project-history";
import type { ProjectPersistenceSnapshot, ProjectProposal } from "../domain/project-persistence";
import type { WorkspaceChange, WorkspacePreference } from "../domain/workspace";
import type { EditorCommandId } from "../editor/editor-commands";
import { getSemanticTarget } from "../editor/semantic-targets";
import { focusStore } from "../webmcp/focus-store";
import { getWebMcpAvailability } from "../webmcp/model-context";
import { getRegisteredToolCount } from "../webmcp/site-tools";

type ProjectWorkspaceService = ProjectLifecycleService & ProjectHistoryService & Partial<ProjectPersistenceService & ProjectAutomationService & PhotoDocumentService & ProjectObservationService>;
type WorkspaceApi = Pick<WorkspaceService, "getWorkspace" | "applyWorkspaceChange" | "subscribe">;
export interface ProjectWorkspaceProps {
  service?: ProjectWorkspaceService;
  workspaceApi?: WorkspaceApi;
  assetApi?: AssetService;
  jobApi?: JobService;
  layerApi?: LayerService;
  renderApi?: RenderService;
  organizationApi?: OrganizationService;
  outputApi?: OutputService;
}

function formatTransactionTime(timestamp: string): string { return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(timestamp)); }
function transactionState(transaction: ProjectTransaction, history: ProjectHistorySnapshot): string {
  if (transaction.resultingRevisionId === history.headRevision.id) return "Current revision";
  if (transaction.kind === "undo") return "Undo record";
  if (transaction.kind === "redo") return "Redo record";
  if (history.project.redoTransactionIds.includes(transaction.id)) return "Undone";
  if (history.project.undoTransactionIds.includes(transaction.id)) return "Applied";
  return "Recorded";
}
function clamp(value: number, minimum: number, maximum: number) { return Math.min(maximum, Math.max(minimum, value)); }

export function ProjectWorkspace({ service = projectService, workspaceApi = defaultWorkspaceService, assetApi = defaultAssetService, jobApi = defaultJobService, layerApi = defaultLayerService, renderApi = defaultRenderService, organizationApi = defaultOrganizationService, outputApi = defaultOutputService }: ProjectWorkspaceProps) {
  const { projectId } = useParams<{ projectId: string }>();
  const [history, setHistory] = useState<ProjectHistorySnapshot | null>(null);
  const [persistence, setPersistence] = useState<ProjectPersistenceSnapshot | null>(null);
  const [workspace, setWorkspace] = useState<WorkspacePreference | null>(null);
  const [proposal, setProposal] = useState<ProjectProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "draft" | "autosaving" | "failed">("saved");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [nameDialog, setNameDialog] = useState<"rename" | "save-as" | "snapshot" | null>(null);
  const [documentDialogOpen, setDocumentDialogOpen] = useState(false);
  const [proposalOpen, setProposalOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  /**
   * Which Inspector groups are open.
   *
   * `null` means "nobody has said", and the default for the current selection applies — so
   * selecting a photograph opens the groups about a photograph without overriding a group the
   * person has already opened or closed themselves. An explicit true or false wins and stays
   * put, including across a change of selection, because a group someone opened on purpose
   * vanishing when they click a different layer is worse than a stale default.
   *
   * Declared up here with the rest of the state because the focus-reveal effect below depends
   * on it: a semantic target inside a collapsed group cannot take focus until it opens.
   */
  const [openSections, setOpenSections] = useState<Record<string, boolean | null>>({});
  const [leftTab, setLeftTab] = useState<"layers" | "media" | "history">("layers");
  /**
   * Video work starts in the bins, not the layer stack.
   *
   * A video project opened on Layers, which for a sequence reads "3 track(s) and 3 clip(s),
   * video structure lives in the timeline below" — a panel whose only content is a sentence
   * telling you to look somewhere else. The blueprint makes Media the default for video, and
   * this switches once, on load, so a deliberate move back to Layers is not undone.
   */
  const kindDefaultApplied = useRef(false);
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
  const [playhead, setPlayhead] = useState<Rational>(ZERO);
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [cropping, setCropping] = useState(false);
  /*
   * The two tools that cannot be a form.
   *
   * Held here rather than in the persisted workspace record: which brush you had out is not
   * something anybody wants restored three days later, and putting it in the workspace would
   * mean migrating every saved one for a preference with no memory value.
   */
  const [canvasTool, setCanvasTool] = useState<CanvasTool | null>(null);
  const [brushKind, setBrushKind] = useState<BrushKind>("brush");
  const [brushSizePx, setBrushSizePx] = useState(40);
  const [brushColour, setBrushColour] = useState("#ffffff");
  /** Where a healing or cloning brush reads its texture from, relative to where it paints. */
  const [cloneOffset, setCloneOffset] = useState({ x: 60, y: 0 });
  const [selectionState, setSelectionState] = useState<{ summary: string; hasSelection: boolean }>({ summary: "Nothing is selected.", hasSelection: false });
  /**
   * Which channels are drawn, held here rather than in the revision.
   *
   * Hiding a channel is not an edit, so it must not produce a transaction or land in Undo. The
   * service owns the value; this mirrors it only so React re-renders the canvas filter when it
   * changes.
   */
  const [channelView, setChannelView] = useState<ChannelView>(DEFAULT_CHANNEL_VIEW);
  /** Every project, so a batch can reach past the one that is open. */
  const [allProjects, setAllProjects] = useState<ProjectRecord[]>([]);
  const [selectionOutline, setSelectionOutline] = useState<SelectionOutline | null>(null);
  const [cropDraft, setCropDraft] = useState<LayerCrop | null>(null);
  const [cropRatio, setCropRatio] = useState<number | null>(null);
  const [comparison, setComparison] = useState<ComparisonState | null>(null);
  const [looping, setLooping] = useState(false);
  const [waveforms, setWaveforms] = useState<Record<string, WaveformData | null>>({});
  const [assetRecords, setAssetRecords] = useState<AssetRecord[]>([]);
  const [reconciliation, setReconciliation] = useState<{ interruptedJobs: number; discardedStagedSources: number } | null>(null);
  const [agentTarget, setAgentTarget] = useState<string | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);
  const autosaveGeneration = useRef(0);
  const cancelDiscardRef = useRef<HTMLButtonElement>(null);
  const workspaceHeadingRef = useRef<HTMLHeadingElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const hasFocusedRoute = useRef(false);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; panX: number; panY: number } | null>(null);
  const resizeRef = useRef<{ pointerId: number; panel: "left" | "inspector"; startX: number; width: number } | null>(null);

  const trackAutosave = useCallback((targetProjectId: string) => {
    if (!service.waitForAutosave) { setSaveState("draft"); return; }
    const generation = ++autosaveGeneration.current;
    setSaveState("autosaving");
    void service.waitForAutosave(targetProjectId).then(async () => {
      const nextPersistence = await service.getProjectPersistence?.(targetProjectId);
      if (generation !== autosaveGeneration.current) return;
      if (nextPersistence) setPersistence(nextPersistence);
      setSaveState("saved"); setStatus("Autosave completed. The current revision is durable.");
    }).catch(() => { if (generation !== autosaveGeneration.current) return; setSaveState("failed"); setError("Autosave did not complete. Your last durable revision is preserved; use Save to retry."); });
  }, [service]);

  const loadWorkspace = useCallback(async () => {
    if (!projectId) return;
    const [nextHistory, nextPersistence, nextWorkspace] = await Promise.all([
      service.getProjectHistory(projectId), service.getProjectPersistence?.(projectId) ?? Promise.resolve(null), workspaceApi.getWorkspace(projectId),
    ]);
    setHistory(nextHistory); setPersistence(nextPersistence); setWorkspace(nextWorkspace);
    if (nextPersistence?.hasPendingAutosave) trackAutosave(projectId); else setSaveState(nextPersistence?.hasRecoverableDraft ? "draft" : "saved");
  }, [projectId, service, trackAutosave, workspaceApi]);

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    service.openProject(projectId).then(loadWorkspace).catch((loadError) => { if (active) setError(loadError instanceof ProjectError ? loadError.message : "This local project is no longer available."); });
    const unsubscribeWorkspace = workspaceApi.subscribe(projectId, (next) => { if (active) setWorkspace(next); });
    const unsubscribeProject = service.subscribeProject?.(projectId, (result) => {
      if (!active) return;
      setHistory(result); setStatus(result.transaction.summary);
      if (result.transaction.actor.type === "agent") trackAutosave(projectId);
    }) ?? (() => undefined);
    return () => { active = false; autosaveGeneration.current += 1; unsubscribeWorkspace(); unsubscribeProject(); };
  }, [loadWorkspace, projectId, service, workspaceApi]);

  useEffect(() => focusStore.subscribe((request) => {
    if (request.projectId !== projectId) return;
    const target = getSemanticTarget(request.targetId); if (!target) return;
    if (target.region === "left") setWorkspace((current) => current ? { ...current, panels: { ...current.panels, left: { ...current.panels.left, open: true } } } : current);
    if (target.region === "inspector") setWorkspace((current) => current ? {
      ...current,
      panels: { ...current.panels, inspector: { ...current.panels.inspector, open: true } },
      ...(request.targetId === "inspector-document-width" && history?.headRevision.state.photoDocument
        ? { selection: { type: "document" as const, targetId: history.headRevision.state.photoDocument.id, targetIds: [] } }
        : {}),
    } : current);
    setAgentTarget(request.targetId); setStatus(`WebMCP focused ${target.label}.`);
    queueMicrotask(() => {
      const element = document.querySelector<HTMLElement>(`[data-semantic-id="${request.targetId}"]`);
      /*
       * An Inspector group can be collapsed, and a collapsed group's body is `display: none`,
       * so focusing something inside one would silently do nothing. Reading the group off the
       * DOM rather than from a target-to-group table means a target added later reveals
       * itself without anyone remembering to register it here.
       */
      const group = element?.closest<HTMLElement>("[data-inspector-section]")?.dataset.inspectorSection;
      if (group) setOpenSections((current) => ({ ...current, [group]: true }));
      element?.focus();
    });
    window.setTimeout(() => setAgentTarget((current) => current === request.targetId ? null : current), 10_000);
  }), [history?.headRevision.state.photoDocument, projectId]);

  useEffect(() => {
    if (!agentTarget) return;
    // A focused target can be re-rendered out from under the cursor while background loads
    // settle. Re-asserting focus for a few frames means an agent's reveal actually lands
    // instead of quietly losing a race with an unrelated update.
    let frames = 0;
    let handle = 0;
    const settle = () => {
      const element = document.querySelector<HTMLElement>(`[data-semantic-id="${agentTarget}"]`);
      if (element && document.activeElement !== element) element.focus();
      frames += 1;
      if (frames < 20) handle = window.setTimeout(settle, 16);
    };
    settle();
    return () => window.clearTimeout(handle);
    // `openSections` is in here because a target inside a collapsed Inspector group cannot take
    // focus until the group is open, and the reveal that opens it lands in the same render.
  }, [agentTarget, workspace?.selection.type, openSections]);

  useEffect(() => {
    function enforceCompactPanelRule() {
      if (!workspace || window.innerWidth >= 1180 || !workspace.panels.left.open || !workspace.panels.inspector.open) return;
      const panelToClose = workspace.selection.type === "document" ? "left" : "inspector";
      void applyWorkspaceChange({ type: "panel", panel: panelToClose, open: false }, `${panelToClose === "left" ? "Layers panel" : "Inspector"} closed to keep the canvas usable at this width.`);
    }
    enforceCompactPanelRule();
    window.addEventListener("resize", enforceCompactPanelRule);
    return () => window.removeEventListener("resize", enforceCompactPanelRule);
  }, [workspace?.panels.left.open, workspace?.panels.inspector.open, workspace?.selection.type]);

  /** Reads the live selection back so the ants and the summary follow what actually happened. */
  const refreshSelection = useCallback(() => {
    if (!projectId) return;
    const state = defaultSelectionService.state(projectId);
    setSelectionState({ summary: state.summary, hasSelection: state.mask !== null });
    setSelectionOutline(defaultSelectionService.outline(projectId));
  }, [projectId]);

  /* Every project, for the batch panel. Reloaded when the open project's name may have changed. */
  useEffect(() => {
    void projectService.listProjects().then(setAllProjects).catch(() => setAllProjects([]));
  }, [projectId, history?.headRevision.id]);

  /**
   * Brings an SVG in as editable objects rather than as a picture of itself.
   *
   * Each shape becomes its own layer, which is the honest translation: an SVG's objects are
   * separate things, and flattening them into one layer would throw away the only reason to
   * import vectors rather than a PNG. Anything Estro cannot draw is named rather than dropped
   * silently, because a file that quietly lost half its content is worse than one that refused.
   */
  async function importSvg(source: string, fileName: string) {
    if (!projectId) return;
    setError(null);
    try {
      const { objects, warnings } = parseSvg(source);
      if (!objects.length) {
        setError(`Nothing in “${fileName}” could be read as a shape.${warnings[0] ? ` ${warnings[0]}` : ""}`);
        return;
      }
      for (const object of objects) {
        await runLayerOperation({
          operation: "add_shape", shape: object.shape, fill: object.fill, stroke: object.stroke,
        });
      }
      setStatus(warnings.length
        ? `Brought in ${objects.length} shape(s) from “${fileName}”. ${warnings[0]}`
        : `Brought in ${objects.length} shape(s) from “${fileName}”, each as its own layer.`);
    } catch (svgError) {
      setError(svgError instanceof ProjectError ? svgError.message : "That file could not be read as SVG.");
    }
  }

  /** Writes every vector shape in the document out as one SVG file. */
  function exportSvg() {
    if (!documentState) return;
    const objects = flattenLayers(documentLayers)
      .map((entry) => entry.layer)
      .filter((layer) => layer.kind === "graphics" && layer.content.kind === "vector")
      .map((layer) => (layer as Extract<typeof layer, { kind: "graphics" }>).content)
      .filter((content): content is Extract<typeof content, { kind: "vector" }> => content.kind === "vector")
      .map((content) => content.vector);
    if (!objects.length) { setError("There are no shapes in this document to write out."); return; }

    const swatches = new Map((documentState.swatches ?? []).map((swatch) => [swatch.id, swatch]));
    const svg = toSvgDocument(objects, { widthPx: documentState.widthPx, heightPx: documentState.heightPx, swatches });
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${(project?.name ?? "shapes").replace(/[^\w\- ]+/g, "").trim() || "shapes"}.svg`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus(`Wrote ${objects.length} shape(s) out as SVG.`);
  }

  /**
   * One gesture from the canvas, turned into the command it means.
   *
   * A selection is runtime state rather than a project revision — it is what the next edit
   * applies to, not an edit itself — so it does not go through the history engine. A stroke
   * does, which is why only that one calls `runLayerOperation`.
   */
  async function handleCanvasGesture(gesture: Parameters<Parameters<typeof CanvasToolOverlay>[0]["onGesture"]>[0]) {
    if (!projectId) return;
    try {
      if (gesture.kind === "stroke") {
        const points = gesture.points.map((point: DocumentPoint) => ({ x: point.x, y: point.y, pressure: 1 }));
        await runLayerOperation({
          operation: "paint_stroke",
          /*
           * Paint onto the selected paint layer, or the topmost existing one, and only start
           * a new layer when there is none. Without the fallback every stroke made its own
           * layer, which after five strokes is five layers nobody asked for. A photo layer is
           * never painted on directly: strokes live on their own layer so the photograph stays
           * untouched.
           */
          layerId: selectedLayer?.kind === "paint"
            ? selectedLayer.id
            : [...documentLayers].reverse().find((entry) => entry.kind === "paint")?.id,
          brush: { kind: brushKind, sizePx: brushSizePx },
          paint: { kind: "solid", colour: brushColour, opacity: 1 },
          // Only the two sampling brushes use it; sending it otherwise would be noise.
          cloneOffset: brushKind === "heal" || brushKind === "clone" ? cloneOffset : undefined,
          points,
        });
        return;
      }
      if (gesture.kind === "marquee") {
        await defaultSelectionService.select({
          projectId,
          source: { kind: "marquee", shape: gesture.shape, x: gesture.x, y: gesture.y, width: gesture.width, height: gesture.height },
        });
      } else if (gesture.kind === "lasso") {
        await defaultSelectionService.select({
          projectId,
          source: { kind: "lasso", points: gesture.points.map((point: DocumentPoint) => ({ x: point.x, y: point.y })) },
        });
      } else if (gesture.kind === "wand") {
        await defaultSelectionService.select({
          projectId,
          source: { kind: "wand", x: gesture.x, y: gesture.y, tolerance: 32, contiguous: true },
        });
      }
      refreshSelection();
      setStatus(defaultSelectionService.state(projectId).summary);
    } catch (error) {
      setError(error instanceof ProjectError ? error.message : "That gesture did not complete.");
    }
  }

  const acceptMutation = useCallback((result: ProjectMutationResult) => { setHistory(result); setStatus(result.transaction.summary); if (projectId) trackAutosave(projectId); else setSaveState("draft"); }, [projectId, trackAutosave]);

  async function applyWorkspaceChange(change: WorkspaceChange, announcement?: string) {
    if (!projectId) return null;
    try { const next = await workspaceApi.applyWorkspaceChange(projectId, change); setWorkspace(next); if (announcement) setStatus(announcement); return next; }
    catch (workspaceError) { setError(workspaceError instanceof Error ? workspaceError.message : "The workspace preference was not changed."); return null; }
  }
  function previewViewport(viewport: WorkspacePreference["viewport"]) { setWorkspace((current) => current ? { ...current, viewport } : current); }
  function fitViewport(mode: "fit" | "actual" = "fit") {
    if (!workspace || !history?.headRevision.state.photoDocument) return;
    const documentState = history.headRevision.state.photoDocument; const stage = stageRef.current;
    const rotated = Math.abs(workspace.viewport.rotationDeg) === 90;
    const width = rotated ? documentState.heightPx : documentState.widthPx; const height = rotated ? documentState.widthPx : documentState.heightPx;
    const zoom = mode === "actual" ? 1 : clamp(Math.min(((stage?.clientWidth ?? 900) - 96) / width, ((stage?.clientHeight ?? 620) - 112) / height), 0.05, 32);
    void applyWorkspaceChange({ type: "viewport", viewport: { zoom, panX: 0, panY: 0, rotationDeg: workspace.viewport.rotationDeg, mode } }, mode === "fit" ? "Fit the document to the canvas." : "Showing the document at 100%.");
  }
  function changeZoom(factor: number) { if (!workspace) return; const zoom = clamp(workspace.viewport.zoom * factor, 0.05, 32); void applyWorkspaceChange({ type: "viewport", viewport: { ...workspace.viewport, zoom, mode: "custom" } }, `Canvas zoom ${Math.round(zoom * 100)}%.`); }
  function rotateView(reset = false) { if (!workspace) return; const rotationDeg = reset ? 0 : workspace.viewport.rotationDeg >= 90 ? workspace.viewport.rotationDeg - 270 : workspace.viewport.rotationDeg + 90; void applyWorkspaceChange({ type: "viewport", viewport: { ...workspace.viewport, rotationDeg, mode: "custom" } }, `View rotation ${rotationDeg} degrees. Document pixels are unchanged.`); }
  async function setDistractionFree(enabled: boolean) {
    const next = await applyWorkspaceChange({ type: "distraction_free", enabled }, enabled ? "Entered distraction-free preview." : "Exited distraction-free preview."); if (!next) return;
    if (enabled && document.fullscreenEnabled && !document.fullscreenElement) { try { await document.documentElement.requestFullscreen(); } catch { setStatus("Distraction-free preview is active inside the page. Browser fullscreen was unavailable."); } }
    else if (!enabled && document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
  }
  /**
   * The one place a command name turns into an action.
   *
   * Every entry in the command index resolves here, so nothing in the palette is inert: a
   * command that cannot run right now says why instead of doing nothing.
   */
  function runCommand(commandId: EditorCommandId) {
    if (!workspace) return;
    const needsLayer = () => {
      if (selectedImageLayer) return true;
      setError("Select an image layer first. This command acts on the selected layer.");
      return false;
    };
    const needsClip = () => {
      if (selectedClipIds.length) return true;
      setError("Select a clip on the timeline first.");
      return false;
    };
    const relationships = { honorLinks: workspace.timeline.linkedSelection, honorGroups: workspace.timeline.linkedSelection };

    switch (commandId) {
      /* view */
      case "view.fit": fitViewport("fit"); return;
      case "view.actual": fitViewport("actual"); return;
      case "view.zoom-in": changeZoom(1.2); return;
      case "view.zoom-out": changeZoom(1 / 1.2); return;
      case "view.rotate": rotateView(); return;
      case "view.reset-rotation": rotateView(true); return;
      case "view.quality-draft":
      case "view.quality-balanced":
      case "view.quality-full": {
        const quality = commandId.replace("view.quality-", "") as "draft" | "balanced" | "full";
        void applyWorkspaceChange({ type: "preview_quality", quality }, `Preview quality set to ${quality}.`);
        return;
      }

      /* overlays */
      case "overlay.grid": void applyWorkspaceChange({ type: "overlay", overlay: "grid", enabled: !workspace.overlays.grid }, `${workspace.overlays.grid ? "Hid" : "Showed"} the grid.`); return;
      case "overlay.guides": void applyWorkspaceChange({ type: "overlay", overlay: "guides", enabled: !workspace.overlays.guides }, `${workspace.overlays.guides ? "Hid" : "Showed"} guides.`); return;
      case "overlay.snapping": void applyWorkspaceChange({ type: "overlay", overlay: "snapping", enabled: !workspace.overlays.snapping }, `Canvas snapping ${workspace.overlays.snapping ? "off" : "on"}.`); return;
      case "overlay.pixel-grid": void applyWorkspaceChange({ type: "overlay", overlay: "pixelGrid", enabled: !workspace.overlays.pixelGrid }, `Pixel grid ${workspace.overlays.pixelGrid ? "off" : "on"}. It is visible above 100% zoom.`); return;
      case "overlay.safe-areas": void applyWorkspaceChange({ type: "overlay", overlay: "safeAreas", enabled: !workspace.overlays.safeAreas }, `${workspace.overlays.safeAreas ? "Hid" : "Showed"} safe areas.`); return;

      /* workspace */
      case "workspace.distraction-free": void setDistractionFree(!workspace.distractionFree); return;
      case "workspace.left-panel": void togglePanel("left"); return;
      case "workspace.inspector": void togglePanel("inspector"); return;
      case "workspace.swap-docks": void applyWorkspaceChange({ type: "dock", leadingPanel: workspace.leadingPanel === "left" ? "inspector" : "left" }, "Swapped the panel docking sides."); return;
      case "workspace.media": setLeftTab("media"); void applyWorkspaceChange({ type: "panel", panel: "left", open: true }, "Showing the Media panel."); return;
      case "workspace.layers": setLeftTab("layers"); void applyWorkspaceChange({ type: "panel", panel: "left", open: true }, "Showing the Layers panel."); return;
      case "workspace.history": setLeftTab("history"); void applyWorkspaceChange({ type: "panel", panel: "left", open: true }, "Showing the History panel."); return;

      /* tools */
      case "tool.select": setCropping(false); void applyWorkspaceChange({ type: "tool", tool: "select" }, "Select tool active."); return;
      case "tool.hand": setCropping(false); void applyWorkspaceChange({ type: "tool", tool: "hand" }, "Hand tool active."); return;
      case "tool.zoom": setCropping(false); void applyWorkspaceChange({ type: "tool", tool: "zoom" }, "Zoom tool active."); return;
      case "tool.crop":
        if (!needsLayer()) return;
        setCropping(true);
        setCropDraft(selectedImageLayer!.crop);
        setStatus("Crop tool active. Drag a handle, or set an exact crop in the Inspector.");
        return;

      /* media */
      case "media.import":
      case "media.import-folder":
        setLeftTab("media");
        focusStore.request(projectId!, "media-import", "command");
        setStatus("Choosing files is a user action, so the Import control is focused rather than opened automatically.");
        return;
      case "media.add-to-canvas":
        if (!selectedAssetId) { setError("Select media in the Media panel first."); return; }
        void addAssetToCanvas(selectedAssetId);
        return;
      case "media.relink":
      case "media.replace":
      case "media.proxy":
        setLeftTab("media");
        focusStore.request(projectId!, commandId === "media.proxy" ? "media-proxy" : commandId === "media.replace" ? "media-replace" : "media-relink", "command");
        return;
      case "media.create-bin":
        void applyWorkspaceChange({ type: "media_view", view: "bins" }, "Showing bins. Use New bin to create one.");
        setLeftTab("media");
        return;
      case "media.storyboard":
        void applyWorkspaceChange({ type: "media_view", view: "storyboard" }, "Showing the storyboard.");
        setLeftTab("media");
        return;

      /* layers */
      case "layer.group":
        if (selectedLayerIds.length < 2) { setError("Select at least two layers to group them."); return; }
        void runLayerOperation({ operation: "group", layerIds: selectedLayerIds });
        return;
      case "layer.ungroup":
        if (selectedLayerIds.length !== 1) { setError("Select one group to ungroup it."); return; }
        void runLayerOperation({ operation: "ungroup", layerId: selectedLayerIds[0] });
        return;
      case "layer.duplicate":
        if (selectedLayerIds.length !== 1) { setError("Select one layer to duplicate it."); return; }
        void runLayerOperation({ operation: "duplicate", layerId: selectedLayerIds[0] });
        return;
      case "layer.rename":
        if (selectedLayerIds.length !== 1) { setError("Select one layer to rename it."); return; }
        setLeftTab("layers");
        focusStore.request(projectId!, "panel-layers", "command");
        setStatus("Double-click the layer name, or use the rename control in its row.");
        return;
      case "layer.fit": if (needsLayer()) void runLayerOperation({ operation: "fit", layerId: selectedImageLayer!.id, mode: "fit" }); return;
      case "layer.fill": if (needsLayer()) void runLayerOperation({ operation: "fit", layerId: selectedImageLayer!.id, mode: "fill" }); return;
      case "layer.reset-transform": if (needsLayer()) void runLayerOperation({ operation: "reset_transform", layerId: selectedImageLayer!.id }); return;
      case "layer.rotate-right": if (needsLayer()) void runLayerOperation({ operation: "rotate_quarter", layerId: selectedImageLayer!.id, turns: 1 }); return;
      case "layer.rotate-left": if (needsLayer()) void runLayerOperation({ operation: "rotate_quarter", layerId: selectedImageLayer!.id, turns: -1 }); return;
      case "layer.flip-horizontal": if (needsLayer()) void runLayerOperation({ operation: "flip", layerId: selectedImageLayer!.id, axis: "horizontal" }); return;
      case "layer.flip-vertical": if (needsLayer()) void runLayerOperation({ operation: "flip", layerId: selectedImageLayer!.id, axis: "vertical" }); return;

      /* review */
      case "compare.toggle": void setComparisonMode(workspace.comparison.mode === "off" ? "toggle" : "off"); return;
      case "compare.split": void setComparisonMode(workspace.comparison.mode === "split" ? "off" : "split"); return;

      /* export */
      case "export.photo":
      case "export.outputs":
        void applyWorkspaceChange({ type: "panel", panel: "inspector", open: true });
        focusStore.request(projectId!, commandId === "export.outputs" ? "output-list" : "inspector-export", "command");
        return;
    }
  }

  async function togglePanel(panel: "left" | "inspector") {
    if (!workspace) return;
    const opening = !workspace.panels[panel].open;
    const other = panel === "left" ? "inspector" : "left";
    if (opening && window.innerWidth < 1180 && workspace.panels[other].open) {
      await applyWorkspaceChange({ type: "panel", panel: other, open: false });
    }
    await applyWorkspaceChange({ type: "panel", panel, open: opening }, `${opening ? "Opened" : "Closed"} the ${panel === "left" ? "Layers panel" : "Inspector"}.`);
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setCommandPaletteOpen(true); return; }
      const targetIsTextControl = event.target instanceof Element && event.target.matches("input, textarea, select");
      if (targetIsTextControl || document.querySelector("dialog[open]")) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); void changeHistory(event.shiftKey ? "redo" : "undo"); return; }
      if (event.key === " ") {
        event.preventDefault();
        setSpacePressed(true);
        return;
      }
      const key = event.key.toLowerCase();

      if (key === "c" && !event.metaKey && !event.ctrlKey && documentState) { runCommand("tool.crop"); return; }
      if (event.key === "\\") { runCommand("compare.toggle"); return; }

      if (key === "v") runCommand("tool.select"); else if (key === "h") runCommand("tool.hand"); else if (key === "z") runCommand("tool.zoom"); else if (key === "g") runCommand("overlay.grid");
      else if (event.key === ";" && event.shiftKey) runCommand("overlay.snapping"); else if (event.key === ";") runCommand("overlay.guides"); else if (key === "f") runCommand("workspace.distraction-free");
      else if (key === "r" && event.shiftKey) runCommand("view.reset-rotation"); else if (key === "r") runCommand("view.rotate"); else if (event.key === "0") runCommand("view.fit"); else if (event.key === "1") runCommand("view.actual");
      else if (event.key === "+" || event.key === "=") runCommand("view.zoom-in"); else if (event.key === "-") runCommand("view.zoom-out");
      else if (event.key === "Escape" && workspace?.distractionFree) void setDistractionFree(false);
      else if (event.key === "Escape" && workspace && window.innerWidth < 1180 && (workspace.panels.left.open || workspace.panels.inspector.open)) {
        const panel = workspace.panels.inspector.open ? "inspector" : "left";
        void applyWorkspaceChange({ type: "panel", panel, open: false }, `Closed the ${panel === "left" ? "Layers panel" : "Inspector"}.`);
      } else if (event.key === "Escape" && cropping) { setCropping(false); setCropDraft(null); }
      else if (event.key === "Escape" && agentTarget) setAgentTarget(null);
    }
    function handleKeyUp(event: KeyboardEvent) { if (event.key === " ") setSpacePressed(false); }
    window.addEventListener("keydown", handleKeyDown); window.addEventListener("keyup", handleKeyUp); return () => { window.removeEventListener("keydown", handleKeyDown); window.removeEventListener("keyup", handleKeyUp); };
  });

  function onCanvasPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!workspace) return; const shouldPan = workspace.activeTool === "hand" || spacePressed || event.button === 1 || event.pointerType === "touch";
    if (workspace.activeTool === "zoom" && event.button === 0) { changeZoom(event.shiftKey ? 1 / 1.2 : 1.2); return; } if (!shouldPan) return;
    event.currentTarget.setPointerCapture(event.pointerId); dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, panX: workspace.viewport.panX, panY: workspace.viewport.panY };
    setStatus(`${event.pointerType || "pointer"} canvas navigation active${event.pointerType === "pen" && event.pressure ? ` at ${Math.round(event.pressure * 100)}% pressure` : ""}.`);
  }
  function onCanvasPointerMove(event: ReactPointerEvent<HTMLDivElement>) { const drag = dragRef.current; if (!workspace || !drag || drag.pointerId !== event.pointerId) return; previewViewport({ ...workspace.viewport, panX: drag.panX + event.clientX - drag.startX, panY: drag.panY + event.clientY - drag.startY, mode: "custom" }); }
  function onCanvasPointerUp(event: ReactPointerEvent<HTMLDivElement>) { const drag = dragRef.current; if (!workspace || !drag || drag.pointerId !== event.pointerId) return; dragRef.current = null; event.currentTarget.releasePointerCapture(event.pointerId); void applyWorkspaceChange({ type: "viewport", viewport: workspace.viewport }, `Canvas panned to ${Math.round(workspace.viewport.panX)}, ${Math.round(workspace.viewport.panY)} pixels.`); }
  function onCanvasWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!workspace) return; event.preventDefault();
    if (event.ctrlKey || event.metaKey) { const rect = event.currentTarget.getBoundingClientRect(); const pointX = event.clientX - rect.left - rect.width / 2; const pointY = event.clientY - rect.top - rect.height / 2; const zoom = clamp(workspace.viewport.zoom * Math.exp(-event.deltaY * 0.002), 0.05, 32); const ratio = zoom / workspace.viewport.zoom; void applyWorkspaceChange({ type: "viewport", viewport: { ...workspace.viewport, zoom, panX: pointX - (pointX - workspace.viewport.panX) * ratio, panY: pointY - (pointY - workspace.viewport.panY) * ratio, mode: "custom" } }, `Canvas zoom ${Math.round(zoom * 100)}%.`); }
    else void applyWorkspaceChange({ type: "viewport", viewport: { ...workspace.viewport, panX: workspace.viewport.panX - event.deltaX, panY: workspace.viewport.panY - event.deltaY, mode: "custom" } });
  }
  function onCanvasKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!workspace) return;
    const key = event.key.toLowerCase();
    let handled = true;
    if (event.key === "+" || event.key === "=") runCommand("view.zoom-in");
    else if (event.key === "-") runCommand("view.zoom-out");
    else if (event.key === "0") runCommand("view.fit");
    else if (event.key === "1") runCommand("view.actual");
    else if (key === "r" && event.shiftKey) runCommand("view.reset-rotation");
    else if (key === "r") runCommand("view.rotate");
    else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      const step = event.shiftKey ? 48 : 8;
      const panX = workspace.viewport.panX + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0);
      const panY = workspace.viewport.panY + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0);
      void applyWorkspaceChange({ type: "viewport", viewport: { ...workspace.viewport, panX, panY, mode: "custom" } }, `Canvas panned to ${Math.round(panX)}, ${Math.round(panY)} pixels.`);
    } else handled = false;
    if (handled) { event.preventDefault(); event.stopPropagation(); }
  }
  function beginResize(event: ReactPointerEvent<HTMLDivElement>, panel: "left" | "inspector") { if (!workspace) return; event.currentTarget.setPointerCapture(event.pointerId); resizeRef.current = { pointerId: event.pointerId, panel, startX: event.clientX, width: workspace.panels[panel].widthPx }; }
  function panelIsLeading(panel: "left" | "inspector") { return workspace?.leadingPanel === panel; }
  function moveResize(event: ReactPointerEvent<HTMLDivElement>) { const resize = resizeRef.current; if (!workspace || !resize || resize.pointerId !== event.pointerId) return; const direction = panelIsLeading(resize.panel) ? 1 : -1; const bounds = resize.panel === "left" ? [224, 360] : [272, 400]; const widthPx = clamp(resize.width + (event.clientX - resize.startX) * direction, bounds[0], bounds[1]); setWorkspace({ ...workspace, panels: { ...workspace.panels, [resize.panel]: { ...workspace.panels[resize.panel], widthPx: Math.round(widthPx) } } }); }
  function endResize(event: ReactPointerEvent<HTMLDivElement>) { const resize = resizeRef.current; if (!workspace || !resize || resize.pointerId !== event.pointerId) return; resizeRef.current = null; event.currentTarget.releasePointerCapture(event.pointerId); void applyWorkspaceChange({ type: "panel", panel: resize.panel, widthPx: workspace.panels[resize.panel].widthPx }, `${resize.panel === "left" ? "Layers panel" : "Inspector"} width ${workspace.panels[resize.panel].widthPx} pixels.`); }
  function resizeWithKeyboard(event: React.KeyboardEvent<HTMLDivElement>, panel: "left" | "inspector") { if (!workspace) return; const bounds = panel === "left" ? [224, 360] : [272, 400]; const direction = panelIsLeading(panel) ? 1 : -1; let width = workspace.panels[panel].widthPx; if (event.key === "Home") width = bounds[0]; else if (event.key === "End") width = bounds[1]; else if (event.key === "ArrowLeft") width -= 8 * direction; else if (event.key === "ArrowRight") width += 8 * direction; else return; event.preventDefault(); void applyWorkspaceChange({ type: "panel", panel, widthPx: clamp(width, bounds[0], bounds[1]) }); }

  /* ------------------------------ shared commands ----------------------------- */

  async function runLayerOperation(operation: Parameters<LayerService["applyOperation"]>[1], announcement?: string) {
    if (!projectId) return;
    setError(null);
    try {
      const result = await layerApi.applyOperation(projectId, operation, { intent: "Edit layers from the editor." });
      acceptMutation(result);
      setStatus(announcement ?? result.transaction.summary);
    } catch (layerError) {
      setError(layerError instanceof ProjectError ? layerError.message : "That layer edit did not complete.");
    }
  }



  async function runOrganizationCommand(command: Parameters<OrganizationService["apply"]>[1], announcement?: string) {
    if (!projectId) return;
    setError(null);
    try {
      const result = await organizationApi.apply(projectId, command, { intent: "Organize media from the editor." });
      acceptMutation(result);
      setStatus(announcement ?? result.transaction.summary);
    } catch (organizationError) {
      setError(organizationError instanceof ProjectError ? organizationError.message : "That change did not complete.");
    }
  }



  async function resizeDocument(
    mode: "canvas" | "image",
    widthPx: number,
    heightPx: number,
    options: { anchor: CanvasAnchor; resampleAlgorithm: ResampleAlgorithm; lockAspect: boolean },
  ) {
    if (!projectId) return;
    setError(null);
    try {
      const result = await layerApi.resizeDocument(projectId, { mode, widthPx, heightPx, ...options }, { intent: "Resize the document from the Inspector." });
      acceptMutation(result);
      setStatus(`${result.transaction.summary}${result.warnings[0] ? ` ${result.warnings[0]}` : ""}`);
    } catch (resizeError) {
      setError(resizeError instanceof ProjectError ? resizeError.message : "That resize did not complete.");
    }
  }

  async function adjustColor(adjustment: AdjustmentName, value: number) {
    if (!projectId || !selectedImageLayer) return;
    try {
      const result = await layerApi.applyColorAdjustment(projectId, { layerId: selectedImageLayer.id, adjustment, value }, { intent: "Adjust colour from the Inspector." });
      acceptMutation(result);
      setStatus(result.description);
    } catch (colorError) {
      setError(colorError instanceof ProjectError ? colorError.message : "That colour adjustment did not complete.");
    }
  }

  /* -------------------------------- media flow -------------------------------- */

  async function addAssetToCanvas(assetId: string) {
    if (!documentState) {
      setError("Create an image document before adding media to the canvas.");
      return;
    }
    await runLayerOperation({ operation: "add_image", assetId, fit: "fit" }, "Added the image to the canvas as a new layer.");
  }


  /** The range the Source Monitor's marks describe, or the whole source when unmarked. */
  function sourceRangeForEdit(): { start: Rational; duration: Rational } | undefined {
    const marks = workspace?.sourceMonitor;
    if (!marks || marks.inPointSeconds === null || marks.outPointSeconds === null) return undefined;
    return {
      start: rational(Math.round(marks.inPointSeconds * 1000), 1000),
      duration: rational(Math.round((marks.outPointSeconds - marks.inPointSeconds) * 1000), 1000),
    };
  }

  function sourceDescriptorForEdit(): { assetId: string } | { subclipId: string } | null {
    const marks = workspace?.sourceMonitor;
    if (!marks?.itemId) return null;
    return marks.itemType === "subclip" ? { subclipId: marks.itemId } : { assetId: marks.itemId };
  }




  /* -------------------------------- playback ---------------------------------- */



  /* ------------------------------- comparison --------------------------------- */

  async function setComparisonMode(mode: ComparisonState["mode"]) {
    if (!projectId) return;
    await applyWorkspaceChange({ type: "comparison", mode }, mode === "off" ? "Showing the current result." : "Comparing against the baseline revision.");
    if (mode === "off") { setComparison(null); return; }
    const state = await renderApi.comparisonState(
      projectId,
      workspace?.comparison.baseline ?? "original_import",
      workspace?.comparison.revisionId ?? null,
      mode,
      workspace?.comparison.splitPosition ?? 0.5,
    );
    setComparison(state);
    if (!state.available) setStatus(state.reason ?? "There is no earlier revision to compare with yet.");
  }

  async function createDocument(input: CreatePhotoDocumentInput) {
    if (!service.createPhotoDocument) throw new ProjectError("INVALID_INPUT", "Image document creation is unavailable in this runtime.");
    const result = await service.createPhotoDocument(input); acceptMutation(result);
    const createdDocument = result.headRevision.state.photoDocument;
    if (projectId && createdDocument && workspace) {
      const selected = await applyWorkspaceChange({ type: "selection", selectionType: "document", targetId: createdDocument.id });
      const stage = stageRef.current;
      const zoom = clamp(Math.min(((stage?.clientWidth ?? 900) - 96) / createdDocument.widthPx, ((stage?.clientHeight ?? 620) - 112) / createdDocument.heightPx), 0.05, 32);
      await applyWorkspaceChange({ type: "viewport", viewport: { ...(selected ?? workspace).viewport, zoom, panX: 0, panY: 0, rotationDeg: 0, mode: "fit" } }, "Created and fit the image document to the canvas.");
    }
  }
  async function renameProject(name: string) { if (projectId) acceptMutation(await service.renameProject({ projectId, name })); }
  async function submitName(name: string) { if (!projectId) return; if (nameDialog === "rename") return renameProject(name); if (nameDialog === "save-as" && service.saveProjectAs) { const copy = await service.saveProjectAs(projectId, name); setStatus(`Saved “${copy.name}” as a separate project.`); return; } if (nameDialog === "snapshot" && service.createSnapshot) { const result = await service.createSnapshot(projectId, name); setHistory(result); setPersistence(await service.getProjectPersistence?.(projectId) ?? null); setSaveState("saved"); setStatus(result.transaction.summary); } }
  async function explicitSave() { if (!projectId || !service.saveProject) return; autosaveGeneration.current += 1; setPendingAction("save"); try { await service.saveProject(projectId); setPersistence(await service.getProjectPersistence?.(projectId) ?? null); setSaveState("saved"); setStatus("Saved the current project revision."); } catch (saveError) { setSaveState("failed"); setError(saveError instanceof Error ? saveError.message : "Save failed. Your last durable revision is preserved."); } finally { setPendingAction(null); } }
  async function changeHistory(direction: "undo" | "redo") { if (!projectId) return; setPendingAction(direction); setError(null); try { acceptMutation(direction === "undo" ? await service.undoProject(projectId) : await service.redoProject(projectId)); } catch (historyError) { setError(historyError instanceof ProjectError ? historyError.message : `Unable to ${direction} this change. The current revision is unchanged.`); await loadWorkspace().catch(() => undefined); } finally { setPendingAction(null); } }
  async function recoverDraft() { if (!projectId || !service.recoverDraft) return; setPendingAction("recover"); try { await service.recoverDraft(projectId); await loadWorkspace(); setStatus("Recovered the interrupted draft and saved it as the current durable revision."); } catch (recoveryError) { setError(recoveryError instanceof Error ? recoveryError.message : "Recovery did not complete."); } finally { setPendingAction(null); } }
  async function openDurable() { if (!projectId || !service.restoreDurableRevision) return false; setPendingAction("durable"); try { const result = await service.restoreDurableRevision(projectId); setHistory(result); setPersistence(await service.getProjectPersistence?.(projectId) ?? null); setSaveState("saved"); setStatus(result.transaction.summary); return true; } catch (recoveryError) { setError(recoveryError instanceof Error ? recoveryError.message : "The durable revision could not be opened."); return false; } finally { setPendingAction(null); } }
  async function discardDraft() { if (await openDurable()) { setDiscardOpen(false); setStatus("Discarded the recoverable draft. Its immutable revision remains in project history."); } }
  async function prepareProposal(projectName: string, snapshotName: string) { if (!projectId || !service.proposeTransaction) return; const next = await service.proposeTransaction({ projectId, operations: [{ type: "rename_project", name: projectName }, { type: "create_snapshot", name: snapshotName }] }); setProposal(next); setStatus("Proposal prepared. The project has not changed."); }
  async function applyProposal() { if (!proposal || !service.applyProposal) return; setPendingAction("proposal"); try { const result = await service.applyProposal(proposal.id); acceptMutation(result); setProposal(null); } catch (proposalError) { setError(proposalError instanceof Error ? proposalError.message : "The proposal was not applied."); } finally { setPendingAction(null); } }
  async function rejectProposal() { if (!proposal || !service.rejectProposal) return; setPendingAction("proposal-reject"); try { await service.rejectProposal(proposal.id); setProposal(null); setStatus("Proposal rejected. No project revision changed."); } finally { setPendingAction(null); } }


  /* ------------------------------ derived state ------------------------------- */

  const project = history?.project ?? null;
  const documentState = history?.headRevision.state.photoDocument ?? null;
  const documentLayers = documentState?.layers ?? [];
  const selectedLayer = selectedLayerIds.length === 1 ? findLayer(documentLayers, selectedLayerIds[0]) : null;
  const selectedImageLayer = selectedLayer?.kind === "image" ? (selectedLayer as ImageLayer) : null;
  const assetNames = Object.fromEntries(assetRecords.map((record) => [record.id, record.reference.name]));
  const selectedAssetSource = selectedImageLayer
    ? assetRecords.find((record) => record.id === selectedImageLayer.assetId) ?? null
    : null;

  const sectionDefaults: Record<string, boolean> = {
    geometry: Boolean(selectedImageLayer),
    colour: Boolean(selectedImageLayer),
    document: !selectedImageLayer,
  };

  const isSectionOpen = (id: string) => openSections[id] ?? sectionDefaults[id] ?? false;
  const toggleSection = (id: string, open: boolean) => setOpenSections((current) => ({ ...current, [id]: open }));

  /* --------------------------------- effects ---------------------------------- */

  // A previous session may have left staged bytes and jobs claiming to run. Reconciling on
  // open means the first thing shown is the truth rather than a frozen progress bar.
  useEffect(() => {
    void reconcileAfterReload().then((outcome) => {
      setReconciliation(outcome);
      if (outcome.interruptedJobs) {
        setStatus(`${outcome.interruptedJobs} job(s) were interrupted when this project last closed. They can be started again from the Job Center.`);
      }
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    const load = () => {
      void assetApi.listAssets(projectId, { limit: 300 }).then((records) => { if (active) setAssetRecords(records); }).catch(() => undefined);
    };
    load();
    const unsubscribe = assetApi.subscribe(projectId, load);
    return () => { active = false; unsubscribe(); };
  }, [assetApi, projectId, history?.headRevision.id]);


  // Comparison resolves against a real revision whenever the head moves.
  useEffect(() => {
    if (!projectId || !workspace || workspace.comparison.mode === "off") { setComparison(null); return; }
    let active = true;
    void renderApi.comparisonState(projectId, workspace.comparison.baseline, workspace.comparison.revisionId, workspace.comparison.mode, workspace.comparison.splitPosition)
      .then((state) => { if (active) setComparison(state); })
      .catch(() => { if (active) setComparison(null); });
    return () => { active = false; };
  }, [projectId, renderApi, workspace?.comparison.mode, workspace?.comparison.baseline, workspace?.comparison.revisionId, workspace?.comparison.splitPosition, history?.headRevision.id]);

  useEffect(() => {
    if (!project) return;
    document.title = `${project.name} · Estro`;
    if (!hasFocusedRoute.current) {
      hasFocusedRoute.current = true;
      queueMicrotask(() => workspaceHeadingRef.current?.focus());
    }
  }, [project]);

  const canUndo = Boolean(project?.undoTransactionIds.length);
  const canRedo = Boolean(project?.redoTransactionIds.length);
  const webMcpReady = getWebMcpAvailability() === "available";
  const saveLabel = saveState === "autosaving" ? "Autosaving…"
    : saveState === "draft" ? "Recovery available"
    : saveState === "failed" ? "Save needs attention"
    : `Revision ${history?.headRevision.sequence ?? 0} saved locally`;

  const currentWorkspace = workspace;
  if (!currentWorkspace) {
    return (
      <div className="editor-shell editor-shell--loading" style={{ "--leading-panel-width": "280px", "--trailing-panel-width": "304px" } as CSSProperties} aria-busy="true" aria-label="Opening the editor">
        <header className="editor-top-bar" aria-hidden="true"><span className="loading-block loading-block--back" /><span className="loading-block loading-block--title" /></header>
        <nav className="editor-tool-rail" aria-hidden="true"><span className="loading-block loading-block--tool" /><span className="loading-block loading-block--tool" /><span className="loading-block loading-block--tool" /></nav>
        <aside className="editor-left-panel" aria-hidden="true"><span className="loading-block loading-block--panel-title" /><span className="loading-block loading-block--panel-row" /></aside>
        <main className="editor-center"><div className="editor-loading-canvas"><span className="loading-block loading-block--canvas" /><span>Opening the editor…</span></div></main>
        <aside className="editor-inspector" aria-hidden="true"><span className="loading-block loading-block--panel-title" /><span className="loading-block loading-block--property" /><span className="loading-block loading-block--property" /><span className="loading-block loading-block--property" /></aside>
      </div>
    );
  }

  const leadingPanel = currentWorkspace.leadingPanel;
  const trailingPanel = leadingPanel === "left" ? "inspector" : "left";
  const shellStyle = {
    "--leading-panel-width": currentWorkspace.panels[leadingPanel].open ? `${currentWorkspace.panels[leadingPanel].widthPx}px` : "0px",
    "--trailing-panel-width": currentWorkspace.panels[trailingPanel].open ? `${currentWorkspace.panels[trailingPanel].widthPx}px` : "0px",
  } as CSSProperties;
  const documentStyle = documentState ? {
    width: `${documentState.widthPx}px`,
    height: `${documentState.heightPx}px`,
    background: documentState.background.type === "transparent" ? undefined : documentState.background.color,
    transform: `translate(calc(-50% + ${currentWorkspace.viewport.panX}px), calc(-50% + ${currentWorkspace.viewport.panY}px)) rotate(${currentWorkspace.viewport.rotationDeg}deg) scale(${currentWorkspace.viewport.zoom})`,
  } as CSSProperties : undefined;



  return (
    <div
      className={`editor-shell${currentWorkspace.leadingPanel === "inspector" ? " editor-shell--inspector-leading" : ""}${currentWorkspace.distractionFree ? " editor-shell--distraction-free" : ""}`}
      style={shellStyle}
      data-semantic-id="workspace-shell"
      tabIndex={-1}
    >
      <a className="skip-link" href="#canvas-stage">Skip to canvas</a>

      <header className="editor-top-bar">
        <Link className="icon-button" to="/projects" aria-label="Back to projects"><ArrowLeft aria-hidden="true" size={18} /></Link>
        <div className="editor-identity">
          <h1 ref={workspaceHeadingRef} tabIndex={-1}>{project?.name ?? "Loading project…"}</h1>
          {project ? (
            <span className={`workspace-save workspace-save--${saveState}`}>
              {saveState === "failed" ? <CloudOff aria-hidden="true" size={13} /> : <Check aria-hidden="true" size={13} />} {saveLabel}
            </span>
          ) : null}
        </div>
        <div className="editor-top-actions" aria-label="Project and workspace actions">
          <button className="button button--ghost" type="button" disabled={!service.saveProject || pendingAction !== null} onClick={() => void explicitSave()}><Save aria-hidden="true" size={15} /><span>Save</span></button>
          <button className="icon-button" type="button" aria-label="Save as a new project" disabled={!service.saveProjectAs} onClick={() => setNameDialog("save-as")}><ChevronDown aria-hidden="true" size={17} /></button>
          <button className="icon-button" type="button" aria-label="Rename project" onClick={() => setNameDialog("rename")}><Pencil aria-hidden="true" size={16} /></button>
          <button className="icon-button" type="button" aria-label="Undo last project change" aria-keyshortcuts="Control+Z Meta+Z" disabled={!canUndo || pendingAction !== null} onClick={() => void changeHistory("undo")}><Undo2 aria-hidden="true" size={17} /></button>
          <button className="icon-button" type="button" aria-label="Redo last undone project change" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z" disabled={!canRedo || pendingAction !== null} onClick={() => void changeHistory("redo")}><Redo2 aria-hidden="true" size={17} /></button>
          <button className="command-trigger" data-semantic-id="command-palette-trigger" type="button" aria-keyshortcuts="Control+K Meta+K" onClick={() => setCommandPaletteOpen(true)}><Command aria-hidden="true" size={15} /> Search <kbd>⌘K</kbd></button>
        </div>
        {projectId ? <JobCenter projectId={projectId} jobService={jobApi} onStatus={setStatus} agentTarget={agentTarget} /> : null}
        <div className="activity-island" data-semantic-id="activity-island" aria-label="WebMCP availability">
          <Sparkles aria-hidden="true" size={15} />
          <span>{webMcpReady ? `WebMCP ready · ${getRegisteredToolCount()} tools` : "Manual controls available"}</span>
        </div>
        <div className="editor-view-actions">
          <button className="icon-button" type="button" aria-label="Toggle Layers panel" aria-pressed={currentWorkspace.panels.left.open} onClick={() => runCommand("workspace.left-panel")}><PanelLeft aria-hidden="true" size={17} /></button>
          <button className="icon-button" type="button" aria-label="Toggle Inspector" aria-pressed={currentWorkspace.panels.inspector.open} onClick={() => runCommand("workspace.inspector")}><PanelRight aria-hidden="true" size={17} /></button>
          <button className="icon-button" type="button" aria-label="Swap panel sides" onClick={() => runCommand("workspace.swap-docks")}><ArrowLeft aria-hidden="true" size={15} /><span className="sr-only">Swap</span></button>
          <button className="icon-button" type="button" aria-label={currentWorkspace.distractionFree ? "Exit distraction-free preview" : "Enter distraction-free preview"} aria-pressed={currentWorkspace.distractionFree} onClick={() => void setDistractionFree(!currentWorkspace.distractionFree)}>
            {currentWorkspace.distractionFree ? <Minimize2 aria-hidden="true" size={17} /> : <Maximize2 aria-hidden="true" size={17} />}
          </button>
        </div>
      </header>

      {persistence?.hasRecoverableDraft ? (
        <section className="editor-recovery" aria-labelledby="recovery-heading">
          <div><strong id="recovery-heading">An interrupted draft was preserved</strong><span>{persistence.durability.recoveryReason}</span></div>
          <div>
            <button className="button button--ghost" type="button" onClick={() => void openDurable()}>Open durable</button>
            <button className="button button--ghost" type="button" onClick={() => setDiscardOpen(true)}>Discard draft</button>
            <button className="button button--primary" type="button" onClick={() => void recoverDraft()}>Recover</button>
          </div>
        </section>
      ) : null}
      {error ? (
        <div className="editor-error" role="alert">
          <strong>Estro needs attention</strong><span>{error}</span>
          <button className="icon-button" type="button" aria-label="Dismiss error" onClick={() => setError(null)}>×</button>
        </div>
      ) : null}
      <p className="compact-workspace-advisory">A wider window gives more precise canvas control. Every action here stays available through the Inspector, the timeline menus, and the command search.</p>

      <nav className="editor-tool-rail" aria-label="Editor tools">
        {([
          { id: "select", target: "tool-select", label: "Select", icon: MousePointer2, shortcut: "V" },
          { id: "hand", target: "tool-hand", label: "Hand", icon: Hand, shortcut: "H" },
          { id: "zoom", target: "tool-zoom", label: "Zoom", icon: ZoomIn, shortcut: "Z" },
        ] as const).map((tool) => (
          <button
            key={tool.id} className="editor-tool" data-semantic-id={tool.target}
            data-agent-target={agentTarget === tool.target ? "true" : undefined}
            type="button" aria-label={`${tool.label} tool (${tool.shortcut})`} aria-keyshortcuts={tool.shortcut}
            aria-pressed={currentWorkspace.activeTool === tool.id && !cropping}
            onClick={() => { setCropping(false); void applyWorkspaceChange({ type: "tool", tool: tool.id }, `${tool.label} tool active.`); }}
          >
            <tool.icon aria-hidden="true" size={18} /><span>{tool.label}</span>
          </button>
        ))}
        <button
          className="editor-tool" data-semantic-id="tool-crop"
          data-agent-target={agentTarget === "tool-crop" ? "true" : undefined}
          type="button" aria-label="Crop tool (C)" aria-keyshortcuts="C" aria-pressed={cropping}
          disabled={!selectedImageLayer}
          title={selectedImageLayer ? undefined : "Select an image layer to crop it"}
          onClick={() => { setCropping((value) => !value); setCropDraft(selectedImageLayer?.crop ?? null); }}
        >
          <Crop aria-hidden="true" size={18} /><span>Crop</span>
        </button>
      </nav>

      {currentWorkspace.panels.left.open ? (
        <aside className="editor-left-panel" data-semantic-id={leftTab === "media" ? "panel-media" : leftTab === "layers" ? "panel-layers" : "panel-history"} tabIndex={-1} aria-label={leftTab === "layers" ? "Layers" : leftTab === "media" ? "Media" : "History"}>
          <div className="panel-tabs" role="tablist" aria-label="Left panel" onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const order = ["layers", "media", "history"] as const;
            const index = order.indexOf(leftTab);
            const next = event.key === "Home" ? order[0]
              : event.key === "End" ? order[order.length - 1]
              : event.key === "ArrowLeft" ? order[(index - 1 + order.length) % order.length]
              : order[(index + 1) % order.length];
            setLeftTab(next);
            queueMicrotask(() => document.getElementById(`${next}-tab`)?.focus());
          }}>
            <button id="layers-tab" type="button" role="tab" aria-selected={leftTab === "layers"} aria-controls="layers-tabpanel" tabIndex={leftTab === "layers" ? 0 : -1} onClick={() => setLeftTab("layers")}><Layers3 aria-hidden="true" size={15} /> Layers</button>
            <button id="media-tab" type="button" role="tab" aria-selected={leftTab === "media"} aria-controls="media-tabpanel" tabIndex={leftTab === "media" ? 0 : -1} onClick={() => setLeftTab("media")}><ImagePlus aria-hidden="true" size={15} /> Media</button>
            <button id="history-tab" type="button" role="tab" aria-selected={leftTab === "history"} aria-controls="history-tabpanel" tabIndex={leftTab === "history" ? 0 : -1} onClick={() => setLeftTab("history")}><History aria-hidden="true" size={15} /> History</button>
          </div>

          {leftTab === "media" && projectId ? (
            <MediaLibraryPanel
              projectId={projectId}
              assetService={assetApi}
              organizationService={organizationApi}
              catalogueService={defaultCatalogueService}
              revisionKey={history?.headRevision.id ?? ""}
              view={currentWorkspace.mediaView as MediaView}
              activeBinId={currentWorkspace.activeBinId}
              canAddToCanvas={documentState !== null}
              selectedAssetId={selectedAssetId}
              agentTarget={agentTarget}
              onSelectAsset={setSelectedAssetId}
              onChangeView={(view, binId) => void applyWorkspaceChange({ type: "media_view", view, binId })}
              onAddToCanvas={(assetId) => void addAssetToCanvas(assetId)}
              onStatus={setStatus}
              onError={setError}
            />
          ) : leftTab === "layers" ? (
            <div id="layers-tabpanel" role="tabpanel" aria-labelledby="layers-tab" className="layers-panel">
              {/*
                * The eyebrow is gone from all four panel headings.
                *
                * "Document structure" over "Layers", under a tab already reading "Layers",
                * said the same word three times and spent about a fifth of the visible
                * height of a 280px rail doing it — in tertiary text that was the least
                * readable on screen. The heading and its count are the whole job here.
                */}
              <div className="panel-heading"><h2>Layers</h2><span>{documentLayers.length}</span></div>
              {documentState ? (
                <LayersPanel
                  layers={documentLayers}
                  selectedLayerIds={selectedLayerIds}
                  agentTarget={agentTarget}
                  onSelect={(id, additive) => {
                    setSelectedLayerIds((current) => additive
                      ? current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
                      : current.length === 1 && current[0] === id ? [] : [id]);
                    void applyWorkspaceChange({ type: "selection", selectionType: "layer", targetId: id, targetIds: [id] }, "Selected a layer.");
                  }}
                  onToggleVisibility={(id, visible) => void runLayerOperation({ operation: "set_visibility", layerId: id, visible })}
                  onToggleLock={(id, locked) => void runLayerOperation({ operation: "set_lock", layerId: id, locked })}
                  onRename={(id, name) => void runLayerOperation({ operation: "rename", layerId: id, name })}
                  onReorder={(id, toIndex) => void runLayerOperation({ operation: "reorder", layerId: id, toIndex })}
                  onDuplicate={(id) => void runLayerOperation({ operation: "duplicate", layerId: id })}
                  onRemove={(id) => void runLayerOperation({ operation: "remove", layerId: id })}
                  onGroup={(layerIds) => void runLayerOperation({ operation: "group", layerIds })}
                  onUngroup={(groupId) => void runLayerOperation({ operation: "ungroup", layerId: groupId })}
                  onMoveIntoGroup={(layerId, groupId) => void runLayerOperation({ operation: "move_into_group", layerId, groupId })}
                  soloLayerIds={currentWorkspace.soloLayerIds}
                  isolateGroupId={currentWorkspace.isolateGroupId}
                  onToggleSolo={(id) => void applyWorkspaceChange({ type: "solo", layerIds: currentWorkspace.soloLayerIds.includes(id) ? currentWorkspace.soloLayerIds.filter((entry) => entry !== id) : [...currentWorkspace.soloLayerIds, id] }, "Changed which layers are soloed. This is a viewing mode, not an edit.")}
                  onToggleIsolate={(id) => void applyWorkspaceChange({ type: "isolate", groupId: currentWorkspace.isolateGroupId === id ? null : id }, "Changed the isolated group. This is a viewing mode, not an edit.")}
                />
              ) : (
                <div className="panel-empty">
                  <Layers3 aria-hidden="true" size={24} />
                  <strong>No document yet</strong>
                  <span>Create an empty image document to establish the canvas.</span>
                </div>
              )}
            </div>
          ) : (
            <HistoryPanel
              projectId={projectId!}
              history={history}
              persistence={persistence}
              service={service as never}
              agentTarget={agentTarget}
              onCreateSnapshot={() => setNameDialog("snapshot")}
              onPrepareProposal={() => setProposalOpen(true)}
              onChanged={(summary) => { void loadWorkspace(); setStatus(summary); }}
              onStatus={setStatus}
              onError={setError}
            />
          )}
          <div className={`panel-resize-handle panel-resize-handle--${panelIsLeading("left") ? "leading" : "trailing"}`} role="separator" aria-label="Resize left panel" aria-orientation="vertical" aria-valuemin={224} aria-valuemax={360} aria-valuenow={currentWorkspace.panels.left.widthPx} tabIndex={0} onDoubleClick={() => void applyWorkspaceChange({ type: "panel", panel: "left", widthPx: 280 })} onKeyDown={(event) => resizeWithKeyboard(event, "left")} onPointerDown={(event) => beginResize(event, "left")} onPointerMove={moveResize} onPointerUp={endResize} />
        </aside>
      ) : null}

      <main className="editor-center" id="workspace-main">
        <div className="context-action-bar" aria-label="Canvas actions">
          {/*
            * "Actual size", not a second "100%".
            *
            * The bar read "Fit | 100% | 100%": a button that sets 1:1 sitting immediately
            * beside the readout of the current zoom, the same four characters twice, told
            * apart only by weight and colour. Naming the action says which one you can press,
            * and leaves the number to the control whose whole job is reporting it.
            */}
          <button className="button button--ghost" type="button" disabled={!documentState} onClick={() => fitViewport("fit")}>Fit</button>
          <button className="button button--ghost" type="button" disabled={!documentState} onClick={() => fitViewport("actual")}>Actual size</button>
          <output className="zoom-output" data-semantic-id="view-zoom" tabIndex={-1} aria-label="Canvas zoom">{Math.round(currentWorkspace.viewport.zoom * 100)}%</output>

          <label className="slider-field slider-field--inline" data-semantic-id="preview-quality">
            <span className="sr-only">Preview quality</span>
            <select
              value={currentWorkspace.previewQuality}
              aria-label="Preview quality"
              onChange={(event) => void applyWorkspaceChange({ type: "preview_quality", quality: event.target.value as "draft" | "balanced" | "full" }, `Preview quality set to ${event.target.value}.`)}
            >
              <option value="draft">Draft preview</option>
              <option value="balanced">Balanced preview</option>
              <option value="full">Full quality</option>
            </select>
          </label>

          <button
            className="button button--ghost" type="button"
            data-semantic-id="comparison-toggle"
            data-agent-target={agentTarget === "comparison-toggle" ? "true" : undefined}
            disabled={!documentLayers.length}
            aria-pressed={currentWorkspace.comparison.mode !== "off"}
            aria-keyshortcuts="\\"
            onClick={() => void setComparisonMode(currentWorkspace.comparison.mode === "off" ? "toggle" : "off")}
          >
            {currentWorkspace.comparison.mode === "off" ? "Before" : "After"}
          </button>
          <button
            className="icon-button" type="button" aria-label="Compare with a split view"
            disabled={!documentLayers.length}
            aria-pressed={currentWorkspace.comparison.mode === "split"}
            onClick={() => void setComparisonMode(currentWorkspace.comparison.mode === "split" ? "off" : "split")}
          >
            <SplitSquareHorizontal aria-hidden="true" size={16} />
          </button>

          <button className="icon-button" data-semantic-id="toggle-grid" data-agent-target={agentTarget === "toggle-grid" ? "true" : undefined} type="button" aria-label="Toggle grid" aria-pressed={currentWorkspace.overlays.grid} onClick={() => runCommand("overlay.grid")}><Grid3X3 aria-hidden="true" size={16} /></button>
          <button className="icon-button" type="button" aria-label="Toggle guides" aria-pressed={currentWorkspace.overlays.guides} onClick={() => runCommand("overlay.guides")}><Ruler aria-hidden="true" size={16} /></button>
          <button className="icon-button" type="button" aria-label="Toggle safe areas" aria-pressed={currentWorkspace.overlays.safeAreas} onClick={() => runCommand("overlay.safe-areas")}><Shield aria-hidden="true" size={16} /></button>
          <button className="icon-button" type="button" aria-label="Toggle pixel grid" aria-pressed={currentWorkspace.overlays.pixelGrid} title="Pixel grid appears above 100% zoom" onClick={() => void applyWorkspaceChange({ type: "overlay", overlay: "pixelGrid", enabled: !currentWorkspace.overlays.pixelGrid }, `Pixel grid ${currentWorkspace.overlays.pixelGrid ? "off" : "on"}. It is visible above 100% zoom.`)}><Grid2X2 aria-hidden="true" size={16} /></button>

        </div>

        <div
          ref={stageRef} id="canvas-stage"
          className={`canvas-stage canvas-stage--tool-${currentWorkspace.activeTool}`}
          data-semantic-id="canvas-stage"
          data-agent-target={agentTarget === "canvas-stage" ? "true" : undefined}
          tabIndex={0} role="group" aria-label="Image canvas" aria-describedby="canvas-instructions"
          onKeyDown={onCanvasKeyDown} onPointerDown={onCanvasPointerDown} onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp} onPointerCancel={onCanvasPointerUp} onWheel={onCanvasWheel}
        >
          <p className="sr-only" id="canvas-instructions">Use Space and drag or the Hand tool to pan. Control or Command plus wheel zooms. Press 0 to fit, 1 for actual size, and R to rotate the view.</p>
          {currentWorkspace.overlays.rulers && documentState ? (<><div className="canvas-ruler canvas-ruler--horizontal" aria-hidden="true" /><div className="canvas-ruler canvas-ruler--vertical" aria-hidden="true" /></>) : null}

          {!documentState ? (
            <section className="canvas-empty" aria-labelledby="canvas-empty-title">
              <div className="canvas-empty__glyph" aria-hidden="true"><Focus size={28} /></div>
              <p className="eyebrow">Empty photo project</p>
              <h2 id="canvas-empty-title">Create the first image document</h2>
              <p>Choose dimensions, resolution, orientation, and background. This creates editable project state, not flattened pixels.</p>
              <button className="button button--primary" type="button" disabled={!service.createPhotoDocument} onClick={() => setDocumentDialogOpen(true)}>Create image document</button>
            </section>
          ) : (
            <div
              className={`document-canvas${documentState.background.type === "transparent" ? " document-canvas--transparent" : ""}`}
              data-semantic-id="document-canvas"
              data-agent-target={agentTarget === "document-canvas" ? "true" : undefined}
              style={documentStyle}
              onDragOver={(event) => { if (event.dataTransfer.types.includes("application/estro-asset")) event.preventDefault(); }}
              onDrop={(event) => {
                const assetId = event.dataTransfer.getData("application/estro-asset");
                if (!assetId) return;
                event.preventDefault();
                void addAssetToCanvas(assetId);
              }}
            >
              {currentWorkspace.overlays.grid ? <span className="document-grid" style={{ backgroundSize: `${currentWorkspace.gridSizePx}px ${currentWorkspace.gridSizePx}px` }} aria-hidden="true" /> : null}
              {currentWorkspace.overlays.safeAreas ? <span className="document-safe-area" style={{ inset: `${currentWorkspace.safeAreaPercent}%` }} aria-hidden="true" /> : null}
              {currentWorkspace.overlays.pixelGrid && currentWorkspace.viewport.zoom > 1 ? <span className="document-pixel-grid" style={{ backgroundSize: `${currentWorkspace.viewport.zoom}px ${currentWorkspace.viewport.zoom}px` }} aria-hidden="true" /> : null}
              {currentWorkspace.overlays.guides ? currentWorkspace.guides.map((guide) => <span key={guide.id} className={`document-guide document-guide--${guide.axis}`} style={guide.axis === "x" ? { left: guide.positionPx } : { top: guide.positionPx }} aria-hidden="true" />) : null}
              {documentLayers.length && projectId ? (
                <>
                <LayerCanvas
                  projectId={projectId}
                  renderService={renderApi}
                  revisionKey={`${history?.headRevision.id ?? ""}:${currentWorkspace.comparison.mode}:${currentWorkspace.previewQuality}:${currentWorkspace.soloLayerIds.join(",")}:${currentWorkspace.isolateGroupId ?? ""}`}
                  widthPx={documentState.widthPx}
                  heightPx={documentState.heightPx}
                  soloLayerIds={currentWorkspace.soloLayerIds}
                  isolateGroupId={currentWorkspace.isolateGroupId}
                  quality={currentWorkspace.previewQuality}
                  comparison={comparison}
                  displayFilter={channelFilterCss(channelView)}
                  onWarnings={(warnings) => { if (warnings.length) setStatus(warnings[0]); }}
                />
                <ChannelFilterDefs view={channelView} />
                </>
              ) : <span className="sr-only">Empty editable canvas</span>}

              {/* Selecting the document is its own control so the crop overlay can hold
                  interactive handles without nesting them inside a button. */}
              <button
                type="button"
                className="document-canvas__select"
                aria-label={`Image document, ${documentState.widthPx} by ${documentState.heightPx} pixels, ${documentState.orientation}`}
                aria-pressed={currentWorkspace.selection.type === "document"}
                onClick={(event) => {
                  event.stopPropagation();
                  void applyWorkspaceChange({ type: "selection", selectionType: "document", targetId: documentState.id }, "Selected the image document.");
                }}
              />

              {canvasTool && !cropping ? (
                <CanvasToolOverlay
                  tool={canvasTool}
                  documentWidthPx={documentState.widthPx}
                  documentHeightPx={documentState.heightPx}
                  zoom={currentWorkspace.viewport.zoom}
                  rotationDeg={currentWorkspace.viewport.rotationDeg}
                  panX={currentWorkspace.viewport.panX}
                  panY={currentWorkspace.viewport.panY}
                  outline={selectionOutline}
                  brushSizePx={brushSizePx}
                  onGesture={(gesture) => void handleCanvasGesture(gesture)}
                />
              ) : null}

              {cropping && selectedImageLayer ? (
                <CropOverlay
                  crop={cropDraft ?? selectedImageLayer.crop}
                  ratio={cropRatio}
                  sourceWidthPx={selectedAssetSource?.reference.widthPx ?? documentState.widthPx}
                  sourceHeightPx={selectedAssetSource?.reference.heightPx ?? documentState.heightPx}
                  agentTarget={agentTarget}
                  onPreview={setCropDraft}
                  onCommit={(crop) => { setCropDraft(crop); void runLayerOperation({ operation: "crop", layerId: selectedImageLayer.id, crop }); }}
                  onCancel={() => { setCropping(false); setCropDraft(null); }}
                />
              ) : null}
            </div>
          )}
          <button className="canvas-selection-target" type="button" aria-label="Select canvas stage" onClick={() => void applyWorkspaceChange({ type: "selection", selectionType: "canvas", targetId: "canvas-stage" }, "Selected the canvas stage.")} />
        </div>
      </main>

      {currentWorkspace.panels.inspector.open ? (
        <aside className="editor-inspector" data-semantic-id="inspector" data-agent-target={agentTarget === "inspector" ? "true" : undefined} tabIndex={-1} aria-labelledby="inspector-heading">
          <div className={`panel-resize-handle panel-resize-handle--${panelIsLeading("inspector") ? "leading" : "trailing"}`} role="separator" aria-label="Resize Inspector" aria-orientation="vertical" aria-valuemin={272} aria-valuemax={400} aria-valuenow={currentWorkspace.panels.inspector.widthPx} tabIndex={0} onDoubleClick={() => void applyWorkspaceChange({ type: "panel", panel: "inspector", widthPx: 304 })} onKeyDown={(event) => resizeWithKeyboard(event, "inspector")} onPointerDown={(event) => beginResize(event, "inspector")} onPointerMove={moveResize} onPointerUp={endResize} />
          <div className="panel-heading"><h2 id="inspector-heading">Inspector</h2></div>

          <div className="inspector-groups">
            {documentState && projectId ? (
              <InspectorSection id="geometry" title="Position and size" open={isSectionOpen("geometry")} onToggle={(next) => toggleSection("geometry", next)}>
                <GeometryPanel
                  documentWidthPx={documentState.widthPx}
                  documentHeightPx={documentState.heightPx}
                  selectedLayerIds={selectedLayerIds}
                  selectedLayer={selectedImageLayer}
                  sourceWidthPx={selectedAssetSource?.reference.widthPx ?? null}
                  sourceHeightPx={selectedAssetSource?.reference.heightPx ?? null}
                  disabled={Boolean(selectedImageLayer?.locked)}
                  workerAvailable={assetApi.workerAvailable}
                  agentTarget={agentTarget}
                  onAlign={(edge: AlignEdge, reference: AlignReference, keyLayerId) => void runLayerOperation({ operation: "align", layerIds: selectedLayerIds, edge, reference, keyLayerId })}
                  onDistribute={(axis) => void runLayerOperation({ operation: "distribute", layerIds: selectedLayerIds, axis })}
                  onTransform={(patch) => selectedImageLayer && void runLayerOperation({ operation: "transform", layerId: selectedImageLayer.id, transform: patch })}
                  onCrop={(crop) => selectedImageLayer && void runLayerOperation({ operation: "crop", layerId: selectedImageLayer.id, crop })}
                  onCropRatio={(ratio) => { setCropRatio(ratio); if (selectedImageLayer) void runLayerOperation({ operation: "set_crop_ratio", layerId: selectedImageLayer.id, ratio }); }}
                  onFit={(mode) => selectedImageLayer && void runLayerOperation({ operation: "fit", layerId: selectedImageLayer.id, mode })}
                  onResetTransform={() => selectedImageLayer && void runLayerOperation({ operation: "reset_transform", layerId: selectedImageLayer.id })}
                  onRotateQuarter={(turns) => selectedImageLayer && void runLayerOperation({ operation: "rotate_quarter", layerId: selectedImageLayer.id, turns })}
                  onFlip={(axis) => selectedImageLayer && void runLayerOperation({ operation: "flip", layerId: selectedImageLayer.id, axis })}
                  onResize={(mode, w, h, options) => void resizeDocument(mode, w, h, options)}
                />
              </InspectorSection>
            ) : null}

            {selectedImageLayer && projectId ? (
              <InspectorSection id="colour" title="Colour adjustments" open={isSectionOpen("colour")} onToggle={(next) => toggleSection("colour", next)}>
                <AdjustmentInspector
                  projectId={projectId}
                  layer={selectedImageLayer}
                  renderService={renderApi}
                  revisionKey={history?.headRevision.id ?? ""}
                  disabled={selectedImageLayer.locked}
                  onAdjust={(adjustment, value) => void adjustColor(adjustment, value)}
                  onOpacity={(opacity) => void runLayerOperation({ operation: "set_opacity", layerId: selectedImageLayer.id, opacity })}
                  onFlip={(axis) => void runLayerOperation({ operation: "flip", layerId: selectedImageLayer.id, axis })}
                  onStraighten={(rotationDeg) => void runLayerOperation({ operation: "straighten", layerId: selectedImageLayer.id, rotationDeg })}
                />
              </InspectorSection>
            ) : null}

            {selectedImageLayer && projectId ? (
              <InspectorSection id="profiles" title="Starting point and look" open={isSectionOpen("profiles")} onToggle={(next) => toggleSection("profiles", next)}>
                <ProfilesPanel
                  applied={selectedImageLayer.profiles}
                  disabled={selectedImageLayer.locked}
                  agentTarget={agentTarget}
                  onApply={(profile, strength) => void runLayerOperation({ operation: "apply_profile", layerId: selectedImageLayer.id, profile, strength })}
                  onStrength={(applied, strength) => void runLayerOperation({
                    operation: "apply_profile", layerId: selectedImageLayer.id, strength,
                    profile: {
                      schemaVersion: 1, id: applied.profileId, name: applied.name,
                      kind: applied.kind, camera: null, operations: applied.operations,
                    },
                  })}
                  onRemove={(kind) => void runLayerOperation({ operation: "apply_profile", layerId: selectedImageLayer.id, remove: kind })}
                />
              </InspectorSection>
            ) : null}

            {documentState && projectId ? (
              <InspectorSection id="paint" title="Select and paint" open={isSectionOpen("paint")} onToggle={(next) => toggleSection("paint", next)}>
                <PaintAndSelectPanel
                  tool={canvasTool}
                  brushKind={brushKind}
                  brushSizePx={brushSizePx}
                  brushColour={brushColour}
                  hasSelection={selectionState.hasSelection}
                  selectionSummary={selectionState.summary}
                  disabled={false}
                  agentTarget={agentTarget}
                  onChooseTool={(next) => { setCanvasTool(next); if (next) setCropping(false); }}
                  onBrushKind={setBrushKind}
                  onBrushSize={setBrushSizePx}
                  onBrushColour={setBrushColour}
                  cloneOffset={cloneOffset}
                  onCloneOffset={setCloneOffset}
                  strokeCount={selectedLayer?.kind === "paint" ? selectedLayer.strokes.strokes.length : 0}
                  onUndoStroke={() => { if (selectedLayer) void runLayerOperation({ operation: "undo_stroke", layerId: selectedLayer.id }); }}
                  onRestyleLastStroke={() => {
                    if (selectedLayer?.kind !== "paint") return;
                    const last = selectedLayer.strokes.strokes[selectedLayer.strokes.strokes.length - 1];
                    if (!last) return;
                    void runLayerOperation({
                      operation: "restyle_stroke", layerId: selectedLayer.id, strokeId: last.id,
                      brush: { kind: brushKind, sizePx: brushSizePx },
                      paint: { kind: "solid", colour: brushColour, opacity: 1 },
                    }, "Repainted the last stroke with the current brush.");
                  }}
                  onSelectAll={() => {
                    void defaultSelectionService.selectAll(projectId).then(() => {
                      refreshSelection();
                      setStatus("Everything is selected.");
                    }).catch(() => setError("Nothing could be selected."));
                  }}
                  onClearSelection={() => {
                    defaultSelectionService.clear(projectId);
                    refreshSelection();
                    setStatus("Selection cleared.");
                  }}
                  onFeather={(radiusPx) => {
                    // Refining is synchronous: it works on the mask already in memory.
                    defaultSelectionService.refine({ projectId, operation: { kind: "feather", radiusPx } });
                    refreshSelection();
                  }}
                  onFillSelection={() => {
                    void defaultSelectionService.save(projectId, "For fill").then((saved) => runLayerOperation({
                      operation: "fill_region", selectionId: saved.id,
                      paint: { kind: "solid", colour: brushColour, opacity: 1 },
                    })).catch(() => setError("That selection could not be filled."));
                  }}
                />
              </InspectorSection>
            ) : null}

            {documentState && projectId ? (
              <InspectorSection id="content" title="Text and shapes" dedupeHeading open={isSectionOpen("content")} onToggle={(next) => toggleSection("content", next)}>
                <ContentPanel
                  layer={selectedLayer}
                  disabled={Boolean(selectedLayer?.locked)}
                  agentTarget={agentTarget}
                  onAddText={() => void runLayerOperation({ operation: "add_text", content: "Your words here" })}
                  onAddShape={(kind) => void runLayerOperation({
                    operation: "add_shape",
                    shape: kind === "rectangle"
                      ? { kind: "rectangle", x: 0, y: 0, width: Math.round(documentState.widthPx / 3), height: Math.round(documentState.heightPx / 3), cornerRadius: 0 }
                      : { kind: "ellipse", cx: 0, cy: 0, rx: Math.round(documentState.widthPx / 6), ry: Math.round(documentState.heightPx / 6) },
                  })}
                  onEditText={(patch) => { if (selectedLayer) void runLayerOperation({ operation: "edit_text", layerId: selectedLayer.id, ...patch }); }}
                  onSetFill={(colour) => { if (selectedLayer) void runLayerOperation({ operation: "set_paint", layerId: selectedLayer.id, fill: { kind: "solid", colour, opacity: 1 } }); }}
                  onUseSwatch={selectedLayer ? (swatchId) => void runLayerOperation({ operation: "set_paint", layerId: selectedLayer.id, fill: { kind: "swatch", swatchId } }) : null}
                  onImportSvg={(source, fileName) => void importSvg(source, fileName)}
                  onExportSvg={exportSvg}
                  vectorCount={flattenLayers(documentLayers).filter(({ layer }) => layer.kind === "graphics" && layer.content.kind === "vector").length}
                />
              </InspectorSection>
            ) : null}

            {selectedLayer && selectedLayer.kind !== "group" && projectId ? (
              <InspectorSection id="masks" title="Masks" dedupeHeading open={isSectionOpen("masks")} onToggle={(next) => toggleSection("masks", next)}>
                <MasksPanel
                  masks={selectedLayer.masks}
                  disabled={selectedLayer.locked}
                  agentTarget={agentTarget}
                  onAdd={(mask) => void runLayerOperation({ operation: "add_mask", layerId: selectedLayer.id, mask })}
                  onUpdate={(maskId, patch) => void runLayerOperation({ operation: "update_mask", layerId: selectedLayer.id, maskId, mask: patch })}
                  onRemove={(maskId) => void runLayerOperation({ operation: "remove_mask", layerId: selectedLayer.id, maskId })}
                />
              </InspectorSection>
            ) : null}

            {documentState && projectId ? (
              <InspectorSection id="presets" title="Presets" dedupeHeading open={isSectionOpen("presets")} onToggle={(next) => toggleSection("presets", next)}>
                <PresetsPanel
                  projectId={projectId}
                  presetService={defaultPresetService}
                  selectedLayerIds={selectedLayerIds}
                  revisionKey={history?.headRevision.id ?? ""}
                  disabled={false}
                  agentTarget={agentTarget}
                  onStatus={setStatus}
                  onError={setError}
                  onChanged={() => void loadWorkspace()}
                />
              </InspectorSection>
            ) : null}

            {selectedImageLayer && projectId ? (
              <InspectorSection id="corrections" title="Lens and perspective" dedupeHeading open={isSectionOpen("corrections")} onToggle={(next) => toggleSection("corrections", next)}>
                <CorrectionsPanel
                  layer={selectedImageLayer}
                  disabled={selectedImageLayer.locked}
                  agentTarget={agentTarget}
                  onPerspective={(sliders) => void runLayerOperation({ operation: "set_perspective", layerId: selectedImageLayer.id, sliders })}
                  onClearPerspective={() => void runLayerOperation({ operation: "set_perspective", layerId: selectedImageLayer.id, corners: null })}
                  onLens={(correction) => void runLayerOperation({ operation: "correct_lens", layerId: selectedImageLayer.id, correction })}
                  onFreeTransform={(patch) => void runLayerOperation({ operation: "free_transform", layerId: selectedImageLayer.id, transform: patch })}
                  onWarp={(input) => void runLayerOperation({ operation: "warp", layerId: selectedImageLayer.id, ...input })}
                />
              </InspectorSection>
            ) : null}

            {selectedLayer && selectedLayer.kind !== "group" && projectId ? (
              <InspectorSection id="styles" title="Layer styles" dedupeHeading open={isSectionOpen("styles")} onToggle={(next) => toggleSection("styles", next)}>
                <LayerStylesPanel
                  container={selectedLayer.styles}
                  disabled={selectedLayer.locked}
                  agentTarget={agentTarget}
                  onAdd={(style) => void runLayerOperation({ operation: "add_style", layerId: selectedLayer.id, style })}
                  onUpdate={(styleId, patch) => void runLayerOperation({ operation: "update_style", layerId: selectedLayer.id, styleId, style: patch })}
                  onRemove={(styleId) => void runLayerOperation({ operation: "remove_style", layerId: selectedLayer.id, styleId })}
                />
              </InspectorSection>
            ) : null}

            {selectedLayer && projectId ? (
              <InspectorSection id="compositing" title="Compositing" dedupeHeading open={isSectionOpen("compositing")} onToggle={(next) => toggleSection("compositing", next)}>
                <LayerPropertiesPanel
                  layer={selectedLayer}
                  canClip={documentLayers.findIndex((entry) => entry.id === selectedLayer.id) > 0}
                  disabled={selectedLayer.locked}
                  agentTarget={agentTarget}
                  onSetBlendMode={(blendMode) => void runLayerOperation({ operation: "set_blend_mode", layerId: selectedLayer.id, blendMode })}
                  onSetClipping={(clipToBelow) => void runLayerOperation({ operation: "set_clipping", layerId: selectedLayer.id, clipToBelow })}
                  onAddAdjustmentLayer={() => void runLayerOperation({ operation: "add_adjustment_layer" })}
                  onAddFillLayer={() => void runLayerOperation({ operation: "add_fill_layer" })}
                />
              </InspectorSection>
            ) : null}

            {/*
              * Every layer kind carries an effect container, not just image layers: a shape
              * or a piece of text can be blurred too. So this is keyed on the selection
              * rather than on the image-layer narrowing above it.
              */}
            {selectedLayer && selectedLayer.kind !== "group" && projectId ? (
              <InspectorSection id="effects" title="Effects" dedupeHeading open={isSectionOpen("effects")} onToggle={(next) => toggleSection("effects", next)}>
                <EffectStackPanel
                  container={selectedLayer.effects}
                  disabled={selectedLayer.locked}
                  agentTarget={agentTarget}
                  onAdd={(choice) => void runLayerOperation({
                    operation: "add_effect", layerId: selectedLayer.id,
                    name: choice.name,
                    colourOperation: choice.colourOperation,
                    filter: choice.filter,
                  })}
                  onUpdate={(effectId, patch) => void runLayerOperation({
                    operation: "update_effect", layerId: selectedLayer.id, effectId, ...patch,
                  })}
                  onReorder={(effectId, toIndex) => void runLayerOperation({
                    operation: "reorder_effect", layerId: selectedLayer.id, effectId, toIndex,
                  })}
                  onRemove={(effectId) => void runLayerOperation({
                    operation: "remove_effect", layerId: selectedLayer.id, effectId,
                  })}
                />
              </InspectorSection>
            ) : null}

            {documentState && projectId ? (
              <InspectorSection id="swatches" title="Saved colours" dedupeHeading open={isSectionOpen("swatches")} onToggle={(next) => toggleSection("swatches", next)}>
                <SwatchesPanel
                  swatches={documentState.swatches ?? []}
                  disabled={false}
                  agentTarget={agentTarget}
                  onAdd={(name, paint) => void layerApi.applySwatch(projectId, { name, paint }, { intent: "Save a colour from the Inspector." })
                    .then((result) => { acceptMutation(result); setStatus(`Saved “${name}”.`); })
                    .catch((swatchError) => setError(swatchError instanceof ProjectError ? swatchError.message : "That colour could not be saved."))}
                  onUpdate={(swatchId, patch) => void layerApi.applySwatch(projectId, { swatchId, ...patch }, { intent: "Change a saved colour from the Inspector." })
                    .then((result) => { acceptMutation(result); setStatus(result.transaction.summary); })
                    .catch((swatchError) => setError(swatchError instanceof ProjectError ? swatchError.message : "That colour could not be changed."))}
                  onRemove={(swatchId) => void layerApi.applySwatch(projectId, { swatchId, remove: true }, { intent: "Remove a saved colour from the Inspector." })
                    .then((result) => { acceptMutation(result); setStatus(result.transaction.summary); })
                    .catch((swatchError) => setError(swatchError instanceof ProjectError ? swatchError.message : "That colour could not be removed."))}
                  onUseOnSelection={selectedLayer?.kind === "graphics"
                    ? (swatchId) => void runLayerOperation({ operation: "set_paint", layerId: selectedLayer.id, fill: { kind: "swatch", swatchId } })
                    : null}
                />
              </InspectorSection>
            ) : null}

            {documentState && projectId ? (
              <InspectorSection id="channels" title="Channels" dedupeHeading open={isSectionOpen("channels")} onToggle={(next) => toggleSection("channels", next)}>
                <ChannelsPanel
                  projectId={projectId}
                  channelService={defaultChannelService}
                  selectionService={defaultSelectionService}
                  hasSelection={selectionState.hasSelection}
                  revisionKey={history?.headRevision.id ?? ""}
                  agentTarget={agentTarget}
                  onViewChange={setChannelView}
                  onStatus={setStatus}
                  onError={setError}
                  onSelectionChanged={refreshSelection}
                />
              </InspectorSection>
            ) : null}

            {projectId && project ? (
              <InspectorSection id="batch" title="Many at once" dedupeHeading open={isSectionOpen("batch")} onToggle={(next) => toggleSection("batch", next)}>
                <BatchPanel
                  projectId={projectId}
                  projectName={project.name}
                  batchExportService={defaultBatchExportService}
                  presetService={defaultPresetService}
                  historyService={service}
                  projects={allProjects.map((entry) => ({ id: entry.id, name: entry.name }))}
                  selectedLayerIds={selectedLayerIds}
                  revisionKey={history?.headRevision.id ?? ""}
                  disabled={!documentState}
                  agentTarget={agentTarget}
                  onStatus={setStatus}
                  onError={setError}
                />
              </InspectorSection>
            ) : null}

            {projectId && project ? (
              <InspectorSection id="sharing" title="Hand it over" dedupeHeading open={isSectionOpen("sharing")} onToggle={(next) => toggleSection("sharing", next)}>
                <SharingPanel
                  projectId={projectId}
                  projectName={project.name}
                  packageService={defaultPackageService}
                  reviewService={defaultReviewService}
                  selectedLayerId={selectedLayer?.id ?? null}
                  revisionKey={history?.headRevision.id ?? ""}
                  agentTarget={agentTarget}
                  onStatus={setStatus}
                  onError={setError}
                />
              </InspectorSection>
            ) : null}

            {projectId ? (
              <InspectorSection id="export" title="Export" dedupeHeading open={isSectionOpen("export")} onToggle={(next) => toggleSection("export", next)}>
                <ExportPanel
                  projectId={projectId}
                  renderService={renderApi}
                  outputService={outputApi}
                  jobService={jobApi}
                  revisionKey={history?.headRevision.id ?? ""}
                  hasDocument={documentState !== null}
                  agentTarget={agentTarget}
                  onStatus={setStatus}
                  onError={setError}
                />
              </InspectorSection>
            ) : null}

            {documentState && !selectedImageLayer ? (
              <InspectorSection id="document" title="Document" open={isSectionOpen("document")} onToggle={(next) => toggleSection("document", next)}>
                <section>
                  <dl className="property-list">
                    <div data-semantic-id="inspector-document-width" data-agent-target={agentTarget === "inspector-document-width" ? "true" : undefined} tabIndex={-1}><dt>Width</dt><dd>{documentState.widthPx.toLocaleString()} px</dd></div>
                    <div><dt>Height</dt><dd>{documentState.heightPx.toLocaleString()} px</dd></div>
                    <div><dt>Resolution</dt><dd>{documentState.resolutionPpi} ppi</dd></div>
                    <div><dt>Orientation</dt><dd>{documentState.orientation}</dd></div>
                    <div><dt>Background</dt><dd>{documentState.background.type === "transparent" ? "Transparent" : documentState.background.color}</dd></div>
                    <div><dt>Document ID</dt><dd><code>{documentState.id}</code></dd></div>
                  </dl>
                </section>
              </InspectorSection>
            ) : null}

            <InspectorSection id="guides" title="Guides and snapping" open={isSectionOpen("guides")} onToggle={(next) => toggleSection("guides", next)}>
              <section>
                <div className="inspector-actions">
                  <button className="button button--secondary" type="button" disabled={!documentState} onClick={() => {
                    if (!documentState) return;
                    void applyWorkspaceChange({ type: "guide", action: "add", axis: "x", positionPx: documentState.widthPx / 2 }, "Added a vertical center guide.");
                    void applyWorkspaceChange({ type: "guide", action: "add", axis: "y", positionPx: documentState.heightPx / 2 }, "Added a horizontal center guide.");
                  }}>Add center guides</button>
                  <button className="button button--ghost" type="button" disabled={!currentWorkspace.guides.length} onClick={() => void applyWorkspaceChange({ type: "guide", action: "clear" }, "Cleared all guides.")}>Clear guides</button>
                </div>
                <p className="field-help">Canvas guides snap to the {currentWorkspace.gridSizePx}px grid. Timeline snapping is separate and lives in the timeline's own controls.</p>
              </section>
            </InspectorSection>
          </div>
        </aside>
      ) : null}


      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{status}</div>

      {projectId && history ? <CreateDocumentDialog open={documentDialogOpen} projectId={projectId} expectedRevisionId={history.headRevision.id} onClose={() => setDocumentDialogOpen(false)} onSubmit={createDocument} /> : null}
      <CommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} onRun={runCommand} />
      <ProjectNameDialog open={nameDialog !== null} mode={nameDialog ?? "rename"} initialName={nameDialog === "rename" ? project?.name ?? "" : nameDialog === "save-as" ? `${project?.name ?? "Project"} copy` : "Milestone"} onClose={() => setNameDialog(null)} onSubmit={submitName} />
      <TransactionProposalDialog open={proposalOpen} currentName={project?.name ?? ""} onClose={() => setProposalOpen(false)} onSubmit={prepareProposal} />
      <ModalDialog open={discardOpen} title="Discard the recoverable draft?" description="Estro will reopen the last durable state. The immutable draft revision remains in History." tone="danger" initialFocusRef={cancelDiscardRef} onClose={() => setDiscardOpen(false)} footer={<><button ref={cancelDiscardRef} className="button button--secondary" type="button" onClick={() => setDiscardOpen(false)}>Cancel</button><button className="button button--danger" type="button" onClick={() => void discardDraft()}>Discard draft</button></>}>
        <p className="confirmation-copy">The last durable revision is preserved.</p>
      </ModalDialog>
    </div>
  );
}

export function ProjectWorkspacePage() { return <ProjectWorkspace />; }
