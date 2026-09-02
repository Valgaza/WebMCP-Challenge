import type { EstroDatabase } from "../data/estro-database";
import { ProjectError, toProjectError } from "../domain/project-error";
import {
  createDefaultWorkspacePreference,
  workspaceChangeSchema,
  workspacePreferenceSchema,
  type WorkspaceChange,
  type WorkspacePreference,
} from "../domain/workspace";

export interface WorkspaceServiceOptions { now?: () => Date; createGuideId?: () => string; }

export class WorkspaceService {
  private readonly now: () => Date;
  private readonly listeners = new Map<string, Set<(workspace: WorkspacePreference) => void>>();
  private readonly createGuideId: () => string;

  constructor(private readonly database: EstroDatabase, options: WorkspaceServiceOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.createGuideId = options.createGuideId ?? (() => crypto.randomUUID());
  }

  async getWorkspace(projectId: string): Promise<WorkspacePreference> {
    try {
      const project = await this.database.projects.get(projectId);
      if (!project || project.status !== "active") {
        throw new ProjectError("PROJECT_NOT_FOUND", "This project is no longer available in this browser.");
      }
      const stored = await this.database.workspaces.get(projectId);
      if (stored) {
        const parsed = workspacePreferenceSchema.safeParse(stored);
        if (parsed.success) return parsed.data;
      }
      const created = createDefaultWorkspacePreference(projectId, this.now().toISOString());
      await this.database.workspaces.put(created);
      this.notify(created);
      return created;
    } catch (error) { throw toProjectError(error); }
  }

  async applyWorkspaceChange(projectId: string, input: WorkspaceChange): Promise<WorkspacePreference> {
    try {
      const change = workspaceChangeSchema.parse(input);
      const updated = await this.database.transaction("rw", this.database.projects, this.database.workspaces, async () => {
        const project = await this.database.projects.get(projectId);
        if (!project || project.status !== "active") {
          throw new ProjectError("PROJECT_NOT_FOUND", "This project is no longer available in this browser.");
        }
        const stored = await this.database.workspaces.get(projectId);
        const parsedStored = workspacePreferenceSchema.safeParse(stored);
        const current = parsedStored.success
          ? parsedStored.data
          : createDefaultWorkspacePreference(projectId, this.now().toISOString());
        let next: WorkspacePreference;
        if (change.type === "viewport") {
          next = { ...current, viewport: change.viewport, updatedAt: this.now().toISOString() };
        } else if (change.type === "panel") {
          const bounds = change.panel === "left" ? { min: 224, max: 360 } : { min: 272, max: 400 };
          if (change.widthPx !== undefined && (change.widthPx < bounds.min || change.widthPx > bounds.max)) {
            throw new ProjectError("INVALID_INPUT", `${change.panel === "left" ? "Left panel" : "Inspector"} width must be between ${bounds.min} and ${bounds.max} pixels.`, { fieldPath: "widthPx" });
          }
          next = {
            ...current,
            panels: {
              ...current.panels,
              [change.panel]: {
                ...current.panels[change.panel],
                ...(change.open === undefined ? {} : { open: change.open }),
                ...(change.widthPx === undefined ? {} : { widthPx: change.widthPx }),
              },
            },
            updatedAt: this.now().toISOString(),
          };
        } else if (change.type === "dock") {
          next = { ...current, leadingPanel: change.leadingPanel, updatedAt: this.now().toISOString() };
        } else if (change.type === "tool") {
          next = { ...current, activeTool: change.tool, updatedAt: this.now().toISOString() };
        } else if (change.type === "overlay") {
          next = { ...current, overlays: { ...current.overlays, [change.overlay]: change.enabled }, updatedAt: this.now().toISOString() };
        } else if (change.type === "guide") {
          if (change.action === "clear") {
            next = { ...current, guides: [], updatedAt: this.now().toISOString() };
          } else if (change.action === "add") {
            if (change.axis === undefined || change.positionPx === undefined) throw new ProjectError("INVALID_INPUT", "Adding a guide requires an axis and pixel position.", { fieldPath: "change" });
            const positionPx = current.overlays.snapping ? Math.round(change.positionPx / current.gridSizePx) * current.gridSizePx : change.positionPx;
            next = { ...current, guides: [...current.guides, { id: this.createGuideId(), axis: change.axis, positionPx }], updatedAt: this.now().toISOString() };
          } else {
            if (!change.guideId) throw new ProjectError("INVALID_INPUT", "Updating or removing a guide requires its stable ID.", { fieldPath: "guideId" });
            const existing = current.guides.find((guide) => guide.id === change.guideId);
            if (!existing) throw new ProjectError("INVALID_INPUT", "That guide is no longer available.", { fieldPath: "guideId" });
            if (change.action === "remove") next = { ...current, guides: current.guides.filter((guide) => guide.id !== change.guideId), updatedAt: this.now().toISOString() };
            else {
              if (change.positionPx === undefined) throw new ProjectError("INVALID_INPUT", "Updating a guide requires a pixel position.", { fieldPath: "positionPx" });
              const positionPx = current.overlays.snapping ? Math.round(change.positionPx / current.gridSizePx) * current.gridSizePx : change.positionPx;
              next = { ...current, guides: current.guides.map((guide) => guide.id === change.guideId ? { ...guide, axis: change.axis ?? guide.axis, positionPx } : guide), updatedAt: this.now().toISOString() };
            }
          }
        } else if (change.type === "distraction_free") {
          next = { ...current, distractionFree: change.enabled, updatedAt: this.now().toISOString() };
        } else {
          next = { ...current, selection: { type: change.selectionType, targetId: change.targetId }, updatedAt: this.now().toISOString() };
        }
        const parsed = workspacePreferenceSchema.parse(next);
        await this.database.workspaces.put(parsed);
        return parsed;
      });
      this.notify(updated);
      return updated;
    } catch (error) { throw toProjectError(error); }
  }

  subscribe(projectId: string, listener: (workspace: WorkspacePreference) => void): () => void {
    const listeners = this.listeners.get(projectId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(projectId, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(projectId);
    };
  }

  private notify(workspace: WorkspacePreference): void {
    this.listeners.get(workspace.projectId)?.forEach((listener) => listener(workspace));
  }
}
