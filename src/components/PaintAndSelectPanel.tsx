import { Brush, Circle, Eraser, Lasso, MousePointerSquareDashed, Palette, Square, Undo2, Wand2 } from "lucide-react";
import type { CanvasTool } from "./CanvasToolOverlay";
import { BRUSH_KIND_LABELS, type BrushKind } from "../domain/brush";

/**
 * Picking a canvas tool, and the settings the chosen one needs.
 *
 * Selections and brushes were the last two features that could not be a form, and they share
 * a panel because they share a gesture: press, drag, release. What differs is what the drag
 * means, and that is exactly what this chooses.
 *
 * Retouching brushes are listed with the painting ones rather than separately, because to a
 * person they are the same action with a different result — and because the model already
 * treats them that way, sharing stamps, spacing and pressure.
 */

interface PaintAndSelectPanelProps {
  tool: CanvasTool | null;
  brushKind: BrushKind;
  brushSizePx: number;
  brushColour: string;
  hasSelection: boolean;
  selectionSummary: string;
  disabled: boolean;
  agentTarget?: string | null;
  onChooseTool: (tool: CanvasTool | null) => void;
  onBrushKind: (kind: BrushKind) => void;
  onBrushSize: (sizePx: number) => void;
  onBrushColour: (colour: string) => void;
  cloneOffset: { x: number; y: number };
  onCloneOffset: (offset: { x: number; y: number }) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onFeather: (radiusPx: number) => void;
  onFillSelection: () => void;
  /** How many strokes are on the layer being painted, so the two stroke controls can hide. */
  strokeCount: number;
  onUndoStroke: () => void;
  /** Repaints the last stroke with the settings above, without redrawing it. */
  onRestyleLastStroke: () => void;
}

const SELECT_TOOLS: { id: CanvasTool; label: string; Icon: typeof Square }[] = [
  { id: "marquee_rectangle", label: "Rectangle", Icon: Square },
  { id: "marquee_ellipse", label: "Ellipse", Icon: Circle },
  { id: "lasso", label: "Freehand", Icon: Lasso },
  { id: "wand", label: "Magic wand", Icon: Wand2 },
];

/** Painting kinds first, then the ones that change what is already there. */
const BRUSH_KINDS: BrushKind[] = [
  "brush", "pencil", "eraser",
  "heal", "clone", "dodge", "burn", "sponge", "blur", "sharpen", "smudge", "red_eye",
];

