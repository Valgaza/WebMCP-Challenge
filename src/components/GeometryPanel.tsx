import { useEffect, useState } from "react";
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical,
  AlignStartHorizontal, AlignStartVertical, Crop, FlipHorizontal, FlipVertical, RotateCcw,
  RotateCw, Scaling,
} from "lucide-react";
import {
  ASPECT_PRESETS, CANVAS_ANCHORS, type AlignEdge, type AlignReference, type CanvasAnchor,
  type ImageLayer,
} from "../domain/layer";
import type { ResampleAlgorithm } from "../workers/worker-protocol";

interface GeometryPanelProps {
  documentWidthPx: number;
  documentHeightPx: number;
  /** Only the layers the user has actually selected; alignment never acts on everything. */
  selectedLayerIds: string[];
  selectedLayer: ImageLayer | null;
  sourceWidthPx: number | null;
  sourceHeightPx: number | null;
  disabled: boolean;
  workerAvailable: boolean;
  onAlign: (edge: AlignEdge, reference: AlignReference, keyLayerId: string | null) => void;
  onDistribute: (axis: "horizontal" | "vertical") => void;
  onTransform: (patch: Partial<ImageLayer["transform"]>) => void;
  onCrop: (crop: ImageLayer["crop"]) => void;
  onCropRatio: (ratio: number | null) => void;
  onFit: (mode: "fit" | "fill" | "actual") => void;
  onResetTransform: () => void;
  onRotateQuarter: (turns: number) => void;
  onFlip: (axis: "horizontal" | "vertical") => void;
  onResize: (
    mode: "canvas" | "image",
    widthPx: number,
    heightPx: number,
    options: { anchor: CanvasAnchor; resampleAlgorithm: ResampleAlgorithm; lockAspect: boolean },
  ) => void;
  agentTarget?: string | null;
}

const ALIGN_ACTIONS: { edge: AlignEdge; label: string; Icon: typeof AlignStartHorizontal }[] = [
  { edge: "left", label: "Align left", Icon: AlignStartVertical },
  { edge: "horizontal-center", label: "Align horizontal centres", Icon: AlignCenterVertical },
  { edge: "right", label: "Align right", Icon: AlignEndVertical },
  { edge: "top", label: "Align top", Icon: AlignStartHorizontal },
  { edge: "vertical-center", label: "Align vertical centres", Icon: AlignCenterHorizontal },
  { edge: "bottom", label: "Align bottom", Icon: AlignEndHorizontal },
];

const RESAMPLE_LABELS: Record<ResampleAlgorithm, string> = {
  lanczos3: "Lanczos 3 — sharpest, slowest",
  bilinear: "Bilinear — smooth and quick",
  nearest: "Nearest neighbour — hard pixels, no blending",
  "browser-smooth": "Browser default — whatever this browser does",
};

/**
 * Geometry for the selected layer and for the document.
 *
 * Every direct-manipulation gesture on the canvas has a numeric twin here, because a drag
 * cannot express "exactly 1920 pixels" and a keyboard cannot express a drag.
 */
