import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { ADJUSTMENT_RANGES, describeAdjustment, type AdjustmentName } from "../domain/adjustment";
import type { ImageLayer } from "../domain/layer";
import type { RenderService } from "../application/render-service";
import { FieldHelp } from "./ui/FieldHelp";

interface AdjustmentInspectorProps {
  projectId: string;
  layer: ImageLayer;
  renderService: RenderService;
  revisionKey: string;
  onAdjust: (adjustment: AdjustmentName, value: number) => void;
  onOpacity: (opacity: number) => void;
  onFlip: (axis: "horizontal" | "vertical") => void;
  onStraighten: (rotationDeg: number) => void;
  disabled: boolean;
}

/**
 * The controls and the agent read the same ranges and descriptions, so a person and an
 * agent are told the same thing about the same parameter.
 */
export function AdjustmentInspector({
  projectId, layer, renderService, revisionKey, onAdjust, onOpacity, onFlip, onStraighten, disabled,
}: AdjustmentInspectorProps) {
  const [histogram, setHistogram] = useState<{
    warnings: string[]; exposure: string; bins: number[];
    red: number[]; green: number[]; blue: number[];
    revisionId: string; scale: number; ranInWorker: boolean;
  } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "stale" | "unavailable">("loading");
  const [channel, setChannel] = useState<"luminance" | "red" | "green" | "blue">("luminance");

  useEffect(() => {
    let cancelled = false;
    // The previous reading describes an earlier revision, so it is marked stale rather than
    // left on screen as if it still applied.
    setState((current) => (current === "ready" ? "stale" : "loading"));
    void renderService.histogram(projectId, 0.2)
      .then((result) => {
        if (cancelled) return;
        setHistogram({
          warnings: result.warnings, exposure: result.exposure,
          bins: result.luminance.bins, red: result.red.bins, green: result.green.bins, blue: result.blue.bins,
          revisionId: result.revisionId, scale: result.scale, ranInWorker: result.ranInWorker,
        });
        setState("ready");
      })
      .catch(() => { if (!cancelled) { setHistogram(null); setState("unavailable"); } });
    return () => { cancelled = true; };
  }, [projectId, renderService, revisionKey]);

  const bins = histogram
    ? channel === "red" ? histogram.red : channel === "green" ? histogram.green : channel === "blue" ? histogram.blue : histogram.bins
    : [];
  const peak = bins.length ? Math.max(1, ...bins) : 1;

  return (
    <div className="inspector-groups">
      <section>
        <h3>Layer</h3>
        <label className="slider-field">
          <span>Opacity <output>{Math.round(layer.opacity * 100)}%</output></span>
          <input
            type="range" min={0} max={100} step={1} disabled={disabled}
            value={Math.round(layer.opacity * 100)}
            onChange={(event) => onOpacity(Number(event.target.value) / 100)}
          />
        </label>
        <div className="inspector-actions">
          <button className="button button--secondary" type="button" disabled={disabled} onClick={() => onFlip("horizontal")}>Flip horizontal</button>
          <button className="button button--secondary" type="button" disabled={disabled} onClick={() => onFlip("vertical")}>Flip vertical</button>
        </div>
        <label className="slider-field">
          <span>Straighten <output>{layer.transform.rotationDeg}°</output></span>
          <input
            type="range" min={-45} max={45} step={0.5} disabled={disabled}
            value={layer.transform.rotationDeg}
            onChange={(event) => onStraighten(Number(event.target.value))}
          />
        </label>
      </section>

      {/* `inspector-adjustments` is a declared semantic target, so an agent asking to focus
          the colour controls has to find something here. Without it the request resolved to
          nothing and the agent was told it had focused a panel it had not. */}
      <section data-semantic-id="inspector-adjustments" tabIndex={-1} aria-label="Colour adjustments">
        <h3>Colour</h3>
        {(Object.keys(ADJUSTMENT_RANGES) as AdjustmentName[]).map((name) => {
          const range = ADJUSTMENT_RANGES[name];
          const value = layer.adjustments[name];
          return (
            <label key={name} className="slider-field" data-semantic-id={`inspector-${name}`}>
              <span>
                <span className="slider-field__label">
                  {range.label}
                  <FieldHelp subject={range.label} id={`${name}-help`}>{describeAdjustment(name, value)}</FieldHelp>
                </span>
                <output>{value}</output>
              </span>
              <input
                type="range" min={range.min} max={range.max} step={1} disabled={disabled}
                value={value}
                aria-describedby={`${name}-help`}
                onChange={(event) => onAdjust(name, Number(event.target.value))}
              />
            </label>
          );
        })}
      </section>

      <section data-semantic-id="inspector-histogram" tabIndex={-1}>
        <h3>Histogram</h3>
        <div className="chip-row" role="group" aria-label="Histogram channel">
          {(["luminance", "red", "green", "blue"] as const).map((entry) => (
            <button
              key={entry} type="button" className="chip" aria-pressed={channel === entry}
              onClick={() => setChannel(entry)}
            >
              {entry}
            </button>
          ))}
        </div>
        {histogram ? (
          <>
            <div
              className={`histogram${state === "stale" ? " histogram--stale" : ""}`}
              role="img"
              aria-label={`${channel} histogram. ${histogram.exposure}`}
            >
              {bins.map((count, index) => (
                <span key={index} style={{ blockSize: `${Math.round((count / peak) * 100)}%` }} />
              ))}
            </div>
            <p className="field-help">{histogram.exposure}</p>
            <p className="field-help">
              Measured from revision {histogram.revisionId.slice(0, 8)} at {Math.round(histogram.scale * 100)}% scale
              {histogram.ranInWorker ? ", off the interface thread." : " on the interface thread, because this browser has no worker."}
              {state === "stale" ? " Recomputing for the current revision." : ""}
            </p>
            {histogram.warnings.map((warning) => (
              <p key={warning} className="media-alert" role="status">
                <AlertTriangle aria-hidden="true" size={14} />{warning}
              </p>
            ))}
          </>
        ) : state === "loading" ? (
          <p className="field-help">Measuring the current composite…</p>
        ) : (
          <p className="field-help">The histogram needs a readable image source.</p>
        )}
      </section>
    </div>
  );
}