export function PaintAndSelectPanel({
  tool, brushKind, brushSizePx, brushColour, hasSelection, selectionSummary, disabled,
  agentTarget, onChooseTool, onBrushKind, onBrushSize, onBrushColour, cloneOffset, onCloneOffset,
  onSelectAll, onClearSelection, onFeather, onFillSelection,
  strokeCount, onUndoStroke, onRestyleLastStroke,
}: PaintAndSelectPanelProps) {
  return (
    <section
      data-semantic-id="inspector-tools" tabIndex={-1}
      data-agent-target={agentTarget === "inspector-tools" ? "true" : undefined}
    >
      <h3>Select</h3>
      <div className="tool-grid" role="group" aria-label="Selection tools">
        {SELECT_TOOLS.map(({ id, label, Icon }) => (
          <button
            key={id} type="button"
            className={tool === id ? "tool-chip tool-chip--on" : "tool-chip"}
            aria-pressed={tool === id}
            disabled={disabled}
            onClick={() => onChooseTool(tool === id ? null : id)}
          >
            <Icon aria-hidden="true" size={15} />
            {label}
          </button>
        ))}
      </div>

      <p className="field-help">
        {tool && tool !== "brush"
          ? "Drag on the canvas. The edge crawls so you can see it against any picture."
          : "Choose one, then drag on the canvas."}
      </p>

      <div className="inspector-actions">
        <button className="button button--ghost" type="button" disabled={disabled} onClick={onSelectAll}>
          <MousePointerSquareDashed aria-hidden="true" size={14} /> Select all
        </button>
        <button className="button button--ghost" type="button" disabled={disabled || !hasSelection} onClick={onClearSelection}>
          Deselect
        </button>
      </div>

      {hasSelection ? (
        <>
          <p className="field-help">{selectionSummary}</p>
          <label className="slider-field">
            <span title="Softens the edge, so a change confined to the selection does not stop abruptly.">Soften edge</span>
            <input
              type="range" min={0} max={100} step={1} defaultValue={0}
              disabled={disabled}
              onChange={(event) => onFeather(Number(event.target.value))}
            />
          </label>
          <div className="inspector-actions">
            <button className="button button--secondary" type="button" disabled={disabled} onClick={onFillSelection}>
              Fill with the brush colour
            </button>
          </div>
        </>
      ) : null}

      <h3>Paint</h3>
      <div className="tool-grid" role="group" aria-label="Brush">
        <button
          type="button"
          className={tool === "brush" ? "tool-chip tool-chip--on" : "tool-chip"}
          aria-pressed={tool === "brush"}
          disabled={disabled}
          onClick={() => onChooseTool(tool === "brush" ? null : "brush")}
        >
          {brushKind === "eraser" ? <Eraser aria-hidden="true" size={15} /> : <Brush aria-hidden="true" size={15} />}
          {tool === "brush" ? "Painting" : "Paint"}
        </button>
      </div>

      <label className="slider-field">
        <span>Kind</span>
        <select
          className="select-field" value={brushKind} disabled={disabled}
          onChange={(event) => onBrushKind(event.target.value as BrushKind)}
        >
          {BRUSH_KINDS.map((kind) => (
            <option key={kind} value={kind}>{BRUSH_KIND_LABELS[kind]}</option>
          ))}
        </select>
      </label>

      <label className="slider-field">
        <span>Size</span>
        <input
          type="range" min={1} max={400} step={1}
          value={brushSizePx} disabled={disabled}
          onChange={(event) => onBrushSize(Number(event.target.value))}
        />
        <output>{brushSizePx} px</output>
      </label>

      {brushKind === "heal" || brushKind === "clone" ? (
        <>
          <label className="slider-field">
            <span title="How far away, and in which direction, the brush reads its texture from.">Sample from — across</span>
            <input
              type="range" min={-400} max={400} step={1}
              value={cloneOffset.x} disabled={disabled}
              onChange={(event) => onCloneOffset({ ...cloneOffset, x: Number(event.target.value) })}
            />
            <output>{cloneOffset.x} px</output>
          </label>
          <label className="slider-field">
            <span>Sample from — down</span>
            <input
              type="range" min={-400} max={400} step={1}
              value={cloneOffset.y} disabled={disabled}
              onChange={(event) => onCloneOffset({ ...cloneOffset, y: Number(event.target.value) })}
            />
            <output>{cloneOffset.y} px</output>
          </label>
          <p className="field-help">
            {brushKind === "heal"
              ? "Healing borrows the texture from there and keeps the colour and brightness where you paint, which is why a healed blemish disappears where a cloned one shows as a patch."
              : "Cloning copies those pixels outright, lighting and all."}
          </p>
        </>
      ) : null}

      <label className="color-field" htmlFor="brush-colour">
        Colour
        <input
          id="brush-colour" type="color" value={brushColour} disabled={disabled}
          onChange={(event) => onBrushColour(event.target.value)}
        />
      </label>

      {strokeCount > 0 ? (
        <div className="inspector-actions">
          <button className="button button--ghost" type="button" disabled={disabled} onClick={onUndoStroke}>
            <Undo2 aria-hidden="true" size={14} /> Take back the last stroke
          </button>
          <button
            className="button button--ghost" type="button" disabled={disabled}
            title="Repaint the last stroke with the size and colour above, without drawing it again"
            onClick={onRestyleLastStroke}
          >
            <Palette aria-hidden="true" size={14} /> Restyle it
          </button>
        </div>
      ) : null}

    </section>
  );
}
