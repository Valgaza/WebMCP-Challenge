import { useCallback, useEffect, useState } from "react";
import { Copy, Layers, PackageCheck, Play } from "lucide-react";
import type { BatchExportService, BatchExportPlan, ExportVariant } from "../application/batch-export-service";
import type { PresetService } from "../application/preset-service";
import type { ProjectHistoryService } from "../application/project-service";
import { flattenLayers } from "../domain/layer";

/**
 * Doing one thing to many photographs.
 *
 * This is the most ordinary professional workflow there is and the one an editor is judged on:
 * a shoot is two hundred frames of the same light, corrected once. Both halves run as a single
 * transaction or a single cancellable job, so "apply this to forty" is one Undo and one
 * progress bar rather than forty of each.
 *
 * The export half always plans before it runs. Three sizes of a hundred photographs is three
 * hundred encodes and minutes of work, so the count and the photographs that cannot take part
 * are stated first, rather than discovered when the finished set comes up short.
 */

interface BatchPanelProps {
  projectId: string;
  projectName: string;
  batchExportService: BatchExportService;
  presetService: PresetService;
  historyService: ProjectHistoryService;
  /** Every project in the workspace, so a batch can reach past the open one. */
  projects: { id: string; name: string }[];
  selectedLayerIds: string[];
  revisionKey: string;
  disabled: boolean;
  agentTarget?: string | null;
  onStatus: (message: string) => void;
  onError: (message: string) => void;
}

/** Sizes people actually ask for, named by where they are going rather than by pixel count. */
const VARIANTS: { variant: ExportVariant; hint: string }[] = [
  {
    variant: { name: "Full size", mediaType: "image/jpeg", quality: 0.92, maxEdgePx: null, resampleAlgorithm: "lanczos3" },
    hint: "The document's own size, as a high-quality JPEG.",
  },
  {
    variant: { name: "Web", mediaType: "image/webp", quality: 0.85, maxEdgePx: 2048, resampleAlgorithm: "lanczos3" },
    hint: "2048 px on the long edge. Small enough for a page, large enough to look right.",
  },
  {
    variant: { name: "Thumbnail", mediaType: "image/webp", quality: 0.8, maxEdgePx: 512, resampleAlgorithm: "lanczos3" },
    hint: "512 px, for a contact sheet or a grid.",
  },
  {
    variant: { name: "Lossless", mediaType: "image/png", quality: 1, maxEdgePx: null, resampleAlgorithm: "lanczos3" },
    hint: "PNG, no compression loss. Large files.",
  },
];

