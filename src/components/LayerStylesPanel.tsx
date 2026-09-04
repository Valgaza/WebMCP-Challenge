import { Plus, Trash2 } from "lucide-react";
import { SectionEmpty } from "./ui/SectionEmpty";
import { paintOrder, type LayerStyle, type LayerStyleStack } from "../domain/layer-style";

/**
 * Strokes, shadows, glows, bevels, and overlays on a layer's own shape.
 *
 * All five were built and drawn and none could be added without an agent, which is a
 * conspicuous gap on text: an outline or a drop shadow is what makes a title readable over a
 * photograph, and there was no way to ask for one.
 *
 * The list is shown in paint order rather than the order they were added, because that is the
 * order they will appear in — a stroke over a shadow is a different picture from a shadow over
 * a stroke, and a panel that showed them in the wrong order would be lying about the result.
 */

interface LayerStylesPanelProps {
  container: LayerStyleStack;
  disabled: boolean;
  agentTarget?: string | null;
  onAdd: (style: LayerStyle) => void;
  onUpdate: (styleId: string, patch: Partial<LayerStyle>) => void;
  onRemove: (styleId: string) => void;
}

const newId = () => crypto.randomUUID();

/** Every default is a value the compositor already accepts and a look somebody would want. */
const ADDABLE: { label: string; make: () => LayerStyle }[] = [
  {
    label: "Drop shadow",
    make: () => ({
      kind: "drop_shadow", id: newId(), enabled: true,
      angleDegrees: 135, distancePx: 6, spreadPx: 0, blurPx: 8,
      colour: "#000000", opacity: 0.5, blendMode: "normal",
    }),
  },
  {
    label: "Inner shadow",
    make: () => ({
      kind: "inner_shadow", id: newId(), enabled: true,
      angleDegrees: 135, distancePx: 4, spreadPx: 0, blurPx: 6,
      colour: "#000000", opacity: 0.45, blendMode: "normal",
    }),
  },
  {
    label: "Outline",
    make: () => ({
      kind: "stroke", id: newId(), enabled: true,
      widthPx: 3, position: "outside",
      paint: { kind: "solid", colour: "#000000", opacity: 1 },
      opacity: 1, blendMode: "normal",
    }),
  },
  {
    label: "Glow",
    make: () => ({
      kind: "glow", id: newId(), enabled: true,
      direction: "outer", sizePx: 12, spreadPx: 0,
      colour: "#ffffff", opacity: 0.6, blendMode: "screen",
    }),
  },
  {
    label: "Bevel",
    make: () => ({
      kind: "bevel", id: newId(), enabled: true,
      direction: "raised", sizePx: 4, softnessPx: 3, angleDegrees: 135,
      highlightColour: "#ffffff", shadowColour: "#000000",
      opacity: 0.6, blendMode: "normal",
    }),
  },
  {
    label: "Colour overlay",
    make: () => ({
      kind: "overlay", id: newId(), enabled: true,
      paint: { kind: "solid", colour: "#3b6fd4", opacity: 1 },
      opacity: 0.6, blendMode: "normal",
    }),
  },
];

interface NumberField { key: string; label: string; min: number; max: number; step?: number }

const FIELDS: Record<LayerStyle["kind"], NumberField[]> = {
  drop_shadow: [
    { key: "angleDegrees", label: "Light angle", min: -360, max: 360 },
    { key: "distancePx", label: "Distance", min: 0, max: 500 },
    { key: "blurPx", label: "Blur", min: 0, max: 500 },
    { key: "spreadPx", label: "Spread", min: 0, max: 250 },
  ],
  inner_shadow: [
    { key: "angleDegrees", label: "Light angle", min: -360, max: 360 },
    { key: "distancePx", label: "Distance", min: 0, max: 500 },
    { key: "blurPx", label: "Blur", min: 0, max: 500 },
    { key: "spreadPx", label: "Spread", min: 0, max: 250 },
  ],
  stroke: [{ key: "widthPx", label: "Width", min: 0, max: 500 }],
  glow: [
    { key: "sizePx", label: "Size", min: 0, max: 500 },
    { key: "spreadPx", label: "Spread", min: 0, max: 250 },
  ],
  bevel: [
    { key: "sizePx", label: "Size", min: 0, max: 250 },
    { key: "softnessPx", label: "Softness", min: 0, max: 250 },
    { key: "angleDegrees", label: "Light angle", min: -360, max: 360 },
  ],
  overlay: [],
};

