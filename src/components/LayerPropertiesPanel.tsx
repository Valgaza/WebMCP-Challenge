import { Contrast, Link2, PaintBucket } from "lucide-react";
import { BLEND_MODES, BLEND_MODE_LABELS, type BlendMode } from "../domain/effect";
import type { Layer } from "../domain/layer";

/**
 * The compositing properties every layer has, and the two layer kinds that had no way in.
 *
 * Blend modes, clipping, adjustment layers and fill layers were all built, undoable and
 * exposed to WebMCP, and none of them had a control — so a person could stack layers but
 * never make one interact with the one beneath it, which is most of what a layer stack is
 * for. Each label says what the mode does rather than only naming it, because "Color burn"
 * tells nobody anything.
 */

interface LayerPropertiesPanelProps {
  layer: Layer;
  /** Whether there is a layer beneath this one for it to clip to. */
  canClip: boolean;
  disabled: boolean;
  agentTarget?: string | null;
  onSetBlendMode: (mode: BlendMode) => void;
  onSetClipping: (clipToBelow: boolean) => void;
  onAddAdjustmentLayer: () => void;
  onAddFillLayer: () => void;
}

export function LayerPropertiesPanel({
  layer, canClip, disabled, agentTarget,
  onSetBlendMode, onSetClipping, onAddAdjustmentLayer, onAddFillLayer,
}: LayerPropertiesPanelProps) {
  return (
    <section
      data-semantic-id="inspector-compositing" tabIndex={-1}
      data-agent-target={agentTarget === "inspector-compositing" ? "true" : undefined}
    >
      <h3>Compositing</h3>

      <label className="slider-field">
        <span>Blend mode</span>
        <select
          className="select-field"
          value={layer.blendMode}
          disabled={disabled}
          onChange={(event) => onSetBlendMode(event.target.value as BlendMode)}
        >
          {BLEND_MODES.map((mode) => (
            <option key={mode} value={mode}>{BLEND_MODE_LABELS[mode]}</option>
          ))}
        </select>
      </label>

      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={layer.clipToBelow}
          disabled={disabled || !canClip}
          onChange={(event) => onSetClipping(event.target.checked)}
        />
        <span>
          <Link2 aria-hidden="true" size={14} /> Clip to the layer below
        </span>
      </label>
      <p className="field-help">
        {canClip
          ? "A clipped layer shows only where the one under it has pixels. Nothing is erased; uncheck to see all of it again."
          : "There is no layer underneath this one to clip to."}
      </p>

      <h3>Add a layer</h3>
      <div className="inspector-actions">
        <button
          className="button button--secondary" type="button" disabled={disabled}
          onClick={onAddAdjustmentLayer}
        >
          <Contrast aria-hidden="true" size={15} /> Adjustment
        </button>
        <button
          className="button button--secondary" type="button" disabled={disabled}
          onClick={onAddFillLayer}
        >
          <PaintBucket aria-hidden="true" size={15} /> Fill
        </button>
      </div>
      <p className="field-help">
        An adjustment layer changes everything beneath it rather than drawing anything of its
        own, so one of them can grade a whole stack and be removed again in one step. A fill
        layer covers the document with a colour or a gradient and re-fits when it is resized;
        it is almost always clipped or masked.
      </p>
    </section>
  );
}
