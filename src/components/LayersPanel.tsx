import { useState } from "react";
import {
  Brush, ChevronDown, ChevronRight, Contrast, Copy, Eye, EyeOff, Focus, FolderInput,
  Headphones, Image, Layers3, Lock, LockOpen, MoveDown, MoveUp, PaintBucket, Pencil, Shapes,
  Trash2, Type, Ungroup,
} from "lucide-react";
import { flattenLayers, type Layer } from "../domain/layer";

interface LayersPanelProps {
  layers: Layer[];
  selectedLayerIds: string[];
  onSelect: (layerId: string, additive: boolean) => void;
  onToggleVisibility: (layerId: string, visible: boolean) => void;
  onToggleLock: (layerId: string, locked: boolean) => void;
  onRename: (layerId: string, name: string) => void;
  onReorder: (layerId: string, toIndex: number) => void;
  onDuplicate: (layerId: string) => void;
  onRemove: (layerId: string) => void;
  onGroup: (layerIds: string[]) => void;
  onUngroup: (groupId: string) => void;
  onMoveIntoGroup: (layerId: string, groupId: string | null) => void;
  soloLayerIds: string[];
  isolateGroupId: string | null;
  onToggleSolo: (layerId: string) => void;
  onToggleIsolate: (groupId: string) => void;
  agentTarget?: string | null;
}

/**
 * Renders the stack top-first, the way a user reads it, while the model keeps paint order
 * bottom-first. Indentation carries nesting; a group's own row reports its child count.
 *
 * Every action here names the layers it will touch. Grouping used to act on the whole
 * document regardless of selection, which is the kind of surprise a stack panel exists to
 * prevent.
 */
