import { useCallback, useEffect, useState } from "react";
import { BookmarkPlus, Check } from "lucide-react";
import type { PresetService } from "../application/preset-service";
import type { PresetRecord } from "../domain/preset";
import { describeBundle } from "../domain/preset";
import { count } from "../domain/plural";

/**
 * Saving a look and putting it on something else.
 *
 * The reuse engine handles copy, paste, presets, templates and batch apply as one operation
 * — an adapter reads a layer's attributes and writes them to many at once, in a single
 * transaction and therefore a single Undo. All of it worked and none of it had a control, so
 * the most ordinary photographic workflow of all, "make the other twelve look like this
 * one", was agent-only.
 *
 * Applying to the whole selection rather than one layer is the point: it is one transaction
 * either way, and doing forty at once is what makes it worth having.
 */

interface PresetsPanelProps {
  projectId: string;
  presetService: PresetService;
  /** Which layers a preset would be applied to, and read from. */
  selectedLayerIds: string[];
  revisionKey: string;
  disabled: boolean;
  agentTarget?: string | null;
  onStatus: (message: string) => void;
  onError: (message: string) => void;
  onChanged: () => void;
}

export function PresetsPanel({
  projectId, presetService, selectedLayerIds, revisionKey, disabled,
  agentTarget, onStatus, onError, onChanged,
}: PresetsPanelProps) {
  const [presets, setPresets] = useState<PresetRecord[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void presetService.listPresets({ projectId, domain: "layer" })
      .then(setPresets)
      .catch(() => setPresets([]));
  }, [presetService, projectId]);

  useEffect(load, [load, revisionKey]);

  async function saveFromSelection() {
    const source = selectedLayerIds[0];
    if (!source) { onError("Select a layer to save its look as a preset."); return; }
    if (!name.trim()) { onError("Give the preset a name you will recognise later."); return; }
    setBusy(true);
    try {
      // Read what is on the layer now, rather than asking the person to describe it.
      const copied = await presetService.copyAttributes({
        projectId, domain: "layer", targetId: source,
        attributes: ["adjustments", "opacity", "crop"],
      });
      const saved = await presetService.savePreset({
        name: name.trim(), domain: "layer", attributes: copied.attributes, projectId,
      });
      onStatus(`Saved “${saved.name}”: ${describeBundle(saved.attributes)}`);
      setName("");
      load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "That preset could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function apply(preset: PresetRecord) {
    if (!selectedLayerIds.length) { onError("Select the layers to apply this preset to."); return; }
    setBusy(true);
    try {
      const result = await presetService.applyPreset({
        projectId, presetId: preset.id, targetIds: selectedLayerIds,
      });
      onStatus(`Applied “${preset.name}” to ${selectedLayerIds.length} layer(s). One Undo returns every one of them.`);
      void result;
      onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : "That preset could not be applied.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      data-semantic-id="inspector-presets" tabIndex={-1}
      data-agent-target={agentTarget === "inspector-presets" ? "true" : undefined}
    >
      <h3>Presets</h3>

      <label className="field-label" htmlFor="preset-name">Save this layer&rsquo;s look</label>
      <input
        id="preset-name" className="text-field" type="text" value={name}
        placeholder="Warm evening"
        maxLength={80}
        disabled={disabled || busy}
        onChange={(event) => setName(event.target.value)}
      />
      <div className="inspector-actions">
        <button
          className="button button--secondary" type="button"
          disabled={disabled || busy || !name.trim() || selectedLayerIds.length === 0}
          onClick={() => void saveFromSelection()}
        >
          <BookmarkPlus aria-hidden="true" size={15} /> Save preset
        </button>
      </div>

      {presets.length === 0 ? (
        <p className="field-help">
          No presets yet. Saving one reads the colour, opacity and crop off the selected layer
          so it can be put on any number of others in a single step.
        </p>
      ) : (
        <ul className="effect-list">
          {presets.map((preset) => (
            <li key={preset.id} className="effect-row">
              <div className="effect-row__head">
                <button
                  type="button" className="effect-row__title"
                  disabled={disabled || busy || selectedLayerIds.length === 0}
                  title={selectedLayerIds.length ? `Apply to ${count(selectedLayerIds.length, "selected layer")}` : "Select a layer first"}
                  onClick={() => void apply(preset)}
                >
                  <strong>{preset.name}</strong>
                  <small>{describeBundle(preset.attributes)}</small>
                </button>
                <div className="effect-row__actions">
                  <span className="icon-button icon-button--tight" aria-hidden="true"><Check size={14} /></span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="field-help">
        Applying to several layers is one transaction, so one Undo puts every one of them back.
      </p>
    </section>
  );
}
