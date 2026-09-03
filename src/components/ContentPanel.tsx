import { useRef } from "react";
import { Circle, FileDown, FileUp, Square, Type } from "lucide-react";
import type { Layer } from "../domain/layer";
import type { ParagraphStyle } from "../domain/text";
import { count } from "../domain/plural";

/**
 * Making and editing the things that are not photographs.
 *
 * Text and vector shapes both draw correctly and neither could be created without an agent,
 * which made "add a title" the one obvious thing a person could not do. A new layer lands in
 * the middle of the document in a colour chosen to be legible against it, so it is visible
 * the moment it exists rather than needing to be hunted for.
 *
 * This is a panel rather than a canvas tool on purpose: the tool set is stored in the
 * workspace record, and adding to it means migrating every saved workspace. Placement is
 * done with the Transform controls that already exist, which is a click more and no risk.
 */

interface ContentPanelProps {
  /** The selected layer, when it is text or a shape and therefore editable here. */
  layer: Layer | null;
  disabled: boolean;
  agentTarget?: string | null;
  onAddText: () => void;
  onAddShape: (kind: "rectangle" | "ellipse") => void;
  onEditText: (patch: {
    content?: string;
    sizePx?: number;
    colour?: string;
    trackingMille?: number;
    font?: { weight?: number; italic?: boolean };
    paragraph?: Partial<ParagraphStyle>;
  }) => void;
  onSetFill: (colour: string) => void;
  /** Points the fill at a saved colour, so changing that colour changes this too. */
  onUseSwatch: ((swatchId: string) => void) | null;
  onImportSvg: (source: string, fileName: string) => void;
  onExportSvg: () => void;
  /** How many shapes are in the document, so export can say what it would write. */
  vectorCount: number;
}

const WEIGHTS = [300, 400, 500, 600, 700, 800];

export function ContentPanel({
  layer, disabled, agentTarget, onAddText, onAddShape, onEditText, onSetFill,
  onUseSwatch, onImportSvg, onExportSvg, vectorCount,
}: ContentPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const text = layer?.kind === "graphics" && layer.content.kind === "text" ? layer.content.text : null;
  const vector = layer?.kind === "graphics" && layer.content.kind === "vector" ? layer.content.vector : null;
  const paragraph = text?.paragraphs[0];

  return (
    <section
      data-semantic-id="inspector-content" tabIndex={-1}
      data-agent-target={agentTarget === "inspector-content" ? "true" : undefined}
    >
      <h3>Text and shapes</h3>

      <div className="inspector-actions">
        <button className="button button--secondary" type="button" disabled={disabled} onClick={onAddText}>
          <Type aria-hidden="true" size={15} /> Text
        </button>
        <button className="button button--secondary" type="button" disabled={disabled} onClick={() => onAddShape("rectangle")}>
          <Square aria-hidden="true" size={15} /> Rectangle
        </button>
        <button className="button button--secondary" type="button" disabled={disabled} onClick={() => onAddShape("ellipse")}>
          <Circle aria-hidden="true" size={15} /> Ellipse
        </button>
      </div>

      {text ? (
        <>
          <label className="field-label" htmlFor="content-text">Words</label>
          <textarea
            id="content-text"
            className="text-field"
            rows={3}
            value={text.content}
            disabled={disabled}
            onChange={(event) => onEditText({ content: event.target.value })}
          />
          <p className="field-help">
            Stored as text rather than as pixels, so it can be re-worded or resized later and
            still draw sharply at export size.
          </p>

          <label className="slider-field">
            <span>Size</span>
            <input
              type="range" min={8} max={600} step={1}
              value={Math.round(text.sizePx)}
              disabled={disabled}
              onChange={(event) => onEditText({ sizePx: Number(event.target.value) })}
            />
            <output>{Math.round(text.sizePx)} px</output>
          </label>

          <label className="slider-field">
            <span>Letter spacing</span>
            <input
              type="range" min={-100} max={400} step={5}
              value={text.trackingMille}
              disabled={disabled}
              onChange={(event) => onEditText({ trackingMille: Number(event.target.value) })}
            />
            <output>{text.trackingMille}</output>
          </label>

          <label className="slider-field">
            <span>Weight</span>
            <select
              className="select-field"
              value={String(text.font.weight)}
              disabled={disabled}
              onChange={(event) => onEditText({ font: { weight: Number(event.target.value) } })}
            >
              {WEIGHTS.map((weight) => <option key={weight} value={weight}>{weight}</option>)}
            </select>
          </label>

          <label className="slider-field">
            <span>Alignment</span>
            <select
              className="select-field"
              value={paragraph?.alignment ?? "start"}
              disabled={disabled}
              onChange={(event) => onEditText({ paragraph: { alignment: event.target.value as ParagraphStyle["alignment"] } })}
            >
              <option value="start">Left</option>
              <option value="center">Centre</option>
              <option value="end">Right</option>
            </select>
          </label>

          <label className="color-field" htmlFor="content-text-colour">
            Colour
            <input
              id="content-text-colour" type="color"
              value={text.colour}
              disabled={disabled}
              onChange={(event) => onEditText({ colour: event.target.value })}
            />
          </label>
        </>
      ) : null}

      {vector ? (
        <>
          <label className="color-field" htmlFor="content-shape-fill">
            Fill
            <input
              id="content-shape-fill" type="color"
              value={vector.fill.kind === "solid" ? vector.fill.colour : "#ffffff"}
              disabled={disabled}
              onChange={(event) => onSetFill(event.target.value)}
            />
          </label>
          <p className="field-help">
            Drawn from its description rather than from pixels, so it stays sharp at any size.
            Save a colour under Saved colours to fill this with a shared one.
          </p>
        </>
      ) : null}

      {!text && !vector ? (
        <p className="field-help">
          A new one lands in the middle of the canvas, in a colour picked to be readable
          against the background. Select it here to change its words, size, or colour.
        </p>
      ) : null}

      <h3>SVG</h3>
      <div className="inspector-actions">
        <button
          className="button button--ghost" type="button" disabled={disabled}
          onClick={() => fileRef.current?.click()}
        >
          <FileUp aria-hidden="true" size={14} /> Bring one in
        </button>
        <button
          className="button button--ghost" type="button"
          disabled={disabled || vectorCount === 0}
          title={vectorCount ? `Write ${count(vectorCount, "shape")} out as SVG` : "There are no shapes to write out"}
          onClick={onExportSvg}
        >
          <FileDown aria-hidden="true" size={14} /> Write them out
        </button>
      </div>
      <input
        ref={fileRef} type="file" accept="image/svg+xml,.svg" className="visually-hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared straight away so choosing the same file twice still fires a change.
          event.target.value = "";
          if (!file) return;
          void file.text().then((source) => onImportSvg(source, file.name));
        }}
      />
      <p className="field-help">
        Shapes come in as editable objects rather than as a picture of themselves, and anything
        in the file that Estro cannot draw is named rather than dropped in silence.
      </p>
    </section>
  );
}