export function BatchPanel({
  projectId, projectName, batchExportService, presetService, historyService, projects,
  selectedLayerIds, revisionKey, disabled, agentTarget, onStatus, onError,
}: BatchPanelProps) {
  const [chosen, setChosen] = useState<string[]>(["Web"]);
  const [targets, setTargets] = useState<string[]>([projectId]);
  const [pattern, setPattern] = useState("{project} — {variant}");
  const [plan, setPlan] = useState<BatchExportPlan | null>(null);
  const [busy, setBusy] = useState(false);

  // The plan is only true of the projects and sizes currently ticked, so changing either
  // discards it rather than leaving a stale count on screen next to a Run button.
  useEffect(() => { setPlan(null); }, [chosen, targets, pattern, revisionKey]);

  const variantsFor = useCallback(
    () => VARIANTS.filter((entry) => chosen.includes(entry.variant.name)).map((entry) => entry.variant),
    [chosen],
  );

  async function makePlan() {
    setBusy(true);
    try {
      setPlan(await batchExportService.plan({ projectId, projectIds: targets, variants: variantsFor(), namePattern: pattern }));
    } catch (error) {
      onError(error instanceof Error ? error.message : "That batch could not be costed.");
    } finally { setBusy(false); }
  }

  async function run() {
    setBusy(true);
    try {
      const started = await batchExportService.start({ projectId, projectIds: targets, variants: variantsFor(), namePattern: pattern });
      onStatus(`Started: ${started.plan.summary} It runs in the background and can be cancelled from the job list.`);
      setPlan(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : "That batch could not be started.");
    } finally { setBusy(false); }
  }

  /**
   * Brings every other ticked photograph into line with this one.
   *
   * "Match this one" is the request people actually have, and they cannot say which twelve
   * numbers make up the answer — so the attributes are read off the layer rather than typed.
   * Each photograph keeps its own history, so each gets its own Undo step; the alternative,
   * one shared step, would mean undoing a shoot to fix one frame.
   */
  async function matchOthers() {
    const source = selectedLayerIds[0];
    if (!source) { onError("Select the layer whose look you want copied."); return; }
    const others = targets.filter((id) => id !== projectId);
    if (!others.length) { onError("Tick at least one other photograph to match."); return; }
    setBusy(true);
    try {
      // Each target is named by project *and* layer, so the top image of each is resolved
      // first rather than assuming the same layer id exists in every project.
      const pairs: { projectId: string; layerId: string }[] = [];
      const skipped: string[] = [];
      for (const target of others) {
        const snapshot = await historyService.getProjectHistory(target).catch(() => null);
        const layers = snapshot?.headRevision.state.photoDocument?.layers ?? [];
        const image = flattenLayers(layers).map((entry) => entry.layer).find((layer) => layer.kind === "image");
        if (image) pairs.push({ projectId: target, layerId: image.id });
        else skipped.push(projects.find((entry) => entry.id === target)?.name ?? target);
      }
      if (!pairs.length) { onError("None of those photographs has an image to change."); return; }

      const result = await presetService.syncAcrossProjects({
        sourceProjectId: projectId, sourceLayerId: source, targets: pairs,
        attributes: ["adjustments", "opacity", "crop"], policy: "best_effort",
      }, { intent: "Match other photographs to this one from the Inspector." });
      onStatus(skipped.length ? `${result.summary} Skipped: ${skipped.join(", ")}.` : result.summary);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Those photographs could not be matched.");
    } finally { setBusy(false); }
  }

  function toggle(list: string[], value: string, set: (next: string[]) => void) {
    set(list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]);
  }

  return (
    <section
      data-semantic-id="inspector-batch" tabIndex={-1}
      data-agent-target={agentTarget === "inspector-batch" ? "true" : undefined}
    >
      <h3>Many at once</h3>

      <p className="field-help">
        Pick the photographs, then either match them to this one or export the lot.
      </p>

      <ul className="check-list">
        {projects.map((project) => (
          <li key={project.id}>
            <label className="checkbox-field">
              <input
                type="checkbox" checked={targets.includes(project.id)} disabled={disabled || busy}
                onChange={() => toggle(targets, project.id, setTargets)}
              />
              <span>{project.name}{project.id === projectId ? " — open now" : ""}</span>
            </label>
          </li>
        ))}
      </ul>

      <div className="inspector-actions">
        <button
          className="button button--secondary" type="button"
          disabled={disabled || busy || selectedLayerIds.length === 0 || targets.length < 2}
          title="Copy this layer's colour, opacity and crop onto every other ticked photograph"
          onClick={() => void matchOthers()}
        >
          <Copy aria-hidden="true" size={15} /> Match the rest to this one
        </button>
      </div>

      <h3>Export the set</h3>
      <ul className="check-list">
        {VARIANTS.map((entry) => (
          <li key={entry.variant.name}>
            <label className="checkbox-field">
              <input
                type="checkbox" checked={chosen.includes(entry.variant.name)} disabled={disabled || busy}
                onChange={() => toggle(chosen, entry.variant.name, setChosen)}
              />
              <span>{entry.variant.name} — <small>{entry.hint}</small></span>
            </label>
          </li>
        ))}
      </ul>

      <label className="field-label" htmlFor="batch-pattern">File names</label>
      <input
        id="batch-pattern" className="text-field" type="text" value={pattern}
        maxLength={160} disabled={disabled || busy}
        onChange={(event) => setPattern(event.target.value)}
      />
      <p className="field-help">
        <code>{"{project}"}</code> and <code>{"{variant}"}</code> are filled in. Yours would read
        “{pattern.replaceAll("{project}", projectName).replaceAll("{variant}", chosen[0] ?? "Web")}”.
      </p>

      <div className="inspector-actions">
        <button
          className="button button--ghost" type="button"
          disabled={disabled || busy || !chosen.length || !targets.length}
          onClick={() => void makePlan()}
        >
          <Layers aria-hidden="true" size={14} /> How much is this?
        </button>
        {plan?.canRun ? (
          <button className="button" type="button" disabled={busy} onClick={() => void run()}>
            <Play aria-hidden="true" size={15} /> Export {plan.fileCount} file{plan.fileCount === 1 ? "" : "s"}
          </button>
        ) : null}
      </div>

      {plan ? (
        <div className={plan.canRun ? "plan-reading plan-reading--ok" : "plan-reading"}>
          <p className="plan-reading__text">
            <PackageCheck aria-hidden="true" size={14} /> {plan.summary}
          </p>
          {plan.blocked > 0 ? (
            <ul className="plan-caveats">
              {plan.items.filter((item) => item.reason).map((item) => (
                <li key={item.projectId}>{item.projectName ?? item.projectId}: {item.reason}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