export function GeometryPanel({
  documentWidthPx, documentHeightPx, selectedLayerIds, selectedLayer, sourceWidthPx, sourceHeightPx,
  disabled, workerAvailable, onAlign, onDistribute, onTransform, onCrop, onCropRatio, onFit,
  onResetTransform, onRotateQuarter, onFlip, onResize, agentTarget,
}: GeometryPanelProps) {
  const [width, setWidth] = useState(String(documentWidthPx));
  const [height, setHeight] = useState(String(documentHeightPx));
  const [mode, setMode] = useState<"canvas" | "image">("canvas");
  const [anchor, setAnchor] = useState<CanvasAnchor>("center");
  const [algorithm, setAlgorithm] = useState<ResampleAlgorithm>("lanczos3");
  const [lockAspect, setLockAspect] = useState(false);
  const [reference, setReference] = useState<AlignReference>("canvas");

  useEffect(() => {
    setWidth(String(documentWidthPx));
    setHeight(String(documentHeightPx));
  }, [documentWidthPx, documentHeightPx]);

  const parsedWidth = Number(width);
  const parsedHeight = Number(height);
  const valid = Number.isInteger(parsedWidth) && Number.isInteger(parsedHeight)
    && parsedWidth >= 1 && parsedHeight >= 1 && parsedWidth <= 32768 && parsedHeight <= 32768;
  const unchanged = parsedWidth === documentWidthPx && parsedHeight === documentHeightPx;
  const canAlign = selectedLayerIds.length > 0;
  const transform = selectedLayer?.transform ?? null;
  const crop = selectedLayer?.crop ?? null;

  return (
    <>
      <section data-semantic-id="inspector-transform" data-agent-target={agentTarget === "inspector-transform" ? "true" : undefined}>
        <h3>Transform</h3>
        {!selectedLayer ? (
          <p className="field-help">Select an image layer to change its position, size, or rotation.</p>
        ) : (
          <>
            <div className="size-fields">
              <label>
                <span>X</span>
                <input
                  type="number" step={1} value={Math.round(transform!.x)} disabled={disabled}
                  onChange={(event) => onTransform({ x: Number(event.target.value) })}
                />
              </label>
              <label>
                <span>Y</span>
                <input
                  type="number" step={1} value={Math.round(transform!.y)} disabled={disabled}
                  onChange={(event) => onTransform({ y: Number(event.target.value) })}
                />
              </label>
            </div>
            <div className="size-fields">
              <label>
                <span>Scale X %</span>
                <input
                  type="number" min={0.1} max={6400} step={1} value={Math.round(transform!.scaleX * 100)} disabled={disabled}
                  onChange={(event) => {
                    const scaleX = Number(event.target.value) / 100;
                    onTransform(lockAspect ? { scaleX, scaleY: scaleX } : { scaleX });
                  }}
                />
              </label>
              <label>
                <span>Scale Y %</span>
                <input
                  type="number" min={0.1} max={6400} step={1} value={Math.round(transform!.scaleY * 100)} disabled={disabled}
                  onChange={(event) => {
                    const scaleY = Number(event.target.value) / 100;
                    onTransform(lockAspect ? { scaleX: scaleY, scaleY } : { scaleY });
                  }}
                />
              </label>
            </div>
            <label className="checkbox-field">
              <input type="checkbox" checked={lockAspect} onChange={(event) => setLockAspect(event.target.checked)} />
              <span>Keep proportions when scaling</span>
            </label>
            <label className="slider-field">
              <span>Rotation <output>{transform!.rotationDeg.toFixed(1)}°</output></span>
              <input
                type="range" min={-180} max={180} step={0.5} value={transform!.rotationDeg} disabled={disabled}
                onChange={(event) => onTransform({ rotationDeg: Number(event.target.value) })}
              />
            </label>
            <div className="size-fields">
              <label>
                <span>Anchor X</span>
                <input
                  type="number" min={0} max={1} step={0.05} value={transform!.anchorX} disabled={disabled}
                  onChange={(event) => onTransform({ anchorX: Number(event.target.value) })}
                />
              </label>
              <label>
                <span>Anchor Y</span>
                <input
                  type="number" min={0} max={1} step={0.05} value={transform!.anchorY} disabled={disabled}
                  onChange={(event) => onTransform({ anchorY: Number(event.target.value) })}
                />
              </label>
            </div>
            <div className="inspector-actions">
              <button className="button button--secondary" type="button" disabled={disabled} onClick={() => onFit("fit")}>Fit</button>
              <button className="button button--secondary" type="button" disabled={disabled} onClick={() => onFit("fill")}>Fill</button>
              <button className="button button--secondary" type="button" disabled={disabled} onClick={() => onFit("actual")}>Actual size</button>
            </div>
            <div className="inspector-actions">
              <button className="icon-button" type="button" aria-label="Rotate 90° left" disabled={disabled} onClick={() => onRotateQuarter(-1)}>
                <RotateCcw aria-hidden="true" size={16} />
              </button>
              <button className="icon-button" type="button" aria-label="Rotate 90° right" disabled={disabled} onClick={() => onRotateQuarter(1)}>
                <RotateCw aria-hidden="true" size={16} />
              </button>
              <button className="icon-button" type="button" aria-label="Flip horizontally" aria-pressed={transform!.flipX} disabled={disabled} onClick={() => onFlip("horizontal")}>
                <FlipHorizontal aria-hidden="true" size={16} />
              </button>
              <button className="icon-button" type="button" aria-label="Flip vertically" aria-pressed={transform!.flipY} disabled={disabled} onClick={() => onFlip("vertical")}>
                <FlipVertical aria-hidden="true" size={16} />
              </button>
              <button className="button button--ghost" type="button" disabled={disabled} onClick={onResetTransform}>Reset</button>
            </div>
          </>
        )}
      </section>

      {selectedLayer && crop ? (
        <section data-semantic-id="inspector-crop" data-agent-target={agentTarget === "inspector-crop" ? "true" : undefined}>
          <h3>Crop</h3>
          <p className="field-help">
            Crop is stored as a proportion of the source, so it survives a replacement at different pixel dimensions.
            {sourceWidthPx && sourceHeightPx
              ? ` Kept area: ${Math.round((crop.right - crop.left) * sourceWidthPx)} × ${Math.round((crop.bottom - crop.top) * sourceHeightPx)} px.`
              : ""}
          </p>
          <div className="size-fields">
            {(["left", "top", "right", "bottom"] as const).map((edge) => (
              <label key={edge}>
                <span>{edge}</span>
                <input
                  type="number" min={0} max={1} step={0.01} value={Number(crop[edge].toFixed(3))} disabled={disabled}
                  onChange={(event) => onCrop({ ...crop, [edge]: Number(event.target.value) })}
                />
              </label>
            ))}
          </div>
          <div className="chip-row">
            {ASPECT_PRESETS.map((preset) => (
              <button
                key={preset.id} type="button" className="chip" disabled={disabled}
                onClick={() => {
                  if (preset.id === "free" || preset.id === "original") { onCropRatio(null); return; }
                  if (preset.id === "canvas") { onCropRatio(documentWidthPx / documentHeightPx); return; }
                  onCropRatio(preset.ratio);
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <button className="button button--ghost" type="button" disabled={disabled} onClick={() => onCropRatio(null)}>
            <Crop aria-hidden="true" size={15} /> Clear crop
          </button>
        </section>
      ) : null}

      <section data-semantic-id="inspector-align" data-agent-target={agentTarget === "inspector-align" ? "true" : undefined}>
        <h3>Align and distribute</h3>
        <label className="slider-field">
          <span>Align to</span>
          <select value={reference} onChange={(event) => setReference(event.target.value as AlignReference)}>
            <option value="canvas">The canvas</option>
            <option value="selection">The selection's bounds</option>
            <option value="key-layer">The first selected layer</option>
          </select>
        </label>
        <p className="field-help">
          {canAlign
            ? `Acting on ${selectedLayerIds.length} selected layer(s).`
            : "Select one or more image layers to align them."}
        </p>
        <div className="align-grid">
          {ALIGN_ACTIONS.map(({ edge, label, Icon }) => (
            <button
              key={edge} type="button" className="icon-button"
              aria-label={label} title={canAlign ? label : "Select layers first"}
              disabled={disabled || !canAlign}
              onClick={() => onAlign(edge, reference, selectedLayerIds[0] ?? null)}
            >
              <Icon aria-hidden="true" size={16} />
            </button>
          ))}
        </div>
        <div className="inspector-actions">
          <button
            className="button button--secondary" type="button"
            disabled={disabled || selectedLayerIds.length < 3}
            title={selectedLayerIds.length < 3 ? "Distributing needs at least three selected layers" : undefined}
            onClick={() => onDistribute("horizontal")}
          >
            Distribute across
          </button>
          <button
            className="button button--secondary" type="button"
            disabled={disabled || selectedLayerIds.length < 3}
            title={selectedLayerIds.length < 3 ? "Distributing needs at least three selected layers" : undefined}
            onClick={() => onDistribute("vertical")}
          >
            Distribute down
          </button>
        </div>
      </section>

      <section>
        <h3>Document size</h3>
        <div className="size-fields">
          <label>
            <span>Width</span>
            <input type="number" min={1} max={32768} value={width} onChange={(event) => setWidth(event.target.value)} />
          </label>
          <label>
            <span>Height</span>
            <input type="number" min={1} max={32768} value={height} onChange={(event) => setHeight(event.target.value)} />
          </label>
        </div>
        <label className="checkbox-field">
          <input type="checkbox" checked={lockAspect} onChange={(event) => setLockAspect(event.target.checked)} />
          <span>Keep the current aspect ratio</span>
        </label>

        <fieldset className="resize-mode">
          <legend>What should change</legend>
          <label>
            <input type="radio" name="resize-mode" checked={mode === "canvas"} onChange={() => setMode("canvas")} />
            <span>Canvas only — re-frames the document and leaves layers at their current size.</span>
          </label>
          <label>
            <input type="radio" name="resize-mode" checked={mode === "image"} onChange={() => setMode("image")} />
            <span>Image — resamples the document and scales every layer with it.</span>
          </label>
        </fieldset>

        {mode === "canvas" ? (
          <fieldset className="anchor-grid">
            <legend>Anchor content to</legend>
            {CANVAS_ANCHORS.map((candidate) => (
              <label key={candidate}>
                <input
                  type="radio" name="canvas-anchor" checked={anchor === candidate}
                  onChange={() => setAnchor(candidate)}
                />
                <span className="sr-only">{candidate.replace("-", " ")}</span>
                <span aria-hidden="true" className={anchor === candidate ? "anchor-dot anchor-dot--active" : "anchor-dot"} />
              </label>
            ))}
          </fieldset>
        ) : (
          <>
            <label className="slider-field">
              <span>Resampling</span>
              <select value={algorithm} onChange={(event) => setAlgorithm(event.target.value as ResampleAlgorithm)}>
                {(Object.keys(RESAMPLE_LABELS) as ResampleAlgorithm[]).map((option) => (
                  <option key={option} value={option}>{RESAMPLE_LABELS[option]}</option>
                ))}
              </select>
            </label>
            {!workerAvailable && algorithm !== "browser-smooth" ? (
              <p className="field-help">
                This browser has no media worker, so exports fall back to the browser's own scaling filter and say so.
              </p>
            ) : null}
          </>
        )}

        {!valid ? <p className="field-error">Enter whole numbers between 1 and 32,768.</p> : null}
        {valid && !unchanged ? (
          <p className="field-help">
            {mode === "canvas"
              ? `The frame becomes ${parsedWidth} × ${parsedHeight}. Layers keep their size.`
              : `Every layer scales by ${((parsedWidth / documentWidthPx) * 100).toFixed(1)}%. Original files are untouched.`}
          </p>
        ) : null}
        <button
          className="button button--primary" type="button"
          disabled={disabled || !valid || unchanged}
          onClick={() => onResize(mode, parsedWidth, parsedHeight, { anchor, resampleAlgorithm: algorithm, lockAspect })}
        >
          <Scaling aria-hidden="true" size={15} /> Apply size
        </button>
      </section>
    </>
  );
}