export function LayersPanel({
  layers, selectedLayerIds, onSelect, onToggleVisibility, onToggleLock, onRename, onReorder,
  onDuplicate, onRemove, onGroup, onUngroup, onMoveIntoGroup,
  soloLayerIds, isolateGroupId, onToggleSolo, onToggleIsolate, agentTarget,
}: LayersPanelProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const selected = new Set(selectedLayerIds);
  const topLevelIds = layers.map((layer) => layer.id);
  const allRows = flattenLayers(layers);

  // A collapsed group hides its descendants without changing the stored tree.
  const hiddenIds = new Set<string>();
  for (const groupId of collapsed) {
    const group = allRows.find((row) => row.layer.id === groupId)?.layer;
    if (group?.kind === "group") flattenLayers(group.children).forEach((row) => hiddenIds.add(row.layer.id));
  }

  const rows = [...allRows].reverse().filter((row) => !hiddenIds.has(row.layer.id));
  const selectedTopLevel = selectedLayerIds.filter((id) => topLevelIds.includes(id));
  const groups = allRows.filter((row) => row.layer.kind === "group").map((row) => row.layer);
  const selectedGroup = selectedLayerIds.length === 1
    ? allRows.find((row) => row.layer.id === selectedLayerIds[0] && row.layer.kind === "group")?.layer ?? null
    : null;

  if (!rows.length) {
    return (
      <div className="panel-empty">
        <Layers3 aria-hidden="true" size={24} />
        <strong>No layers yet</strong>
        <span>Open the Media tab, choose an image, and use “Add to canvas” to start building this document.</span>
      </div>
    );
  }

  return (
    <>
      <ul className="layer-list" data-semantic-id="panel-layers" data-agent-target={agentTarget === "panel-layers" ? "true" : undefined}>
        {rows.map(({ layer, depth }) => {
          const isSelected = selected.has(layer.id);
          const topLevelIndex = topLevelIds.indexOf(layer.id);
          const isTopLevel = topLevelIndex >= 0;
          return (
            <li key={layer.id} style={{ paddingInlineStart: `${depth * 14}px` }}>
              <div className={`layer-row-group${isSelected ? " layer-row-group--selected" : ""}`}>
                {layer.kind === "group" ? (
                  <button
                    type="button" className="icon-button icon-button--tight"
                    aria-label={`${collapsed.has(layer.id) ? "Expand" : "Collapse"} ${layer.name}`}
                    aria-expanded={!collapsed.has(layer.id)}
                    onClick={() => setCollapsed((current) => {
                      const next = new Set(current);
                      if (next.has(layer.id)) next.delete(layer.id); else next.add(layer.id);
                      return next;
                    })}
                  >
                    {collapsed.has(layer.id) ? <ChevronRight aria-hidden="true" size={14} /> : <ChevronDown aria-hidden="true" size={14} />}
                  </button>
                ) : <span className="layer-row-spacer" aria-hidden="true" />}

                {renaming === layer.id ? (
                  <input
                    className="layer-rename"
                    autoFocus
                    value={renameDraft}
                    maxLength={120}
                    aria-label={`Rename ${layer.name}`}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onBlur={() => { if (renameDraft.trim()) onRename(layer.id, renameDraft.trim()); setRenaming(null); }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") { if (renameDraft.trim()) onRename(layer.id, renameDraft.trim()); setRenaming(null); }
                      if (event.key === "Escape") setRenaming(null);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="layer-row-main"
                    aria-pressed={isSelected}
                    onClick={(event) => onSelect(layer.id, event.shiftKey || event.metaKey || event.ctrlKey)}
                    onDoubleClick={() => { setRenaming(layer.id); setRenameDraft(layer.name); }}
                  >
                    <span className={`layer-thumbnail layer-thumbnail--${layer.kind}`} aria-hidden="true">
                      {layerGlyph(layer)}
                    </span>
                    <span className="layer-row-meta">
                      <strong>{layer.name}</strong>
                      <small>
                        {/* What the layer is, then how it is set. The row used to say only
                            the opacity, so a text layer and a photograph read identically. */}
                        {layerKindLabel(layer)} · {Math.round(layer.opacity * 100)}%
                        {layer.visible ? "" : " · hidden"}
                        {layer.locked ? " · locked" : ""}
                      </small>
                    </span>
                  </button>
                )}

                <button
                  type="button" className="icon-button icon-button--tight"
                  aria-label={`Rename ${layer.name}`}
                  onClick={() => { setRenaming(layer.id); setRenameDraft(layer.name); }}
                >
                  <Pencil aria-hidden="true" size={14} />
                </button>
                <button
                  type="button" className="icon-button icon-button--tight"
                  aria-label={`${layer.visible ? "Hide" : "Show"} ${layer.name}`}
                  aria-pressed={!layer.visible}
                  onClick={() => onToggleVisibility(layer.id, !layer.visible)}
                >
                  {layer.visible ? <Eye aria-hidden="true" size={15} /> : <EyeOff aria-hidden="true" size={15} />}
                </button>
                <button
                  type="button" className="icon-button icon-button--tight"
                  aria-label={`${layer.locked ? "Unlock" : "Lock"} ${layer.name}`}
                  aria-pressed={layer.locked}
                  onClick={() => onToggleLock(layer.id, !layer.locked)}
                >
                  {layer.locked ? <Lock aria-hidden="true" size={15} /> : <LockOpen aria-hidden="true" size={15} />}
                </button>
                <button
                  type="button" className="icon-button icon-button--tight"
                  aria-label={`${soloLayerIds.includes(layer.id) ? "Stop soloing" : "Solo"} ${layer.name}`}
                  aria-pressed={soloLayerIds.includes(layer.id)}
                  onClick={() => onToggleSolo(layer.id)}
                >
                  <Headphones aria-hidden="true" size={15} />
                </button>
                {layer.kind === "group" ? (
                  <button
                    type="button" className="icon-button icon-button--tight"
                    aria-label={`${isolateGroupId === layer.id ? "Stop isolating" : "Isolate"} ${layer.name}`}
                    aria-pressed={isolateGroupId === layer.id}
                    onClick={() => onToggleIsolate(layer.id)}
                  >
                    <Focus aria-hidden="true" size={15} />
                  </button>
                ) : null}
                {isTopLevel ? (
                  <>
                    <button
                      type="button" className="icon-button icon-button--tight"
                      aria-label={`Move ${layer.name} up the stack`}
                      disabled={topLevelIndex >= topLevelIds.length - 1}
                      onClick={() => onReorder(layer.id, topLevelIndex + 1)}
                    >
                      <MoveUp aria-hidden="true" size={14} />
                    </button>
                    <button
                      type="button" className="icon-button icon-button--tight"
                      aria-label={`Move ${layer.name} down the stack`}
                      disabled={topLevelIndex <= 0}
                      onClick={() => onReorder(layer.id, topLevelIndex - 1)}
                    >
                      <MoveDown aria-hidden="true" size={14} />
                    </button>
                  </>
                ) : (
                  <button
                    type="button" className="icon-button icon-button--tight"
                    aria-label={`Move ${layer.name} out to the top level`}
                    onClick={() => onMoveIntoGroup(layer.id, null)}
                  >
                    <FolderInput aria-hidden="true" size={14} />
                  </button>
                )}
                <button
                  type="button" className="icon-button icon-button--tight"
                  aria-label={`Duplicate ${layer.name}`}
                  disabled={!isTopLevel}
                  onClick={() => onDuplicate(layer.id)}
                >
                  <Copy aria-hidden="true" size={14} />
                </button>
                <button
                  type="button" className="icon-button icon-button--tight"
                  aria-label={`Remove ${layer.name}`}
                  disabled={layer.locked}
                  onClick={() => onRemove(layer.id)}
                >
                  <Trash2 aria-hidden="true" size={15} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="layer-list__actions">
        <button
          className="button button--ghost" type="button"
          disabled={selectedTopLevel.length < 2}
          title={selectedTopLevel.length < 2 ? "Select at least two top-level layers to group" : undefined}
          onClick={() => onGroup(selectedTopLevel)}
        >
          Group {selectedTopLevel.length || "selected"} layer(s)
        </button>
        <button
          className="button button--ghost" type="button"
          disabled={!selectedGroup}
          title={selectedGroup ? undefined : "Select a group to ungroup it"}
          onClick={() => selectedGroup && onUngroup(selectedGroup.id)}
        >
          <Ungroup aria-hidden="true" size={14} /> Ungroup
        </button>
        {groups.length && selectedLayerIds.length === 1 ? (
          <label className="slider-field">
            <span>Move into</span>
            <select
              value=""
              onChange={(event) => onMoveIntoGroup(selectedLayerIds[0], event.target.value || null)}
            >
              <option value="">Top level</option>
              {groups
                .filter((group) => group.id !== selectedLayerIds[0])
                .map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </label>
        ) : null}
        {soloLayerIds.length || isolateGroupId ? (
          <p className="field-help" role="status">
            A viewing mode is active, so the canvas is not showing the whole document. Exports are unaffected.
          </p>
        ) : null}
      </div>
    </>
  );
}

/**
 * A layer's kind, as an icon and as words.
 *
 * The thumbnail slot was a hard-coded transparency checker on every row, which said the same
 * thing about a photograph, a title, and an adjustment layer — that is, nothing. Drawing a
 * real preview means compositing each layer alone, which is too much work for a list that
 * re-renders on every selection; naming the kind costs nothing and is the fact a person is
 * actually scanning for.
 */
function layerGlyph(layer: Layer) {
  const size = 16;
  if (layer.kind === "group") return <Layers3 aria-hidden="true" size={size} />;
  if (layer.kind === "image") return <Image aria-hidden="true" size={size} />;
  if (layer.kind === "adjustment") return <Contrast aria-hidden="true" size={size} />;
  if (layer.kind === "fill") return <PaintBucket aria-hidden="true" size={size} />;
  if (layer.kind === "paint") return <Brush aria-hidden="true" size={size} />;
  if (layer.kind === "graphics") {
    return layer.content.kind === "text"
      ? <Type aria-hidden="true" size={size} />
      : <Shapes aria-hidden="true" size={size} />;
  }
  return <Layers3 aria-hidden="true" size={size} />;
}

function layerKindLabel(layer: Layer): string {
  switch (layer.kind) {
    case "group": return `Group of ${layer.children.length}`;
    case "image": return "Image";
    case "adjustment": return "Adjustment";
    case "fill": return "Fill";
    case "paint": return "Paint";
    case "graphics": return layer.content.kind === "text" ? "Text" : "Shape";
    default: return "Layer";
  }
}
