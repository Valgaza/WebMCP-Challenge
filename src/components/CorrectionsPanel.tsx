import { useEffect, useState } from "react";
import { Grid3X3, RotateCcw } from "lucide-react";
import type { ImageLayer } from "../domain/layer";
import type { FreeTransformPatch } from "../domain/geometry";

/**
 * The corrections that fix how the camera saw a thing rather than how it was lit.
 *
 * Perspective, lens distortion, fringing and vignetting are all stored as settings and
 * applied when the picture is drawn, so none of it is destructive and any of it can be
 * dialled back to zero. They were built, tested and exposed to WebMCP with no control, which
 * meant the most common real complaint about a photograph — "the building is leaning" —
 * could not be fixed by hand.
 *
 * Sliders rather than corner handles for perspective: a slider correction is converted to four
 * corners before it is stored and there is no inverse, so sliders are the form that can be read
 * back honestly. The corner form stays available through WebMCP.
 *
 * Warping is a grid of control points, and a grid needs a grid: a mesh with a slider per point
 * would be forty sliders. So the mesh is shown as a small clickable lattice, and the point you
 * pick is nudged — which is the same gesture as dragging it, in a form that fits a panel.
 */

interface CorrectionsPanelProps {
  layer: ImageLayer;
  disabled: boolean;
  agentTarget?: string | null;
  onPerspective: (sliders: { verticalDeg: number; horizontalDeg: number; rotationDeg: number; scale: number }) => void;
  onLens: (correction: { distortion: number; distortionFine: number; chromaticAberration: number; vignette: number }) => void;
  onClearPerspective: () => void;
  /** Skew and anchor, which the numeric transform in Geometry does not reach. */
  onFreeTransform: (patch: FreeTransformPatch) => void;
  /** Creates or clears the warp mesh, and nudges one of its points. */
  onWarp: (input: { columns?: number; rows?: number; point?: { column: number; row: number; offset: { x: number; y: number } }; clear?: boolean }) => void;
}

const NEUTRAL_PERSPECTIVE = { verticalDeg: 0, horizontalDeg: 0, rotationDeg: 0, scale: 1 };
const NEUTRAL_LENS = { distortion: 0, distortionFine: 0, chromaticAberration: 0, vignette: 0 };

