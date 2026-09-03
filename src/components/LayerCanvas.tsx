import { useEffect, useRef, useState } from "react";
import type { ComparisonState, RenderService } from "../application/render-service";
import type { PreviewQuality } from "../media/image-derivatives";

/**
 * How much of the document each quality tier actually composites.
 *
 * A named quality has to mean a real resolution, or the setting is decoration. Draft halves
 * the linear resolution, which is a quarter of the pixels and roughly a quarter of the work.
 */
const QUALITY_SCALE: Record<PreviewQuality, number> = { draft: 0.5, balanced: 0.75, full: 1 };

interface LayerCanvasProps {
  projectId: string;
  renderService: RenderService;
  /** Bumping this re-renders; the parent raises it whenever the revision changes. */
  revisionKey: string;
  widthPx: number;
  heightPx: number;
  soloLayerIds?: string[];
  isolateGroupId?: string | null;
  quality?: PreviewQuality;
  /** When set, the baseline revision is rendered alongside or behind the current one. */
  comparison?: ComparisonState | null;
  /**
   * A display filter, for showing channels on their own.
   *
   * Applied to the element rather than to the pixels, because which channels are shown is a
   * view state and must not become an edit: filtering here keeps it out of the revision, out
   * of Undo, and off the render path entirely.
   */
  displayFilter?: string;
  onWarnings?: (warnings: string[]) => void;
}

/**
 * Paints the composited document.
 *
 * Rendering is a pure function of a revision, so this component only decides *when* to
 * re-render, never what the result should be. A comparison renders an actual earlier
 * revision rather than hiding the current layers, which showed an empty background the
 * document was never in.
 */
export function LayerCanvas({
  projectId, renderService, revisionKey, widthPx, heightPx,
  soloLayerIds, isolateGroupId, comparison, quality = "balanced", displayFilter, onWarnings,
}: LayerCanvasProps) {
  const hostRef = useRef<HTMLCanvasElement>(null);
  const baselineRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"idle" | "rendering" | "failed">("idle");
  const [rendered, setRendered] = useState<{ widthPx: number; heightPx: number } | null>(null);
  const scale = QUALITY_SCALE[quality];

  const comparing = comparison && comparison.mode !== "off" && comparison.available;

  useEffect(() => {
    let cancelled = false;
    setStatus("rendering");

    void (async () => {
      try {
        const result = await renderService.render({ projectId, soloLayerIds, isolateGroupId, scale });
        if (cancelled) return;
        const host = hostRef.current;
        if (!host) return;
        host.width = result.widthPx;
        host.height = result.heightPx;
        const context = host.getContext("2d");
        if (!context) { setStatus("failed"); return; }
        context.clearRect(0, 0, host.width, host.height);
        context.drawImage(result.canvas as CanvasImageSource, 0, 0);

        if (comparing) {
          const baseline = await renderService.render({
            projectId, soloLayerIds, isolateGroupId, scale, revisionId: comparison!.baselineRevisionId,
          });
          if (cancelled) return;
          const target = baselineRef.current;
          if (target) {
            target.width = baseline.widthPx;
            target.height = baseline.heightPx;
            const baselineContext = target.getContext("2d");
            if (baselineContext) {
              baselineContext.clearRect(0, 0, target.width, target.height);
              baselineContext.drawImage(baseline.canvas as CanvasImageSource, 0, 0);
            }
          }
        }

        setRendered({ widthPx: result.widthPx, heightPx: result.heightPx });
        setStatus("idle");
        onWarnings?.(result.warnings);
      } catch {
        if (!cancelled) setStatus("failed");
      }
    })();

    return () => { cancelled = true; };
    // revisionKey already encodes the viewing modes, so they are not separate dependencies.
  }, [projectId, renderService, revisionKey, soloLayerIds, isolateGroupId, comparing, comparison?.baselineRevisionId, scale, onWarnings]);

  const splitPercent = Math.round((comparison?.splitPosition ?? 0.5) * 100);

  return (
    <div className={`layer-canvas-stack${comparing ? ` layer-canvas-stack--${comparison!.mode}` : ""}`}>
      {comparing ? (
        <canvas
          ref={baselineRef}
          className="layer-canvas layer-canvas--baseline"
          width={widthPx}
          height={heightPx}
          aria-label={`Baseline composite from revision ${comparison!.baselineRevisionId.slice(0, 8)}`}
          style={comparison!.mode === "split"
            ? { clipPath: `inset(0 ${100 - splitPercent}% 0 0)` }
            : comparison!.mode === "hold" || comparison!.mode === "toggle"
              ? { opacity: 1 }
              : undefined}
        />
      ) : null}
      <canvas
        ref={hostRef}
        className="layer-canvas"
        width={widthPx}
        height={heightPx}
        aria-label={`Composited image, ${widthPx} by ${heightPx} pixels${scale < 1 ? `, previewed at ${Math.round(scale * 100)}% resolution` : ""}`}
        data-render-state={status}
        style={{
          ...(comparing && comparison!.mode === "split" ? { clipPath: `inset(0 0 0 ${splitPercent}%)` } : {}),
          ...(displayFilter ? { filter: displayFilter } : {}),
        }}
      />
      {scale < 1 && rendered ? (
        <p className="layer-canvas__quality-label" role="status">
          {quality} preview · {rendered.widthPx} × {rendered.heightPx}. Export always uses full resolution.
        </p>
      ) : null}
      {comparing ? (
        <p className="layer-canvas__comparison-label" role="status">
          {comparison!.mode === "split" ? "Split" : comparison!.mode === "side_by_side" ? "Side by side" : "Before"}
          {" · baseline "}{comparison!.baseline.replace("_", " ")}
        </p>
      ) : null}
    </div>
  );
}
