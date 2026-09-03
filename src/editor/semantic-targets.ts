/**
 * Stable names for the places an agent can point at.
 *
 * Focus, teaching, and explanation all address the interface through these rather than
 * through coordinates or list positions, so a target survives a layout change, a resize, and
 * a reordered panel.
 */
export const semanticTargets = [
  { id: "workspace-shell", label: "Editor workspace", region: "shell" },
  { id: "tool-select", label: "Select tool", region: "tools" },
  { id: "tool-hand", label: "Hand tool", region: "tools" },
  { id: "tool-zoom", label: "Zoom tool", region: "tools" },
  { id: "tool-crop", label: "Crop tool", region: "tools" },

  { id: "panel-layers", label: "Layers panel", region: "left" },
  { id: "panel-media", label: "Media panel", region: "left" },
  { id: "panel-history", label: "History panel", region: "left" },
  { id: "history-snapshots", label: "Snapshots", region: "left" },
  { id: "media-import", label: "Import media button", region: "left" },
  { id: "media-filters", label: "Media filters", region: "left" },
  { id: "media-search", label: "Media search", region: "left" },
  { id: "media-sort", label: "Media sort order", region: "left" },
  { id: "media-view-switch", label: "Media view switch", region: "left" },
  { id: "media-bins", label: "Bin tree", region: "left" },
  { id: "media-storyboard", label: "Storyboard board", region: "left" },
  { id: "media-add-to-canvas", label: "Add to canvas action", region: "left" },
  { id: "media-relink", label: "Relink source action", region: "left" },
  { id: "media-replace", label: "Replace source action", region: "left" },
  { id: "media-proxy", label: "Generate proxy action", region: "left" },

  { id: "canvas-stage", label: "Canvas stage", region: "canvas" },
  { id: "document-canvas", label: "Image document", region: "canvas" },
  { id: "crop-overlay", label: "Crop overlay", region: "canvas" },
  { id: "view-zoom", label: "Canvas zoom", region: "canvas" },
  { id: "toggle-grid", label: "Grid visibility", region: "canvas" },
  { id: "comparison-toggle", label: "Before and after comparison", region: "canvas" },
  { id: "preview-quality", label: "Preview quality", region: "canvas" },



  { id: "inspector", label: "Inspector", region: "inspector" },
  { id: "inspector-document-width", label: "Document width", region: "inspector" },
  { id: "inspector-transform", label: "Transform controls", region: "inspector" },
  { id: "inspector-crop", label: "Crop controls", region: "inspector" },
  { id: "inspector-align", label: "Alignment controls", region: "inspector" },
  { id: "inspector-adjustments", label: "Colour adjustments", region: "inspector" },
  { id: "inspector-masks", label: "Masks", region: "inspector", description: "Hiding part of a layer with a shape or a tone range, with feathering, strength, and invert." },
  { id: "inspector-presets", label: "Presets", region: "inspector", description: "Saving the selected layer's look and applying a saved one to every selected layer at once." },
  { id: "inspector-corrections", label: "Lens and perspective", region: "inspector", description: "Perspective lean, levelling, lens distortion, colour fringing, and corner brightness." },
  { id: "inspector-styles", label: "Layer styles", region: "inspector", description: "Outline, drop and inner shadow, glow, bevel, and colour overlay, drawn from the layer's own shape." },
  { id: "inspector-tools", label: "Select and paint", region: "inspector", description: "Marquee, freehand and magic-wand selection, and the brush kinds, size and colour used when painting on the canvas." },
  { id: "inspector-profiles", label: "Starting point and look", region: "inspector", description: "The camera profile a photograph is read with, and a creative look over it, each with a strength." },
  { id: "inspector-channels", label: "Channels", region: "inspector", description: "Showing, hiding and isolating the red, green, blue and alpha channels, and the selections saved as alpha channels." },
  { id: "inspector-swatches", label: "Saved colours", region: "inspector", description: "Named colours and gradients shared by every shape pointing at them." },
  { id: "inspector-batch", label: "Many at once", region: "inspector", description: "Matching other photographs to this one, and exporting a set in several sizes as one job." },
  { id: "inspector-sharing", label: "Hand it over", region: "inspector", description: "Writing the project out as a portable package, recording what went out for review, and the notes left on it." },
  { id: "inspector-content", label: "Text and shapes", region: "inspector", description: "Adding text and vector shapes, and editing the words, size, weight, alignment, and colour of the selected one." },
  { id: "inspector-compositing", label: "Compositing", region: "inspector", description: "Blend mode, clipping to the layer below, and adding adjustment or fill layers." },
  { id: "inspector-effects", label: "Effects", region: "inspector", description: "The layer's ordered effect stack: colour operators and filters, each individually switchable." },
  { id: "inspector-histogram", label: "Histogram", region: "inspector" },
  { id: "inspector-export", label: "Export panel", region: "inspector" },
  { id: "export-preset", label: "Export preset", region: "inspector" },
  { id: "export-start", label: "Start export action", region: "inspector" },
  { id: "output-list", label: "Finished outputs", region: "inspector" },

  { id: "job-center", label: "Job Center", region: "topbar" },
  { id: "command-palette-trigger", label: "Command search", region: "topbar" },
  { id: "activity-island", label: "Agent activity", region: "topbar" },
] as const;

export type SemanticTargetId = (typeof semanticTargets)[number]["id"];

export function getSemanticTarget(targetId: string) {
  return semanticTargets.find((target) => target.id === targetId) ?? null;
}

export function isSemanticTargetId(value: string): value is SemanticTargetId {
  return semanticTargets.some((target) => target.id === value);
}
