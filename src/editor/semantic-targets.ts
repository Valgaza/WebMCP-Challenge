export const semanticTargets = [
  { id: "workspace-shell", label: "Editor workspace", region: "shell" },
  { id: "tool-select", label: "Select tool", region: "tools" },
  { id: "tool-hand", label: "Hand tool", region: "tools" },
  { id: "tool-zoom", label: "Zoom tool", region: "tools" },
  { id: "panel-layers", label: "Layers panel", region: "left" },
  { id: "canvas-stage", label: "Canvas stage", region: "canvas" },
  { id: "document-canvas", label: "Image document", region: "canvas" },
  { id: "inspector", label: "Inspector", region: "inspector" },
  { id: "inspector-document-width", label: "Document width", region: "inspector" },
  { id: "view-zoom", label: "Canvas zoom", region: "canvas" },
  { id: "toggle-grid", label: "Grid visibility", region: "canvas" },
  { id: "command-palette-trigger", label: "Command search", region: "topbar" },
] as const;

export type SemanticTargetId = (typeof semanticTargets)[number]["id"];

export function getSemanticTarget(targetId: string) {
  return semanticTargets.find((target) => target.id === targetId) ?? null;
}