const LABELS: Record<LayerStyle["kind"], string> = {
  drop_shadow: "Drop shadow",
  inner_shadow: "Inner shadow",
  stroke: "Outline",
  glow: "Glow",
  bevel: "Bevel",
  overlay: "Colour overlay",
};

export function LayerStylesPanel({
  container, disabled, agentTarget, onAdd, onUpdate, onRemove,
}: LayerStylesPanelProps) {
  // Paint order, not insertion order: what the list shows is what will be drawn.
  const ordered = paintOrder(container.styles);
  const present = new Set(ordered.map((style: LayerStyle) => style.kind));

  /** A style carries its colour on `colour` or inside `paint`, depending on its kind. */
  function colourOf(style: LayerStyle): string {
    if (style.kind === "stroke" || style.kind === "overlay") {
      return style.paint.kind === "solid" ? style.paint.colour : "#000000";
    }
    if (style.kind === "bevel") return style.highlightColour;
    return style.colour;
  }

  function setColour(style: LayerStyle, colour: string) {
    if (style.kind === "stroke" || style.kind === "overlay") {
      onUpdate(style.id, { paint: { kind: "solid", colour, opacity: 1 } } as Partial<LayerStyle>);
    } else if (style.kind === "bevel") {
      onUpdate(style.id, { highlightColour: colour } as Partial<LayerStyle>);
    } else {
      onUpdate(style.id, { colour } as Partial<LayerStyle>);
    }
  }

  return (
    <section
      data-semantic-id="inspector-styles" tabIndex={-1}
      data-agent-target={agentTarget === "inspector-styles" ? "true" : undefined}
    >
      <h3>Layer styles</h3>

      <div className="inspector-actions">
        {ADDABLE.filter((entry) => !present.has(entry.make().kind)).map((entry) => (
          <button
            key={entry.label} className="button button--ghost" type="button" disabled={disabled}
            onClick={() => onAdd(entry.make())}
          >
            <Plus aria-hidden="true" size={14} /> {entry.label}
          </button>
        ))}
      </div>

      {ordered.length === 0 ? (
        <SectionEmpty title="No styles on this layer yet.">
          Add an outline or a shadow above.
        </SectionEmpty>
      ) : (
        <ul className="effect-list">
          {ordered.map((style: LayerStyle) => (
            <li key={style.id} className={style.enabled ? "effect-row" : "effect-row effect-row--off"}>
              <div className="effect-row__head">
                <span className="effect-row__title" role="presentation">
                  <strong>{LABELS[style.kind]}</strong>
                </span>
                <div className="effect-row__actions">
                  <label className="style-colour">
                    <span className="sr-only">{LABELS[style.kind]} colour</span>
                    <input
                      type="color" value={colourOf(style)} disabled={disabled}
                      onChange={(event) => setColour(style, event.target.value)}
                    />
                  </label>
                  <button
                    type="button" className="icon-button icon-button--tight"
                    aria-label={`Remove the ${LABELS[style.kind].toLowerCase()}`}
                    disabled={disabled}
                    onClick={() => onRemove(style.id)}
                  >
                    <Trash2 aria-hidden="true" size={14} />
                  </button>
                </div>
              </div>
              <div className="effect-row__body">
                <label className="slider-field">
                  <span>Strength</span>
                  <input
                    type="range" min={0} max={100} step={1}
                    value={Math.round(style.opacity * 100)}
                    disabled={disabled}
                    onChange={(event) => onUpdate(style.id, { opacity: Number(event.target.value) / 100 } as Partial<LayerStyle>)}
                  />
                  <output>{Math.round(style.opacity * 100)}%</output>
                </label>
                {FIELDS[style.kind].map((field) => {
                  const value = Number((style as unknown as Record<string, number>)[field.key] ?? field.min);
                  return (
                    <label key={field.key} className="slider-field">
                      <span>{field.label}</span>
                      <input
                        type="range" min={field.min} max={field.max} step={field.step ?? 1}
                        value={value} disabled={disabled}
                        onChange={(event) => onUpdate(style.id, { [field.key]: Number(event.target.value) } as Partial<LayerStyle>)}
                      />
                      <output>{Math.round(value)}</output>
                    </label>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
