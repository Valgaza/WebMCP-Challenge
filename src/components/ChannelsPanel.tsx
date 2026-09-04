import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff, RotateCcw, Save, Trash2, Upload } from "lucide-react";
import { SectionEmpty } from "./ui/SectionEmpty";
import type { ChannelService } from "../application/channel-service";
import type { SelectionService } from "../application/selection-service";
import type { ChannelSummary, ChannelView, ColourChannel } from "../domain/channel";

/**
 * The colour channels, and the saved selections stored beside them.
 *
 * Which channels are shown is a view state rather than an edit, so this changes nothing in the
 * document and nothing appears in Undo — the canvas is filtered on the way to the screen. That
 * is also why isolating a channel draws it in grey: a red channel painted red cannot be judged
 * for contrast, which is the only reason anyone looks at one alone.
 *
 * Alpha channels are saved selections under the name people expect. Saving here and saving in
 * the selection panel write to the same store, so a mask kept in one appears in the other
 * rather than the two quietly disagreeing.
 */

interface ChannelsPanelProps {
  projectId: string;
  channelService: ChannelService;
  selectionService: SelectionService;
  hasSelection: boolean;
  revisionKey: string;
  agentTarget?: string | null;
  onViewChange: (view: ChannelView) => void;
  onStatus: (message: string) => void;
  onError: (message: string) => void;
  onSelectionChanged: () => void;
}

/** What a channel carries, said without the word "channel". */
const CHANNEL_MEANING: Record<ColourChannel, string> = {
  red: "How much red is in each pixel. Skin and warm light live here.",
  green: "How much green. Usually the cleanest of the three, and closest to brightness.",
  blue: "How much blue. Sky and shadow, and normally the noisiest.",
  alpha: "How opaque each pixel is, rather than what colour it is.",
};

export function ChannelsPanel({
  projectId, channelService, selectionService, hasSelection, revisionKey,
  agentTarget, onViewChange, onStatus, onError, onSelectionChanged,
}: ChannelsPanelProps) {
  const [rows, setRows] = useState<ChannelSummary[]>([]);
  const [levels, setLevels] = useState<Record<ColourChannel, number> | null>(null);
  const [name, setName] = useState("");

  const load = useCallback(() => {
    void channelService.list(projectId).then(setRows).catch(() => setRows([]));
    void channelService.levels(projectId).then(setLevels).catch(() => setLevels(null));
  }, [channelService, projectId]);

  useEffect(load, [load, revisionKey]);

  function setView(changes: Partial<Pick<ChannelView, "visible" | "isolated">>) {
    try {
      const next = channelService.setView(projectId, changes);
      onViewChange(next);
      onStatus(channelService.summary(projectId));
      load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "At least one channel has to stay visible.");
    }
  }

  function toggleVisible(channel: ColourChannel, visible: boolean) {
    const current = channelService.view(projectId).visible;
    setView({ visible: visible ? [...current, channel] : current.filter((entry) => entry !== channel) });
  }

  async function saveSelection() {
    if (!name.trim()) { onError("Give the channel a name you will recognise later."); return; }
    try {
      const saved = await selectionService.save(projectId, name.trim());
      onStatus(`Saved “${saved.name}” as an alpha channel. It is the same thing as a saved selection.`);
      setName("");
      load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "That selection could not be saved.");
    }
  }

  async function loadSelection(row: ChannelSummary) {
    try {
      await selectionService.load(projectId, row.id, "replace");
      onSelectionChanged();
      onStatus(`Loaded “${row.name}” back as the selection.`);
    } catch (error) {
      onError(error instanceof Error ? error.message : "That channel could not be loaded.");
    }
  }

  async function removeSelection(row: ChannelSummary) {
    try {
      await selectionService.remove(projectId, row.id);
      onStatus(`Removed “${row.name}”.`);
      load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "That channel could not be removed.");
    }
  }

  const colours = rows.filter((row) => row.kind === "colour");
  const alphas = rows.filter((row) => row.kind === "alpha");
  const view = channelService.view(projectId);

  return (
    <section
      data-semantic-id="inspector-channels" tabIndex={-1}
      data-agent-target={agentTarget === "inspector-channels" ? "true" : undefined}
    >
      <h3>Channels</h3>

      <ul className="effect-list">
        {colours.map((row) => (
          <li key={row.id} className={row.visible ? "effect-row" : "effect-row effect-row--off"}>
            <div className="effect-row__head">
              <button
                type="button" className="effect-row__title"
                aria-pressed={row.isolated}
                title={row.isolated ? "Show all channels again" : `Show only ${row.name.toLowerCase()}, in grey`}
                onClick={() => setView({ isolated: row.isolated ? null : row.channel })}
              >
                <strong>{row.name}{row.isolated ? " — on its own" : ""}</strong>
                <small>
                  {CHANNEL_MEANING[row.channel as ColourChannel]}
                  {levels ? ` Average ${Math.round(levels[row.channel as ColourChannel])} of 255.` : ""}
                </small>
              </button>
              <div className="effect-row__actions">
                <button
                  type="button" className="icon-button icon-button--tight"
                  aria-label={row.visible ? `Hide the ${row.name.toLowerCase()} channel` : `Show the ${row.name.toLowerCase()} channel`}
                  onClick={() => toggleVisible(row.channel as ColourChannel, !row.visible)}
                >
                  {row.visible ? <Eye aria-hidden="true" size={14} /> : <EyeOff aria-hidden="true" size={14} />}
                </button>
              </div>
            </div>
            {levels ? (
              <div className="channel-bar" aria-hidden="true">
                <span style={{ width: `${(levels[row.channel as ColourChannel] / 255) * 100}%` }} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {view.isolated || view.visible.length < 4 ? (
        <div className="inspector-actions">
          <button className="button button--ghost" type="button" onClick={() => { channelService.reset(projectId); onViewChange(channelService.view(projectId)); onStatus("Every channel is showing again."); load(); }}>
            <RotateCcw aria-hidden="true" size={14} /> Show everything again
          </button>
        </div>
      ) : null}

      <h3>Saved channels</h3>
      <label className="field-label" htmlFor="channel-name">Keep the current selection</label>
      <input
        id="channel-name" className="text-field" type="text" value={name}
        placeholder="Sky" maxLength={80} disabled={!hasSelection}
        onChange={(event) => setName(event.target.value)}
      />
      <div className="inspector-actions">
        <button
          className="button button--secondary" type="button"
          disabled={!hasSelection || !name.trim()}
          onClick={() => void saveSelection()}
        >
          <Save aria-hidden="true" size={15} /> Save as a channel
        </button>
      </div>

      {alphas.length === 0 ? (
        <SectionEmpty title="No saved channels yet.">
          Make a selection on the canvas, then save it here to reuse later.
        </SectionEmpty>
      ) : (
        <ul className="effect-list">
          {alphas.map((row) => (
            <li key={row.id} className="effect-row">
              <div className="effect-row__head">
                <button type="button" className="effect-row__title" onClick={() => void loadSelection(row)}>
                  <strong>{row.name}</strong>
                  <small>{row.areaPx?.toLocaleString()} pixels. Click to select it again.</small>
                </button>
                <div className="effect-row__actions">
                  <button
                    type="button" className="icon-button icon-button--tight"
                    aria-label={`Load ${row.name}`} onClick={() => void loadSelection(row)}
                  >
                    <Upload aria-hidden="true" size={14} />
                  </button>
                  <button
                    type="button" className="icon-button icon-button--tight"
                    aria-label={`Remove ${row.name}`} onClick={() => void removeSelection(row)}
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
