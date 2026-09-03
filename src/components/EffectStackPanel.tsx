import { useState } from "react";
import { ChevronDown, ChevronUp, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import type { Effect, EffectContainer } from "../domain/effect";
import { describeColourOperation, type ColourOperation } from "../domain/colour-op";
import { describeFilter, type FilterOperation } from "../domain/filter";
import { meaningOf } from "../domain/plain-english";

/**
 * The layer's effect stack, and the reason this panel exists.
 *
 * Eighteen colour operators and five filter families were built, validated, undoable and
 * exposed to WebMCP, and none of them had a control. They all live in one place already —
 * an ordered, individually switchable list on the layer — so one panel turns all of them on
 * rather than twenty-three panels turning on one each.
 *
 * Order is not decoration. A curve after a grain reads differently from a grain after a
 * curve, which is why the list is reorderable and why a preset saves the whole stack rather
 * than each entry.
 */

interface EffectStackPanelProps {
  container: EffectContainer;
  disabled: boolean;
  agentTarget?: string | null;
  onAdd: (choice: { colourOperation?: ColourOperation; filter?: FilterOperation; name: string }) => void;
  onUpdate: (effectId: string, patch: { enabled?: boolean; opacity?: number; colourOperation?: ColourOperation; filter?: FilterOperation }) => void;
  onReorder: (effectId: string, toIndex: number) => void;
  onRemove: (effectId: string) => void;
}

/**
 * What each operator starts as.
 *
 * Every entry is a value the compositor already accepts, so adding one never produces an
 * invalid stack — and every default is deliberately mild, because an effect that transforms
 * the picture the instant it is added teaches nothing about what it does.
 */
const COLOUR_PRESETS: { kind: ColourOperation["kind"]; label: string; make: () => ColourOperation }[] = [
  { kind: "exposure", label: "Exposure", make: () => ({ kind: "exposure", exposureEv: 0, offset: 0, gamma: 1 }) },
  { kind: "levels", label: "Levels", make: () => ({ kind: "levels" } as ColourOperation) },
  { kind: "curves", label: "Curves", make: () => ({ kind: "curves", channel: "rgb", points: [{ input: 0, output: 0 }, { input: 255, output: 255 }] }) },
  { kind: "vibrance", label: "Vibrance", make: () => ({ kind: "vibrance", vibrance: 0, saturation: 0 }) },
  { kind: "colour_balance", label: "Colour balance", make: () => ({ kind: "colour_balance" } as ColourOperation) },
  { kind: "selective_colour", label: "Selective colour", make: () => ({ kind: "selective_colour", cyan: 0, magenta: 0, yellow: 0, black: 0 } as ColourOperation) },
  { kind: "black_and_white", label: "Black and white", make: () => ({ kind: "black_and_white", red: 40, yellow: 60, green: 40, cyan: 60, blue: 20, magenta: 80 } as ColourOperation) },
  { kind: "channel_mixer", label: "Channel mixer", make: () => ({ kind: "channel_mixer", outputChannel: "red", fromRed: 100, fromGreen: 0, fromBlue: 0, constant: 0 } as ColourOperation) },
  { kind: "gradient_map", label: "Gradient map", make: () => ({ kind: "gradient_map", stops: [{ offset: 0, colour: "#000000" }, { offset: 1, colour: "#ffffff" }] } as ColourOperation) },
  { kind: "photo_filter", label: "Photo filter", make: () => ({ kind: "photo_filter", density: 25, preserveLuminosity: true } as ColourOperation) },
  { kind: "lut", label: "Lookup table", make: () => ({ kind: "lut", name: "Identity", size: 17 } as ColourOperation) },
  { kind: "shadows_highlights", label: "Shadows and highlights", make: () => ({ kind: "shadows_highlights", shadowAmount: 20, shadowTone: 50, highlightAmount: 0, highlightTone: 50, radiusPx: 30 }) },
  { kind: "replace_colour", label: "Replace colour", make: () => ({ kind: "replace_colour", tolerance: 30, hueShiftDeg: 0, saturationShift: 0, lightnessShift: 0 } as ColourOperation) },
  { kind: "posterize", label: "Posterize", make: () => ({ kind: "posterize", levels: 6 }) },
  { kind: "threshold", label: "Threshold", make: () => ({ kind: "threshold", level: 128 }) },
  { kind: "invert", label: "Invert", make: () => ({ kind: "invert" }) },
  { kind: "equalize", label: "Equalize", make: () => ({ kind: "equalize" }) },
];

const FILTER_PRESETS: { label: string; make: () => FilterOperation }[] = [
  { label: "Blur", make: () => ({ kind: "blur", shape: "gaussian", radiusPx: 8 } as FilterOperation) },
  { label: "Sharpen", make: () => ({ kind: "sharpen", method: "unsharp_mask", amount: 100, radiusPx: 1, threshold: 0 } as FilterOperation) },
  { label: "Output sharpen", make: () => ({ kind: "output_sharpen", medium: "screen", amount: "standard" } as FilterOperation) },
  { label: "Noise", make: () => ({ kind: "noise", mode: "add", amount: 10, radiusPx: 2, threshold: 20, monochrome: true, seed: 1 } as FilterOperation) },
  { label: "Distort", make: () => ({ kind: "distort", shape: "ripple", amount: 20, frequency: 5, angleDeg: 0, centreX: 0.5, centreY: 0.5, radius: 0.5 } as FilterOperation) },
  { label: "Pixelate", make: () => ({ kind: "pixelate", shape: "mosaic", cellPx: 12, angleDeg: 45, seed: 1 } as FilterOperation) },
  { label: "Lens flare", make: () => ({ kind: "flare", x: 0.7, y: 0.3, intensity: 0.5, sizeRatio: 0.4, colour: "#ffeecc", ghosts: 4, streak: 0 } as FilterOperation) },
];

/** A numeric field described by the schema's own bounds, so a control can never send an invalid value. */
interface Field {
  key: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  /** A term worth explaining, matching the plain-English glossary. */
  explain?: "saturation" | "contrast" | "brightness";
}

const COLOUR_FIELDS: Partial<Record<ColourOperation["kind"], Field[]>> = {
  exposure: [
    { key: "exposureEv", label: "Exposure (stops)", min: -5, max: 5, step: 0.05 },
    { key: "offset", label: "Offset", min: -0.5, max: 0.5, step: 0.005 },
    { key: "gamma", label: "Gamma", min: 0.1, max: 9.99, step: 0.01 },
  ],
  vibrance: [
    { key: "vibrance", label: "Vibrance", min: -100, max: 100 },
    { key: "saturation", label: "Saturation", min: -100, max: 100, explain: "saturation" },
  ],
  selective_colour: [
    { key: "cyan", label: "Cyan", min: -100, max: 100 },
    { key: "magenta", label: "Magenta", min: -100, max: 100 },
    { key: "yellow", label: "Yellow", min: -100, max: 100 },
    { key: "black", label: "Black", min: -100, max: 100 },
  ],
  black_and_white: [
    { key: "red", label: "Reds", min: -200, max: 300 },
    { key: "yellow", label: "Yellows", min: -200, max: 300 },
    { key: "green", label: "Greens", min: -200, max: 300 },
    { key: "cyan", label: "Cyans", min: -200, max: 300 },
    { key: "blue", label: "Blues", min: -200, max: 300 },
    { key: "magenta", label: "Magentas", min: -200, max: 300 },
  ],
  channel_mixer: [
    { key: "fromRed", label: "From red", min: -200, max: 200 },
    { key: "fromGreen", label: "From green", min: -200, max: 200 },
    { key: "fromBlue", label: "From blue", min: -200, max: 200 },
    { key: "constant", label: "Constant", min: -100, max: 100 },
  ],
  photo_filter: [{ key: "density", label: "Density", min: 0, max: 100 }],
  shadows_highlights: [
    { key: "shadowAmount", label: "Lift shadows", min: 0, max: 100 },
    { key: "shadowTone", label: "Shadow range", min: 0, max: 100 },
    { key: "highlightAmount", label: "Recover highlights", min: 0, max: 100 },
    { key: "highlightTone", label: "Highlight range", min: 0, max: 100 },
    { key: "radiusPx", label: "Radius", min: 1, max: 250 },
  ],
  replace_colour: [
    { key: "tolerance", label: "Tolerance", min: 0, max: 100 },
    { key: "hueShiftDeg", label: "Hue shift", min: -180, max: 180 },
    { key: "saturationShift", label: "Saturation shift", min: -100, max: 100, explain: "saturation" },
    { key: "lightnessShift", label: "Lightness shift", min: -100, max: 100 },
  ],
  posterize: [{ key: "levels", label: "Levels", min: 2, max: 255, step: 1 }],
  threshold: [{ key: "level", label: "Level", min: 0, max: 255, step: 1 }],
  curves: [],
  levels: [],
  colour_balance: [],
  gradient_map: [],
  lut: [],
  invert: [],
  equalize: [],
};

const FILTER_FIELDS: Partial<Record<FilterOperation["kind"], Field[]>> = {
  blur: [
    { key: "radiusPx", label: "Radius", min: 0, max: 500 },
    { key: "angleDeg", label: "Angle", min: -180, max: 180 },
    { key: "threshold", label: "Edge threshold", min: 1, max: 255 },
  ],
  sharpen: [
    { key: "amount", label: "Amount", min: 0, max: 500 },
    { key: "radiusPx", label: "Radius", min: 0.1, max: 250, step: 0.1 },
    { key: "threshold", label: "Threshold", min: 0, max: 255 },
  ],
  output_sharpen: [],
  noise: [
    { key: "amount", label: "Amount", min: 0, max: 100 },
    { key: "radiusPx", label: "Radius", min: 1, max: 50 },
    { key: "threshold", label: "Threshold", min: 0, max: 255 },
  ],
  distort: [
    { key: "amount", label: "Amount", min: -100, max: 100 },
    { key: "frequency", label: "Frequency", min: 0.1, max: 50, step: 0.1 },
    { key: "angleDeg", label: "Angle", min: -180, max: 180 },
    { key: "radius", label: "Radius", min: 0.01, max: 2, step: 0.01 },
  ],
  pixelate: [
    { key: "cellPx", label: "Cell size", min: 2, max: 500 },
    { key: "angleDeg", label: "Angle", min: -180, max: 180 },
  ],
  flare: [
    { key: "x", label: "Position across", min: -1, max: 2, step: 0.01 },
    { key: "y", label: "Position down", min: -1, max: 2, step: 0.01 },
    { key: "intensity", label: "Intensity", min: 0, max: 1, step: 0.01 },
    { key: "sizeRatio", label: "Size", min: 0.01, max: 2, step: 0.01 },
    { key: "ghosts", label: "Ghosts", min: 0, max: 8, step: 1 },
    { key: "streak", label: "Streak", min: 0, max: 1, step: 0.01 },
  ],
};

/** The enum choices each operator or filter offers, keyed by the field they set. */
const CHOICES: Record<string, { key: string; label: string; options: string[] }[]> = {
  curves: [{ key: "channel", label: "Channel", options: ["rgb", "red", "green", "blue"] }],
  channel_mixer: [{ key: "outputChannel", label: "Output channel", options: ["red", "green", "blue"] }],
  blur: [
    { key: "shape", label: "Kind", options: ["gaussian", "box", "motion", "radial", "lens", "surface"] },
    { key: "radialMode", label: "Radial mode", options: ["spin", "zoom"] },
  ],
  sharpen: [{ key: "method", label: "Method", options: ["unsharp_mask", "smart", "high_pass"] }],
  output_sharpen: [
    { key: "medium", label: "For", options: ["screen", "glossy_paper", "matte_paper"] },
    { key: "amount", label: "Strength", options: ["low", "standard", "high"] },
  ],
  noise: [{ key: "mode", label: "Mode", options: ["add", "reduce", "median", "dust_and_scratches"] }],
  distort: [{ key: "shape", label: "Kind", options: ["ripple", "wave", "twirl", "spherize", "pinch", "displace"] }],
  pixelate: [{ key: "shape", label: "Kind", options: ["mosaic", "crystallize", "halftone", "pointillize"] }],
};

const readable = (value: string) => value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export function EffectStackPanel({
  container, disabled, agentTarget, onAdd, onUpdate, onReorder, onRemove,
}: EffectStackPanelProps) {
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const effects = container.effects;

  function settingsOf(effect: Effect): { kind: string; values: Record<string, unknown> } | null {
    if (effect.kind === "colour") return { kind: effect.operation.kind, values: effect.operation as unknown as Record<string, unknown> };
    if (effect.kind === "filter") return { kind: effect.filter.kind, values: effect.filter as unknown as Record<string, unknown> };
    return null;
  }

  /** A changed field is sent as a whole replacement operation, which is how the model stores it. */
  function change(effect: Effect, key: string, value: unknown) {
    if (effect.kind === "colour") {
      onUpdate(effect.id, { colourOperation: { ...effect.operation, [key]: value } as ColourOperation });
    } else if (effect.kind === "filter") {
      onUpdate(effect.id, { filter: { ...effect.filter, [key]: value } as FilterOperation });
    }
  }

  return (
    <section
      className="effect-stack"
      data-semantic-id="inspector-effects"
      data-agent-target={agentTarget === "inspector-effects" ? "true" : undefined}
    >
      <div className="effect-stack__head">
        <h3>Effects</h3>
        <button
          className="button button--ghost" type="button" disabled={disabled}
          aria-expanded={adding}
          onClick={() => setAdding((current) => !current)}
        >
          <Plus aria-hidden="true" size={14} /> Add
        </button>
      </div>

      {adding ? (
        <div className="effect-add" role="group" aria-label="Add an effect">
          <p className="eyebrow">Tone and colour</p>
          <div className="effect-add__grid">
            {COLOUR_PRESETS.map((preset) => (
              <button
                key={preset.kind} type="button" className="effect-add__item"
                onClick={() => { onAdd({ colourOperation: preset.make(), name: preset.label }); setAdding(false); }}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <p className="eyebrow">Filters</p>
          <div className="effect-add__grid">
            {FILTER_PRESETS.map((preset) => (
              <button
                key={preset.label} type="button" className="effect-add__item"
                onClick={() => { onAdd({ filter: preset.make(), name: preset.label }); setAdding(false); }}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {effects.length === 0 ? (
        <p className="field-help">
          No effects yet. Everything added here is stored as settings and re-run when the
          picture is drawn, so any of it can be changed or removed later.
        </p>
      ) : (
        <ul className="effect-list">
          {effects.map((effect, index) => {
            const settings = settingsOf(effect);
            const isOpen = open === effect.id;
            const summary = effect.kind === "colour"
              ? describeColourOperation(effect.operation)
              : effect.kind === "filter"
                ? describeFilter(effect.filter)
                : "The simple colour sliders.";
            return (
              <li key={effect.id} className={effect.enabled ? "effect-row" : "effect-row effect-row--off"}>
                <div className="effect-row__head">
                  <button
                    type="button" className="effect-row__title"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : effect.id)}
                  >
                    <strong>{effect.name}</strong>
                    <small>{summary}</small>
                  </button>
                  <div className="effect-row__actions">
                    <button
                      type="button" className="icon-button icon-button--tight"
                      aria-label={`${effect.enabled ? "Disable" : "Enable"} ${effect.name}`}
                      aria-pressed={effect.enabled}
                      disabled={disabled}
                      onClick={() => onUpdate(effect.id, { enabled: !effect.enabled })}
                    >
                      {effect.enabled ? <Eye aria-hidden="true" size={14} /> : <EyeOff aria-hidden="true" size={14} />}
                    </button>
                    <button
                      type="button" className="icon-button icon-button--tight"
                      aria-label={`Move ${effect.name} earlier`}
                      disabled={disabled || index === 0}
                      onClick={() => onReorder(effect.id, index - 1)}
                    >
                      <ChevronUp aria-hidden="true" size={14} />
                    </button>
                    <button
                      type="button" className="icon-button icon-button--tight"
                      aria-label={`Move ${effect.name} later`}
                      disabled={disabled || index === effects.length - 1}
                      onClick={() => onReorder(effect.id, index + 1)}
                    >
                      <ChevronDown aria-hidden="true" size={14} />
                    </button>
                    <button
                      type="button" className="icon-button icon-button--tight"
                      aria-label={`Remove ${effect.name}`}
                      disabled={disabled}
                      onClick={() => onRemove(effect.id)}
                    >
                      <Trash2 aria-hidden="true" size={14} />
                    </button>
                  </div>
                </div>

                {isOpen ? (
                  <div className="effect-row__body">
                    <label className="slider-field">
                      <span>Strength</span>
                      <input
                        type="range" min={0} max={100} step={1}
                        value={Math.round(effect.opacity * 100)}
                        disabled={disabled}
                        onChange={(event) => onUpdate(effect.id, { opacity: Number(event.target.value) / 100 })}
                      />
                      <output>{Math.round(effect.opacity * 100)}%</output>
                    </label>

                    {settings ? (CHOICES[settings.kind] ?? []).map((choice) => (
                      <label key={choice.key} className="slider-field">
                        <span>{choice.label}</span>
                        <select
                          className="select-field"
                          value={String(settings.values[choice.key] ?? choice.options[0])}
                          disabled={disabled}
                          onChange={(event) => change(effect, choice.key, event.target.value)}
                        >
                          {choice.options.map((option) => (
                            <option key={option} value={option}>{readable(option)}</option>
                          ))}
                        </select>
                      </label>
                    )) : null}

                    {settings ? (
                      (effect.kind === "colour" ? COLOUR_FIELDS[settings.kind as ColourOperation["kind"]] : FILTER_FIELDS[settings.kind as FilterOperation["kind"]]) ?? []
                    ).map((field) => {
                      const value = Number(settings.values[field.key] ?? field.min);
                      return (
                        <label key={field.key} className="slider-field">
                          <span title={field.explain ? `${field.label} is ${meaningOf(field.explain)}.` : undefined}>
                            {field.label}
                          </span>
                          <input
                            type="range"
                            min={field.min} max={field.max} step={field.step ?? 1}
                            value={value}
                            disabled={disabled}
                            onChange={(event) => change(effect, field.key, Number(event.target.value))}
                          />
                          <output>{field.step && field.step < 1 ? value.toFixed(2) : Math.round(value)}</output>
                        </label>
                      );
                    }) : null}

                    {settings && (effect.kind === "colour" ? COLOUR_FIELDS[settings.kind as ColourOperation["kind"]] : FILTER_FIELDS[settings.kind as FilterOperation["kind"]])?.length === 0
                      && (CHOICES[settings.kind] ?? []).length === 0 ? (
                      <p className="field-help">
                        This one has no settings to adjust. It is either on or off.
                      </p>
                    ) : null}

                    {effect.kind === "colour" && (settings?.kind === "curves" || settings?.kind === "levels" || settings?.kind === "colour_balance" || settings?.kind === "gradient_map" || settings?.kind === "lut") ? (
                      <p className="field-help">
                        Its detailed controls — the curve graph, the per-channel numbers — are
                        editable through WebMCP today. Ask an agent to set them, or use
                        Strength to blend what is there.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
