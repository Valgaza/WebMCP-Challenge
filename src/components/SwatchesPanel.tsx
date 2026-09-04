import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { SectionEmpty } from "./ui/SectionEmpty";
import type { Paint } from "../domain/vector";

/**
 * Named colours and gradients, shared by everything pointing at them.
 *
 * The reason a swatch exists rather than a colour picker per shape: changing the brand red
 * across forty objects is one edit here and forty edits otherwise. Removing one leaves whatever
 * used it unpainted and says so, rather than quietly baking in the colour it happened to have —
 * which would be the same bug as a broken link that pretends to work.
 */

export interface Swatch { id: string; name: string; paint: Paint }

interface SwatchesPanelProps {
  swatches: readonly Swatch[];
  disabled: boolean;
  agentTarget?: string | null;
  onAdd: (name: string, paint: Paint) => void;
  onUpdate: (swatchId: string, patch: { name?: string; paint?: Paint }) => void;
  onRemove: (swatchId: string) => void;
  /** Points the selected shape's fill at a swatch, which is what makes it shared. */
  onUseOnSelection: ((swatchId: string) => void) | null;
}

/** Gradients people ask for by name, built at the moment they are added. */
const GRADIENTS: { label: string; make: () => Paint }[] = [
  {
    label: "Fade to transparent",
    make: () => ({ kind: "linear", x1: 0, y1: 0, x2: 1, y2: 0, stops: [{ offset: 0, colour: "#000000", opacity: 1 }, { offset: 1, colour: "#000000", opacity: 0 }] }),
  },
  {
    label: "Sunset",
    make: () => ({ kind: "linear", x1: 0, y1: 0, x2: 0, y2: 1, stops: [{ offset: 0, colour: "#ff9a4a", opacity: 1 }, { offset: 1, colour: "#5b2a86", opacity: 1 }] }),
  },
  {
    label: "Centre glow",
    make: () => ({ kind: "radial", cx: 0.5, cy: 0.5, radius: 0.6, stops: [{ offset: 0, colour: "#ffffff", opacity: 1 }, { offset: 1, colour: "#ffffff", opacity: 0 }] }),
  },
];

/** A CSS preview of a paint, so the row shows the colour rather than describing it. */
function swatchStyle(paint: Paint): string {
  if (paint.kind === "solid") return paint.colour;
  if (paint.kind === "linear" || paint.kind === "radial") {
    const stops = paint.stops
      .map((stop) => `${stop.colour}${Math.round((stop.opacity ?? 1) * 255).toString(16).padStart(2, "0")} ${Math.round(stop.offset * 100)}%`)
      .join(", ");
    return paint.kind === "linear" ? `linear-gradient(90deg, ${stops})` : `radial-gradient(circle, ${stops})`;
  }
  return "transparent";
}

function describePaint(paint: Paint): string {
  if (paint.kind === "solid") return paint.colour;
  if (paint.kind === "linear") return `a gradient through ${paint.stops.length} colours`;
  if (paint.kind === "radial") return `a gradient out from the centre`;
  if (paint.kind === "swatch") return "another swatch";
  return "nothing";
}

export function SwatchesPanel({
  swatches, disabled, agentTarget, onAdd, onUpdate, onRemove, onUseOnSelection,
}: SwatchesPanelProps) {
  const [name, setName] = useState("");
  const [colour, setColour] = useState("#2f6fed");

  return (
    <section
      data-semantic-id="inspector-swatches" tabIndex={-1}
      data-agent-target={agentTarget === "inspector-swatches" ? "true" : undefined}
    >
      <h3>Saved colours</h3>

      <label className="field-label" htmlFor="swatch-name">Name</label>
      <input
        id="swatch-name" className="text-field" type="text" value={name}
        placeholder="Brand red" maxLength={80} disabled={disabled}
        onChange={(event) => setName(event.target.value)}
      />
      <label className="color-field" htmlFor="swatch-colour">
        Colour
        <input
          id="swatch-colour" type="color" value={colour} disabled={disabled}
          onChange={(event) => setColour(event.target.value)}
        />
      </label>
      <div className="inspector-actions">
        <button
          className="button button--secondary" type="button"
          disabled={disabled || !name.trim()}
          onClick={() => { onAdd(name.trim(), { kind: "solid", colour, opacity: 1 }); setName(""); }}
        >
          <Plus aria-hidden="true" size={15} /> Save this colour
        </button>
      </div>

      <p className="field-help">Or start from a gradient:</p>
      <div className="tool-grid" role="group" aria-label="Gradients">
        {GRADIENTS.map((entry) => (
          <button
            key={entry.label} type="button" className="tool-chip"
            disabled={disabled}
            onClick={() => onAdd(name.trim() || entry.label, entry.make())}
          >
            <span className="swatch-dot" style={{ background: swatchStyle(entry.make()) }} aria-hidden="true" />
            {entry.label}
          </button>
        ))}
      </div>

      {swatches.length === 0 ? (
        <SectionEmpty title="Nothing saved yet.">
          Save a colour to reuse it across shapes.
        </SectionEmpty>
      ) : (
        <ul className="effect-list">
          {swatches.map((swatch) => (
            <li key={swatch.id} className="effect-row">
              <div className="effect-row__head">
                <button
                  type="button" className="effect-row__title"
                  disabled={disabled || !onUseOnSelection}
                  title={onUseOnSelection ? "Fill the selected shape with this" : "Select a shape to fill it with this"}
                  onClick={() => onUseOnSelection?.(swatch.id)}
                >
                  <strong>
                    <span className="swatch-dot" style={{ background: swatchStyle(swatch.paint) }} aria-hidden="true" />
                    {swatch.name}
                  </strong>
                  <small>{describePaint(swatch.paint)}</small>
                </button>
                <div className="effect-row__actions">
                  {swatch.paint.kind === "solid" ? (
                    <input
                      type="color" className="swatch-recolour" value={swatch.paint.colour}
                      aria-label={`Recolour ${swatch.name}`} disabled={disabled}
                      onChange={(event) => onUpdate(swatch.id, { paint: { kind: "solid", colour: event.target.value, opacity: 1 } })}
                    />
                  ) : null}
                  <button
                    type="button" className="icon-button icon-button--tight"
                    aria-label={`Remove ${swatch.name}`} disabled={disabled}
                    onClick={() => onRemove(swatch.id)}
                  >
                    <Trash2 aria-hidden="true" size={14} />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
