/**
 * Every manual command the editor exposes, with the semantic target it acts on.
 *
 * The command index is what makes a feature discoverable rather than merely present: a
 * control buried in a panel is still reachable by name from here, and an agent searching for
 * a capability finds the same list a person does.
 */
export const editorCommands = [
  { id: "view.fit", label: "Fit document to view", category: "View", shortcut: "0", targetId: "view-zoom", keywords: ["canvas", "zoom"] },
  { id: "view.actual", label: "Show actual size", category: "View", shortcut: "1", targetId: "view-zoom", keywords: ["100%", "pixels"] },
  { id: "view.zoom-in", label: "Zoom in", category: "View", shortcut: "+", targetId: "view-zoom", keywords: ["magnify"] },
  { id: "view.zoom-out", label: "Zoom out", category: "View", shortcut: "−", targetId: "view-zoom", keywords: ["reduce"] },
  { id: "view.rotate", label: "Rotate view 90 degrees", category: "View", shortcut: "R", targetId: "canvas-stage", keywords: ["orientation"] },
  { id: "view.reset-rotation", label: "Reset view rotation", category: "View", shortcut: "Shift R", targetId: "canvas-stage", keywords: ["straighten"] },
  { id: "view.quality-draft", label: "Preview at draft quality", category: "View", shortcut: "", targetId: "preview-quality", keywords: ["proxy", "fast", "performance"] },
  { id: "view.quality-balanced", label: "Preview at balanced quality", category: "View", shortcut: "", targetId: "preview-quality", keywords: ["proxy"] },
  { id: "view.quality-full", label: "Preview at full quality", category: "View", shortcut: "", targetId: "preview-quality", keywords: ["original", "sharp"] },

  { id: "overlay.grid", label: "Toggle grid", category: "Overlays", shortcut: "G", targetId: "toggle-grid", keywords: ["lines"] },
  { id: "overlay.guides", label: "Toggle guides", category: "Overlays", shortcut: ";", targetId: "canvas-stage", keywords: ["rulers"] },
  { id: "overlay.snapping", label: "Toggle snapping", category: "Overlays", shortcut: "Shift ;", targetId: "canvas-stage", keywords: ["align"] },
  { id: "overlay.pixel-grid", label: "Toggle pixel grid", category: "Overlays", shortcut: "", targetId: "canvas-stage", keywords: ["pixels", "actual size", "1:1"] },
  { id: "overlay.safe-areas", label: "Toggle safe areas", category: "Overlays", shortcut: "", targetId: "canvas-stage", keywords: ["margin", "title safe"] },

  { id: "workspace.distraction-free", label: "Toggle distraction-free preview", category: "Workspace", shortcut: "F", targetId: "canvas-stage", keywords: ["fullscreen", "preview"] },
  { id: "workspace.left-panel", label: "Toggle Layers panel", category: "Workspace", shortcut: "", targetId: "panel-layers", keywords: ["dock"] },
  { id: "workspace.inspector", label: "Toggle Inspector", category: "Workspace", shortcut: "", targetId: "inspector", keywords: ["properties"] },
  { id: "workspace.swap-docks", label: "Swap panel sides", category: "Workspace", shortcut: "", targetId: "workspace-shell", keywords: ["dock", "leading", "trailing", "layout"] },
  { id: "workspace.media", label: "Show the Media panel", category: "Workspace", shortcut: "", targetId: "panel-media", keywords: ["library", "assets", "import"] },
  { id: "workspace.layers", label: "Show the Layers panel", category: "Workspace", shortcut: "", targetId: "panel-layers", keywords: ["stack"] },
  { id: "workspace.history", label: "Show the History panel", category: "Workspace", shortcut: "", targetId: "panel-history", keywords: ["undo", "revisions"] },

  { id: "tool.select", label: "Choose Select tool", category: "Tools", shortcut: "V", targetId: "tool-select", keywords: ["pointer"] },
  { id: "tool.hand", label: "Choose Hand tool", category: "Tools", shortcut: "H", targetId: "tool-hand", keywords: ["pan"] },
  { id: "tool.zoom", label: "Choose Zoom tool", category: "Tools", shortcut: "Z", targetId: "tool-zoom", keywords: ["magnify"] },
  { id: "tool.crop", label: "Choose Crop tool", category: "Tools", shortcut: "C", targetId: "tool-crop", keywords: ["trim", "frame", "aspect"] },

  { id: "media.import", label: "Import media", category: "Media", shortcut: "", targetId: "media-import", keywords: ["add", "files", "video", "audio", "images"] },
  { id: "media.import-folder", label: "Import a folder", category: "Media", shortcut: "", targetId: "media-import", keywords: ["directory", "batch"] },
  { id: "media.add-to-canvas", label: "Add selected media to the canvas", category: "Media", shortcut: "", targetId: "media-add-to-canvas", keywords: ["layer", "place", "photo"] },
  { id: "media.relink", label: "Relink a missing source", category: "Media", shortcut: "", targetId: "media-relink", keywords: ["offline", "missing", "reconnect"] },
  { id: "media.replace", label: "Replace a source", category: "Media", shortcut: "", targetId: "media-replace", keywords: ["swap", "substitute"] },
  { id: "media.proxy", label: "Generate a proxy", category: "Media", shortcut: "", targetId: "media-proxy", keywords: ["optimize", "performance"] },
  { id: "media.create-bin", label: "Create a bin", category: "Media", shortcut: "", targetId: "media-bins", keywords: ["folder", "organize"] },
  { id: "media.storyboard", label: "Show the storyboard", category: "Media", shortcut: "", targetId: "media-storyboard", keywords: ["board", "freeform", "arrange"] },

  { id: "layer.group", label: "Group selected layers", category: "Layers", shortcut: "", targetId: "panel-layers", keywords: ["combine", "folder"] },
  { id: "layer.ungroup", label: "Ungroup the selected group", category: "Layers", shortcut: "", targetId: "panel-layers", keywords: ["split"] },
  { id: "layer.duplicate", label: "Duplicate the selected layer", category: "Layers", shortcut: "", targetId: "panel-layers", keywords: ["copy"] },
  { id: "layer.rename", label: "Rename the selected layer", category: "Layers", shortcut: "", targetId: "panel-layers", keywords: ["name"] },
  { id: "layer.fit", label: "Fit the selected layer to the canvas", category: "Layers", shortcut: "", targetId: "inspector-transform", keywords: ["scale", "contain"] },
  { id: "layer.fill", label: "Fill the canvas with the selected layer", category: "Layers", shortcut: "", targetId: "inspector-transform", keywords: ["cover", "scale"] },
  { id: "layer.reset-transform", label: "Reset the selected layer's transform", category: "Layers", shortcut: "", targetId: "inspector-transform", keywords: ["undo", "position"] },
  { id: "layer.rotate-right", label: "Rotate the selected layer 90° right", category: "Layers", shortcut: "", targetId: "inspector-transform", keywords: ["turn"] },
  { id: "layer.rotate-left", label: "Rotate the selected layer 90° left", category: "Layers", shortcut: "", targetId: "inspector-transform", keywords: ["turn"] },
  { id: "layer.flip-horizontal", label: "Flip the selected layer horizontally", category: "Layers", shortcut: "", targetId: "inspector-transform", keywords: ["mirror"] },
  { id: "layer.flip-vertical", label: "Flip the selected layer vertically", category: "Layers", shortcut: "", targetId: "inspector-transform", keywords: ["mirror"] },

  { id: "compare.toggle", label: "Compare before and after", category: "Review", shortcut: "\\", targetId: "comparison-toggle", keywords: ["original", "baseline", "history"] },
  { id: "compare.split", label: "Compare with a split view", category: "Review", shortcut: "", targetId: "comparison-toggle", keywords: ["side", "wipe"] },



  { id: "export.photo", label: "Export the image", category: "Export", shortcut: "", targetId: "inspector-export", keywords: ["png", "jpeg", "webp", "save"] },
  { id: "export.outputs", label: "Show finished outputs", category: "Export", shortcut: "", targetId: "output-list", keywords: ["downloads", "renders"] },
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
