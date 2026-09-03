import { z } from "zod";
import { DEFAULT_ACCESSIBILITY, accessibilityPreferencesSchema } from "./accessibility";

export const WORKSPACE_SCHEMA_VERSION = 1 as const;

export const workspaceToolSchema = z.enum(["select", "hand", "zoom"]);
export const workspacePanelSchema = z.enum(["left", "inspector"]);
export const workspaceOverlaySchema = z.enum(["rulers", "guides", "grid", "snapping", "safeAreas", "pixelGrid"]);
export const workspaceSelectionTypeSchema = z.enum(["none", "canvas", "document", "layer", "clip", "track", "asset", "sequence", "output"]);
/** Which monitor the transport and marking controls act on. */
export const monitorModeSchema = z.enum(["program", "source"]);
export const previewQualitySchema = z.enum(["draft", "balanced", "full"]);
/** How the Media panel is arranged; a storyboard is a different view of the same items. */
export const mediaViewSchema = z.enum(["grid", "list", "bins", "storyboard"]);
export const comparisonModeSchema = z.enum(["off", "hold", "toggle", "split", "side_by_side"]);
export const comparisonBaselineSchema = z.enum(["original_import", "previous_revision", "chosen_revision"]);
export const guideSchema = z.object({
  id: z.string().min(1),
  axis: z.enum(["x", "y"]),
  positionPx: z.number().min(-32768).max(65536),
});

export const viewportSchema = z.object({
  zoom: z.number().min(0.05, "Zoom cannot be below 5%.").max(32, "Zoom cannot exceed 3,200%."),
  panX: z.number().min(-1_000_000).max(1_000_000),
  panY: z.number().min(-1_000_000).max(1_000_000),
  rotationDeg: z.number().min(-180).max(180),
  mode: z.enum(["custom", "fit", "actual"]),
});

export const workspacePreferenceSchema = z.object({
  projectId: z.string().min(1),
  schemaVersion: z.literal(WORKSPACE_SCHEMA_VERSION),
  viewport: viewportSchema,
  activeTool: workspaceToolSchema,
  panels: z.object({
    left: z.object({ open: z.boolean(), widthPx: z.number().int().min(224).max(360) }),
    inspector: z.object({ open: z.boolean(), widthPx: z.number().int().min(272).max(400) }),
  }),
  leadingPanel: workspacePanelSchema,
  overlays: z.object({
    rulers: z.boolean(),
    guides: z.boolean(),
    grid: z.boolean(),
    snapping: z.boolean(),
    safeAreas: z.boolean(),
    // Only meaningful past 1:1, where individual pixels become distinguishable.
    pixelGrid: z.boolean(),
  }),
  guides: z.array(guideSchema).max(64),
  gridSizePx: z.number().int().min(1).max(4096),
  snapThresholdPx: z.number().min(1).max(64),
  safeAreaPercent: z.number().min(1).max(40),
  distractionFree: z.boolean(),
  // Solo and isolate are viewing modes, not edits. Keeping them in workspace state means
  // auditioning one layer never creates a revision or changes what an export produces.
  soloLayerIds: z.array(z.string().min(1)).max(500),
  isolateGroupId: z.string().min(1).nullable(),
  selection: z.object({
    type: workspaceSelectionTypeSchema,
    targetId: z.string().min(1).nullable(),
    /** Multi-selection for layers and clips; the primary target stays in `targetId`. */
    targetIds: z.array(z.string().min(1)).max(500).default([]),
  }),
  // Everything below is view state. It never enters edit history, because auditioning a
  // quality level or switching monitors is not a change to the project.
  /**
   * How the interface presents itself, regardless of what the operating system asks for.
   *
   * View state rather than project state: it describes this person at this machine, and would
   * be wrong to carry into a duplicated project or another editor's copy.
   */
  accessibility: accessibilityPreferencesSchema.default(DEFAULT_ACCESSIBILITY),
  previewQuality: previewQualitySchema.default("balanced"),
  activeSequenceId: z.string().min(1).nullable().default(null),
  activeMonitor: monitorModeSchema.default("program"),
  /** What the Source Monitor is loaded with, independent of the timeline selection. */
  sourceMonitor: z.object({
    itemType: z.enum(["asset", "subclip"]).nullable(),
    itemId: z.string().min(1).nullable(),
    inPointSeconds: z.number().min(0).nullable(),
    outPointSeconds: z.number().min(0).nullable(),
  }).default({ itemType: null, itemId: null, inPointSeconds: null, outPointSeconds: null }),
  mediaView: mediaViewSchema.default("grid"),
  activeBinId: z.string().min(1).nullable().default(null),
  comparison: z.object({
    mode: comparisonModeSchema,
    baseline: comparisonBaselineSchema,
    revisionId: z.string().min(1).nullable(),
    splitPosition: z.number().min(0).max(1),
  }).default({ mode: "off", baseline: "original_import", revisionId: null, splitPosition: 0.5 }),
  timeline: z.object({
    /** Pixels per second at the current zoom. */
    pixelsPerSecond: z.number().min(1).max(2000),
    scrollSeconds: z.number().min(0).max(86400),
    snapping: z.boolean(),
    linkedSelection: z.boolean(),
    rippleMode: z.boolean(),
    audibleScrub: z.boolean(),
    trackHeightPx: z.number().int().min(28).max(200),
  }).default({
    pixelsPerSecond: 40, scrollSeconds: 0, snapping: true,
    linkedSelection: true, rippleMode: false, audibleScrub: true, trackHeightPx: 56,
  }),
  updatedAt: z.string().datetime(),
});

