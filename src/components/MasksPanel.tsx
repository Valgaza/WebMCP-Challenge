import { Circle, Contrast, Square, Trash2 } from "lucide-react";
import { SectionEmpty } from "./ui/SectionEmpty";
import type { Mask } from "../domain/effect";

/**
 * Hiding part of a layer without erasing it.
 *
 * A mask is the difference between an editor and a paint program: an adjustment confined to
 * the sky, a photograph cut to a shape, a gradient that fades one layer into another. All of
 * it was built and drawn and none of it could be added by hand.
 *
 * The shape and luminance sources are the two a person can specify without painting. A
 * painted mask needs a brush on the canvas, and a mask taken from another layer's
 * transparency needs a layer picker; both remain available through WebMCP and are named here
 * rather than quietly missing.
 */

interface MasksPanelProps {
  masks: readonly Mask[];
  disabled: boolean;
  agentTarget?: string | null;
  onAdd: (mask: Omit<Mask, "id">) => void;
  onUpdate: (maskId: string, patch: Partial<Mask>) => void;
  onRemove: (maskId: string) => void;
}

/** Fractions of the layer, so a mask keeps its place when the layer is resized. */
const CENTRED = { x: 0.15, y: 0.15, width: 0.7, height: 0.7 };

function describeSource(mask: Mask): string {
  switch (mask.source.kind) {
    case "shape": return mask.source.shape === "ellipse" ? "An elliptical area" : "A rectangular area";
    case "luma": return `Tones between ${mask.source.low} and ${mask.source.high}`;
    case "layer_alpha": return "The shape of another layer";
    case "raster": return "A painted mask";
    case "stored": return "A saved selection";
    case "path": return "A vector path";
    default: return "A mask";
  }
}

