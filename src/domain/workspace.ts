import { z } from "zod";

export const WORKSPACE_SCHEMA_VERSION = 1 as const;

export const workspaceToolSchema = z.enum(["select", "hand", "zoom"]);
export const workspacePanelSchema = z.enum(["left", "inspector"]);
export const workspaceOverlaySchema = z.enum(["rulers", "guides", "grid", "snapping", "safeAreas"]);
export const workspaceSelectionTypeSchema = z.enum(["none", "canvas", "document"]);
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
  }),
  guides: z.array(guideSchema).max(64),
  gridSizePx: z.number().int().min(1).max(4096),
  snapThresholdPx: z.number().min(1).max(64),
  safeAreaPercent: z.number().min(1).max(40),
  distractionFree: z.boolean(),
  selection: z.object({
    type: workspaceSelectionTypeSchema,
    targetId: z.string().min(1).nullable(),
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
  z.object({
    type: z.literal("selection"),
    selectionType: workspaceSelectionTypeSchema,
    targetId: z.string().min(1).nullable(),
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
    overlays: { rulers: true, guides: true, grid: false, snapping: true, safeAreas: false },
    guides: [],
    gridSizePx: 64,
    snapThresholdPx: 8,
    safeAreaPercent: 10,
    distractionFree: false,
    selection: { type: "canvas", targetId: "canvas-stage" },
    updatedAt,
  });
}
