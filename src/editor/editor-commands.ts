export const editorCommands = [
  { id: "view.fit", label: "Fit document to view", category: "View", shortcut: "0", targetId: "view-zoom", keywords: ["canvas", "zoom"] },
  { id: "view.actual", label: "Show actual size", category: "View", shortcut: "1", targetId: "view-zoom", keywords: ["100%", "pixels"] },
  { id: "view.zoom-in", label: "Zoom in", category: "View", shortcut: "+", targetId: "view-zoom", keywords: ["magnify"] },
  { id: "view.zoom-out", label: "Zoom out", category: "View", shortcut: "−", targetId: "view-zoom", keywords: ["reduce"] },
  { id: "view.rotate", label: "Rotate view 90 degrees", category: "View", shortcut: "R", targetId: "canvas-stage", keywords: ["orientation"] },
  { id: "view.reset-rotation", label: "Reset view rotation", category: "View", shortcut: "Shift R", targetId: "canvas-stage", keywords: ["straighten"] },
  { id: "overlay.grid", label: "Toggle grid", category: "Overlays", shortcut: "G", targetId: "toggle-grid", keywords: ["lines"] },
  { id: "overlay.guides", label: "Toggle guides", category: "Overlays", shortcut: ";", targetId: "canvas-stage", keywords: ["rulers"] },
  { id: "overlay.snapping", label: "Toggle snapping", category: "Overlays", shortcut: "Shift ;", targetId: "canvas-stage", keywords: ["align"] },
  { id: "overlay.safe-areas", label: "Toggle safe areas", category: "Overlays", shortcut: "", targetId: "canvas-stage", keywords: ["margin", "title safe"] },
  { id: "workspace.distraction-free", label: "Toggle distraction-free preview", category: "Workspace", shortcut: "F", targetId: "canvas-stage", keywords: ["fullscreen", "preview"] },
  { id: "workspace.left-panel", label: "Toggle Layers panel", category: "Workspace", shortcut: "", targetId: "panel-layers", keywords: ["dock"] },
  { id: "workspace.inspector", label: "Toggle Inspector", category: "Workspace", shortcut: "", targetId: "inspector", keywords: ["properties"] },
  { id: "workspace.swap-docks", label: "Swap panel sides", category: "Workspace", shortcut: "", targetId: "workspace-shell", keywords: ["dock", "leading", "trailing", "layout"] },
  { id: "tool.select", label: "Choose Select tool", category: "Tools", shortcut: "V", targetId: "tool-select", keywords: ["pointer"] },
  { id: "tool.hand", label: "Choose Hand tool", category: "Tools", shortcut: "H", targetId: "tool-hand", keywords: ["pan"] },
  { id: "tool.zoom", label: "Choose Zoom tool", category: "Tools", shortcut: "Z", targetId: "tool-zoom", keywords: ["magnify"] },
] as const;

export type EditorCommandId = (typeof editorCommands)[number]["id"];

export function searchEditorCommands(query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...editorCommands];
  return editorCommands.filter((command) =>
    [command.label, command.category, command.shortcut, ...command.keywords]
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalized),
  );
}