export function MasksPanel({ masks, disabled, agentTarget, onAdd, onUpdate, onRemove }: MasksPanelProps) {
  return (
    <section
      data-semantic-id="inspector-masks" tabIndex={-1}
      data-agent-target={agentTarget === "inspector-masks" ? "true" : undefined}
    >
      <h3>Masks</h3>

      <div className="inspector-actions">
        <button
          className="button button--ghost" type="button" disabled={disabled}
          onClick={() => onAdd({
            source: { kind: "shape", shape: "rectangle", ...CENTRED, cornerRadius: 0 },
            featherPx: 0, density: 1, inverted: false, enabled: true,
          })}
        >
          <Square aria-hidden="true" size={14} /> Rectangle
        </button>
        <button
          className="button button--ghost" type="button" disabled={disabled}
          onClick={() => onAdd({
            source: { kind: "shape", shape: "ellipse", ...CENTRED, cornerRadius: 0 },
            featherPx: 40, density: 1, inverted: false, enabled: true,
          })}
        >
          <Circle aria-hidden="true" size={14} /> Ellipse
        </button>
        <button
          className="button button--ghost" type="button" disabled={disabled}
          onClick={() => onAdd({
            source: { kind: "luma", low: 0, high: 90 },
            featherPx: 0, density: 1, inverted: false, enabled: true,
          })}
        >
          <Contrast aria-hidden="true" size={14} /> By tone
        </button>
      </div>

      {masks.length === 0 ? (
        <SectionEmpty title="No masks on this layer yet.">
          Add one above to hide part of it without erasing anything.
        </SectionEmpty>
      ) : (
        <ul className="effect-list">
          {masks.map((mask) => (
            <li key={mask.id} className={mask.enabled ? "effect-row" : "effect-row effect-row--off"}>
              <div className="effect-row__head">
                <span className="effect-row__title" role="presentation">
                  <strong>{describeSource(mask)}</strong>
                  <small>{mask.inverted ? "Hides that area" : "Shows only that area"}</small>
                </span>
                <div className="effect-row__actions">
                  <button
                    type="button" className="icon-button icon-button--tight"
                    aria-label="Remove this mask" disabled={disabled}
                    onClick={() => onRemove(mask.id)}
                  >
                    <Trash2 aria-hidden="true" size={14} />
                  </button>
                </div>
              </div>
              <div className="effect-row__body">
                <label className="checkbox-field">
                  <input
                    type="checkbox" checked={mask.inverted} disabled={disabled}
                    onChange={(event) => onUpdate(mask.id, { inverted: event.target.checked })}
                  />
                  <span>Invert — hide this area instead of showing it</span>
                </label>

                <label className="slider-field">
                  <span title="How far the mask's edge fades, so it does not read as a cut-out.">Soften edge</span>
                  <input
                    type="range" min={0} max={300} step={1}
                    value={mask.featherPx} disabled={disabled}
                    onChange={(event) => onUpdate(mask.id, { featherPx: Number(event.target.value) })}
                  />
                  <output>{mask.featherPx} px</output>
                </label>

                <label className="slider-field">
                  <span title="A half-strength mask leaves the layer half-visible outside it, rather than hidden.">Strength</span>
                  <input
                    type="range" min={0} max={100} step={1}
                    value={Math.round(mask.density * 100)} disabled={disabled}
                    onChange={(event) => onUpdate(mask.id, { density: Number(event.target.value) / 100 })}
                  />
                  <output>{Math.round(mask.density * 100)}%</output>
                </label>

                {mask.source.kind === "luma" ? (
                  <>
                    <label className="slider-field">
                      <span>Darkest tone kept</span>
                      <input
                        type="range" min={0} max={255} step={1}
                        value={mask.source.low} disabled={disabled}
                        onChange={(event) => onUpdate(mask.id, {
                          source: { ...mask.source, low: Number(event.target.value) },
                        } as Partial<Mask>)}
                      />
                      <output>{mask.source.low}</output>
                    </label>
                    <label className="slider-field">
                      <span>Lightest tone kept</span>
                      <input
                        type="range" min={0} max={255} step={1}
                        value={mask.source.high} disabled={disabled}
                        onChange={(event) => onUpdate(mask.id, {
                          source: { ...mask.source, high: Number(event.target.value) },
                        } as Partial<Mask>)}
                      />
                      <output>{mask.source.high}</output>
                    </label>
                  </>
                ) : null}

                {mask.source.kind === "shape" ? (
                  <>
                    <label className="slider-field">
                      <span>Across</span>
                      <input
                        type="range" min={0} max={100} step={1}
                        value={Math.round(mask.source.x * 100)} disabled={disabled}
                        onChange={(event) => onUpdate(mask.id, {
                          source: { ...mask.source, x: Number(event.target.value) / 100 },
                        } as Partial<Mask>)}
                      />
                      <output>{Math.round(mask.source.x * 100)}%</output>
                    </label>
                    <label className="slider-field">
                      <span>Down</span>
                      <input
                        type="range" min={0} max={100} step={1}
                        value={Math.round(mask.source.y * 100)} disabled={disabled}
                        onChange={(event) => onUpdate(mask.id, {
                          source: { ...mask.source, y: Number(event.target.value) / 100 },
                        } as Partial<Mask>)}
                      />
                      <output>{Math.round(mask.source.y * 100)}%</output>
                    </label>
                    <label className="slider-field">
                      <span>Width</span>
                      <input
                        type="range" min={1} max={100} step={1}
                        value={Math.round(mask.source.width * 100)} disabled={disabled}
                        onChange={(event) => onUpdate(mask.id, {
                          source: { ...mask.source, width: Number(event.target.value) / 100 },
                        } as Partial<Mask>)}
                      />
                      <output>{Math.round(mask.source.width * 100)}%</output>
                    </label>
                    <label className="slider-field">
                      <span>Height</span>
                      <input
                        type="range" min={1} max={100} step={1}
                        value={Math.round(mask.source.height * 100)} disabled={disabled}
                        onChange={(event) => onUpdate(mask.id, {
                          source: { ...mask.source, height: Number(event.target.value) / 100 },
                        } as Partial<Mask>)}
                      />
                      <output>{Math.round(mask.source.height * 100)}%</output>
                    </label>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="field-help">
        Painted masks and masks taken from another layer&rsquo;s shape need a brush or a layer
        picker, and are available through WebMCP in the meantime.
      </p>

    </section>
  );
}
