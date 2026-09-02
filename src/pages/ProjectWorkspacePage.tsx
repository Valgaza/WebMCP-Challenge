import {
  ArrowLeft, BookmarkPlus, Check, ChevronDown, CloudOff, Command, Focus, Grid3X3, Hand,
  History, Layers3, Maximize2, Minimize2, MousePointer2, PanelLeft, PanelRight, Pencil,
  Redo2, Ruler, Save, Shield, Sparkles, Undo2, ZoomIn,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { projectService, workspaceService as defaultWorkspaceService } from "../app/services";
import type { PhotoDocumentService, ProjectAutomationService, ProjectHistoryService, ProjectLifecycleService, ProjectMutationResult, ProjectObservationService, ProjectPersistenceService } from "../application/project-service";
import type { WorkspaceService } from "../application/workspace-service";
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
import { ESTRO_TOOL_COUNT } from "../webmcp/site-tools";

type ProjectWorkspaceService = ProjectLifecycleService & ProjectHistoryService & Partial<ProjectPersistenceService & ProjectAutomationService & PhotoDocumentService & ProjectObservationService>;
type WorkspaceApi = Pick<WorkspaceService, "getWorkspace" | "applyWorkspaceChange" | "subscribe">;
export interface ProjectWorkspaceProps { service?: ProjectWorkspaceService; workspaceApi?: WorkspaceApi; }

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

export function ProjectWorkspace({ service = projectService, workspaceApi = defaultWorkspaceService }: ProjectWorkspaceProps) {
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
  const [leftTab, setLeftTab] = useState<"layers" | "history">("layers");
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
        ? { selection: { type: "document" as const, targetId: history.headRevision.state.photoDocument.id } }
        : {}),
    } : current);
    setAgentTarget(request.targetId); setStatus(`WebMCP focused ${target.label}.`);
    queueMicrotask(() => document.querySelector<HTMLElement>(`[data-semantic-id="${request.targetId}"]`)?.focus());
    window.setTimeout(() => setAgentTarget((current) => current === request.targetId ? null : current), 10_000);
  }), [history?.headRevision.state.photoDocument, projectId]);

  useEffect(() => {
    if (!agentTarget) return;
    const timer = window.setTimeout(() => document.querySelector<HTMLElement>(`[data-semantic-id="${agentTarget}"]`)?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [agentTarget, workspace?.selection.type]);

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
  function runCommand(commandId: EditorCommandId) {
    if (!workspace) return;
    if (commandId === "view.fit") fitViewport("fit"); else if (commandId === "view.actual") fitViewport("actual"); else if (commandId === "view.zoom-in") changeZoom(1.2); else if (commandId === "view.zoom-out") changeZoom(1 / 1.2);
    else if (commandId === "view.rotate") rotateView(); else if (commandId === "view.reset-rotation") rotateView(true);
    else if (commandId === "overlay.grid") void applyWorkspaceChange({ type: "overlay", overlay: "grid", enabled: !workspace.overlays.grid }, `${workspace.overlays.grid ? "Hid" : "Showed"} the grid.`);
    else if (commandId === "overlay.guides") void applyWorkspaceChange({ type: "overlay", overlay: "guides", enabled: !workspace.overlays.guides }, `${workspace.overlays.guides ? "Hid" : "Showed"} guides.`);
    else if (commandId === "overlay.snapping") void applyWorkspaceChange({ type: "overlay", overlay: "snapping", enabled: !workspace.overlays.snapping }, `Snapping ${workspace.overlays.snapping ? "off" : "on"}.`);
    else if (commandId === "overlay.safe-areas") void applyWorkspaceChange({ type: "overlay", overlay: "safeAreas", enabled: !workspace.overlays.safeAreas }, `${workspace.overlays.safeAreas ? "Hid" : "Showed"} safe areas.`);
    else if (commandId === "workspace.distraction-free") void setDistractionFree(!workspace.distractionFree);
    else if (commandId === "workspace.left-panel") void togglePanel("left");
    else if (commandId === "workspace.inspector") void togglePanel("inspector");
    else if (commandId === "workspace.swap-docks") void applyWorkspaceChange({ type: "dock", leadingPanel: workspace.leadingPanel === "left" ? "inspector" : "left" }, "Swapped the panel docking sides.");
    else if (commandId === "tool.select") void applyWorkspaceChange({ type: "tool", tool: "select" }, "Select tool active."); else if (commandId === "tool.hand") void applyWorkspaceChange({ type: "tool", tool: "hand" }, "Hand tool active."); else if (commandId === "tool.zoom") void applyWorkspaceChange({ type: "tool", tool: "zoom" }, "Zoom tool active.");
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
      if (event.key === " ") { event.preventDefault(); setSpacePressed(true); return; }
      const key = event.key.toLowerCase();
      if (key === "v") runCommand("tool.select"); else if (key === "h") runCommand("tool.hand"); else if (key === "z") runCommand("tool.zoom"); else if (key === "g") runCommand("overlay.grid");
      else if (event.key === ";" && event.shiftKey) runCommand("overlay.snapping"); else if (event.key === ";") runCommand("overlay.guides"); else if (key === "f") runCommand("workspace.distraction-free");
      else if (key === "r" && event.shiftKey) runCommand("view.reset-rotation"); else if (key === "r") runCommand("view.rotate"); else if (event.key === "0") runCommand("view.fit"); else if (event.key === "1") runCommand("view.actual");
      else if (event.key === "+" || event.key === "=") runCommand("view.zoom-in"); else if (event.key === "-") runCommand("view.zoom-out");
      else if (event.key === "Escape" && workspace?.distractionFree) void setDistractionFree(false);
      else if (event.key === "Escape" && workspace && window.innerWidth < 1180 && (workspace.panels.left.open || workspace.panels.inspector.open)) {
        const panel = workspace.panels.inspector.open ? "inspector" : "left";
        void applyWorkspaceChange({ type: "panel", panel, open: false }, `Closed the ${panel === "left" ? "Layers panel" : "Inspector"}.`);
      } else if (event.key === "Escape" && agentTarget) setAgentTarget(null);
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

  const project = history?.project ?? null; const documentState = history?.headRevision.state.photoDocument ?? null;
  const currentWorkspace = workspace;
  const canUndo = Boolean(project?.undoTransactionIds.length); const canRedo = Boolean(project?.redoTransactionIds.length); const webMcpReady = getWebMcpAvailability() === "available";
  const saveLabel = saveState === "autosaving" ? "Autosaving…" : saveState === "draft" ? "Recovery available" : saveState === "failed" ? "Save needs attention" : `Revision ${history?.headRevision.sequence ?? 0} saved locally`;
  useEffect(() => { if (!project) return; document.title = `${project.name} · Estro`; if (!hasFocusedRoute.current) { hasFocusedRoute.current = true; queueMicrotask(() => workspaceHeadingRef.current?.focus()); } }, [project]);
  if (!currentWorkspace) return <div className="editor-shell editor-shell--loading" style={{ "--leading-panel-width": "280px", "--trailing-panel-width": "304px" } as CSSProperties} aria-busy="true" aria-label="Opening the editor"><header className="editor-top-bar" aria-hidden="true"><span className="loading-block loading-block--back" /><span className="loading-block loading-block--title" /></header><nav className="editor-tool-rail" aria-hidden="true"><span className="loading-block loading-block--tool" /><span className="loading-block loading-block--tool" /><span className="loading-block loading-block--tool" /></nav><aside className="editor-left-panel" aria-hidden="true"><span className="loading-block loading-block--panel-title" /><span className="loading-block loading-block--panel-row" /></aside><main className="editor-center"><div className="editor-loading-canvas"><span className="loading-block loading-block--canvas" /><span>Opening the editor…</span></div></main><aside className="editor-inspector" aria-hidden="true"><span className="loading-block loading-block--panel-title" /><span className="loading-block loading-block--property" /><span className="loading-block loading-block--property" /><span className="loading-block loading-block--property" /></aside></div>;
  const leadingPanel = currentWorkspace.leadingPanel;
  const trailingPanel = leadingPanel === "left" ? "inspector" : "left";
  const shellStyle = { "--leading-panel-width": currentWorkspace.panels[leadingPanel].open ? `${currentWorkspace.panels[leadingPanel].widthPx}px` : "0px", "--trailing-panel-width": currentWorkspace.panels[trailingPanel].open ? `${currentWorkspace.panels[trailingPanel].widthPx}px` : "0px" } as CSSProperties;
  const documentStyle = documentState ? { width: `${documentState.widthPx}px`, height: `${documentState.heightPx}px`, background: documentState.background.type === "transparent" ? undefined : documentState.background.color, transform: `translate(calc(-50% + ${currentWorkspace.viewport.panX}px), calc(-50% + ${currentWorkspace.viewport.panY}px)) rotate(${currentWorkspace.viewport.rotationDeg}deg) scale(${currentWorkspace.viewport.zoom})` } as CSSProperties : undefined;

  return (
    <div className={`editor-shell${currentWorkspace.leadingPanel === "inspector" ? " editor-shell--inspector-leading" : ""}${currentWorkspace.distractionFree ? " editor-shell--distraction-free" : ""}`} style={shellStyle} data-semantic-id="workspace-shell" tabIndex={-1}>
      <a className="skip-link" href="#canvas-stage">Skip to canvas</a>
      <header className="editor-top-bar">
        <Link className="icon-button" to="/projects" aria-label="Back to projects"><ArrowLeft aria-hidden="true" size={18} /></Link>
        <div className="editor-identity"><h1 ref={workspaceHeadingRef} tabIndex={-1}>{project?.name ?? "Loading project…"}</h1>{project ? <span className={`workspace-save workspace-save--${saveState}`}>{saveState === "failed" ? <CloudOff aria-hidden="true" size={13} /> : <Check aria-hidden="true" size={13} />} {saveLabel}</span> : null}</div>
        <div className="editor-top-actions" aria-label="Project and workspace actions"><button className="button button--ghost" type="button" disabled={!service.saveProject || pendingAction !== null} onClick={() => void explicitSave()}><Save aria-hidden="true" size={15} /><span>Save</span></button><button className="icon-button" type="button" aria-label="Save as a new project" disabled={!service.saveProjectAs} onClick={() => setNameDialog("save-as")}><ChevronDown aria-hidden="true" size={17} /></button><button className="icon-button" type="button" aria-label="Rename project" onClick={() => setNameDialog("rename")}><Pencil aria-hidden="true" size={16} /></button><button className="icon-button" type="button" aria-label="Undo last project change" aria-keyshortcuts="Control+Z Meta+Z" disabled={!canUndo || pendingAction !== null} onClick={() => void changeHistory("undo")}><Undo2 aria-hidden="true" size={17} /></button><button className="icon-button" type="button" aria-label="Redo last undone project change" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z" disabled={!canRedo || pendingAction !== null} onClick={() => void changeHistory("redo")}><Redo2 aria-hidden="true" size={17} /></button><button className="command-trigger" data-semantic-id="command-palette-trigger" type="button" aria-keyshortcuts="Control+K Meta+K" onClick={() => setCommandPaletteOpen(true)}><Command aria-hidden="true" size={15} /> Search <kbd>⌘K</kbd></button></div>
        <div className="activity-island" aria-label="WebMCP availability"><Sparkles aria-hidden="true" size={15} /><span>{webMcpReady ? `WebMCP ready · ${ESTRO_TOOL_COUNT} tools` : "Manual controls available"}</span></div>
        <div className="editor-view-actions"><button className="icon-button" type="button" aria-label="Toggle Layers panel" aria-pressed={currentWorkspace.panels.left.open} onClick={() => runCommand("workspace.left-panel")}><PanelLeft aria-hidden="true" size={17} /></button><button className="icon-button" type="button" aria-label="Toggle Inspector" aria-pressed={currentWorkspace.panels.inspector.open} onClick={() => runCommand("workspace.inspector")}><PanelRight aria-hidden="true" size={17} /></button><button className="icon-button" type="button" aria-label="Swap panel sides" onClick={() => runCommand("workspace.swap-docks")}><ArrowLeft aria-hidden="true" size={15} /><span className="sr-only">Swap</span></button><button className="icon-button" type="button" aria-label={currentWorkspace.distractionFree ? "Exit distraction-free preview" : "Enter distraction-free preview"} aria-pressed={currentWorkspace.distractionFree} onClick={() => void setDistractionFree(!currentWorkspace.distractionFree)}>{currentWorkspace.distractionFree ? <Minimize2 aria-hidden="true" size={17} /> : <Maximize2 aria-hidden="true" size={17} />}</button></div>
      </header>
      {persistence?.hasRecoverableDraft ? <section className="editor-recovery" aria-labelledby="recovery-heading"><div><strong id="recovery-heading">An interrupted draft was preserved</strong><span>{persistence.durability.recoveryReason}</span></div><div><button className="button button--ghost" type="button" onClick={() => void openDurable()}>Open durable</button><button className="button button--ghost" type="button" onClick={() => setDiscardOpen(true)}>Discard draft</button><button className="button button--primary" type="button" onClick={() => void recoverDraft()}>Recover</button></div></section> : null}
      {error ? <div className="editor-error" role="alert"><strong>Estro needs attention</strong><span>{error}</span><button className="icon-button" type="button" aria-label="Dismiss error" onClick={() => setError(null)}>×</button></div> : null}
      <p className="compact-workspace-advisory">A wider window gives more precise canvas control. All core actions remain available here.</p>

      <nav className="editor-tool-rail" aria-label="Editor tools">{([{ id: "select", target: "tool-select", label: "Select", icon: MousePointer2, shortcut: "V" }, { id: "hand", target: "tool-hand", label: "Hand", icon: Hand, shortcut: "H" }, { id: "zoom", target: "tool-zoom", label: "Zoom", icon: ZoomIn, shortcut: "Z" }] as const).map((tool) => <button key={tool.id} className="editor-tool" data-semantic-id={tool.target} data-agent-target={agentTarget === tool.target ? "true" : undefined} type="button" aria-label={`${tool.label} tool (${tool.shortcut})`} aria-keyshortcuts={tool.shortcut} aria-pressed={currentWorkspace.activeTool === tool.id} onClick={() => void applyWorkspaceChange({ type: "tool", tool: tool.id }, `${tool.label} tool active.`)}><tool.icon aria-hidden="true" size={18} /><span>{tool.label}</span></button>)}</nav>

      {currentWorkspace.panels.left.open ? <aside className="editor-left-panel" data-semantic-id="panel-layers" data-agent-target={agentTarget === "panel-layers" ? "true" : undefined} tabIndex={-1} aria-label={leftTab === "layers" ? "Layers" : "History"}>
        <div className="panel-tabs" role="tablist" aria-label="Left panel" onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "ArrowLeft" || event.key === "Home" ? "layers" : "history";
          setLeftTab(next);
          queueMicrotask(() => document.getElementById(`${next}-tab`)?.focus());
        }}><button id="layers-tab" type="button" role="tab" aria-selected={leftTab === "layers"} aria-controls="layers-tabpanel" tabIndex={leftTab === "layers" ? 0 : -1} onClick={() => setLeftTab("layers")}><Layers3 aria-hidden="true" size={15} /> Layers</button><button id="history-tab" type="button" role="tab" aria-selected={leftTab === "history"} aria-controls="history-tabpanel" tabIndex={leftTab === "history" ? 0 : -1} onClick={() => setLeftTab("history")}><History aria-hidden="true" size={15} /> History</button></div>
        {leftTab === "layers" ? <div id="layers-tabpanel" role="tabpanel" aria-labelledby="layers-tab" className="layers-panel"><div className="panel-heading"><div><p className="eyebrow">Document structure</p><h2>Layers</h2></div></div>{documentState ? <button className="layer-row" type="button" aria-pressed={currentWorkspace.selection.type === "document"} onClick={() => void applyWorkspaceChange({ type: "selection", selectionType: "document", targetId: documentState.id }, "Selected the image document.")}><span className="layer-thumbnail" aria-hidden="true" /><span><strong>Image document</strong><small>{documentState.widthPx} × {documentState.heightPx}</small></span></button> : <div className="panel-empty"><Layers3 aria-hidden="true" size={24} /><strong>No document yet</strong><span>Create an empty image document to establish the canvas.</span></div>}</div> : <div id="history-tabpanel" role="tabpanel" aria-labelledby="history-tab" className="history-panel history-panel--embedded"><div className="panel-heading"><div><p className="eyebrow">Provenance</p><h2>History</h2></div><span>{history?.transactions.length ?? 0}</span></div><ol className="history-list">{history ? [...history.transactions].reverse().map((transaction) => <li key={transaction.id} className="history-entry"><div className="history-entry__summary"><strong>{transaction.summary}</strong><span className="history-entry__state">{transactionState(transaction, history)}</span></div><p>{transaction.actor.displayName} · {formatTransactionTime(transaction.createdAt)}</p></li>) : null}</ol><div className="history-panel__actions"><button className="button button--secondary" type="button" onClick={() => setNameDialog("snapshot")}><BookmarkPlus aria-hidden="true" size={15} /> Snapshot</button><button className="button button--ghost" type="button" disabled={!service.proposeTransaction} onClick={() => setProposalOpen(true)}>Prepare proposal</button></div>{proposal ? <div className="proposal-card proposal-card--compact"><strong>Proposal ready</strong><p>{proposal.summary}</p><div><button className="button button--ghost" type="button" onClick={() => void rejectProposal()}>Reject</button><button className="button button--primary" type="button" onClick={() => void applyProposal()}>Apply</button></div></div> : null}</div>}
        <div className={`panel-resize-handle panel-resize-handle--${panelIsLeading("left") ? "leading" : "trailing"}`} role="separator" aria-label="Resize left panel" aria-orientation="vertical" aria-valuemin={224} aria-valuemax={360} aria-valuenow={currentWorkspace.panels.left.widthPx} tabIndex={0} onDoubleClick={() => void applyWorkspaceChange({ type: "panel", panel: "left", widthPx: 280 })} onKeyDown={(event) => resizeWithKeyboard(event, "left")} onPointerDown={(event) => beginResize(event, "left")} onPointerMove={moveResize} onPointerUp={endResize} />
      </aside> : null}

      <main className="editor-center" id="workspace-main"><div className="context-action-bar" aria-label="Canvas actions"><button className="button button--ghost" type="button" disabled={!documentState} onClick={() => fitViewport("fit")}>Fit</button><button className="button button--ghost" type="button" disabled={!documentState} onClick={() => fitViewport("actual")}>100%</button><output className="zoom-output" data-semantic-id="view-zoom" tabIndex={-1} aria-label="Canvas zoom">{Math.round(currentWorkspace.viewport.zoom * 100)}%</output><button className="icon-button" data-semantic-id="toggle-grid" data-agent-target={agentTarget === "toggle-grid" ? "true" : undefined} type="button" aria-label="Toggle grid" aria-pressed={currentWorkspace.overlays.grid} onClick={() => runCommand("overlay.grid")}><Grid3X3 aria-hidden="true" size={16} /></button><button className="icon-button" type="button" aria-label="Toggle guides" aria-pressed={currentWorkspace.overlays.guides} onClick={() => runCommand("overlay.guides")}><Ruler aria-hidden="true" size={16} /></button><button className="icon-button" type="button" aria-label="Toggle safe areas" aria-pressed={currentWorkspace.overlays.safeAreas} onClick={() => runCommand("overlay.safe-areas")}><Shield aria-hidden="true" size={16} /></button></div>
        <div ref={stageRef} id="canvas-stage" className={`canvas-stage canvas-stage--tool-${currentWorkspace.activeTool}`} data-semantic-id="canvas-stage" data-agent-target={agentTarget === "canvas-stage" ? "true" : undefined} tabIndex={0} role="group" aria-label="Image canvas" aria-describedby="canvas-instructions" onKeyDown={onCanvasKeyDown} onPointerDown={onCanvasPointerDown} onPointerMove={onCanvasPointerMove} onPointerUp={onCanvasPointerUp} onPointerCancel={onCanvasPointerUp} onWheel={onCanvasWheel}>
          <p className="sr-only" id="canvas-instructions">Use Space and drag or the Hand tool to pan. Control or Command plus wheel zooms. Press 0 to fit, 1 for actual size, and R to rotate the view.</p>{currentWorkspace.overlays.rulers && documentState ? <><div className="canvas-ruler canvas-ruler--horizontal" aria-hidden="true" /><div className="canvas-ruler canvas-ruler--vertical" aria-hidden="true" /></> : null}
          {!documentState ? <section className="canvas-empty" aria-labelledby="canvas-empty-title"><div className="canvas-empty__glyph" aria-hidden="true"><Focus size={28} /></div><p className="eyebrow">Empty photo project</p><h2 id="canvas-empty-title">Create the first image document</h2><p>Choose dimensions, resolution, orientation, and background. This creates editable project state, not flattened pixels.</p><button className="button button--primary" type="button" disabled={!service.createPhotoDocument || project?.kind === "video"} onClick={() => setDocumentDialogOpen(true)}>Create image document</button>{project?.kind === "video" ? <span className="field-error">This is a video project. Create or open a photo project for an image document.</span> : null}</section> : <button className={`document-canvas${documentState.background.type === "transparent" ? " document-canvas--transparent" : ""}`} data-semantic-id="document-canvas" data-agent-target={agentTarget === "document-canvas" ? "true" : undefined} type="button" style={documentStyle} aria-label={`Image document, ${documentState.widthPx} by ${documentState.heightPx} pixels, ${documentState.orientation}`} aria-pressed={currentWorkspace.selection.type === "document"} onClick={(event) => { event.stopPropagation(); void applyWorkspaceChange({ type: "selection", selectionType: "document", targetId: documentState.id }, "Selected the image document."); }}>{currentWorkspace.overlays.grid ? <span className="document-grid" style={{ backgroundSize: `${currentWorkspace.gridSizePx}px ${currentWorkspace.gridSizePx}px` }} aria-hidden="true" /> : null}{currentWorkspace.overlays.safeAreas ? <span className="document-safe-area" style={{ inset: `${currentWorkspace.safeAreaPercent}%` }} aria-hidden="true" /> : null}{currentWorkspace.overlays.guides ? currentWorkspace.guides.map((guide) => <span key={guide.id} className={`document-guide document-guide--${guide.axis}`} style={guide.axis === "x" ? { left: guide.positionPx } : { top: guide.positionPx }} aria-hidden="true" />) : null}<span className="sr-only">Empty editable canvas</span></button>}
          <button className="canvas-selection-target" type="button" aria-label="Select canvas stage" onClick={() => void applyWorkspaceChange({ type: "selection", selectionType: "canvas", targetId: "canvas-stage" }, "Selected the canvas stage.")} />
        </div>
      </main>

      {currentWorkspace.panels.inspector.open ? <aside className="editor-inspector" data-semantic-id="inspector" data-agent-target={agentTarget === "inspector" ? "true" : undefined} tabIndex={-1} aria-labelledby="inspector-heading"><div className={`panel-resize-handle panel-resize-handle--${panelIsLeading("inspector") ? "leading" : "trailing"}`} role="separator" aria-label="Resize Inspector" aria-orientation="vertical" aria-valuemin={272} aria-valuemax={400} aria-valuenow={currentWorkspace.panels.inspector.widthPx} tabIndex={0} onDoubleClick={() => void applyWorkspaceChange({ type: "panel", panel: "inspector", widthPx: 304 })} onKeyDown={(event) => resizeWithKeyboard(event, "inspector")} onPointerDown={(event) => beginResize(event, "inspector")} onPointerMove={moveResize} onPointerUp={endResize} /><div className="panel-heading"><div><p className="eyebrow">Properties</p><h2 id="inspector-heading">Inspector</h2></div></div>
        {documentState && currentWorkspace.selection.type === "document" ? <div className="inspector-groups"><section><h3>Document</h3><dl className="property-list"><div data-semantic-id="inspector-document-width" data-agent-target={agentTarget === "inspector-document-width" ? "true" : undefined} tabIndex={-1}><dt>Width</dt><dd>{documentState.widthPx.toLocaleString()} px</dd></div><div><dt>Height</dt><dd>{documentState.heightPx.toLocaleString()} px</dd></div><div><dt>Resolution</dt><dd>{documentState.resolutionPpi} ppi</dd></div><div><dt>Orientation</dt><dd>{documentState.orientation}</dd></div><div><dt>Background</dt><dd>{documentState.background.type === "transparent" ? "Transparent" : documentState.background.color}</dd></div><div><dt>Document ID</dt><dd><code>{documentState.id}</code></dd></div></dl></section><section><h3>Guides and snapping</h3><div className="inspector-actions"><button className="button button--secondary" type="button" onClick={() => { void applyWorkspaceChange({ type: "guide", action: "add", axis: "x", positionPx: documentState.widthPx / 2 }, "Added a vertical center guide."); void applyWorkspaceChange({ type: "guide", action: "add", axis: "y", positionPx: documentState.heightPx / 2 }, "Added a horizontal center guide."); }}>Add center guides</button><button className="button button--ghost" type="button" disabled={!currentWorkspace.guides.length} onClick={() => void applyWorkspaceChange({ type: "guide", action: "clear" }, "Cleared all guides.")}>Clear guides</button></div><p className="field-help">Guides snap to the {currentWorkspace.gridSizePx}px grid while snapping is on.</p></section><section><h3>Project</h3><button className="button button--secondary" type="button" onClick={() => setNameDialog("rename")}><Pencil aria-hidden="true" size={15} /> Rename project</button></section></div> : <div className="inspector-groups"><section><h3>View</h3><dl className="property-list"><div><dt>Selection</dt><dd>{currentWorkspace.selection.type}</dd></div><div><dt>Zoom</dt><dd>{Math.round(currentWorkspace.viewport.zoom * 100)}%</dd></div><div><dt>Pan</dt><dd>{Math.round(currentWorkspace.viewport.panX)}, {Math.round(currentWorkspace.viewport.panY)}</dd></div><div><dt>Rotation</dt><dd>{currentWorkspace.viewport.rotationDeg}°</dd></div><div><dt>Input</dt><dd>Pointer + keyboard</dd></div></dl></section></div>}
      </aside> : null}

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{status}</div>
      {projectId && history ? <CreateDocumentDialog open={documentDialogOpen} projectId={projectId} expectedRevisionId={history.headRevision.id} onClose={() => setDocumentDialogOpen(false)} onSubmit={createDocument} /> : null}<CommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} onRun={runCommand} />
      <ProjectNameDialog open={nameDialog !== null} mode={nameDialog ?? "rename"} initialName={nameDialog === "rename" ? project?.name ?? "" : nameDialog === "save-as" ? `${project?.name ?? "Project"} copy` : "Milestone"} onClose={() => setNameDialog(null)} onSubmit={submitName} /><TransactionProposalDialog open={proposalOpen} currentName={project?.name ?? ""} onClose={() => setProposalOpen(false)} onSubmit={prepareProposal} />
      <ModalDialog open={discardOpen} title="Discard the recoverable draft?" description="Estro will reopen the last durable state. The immutable draft revision remains in History." tone="danger" initialFocusRef={cancelDiscardRef} onClose={() => setDiscardOpen(false)} footer={<><button ref={cancelDiscardRef} className="button button--secondary" type="button" onClick={() => setDiscardOpen(false)}>Cancel</button><button className="button button--danger" type="button" onClick={() => void discardDraft()}>Discard draft</button></>}><p className="confirmation-copy">The last durable revision is preserved.</p></ModalDialog>
    </div>
  );
}
export function ProjectWorkspacePage() { return <ProjectWorkspace />; }