export function CorrectionsPanel({
  layer, disabled, agentTarget, onPerspective, onLens, onClearPerspective,
  onFreeTransform, onWarp,
}: CorrectionsPanelProps) {
  const lens = { ...NEUTRAL_LENS, ...(layer.geometry.lens ?? {}) };

  /*
   * The sliders are held here rather than read back from the layer.
   *
   * A slider correction is converted to four corners before it is stored, and there is no
   * inverse — four arbitrary corners are not always expressible as three angles. So the
   * panel keeps what it last sent, and resets when the selection moves to another layer,
   * which is the honest behaviour: the numbers describe this editing session, and the
   * corners on the layer are the truth.
   */
  const [sliders, setSliders] = useState(NEUTRAL_PERSPECTIVE);
  useEffect(() => { setSliders(NEUTRAL_PERSPECTIVE); }, [layer.id]);

  const [skew, setSkew] = useState({ skewXDeg: 0, skewYDeg: 0 });
  useEffect(() => { setSkew({ skewXDeg: 0, skewYDeg: 0 }); }, [layer.id]);

  /** Which mesh point the nudge buttons move. */
  const [picked, setPicked] = useState<{ column: number; row: number }>({ column: 1, row: 1 });
  const mesh = layer.geometry.warp ?? null;
  const columns = mesh?.columns ?? 3;
  const rows = mesh?.rows ?? 3;

  /**
   * A nudge is relative, but the mesh stores where each point *is*.
   *
   * Offsets are fractions of the layer rather than pixels, so a point keeps its place when the
   * layer is resized. Four percent is a step you can see once and can repeat to go further.
   */
  const NUDGE = 0.04;
  function nudge(deltaX: number, deltaY: number) {
    const current = mesh?.offsets[picked.row * columns + picked.column] ?? { x: 0, y: 0 };
    onWarp({ point: { ...picked, offset: { x: current.x + deltaX, y: current.y + deltaY } } });
  }

  function applyPerspective(next: typeof NEUTRAL_PERSPECTIVE) {
    setSliders(next);
    onPerspective(next);
  }

  const perspectiveFields = [
    { key: "verticalDeg", label: "Vertical lean", min: -60, max: 60, help: "Positive leans the top away, which is the fix for looking up at a building." },
    { key: "horizontalDeg", label: "Horizontal lean", min: -60, max: 60, help: "For a wall photographed from one side." },
    { key: "rotationDeg", label: "Level", min: -45, max: 45, help: "Counter-rotates a camera that was not level." },
  ] as const;

  const lensFields = [
    { key: "distortion", label: "Straighten lines", min: -1, max: 1, help: "Positive corrects a wide lens bowing straight lines outwards." },
    { key: "chromaticAberration", label: "Colour fringing", min: -1, max: 1, help: "Removes the coloured edges a lens leaves at the corners." },
    { key: "vignette", label: "Corner brightness", min: -1, max: 1, help: "Positive brightens darkened corners back up." },
  ] as const;

  return (
    <section
      data-semantic-id="inspector-corrections" tabIndex={-1}
      data-agent-target={agentTarget === "inspector-corrections" ? "true" : undefined}
    >
      <h3>Lens and perspective</h3>

      {perspectiveFields.map((field) => (
        <label key={field.key} className="slider-field">
          <span title={field.help}>{field.label}</span>
          <input
            type="range" min={field.min} max={field.max} step={0.5}
            value={sliders[field.key]}
            disabled={disabled}
            onChange={(event) => applyPerspective({ ...sliders, [field.key]: Number(event.target.value) })}
          />
          <output>{sliders[field.key].toFixed(1)}°</output>
        </label>
      ))}

      <label className="slider-field">
        <span title="Correcting perspective always crops the frame; this scales it back up.">Scale back up</span>
        <input
          type="range" min={0.5} max={2} step={0.01}
          value={sliders.scale}
          disabled={disabled}
          onChange={(event) => applyPerspective({ ...sliders, scale: Number(event.target.value) })}
        />
        <output>{sliders.scale.toFixed(2)}×</output>
      </label>

      {lensFields.map((field) => (
        <label key={field.key} className="slider-field">
          <span title={field.help}>{field.label}</span>
          <input
            type="range" min={field.min} max={field.max} step={0.01}
            value={lens[field.key]}
            disabled={disabled}
            onChange={(event) => onLens({ ...lens, [field.key]: Number(event.target.value) })}
          />
          <output>{lens[field.key].toFixed(2)}</output>
        </label>
      ))}

      <div className="inspector-actions">
        <button
          className="button button--ghost" type="button" disabled={disabled}
          onClick={() => { setSliders(NEUTRAL_PERSPECTIVE); onClearPerspective(); onLens(NEUTRAL_LENS); }}
        >
          <RotateCcw aria-hidden="true" size={14} /> Reset corrections
        </button>
      </div>
      <h3>Slant</h3>
      <label className="slider-field">
        <span title="Pushes the top and bottom in opposite directions, which is how italics work.">Lean sideways</span>
        <input
          type="range" min={-60} max={60} step={0.5}
          value={skew.skewXDeg} disabled={disabled}
          onChange={(event) => {
            const next = { ...skew, skewXDeg: Number(event.target.value) };
            setSkew(next); onFreeTransform(next);
          }}
        />
        <output>{skew.skewXDeg.toFixed(1)}°</output>
      </label>
      <label className="slider-field">
        <span title="The same, vertically.">Lean up or down</span>
        <input
          type="range" min={-60} max={60} step={0.5}
          value={skew.skewYDeg} disabled={disabled}
          onChange={(event) => {
            const next = { ...skew, skewYDeg: Number(event.target.value) };
            setSkew(next); onFreeTransform(next);
          }}
        />
        <output>{skew.skewYDeg.toFixed(1)}°</output>
      </label>

      <h3>Bend it</h3>
      {mesh ? (
        <>
          <p className="field-help">
            Pick a point, then nudge it. The picture bends smoothly between the points rather
            than creasing at them.
          </p>
          <div
            className="warp-grid"
            role="group" aria-label="Warp mesh points"
            style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
          >
            {Array.from({ length: rows }).flatMap((_unusedRow, row) =>
              Array.from({ length: columns }).map((_unusedColumn, column) => (
                <button
                  key={`${column}-${row}`}
                  type="button"
                  className={[
                    "warp-point",
                    picked.column === column && picked.row === row ? "warp-point--on" : "",
                    (mesh?.offsets[row * columns + column]?.x || mesh?.offsets[row * columns + column]?.y) ? "warp-point--moved" : "",
                  ].filter(Boolean).join(" ")}
                  aria-pressed={picked.column === column && picked.row === row}
                  aria-label={`Point ${column + 1} across, ${row + 1} down`}
                  disabled={disabled}
                  onClick={() => setPicked({ column, row })}
                />
              )))}
          </div>
          <div className="inspector-actions">
            {([
              { label: "Left", x: -NUDGE, y: 0 },
              { label: "Right", x: NUDGE, y: 0 },
              { label: "Up", x: 0, y: -NUDGE },
              { label: "Down", x: 0, y: NUDGE },
            ] as const).map((step) => (
              <button
                key={step.label} className="button button--ghost" type="button" disabled={disabled}
                onClick={() => nudge(step.x, step.y)}
              >
                {step.label}
              </button>
            ))}
          </div>
          <div className="inspector-actions">
            <button className="button button--ghost" type="button" disabled={disabled} onClick={() => onWarp({ clear: true })}>
              <RotateCcw aria-hidden="true" size={14} /> Straighten it out
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="field-help">
            A warp bends the picture over a grid, for a label on a bottle or a flag that should
            look like cloth. Nothing bends until you move a point.
          </p>
          <div className="inspector-actions">
            <button
              className="button button--secondary" type="button" disabled={disabled}
              onClick={() => onWarp({ columns: 3, rows: 3 })}
            >
              <Grid3X3 aria-hidden="true" size={15} /> Start a 3 × 3 grid
            </button>
            <button
              className="button button--ghost" type="button" disabled={disabled}
              onClick={() => onWarp({ columns: 5, rows: 5 })}
            >
              Finer, 5 × 5
            </button>
          </div>
        </>
      )}

    </section>
  );
}