export type WorkspacePreference = z.infer<typeof workspacePreferenceSchema>;

export const workspaceChangeSchema = z.union([
  z.object({ type: z.literal("viewport"), viewport: viewportSchema }),
  z.object({
    type: z.literal("panel"),
    panel: workspacePanelSchema,
    open: z.boolean().optional(),
    widthPx: z.number().int().optional(),
  }).refine((value) => value.open !== undefined || value.widthPx !== undefined, "Provide an open state, a width, or both."),
  z.object({ type: z.literal("dock"), leadingPanel: workspacePanelSchema }),
  z.object({ type: z.literal("tool"), tool: workspaceToolSchema }),
  z.object({ type: z.literal("overlay"), overlay: workspaceOverlaySchema, enabled: z.boolean() }),
  z.object({
    type: z.literal("guide"),
    action: z.enum(["add", "update", "remove", "clear"]),
    guideId: z.string().min(1).optional(),
    axis: z.enum(["x", "y"]).optional(),
    positionPx: z.number().min(-32768).max(65536).optional(),
  }),
  z.object({ type: z.literal("distraction_free"), enabled: z.boolean() }),
  z.object({ type: z.literal("solo"), layerIds: z.array(z.string().min(1)).max(500) }),
  z.object({ type: z.literal("isolate"), groupId: z.string().min(1).nullable() }),
  z.object({ type: z.literal("preview_quality"), quality: previewQualitySchema }),
  z.object({ type: z.literal("active_sequence"), sequenceId: z.string().min(1).nullable() }),
  z.object({ type: z.literal("monitor"), monitor: monitorModeSchema }),
  z.object({
    type: z.literal("source_monitor"),
    itemType: z.enum(["asset", "subclip"]).nullable(),
    itemId: z.string().min(1).nullable(),
    inPointSeconds: z.number().min(0).nullable().optional(),
    outPointSeconds: z.number().min(0).nullable().optional(),
  }),
  z.object({ type: z.literal("media_view"), view: mediaViewSchema, binId: z.string().min(1).nullable().optional() }),
  z.object({
    type: z.literal("comparison"),
    mode: comparisonModeSchema,
    baseline: comparisonBaselineSchema.optional(),
    revisionId: z.string().min(1).nullable().optional(),
    splitPosition: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("timeline_view"),
    pixelsPerSecond: z.number().min(1).max(2000).optional(),
    scrollSeconds: z.number().min(0).max(86400).optional(),
    snapping: z.boolean().optional(),
    linkedSelection: z.boolean().optional(),
    rippleMode: z.boolean().optional(),
    audibleScrub: z.boolean().optional(),
    trackHeightPx: z.number().int().min(28).max(200).optional(),
  }),
  z.object({
    type: z.literal("selection"),
    selectionType: workspaceSelectionTypeSchema,
    targetId: z.string().min(1).nullable(),
    targetIds: z.array(z.string().min(1)).max(500).optional(),
  }).superRefine((value, context) => {
    if (value.selectionType === "none" && value.targetId !== null) {
      context.addIssue({ code: "custom", path: ["targetId"], message: "A cleared selection cannot have a target ID." });
    }
    if (value.selectionType !== "none" && value.targetId === null) {
      context.addIssue({ code: "custom", path: ["targetId"], message: "A selected canvas or document requires a stable target ID." });
    }
  }),
]);

export type WorkspaceChange = z.input<typeof workspaceChangeSchema>;

export function createDefaultWorkspacePreference(projectId: string, updatedAt: string): WorkspacePreference {
  return workspacePreferenceSchema.parse({
    projectId,
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    viewport: { zoom: 1, panX: 0, panY: 0, rotationDeg: 0, mode: "fit" },
    activeTool: "select",
    panels: {
      left: { open: true, widthPx: 280 },
      inspector: { open: true, widthPx: 304 },
    },
    leadingPanel: "left",
    overlays: { rulers: true, guides: true, grid: false, snapping: true, safeAreas: false, pixelGrid: false },
    guides: [],
    gridSizePx: 64,
    snapThresholdPx: 8,
    safeAreaPercent: 10,
    distractionFree: false,
    soloLayerIds: [],
    isolateGroupId: null,
    selection: { type: "canvas", targetId: "canvas-stage", targetIds: [] },
    previewQuality: "balanced",
    activeSequenceId: null,
    activeMonitor: "program",
    sourceMonitor: { itemType: null, itemId: null, inPointSeconds: null, outPointSeconds: null },
    mediaView: "grid",
    activeBinId: null,
    comparison: { mode: "off", baseline: "original_import", revisionId: null, splitPosition: 0.5 },
    timeline: {
      pixelsPerSecond: 40, scrollSeconds: 0, snapping: true,
      linkedSelection: true, rippleMode: false, audibleScrub: true, trackHeightPx: 56,
    },
    updatedAt,
  });
}
