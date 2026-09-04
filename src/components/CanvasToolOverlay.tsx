import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { SelectionOutline } from "../application/selection-service";

/**
 * The drag surface for the tools that need one, and the marching ants.
 *
 * Selections and brushes are the two things that cannot be a form: a marquee you type
 * coordinates into is not a marquee, and a brush without a stroke is a fill. Both need the
 * same thing first — a way to turn a pointer position on screen into a position in the
 * document — which is why they share one overlay rather than growing two.
 *
 * That mapping is done by asking the SVG for its own screen matrix and inverting it, rather
 * than by undoing pan, rotation and zoom by hand. The overlay lives inside the element the
 * canvas transform is already on, so re-deriving the transform here would apply it twice —
 * and `getBoundingClientRect` cannot help, because a rotated element's box is its axis-aligned
 * bounds rather than its actual corners. The browser already knows the answer exactly; this
 * asks it.
 */

export type CanvasTool = "marquee_rectangle" | "marquee_ellipse" | "lasso" | "wand" | "brush";

export interface DocumentPoint { x: number; y: number }

import type { BrushKind } from "../domain/brush";

interface CanvasToolOverlayProps {
  tool: CanvasTool;
  documentWidthPx: number;
  documentHeightPx: number;
  zoom: number;
  rotationDeg: number;
  panX: number;
  panY: number;
  /** The traced edge of the live selection, drawn as marching ants. */
  outline: SelectionOutline | null;
  brushSizePx: number;
  /**
   * The colour and kind the stroke will actually be.
   *
   * The preview drew itself in hardcoded white regardless, so painting in any other colour
   * showed a white ghost that then turned into the real stroke on release — and on a pale
   * photograph the ghost was invisible, which is why the stroke looked like it only appeared
   * once the drag was over.
   */
  brushColour: string;
  brushKind: BrushKind;
  /** Called once, on release, with the whole gesture in document coordinates. */
  onGesture: (gesture:
    | { kind: "marquee"; shape: "rectangle" | "ellipse"; x: number; y: number; width: number; height: number }
    | { kind: "lasso"; points: DocumentPoint[] }
    | { kind: "wand"; x: number; y: number }
    | { kind: "stroke"; points: DocumentPoint[] }
  ) => void | Promise<void>;
}

export function CanvasToolOverlay({
  tool, documentWidthPx, documentHeightPx, zoom, rotationDeg, panX, panY, brushColour, brushKind,
  outline, brushSizePx, onGesture,
}: CanvasToolOverlayProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const antsRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ start: DocumentPoint; points: DocumentPoint[] } | null>(null);
  const [preview, setPreview] = useState<{ points: DocumentPoint[] } | null>(null);

  /** Screen to document, using the SVG's own accumulated matrix so rotation is exact. */
  function toDocument(clientX: number, clientY: number): DocumentPoint {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return { x: 0, y: 0 };
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  }

  /*
   * Marching ants, drawn from the traced edge the selection service hands back.
   *
   * The dash offset moves on an interval rather than a rAF loop: the crawl only needs to be
   * seen, not to be smooth at 120Hz, and a rAF loop on a full-resolution photograph competes
   * with the compositor for the same main thread.
   */
  useEffect(() => {
    const canvas = antsRef.current;
    if (!canvas || !outline) return;
    canvas.width = outline.widthPx;
    canvas.height = outline.heightPx;
    const context = canvas.getContext("2d");
    if (!context) return;

    let phase = 0;
    const image = context.createImageData(outline.widthPx, outline.heightPx);
    const draw = () => {
      for (let index = 0; index < outline.edge.length; index += 1) {
        const on = outline.edge[index] !== 0;
        const offset = index * 4;
        // A two-tone dash so the edge reads on both a light and a dark picture.
        const light = ((index % outline.widthPx) + Math.floor(index / outline.widthPx) + phase) % 12 < 6;
        const value = light ? 255 : 0;
        image.data[offset] = value;
        image.data[offset + 1] = value;
        image.data[offset + 2] = value;
        image.data[offset + 3] = on ? 255 : 0;
      }
      context.putImageData(image, 0, 0);
    };
    draw();
    const timer = window.setInterval(() => { phase = (phase + 1) % 12; draw(); }, 120);
    return () => window.clearInterval(timer);
  }, [outline]);

  function begin(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toDocument(event.clientX, event.clientY);
    dragRef.current = { start: point, points: [point] };
    setPreview({ points: [point] });
  }

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const point = toDocument(event.clientX, event.clientY);
    // Freehand gestures keep every sample; a marquee only needs where it started and where
    // the pointer is now, so it does not accumulate thousands of useless points.
    if (tool === "lasso" || tool === "brush") drag.points.push(point);
    else drag.points = [drag.start, point];
    setPreview({ points: [...drag.points] });
  }

  function end(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) { setPreview(null); return; }
    event.currentTarget.releasePointerCapture(event.pointerId);

    const last = drag.points[drag.points.length - 1];
    if (tool === "wand") { setPreview(null); onGesture({ kind: "wand", x: Math.round(drag.start.x), y: Math.round(drag.start.y) }); return; }
    if (tool === "brush") {
      if (drag.points.length < 2) { setPreview(null); return; }
      /*
       * The preview stays up until the committed stroke exists.
       *
       * It used to be cleared on the line above, synchronously, while the commit is a whole
       * revision away — a write to IndexedDB, a new head revision, then a full re-composite.
       * So the stroke belonged to neither surface for as long as that took, and it read as a
       * stroke that only appeared once you let go.
       */
      void Promise.resolve(onGesture({ kind: "stroke", points: drag.points })).finally(() => setPreview(null));
      return;
    }
    setPreview(null);
    if (tool === "lasso") {
      if (drag.points.length < 3) return;
      onGesture({ kind: "lasso", points: drag.points });
      return;
    }
    const x = Math.min(drag.start.x, last.x);
    const y = Math.min(drag.start.y, last.y);
    const width = Math.abs(last.x - drag.start.x);
    const height = Math.abs(last.y - drag.start.y);
    // A click rather than a drag is not a marquee, and should not clear the selection.
    if (width < 2 || height < 2) return;
    onGesture({
      kind: "marquee",
      shape: tool === "marquee_ellipse" ? "ellipse" : "rectangle",
      x, y, width, height,
    });
  }

  const previewShape = () => {
    if (!preview || preview.points.length === 0) return null;
    const first = preview.points[0];
    const last = preview.points[preview.points.length - 1];

    if (tool === "brush" || tool === "lasso") {
      const path = preview.points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" ");
      return (
        <path
          d={path + (tool === "lasso" ? " Z" : "")}
          fill="none"
          stroke={tool === "brush" ? (brushKind === "eraser" ? "rgba(255, 255, 255, 0.5)" : brushColour) : "#ffffff"}
          strokeOpacity={tool === "brush" && brushKind !== "eraser" ? 0.85 : 1}
          strokeWidth={tool === "brush" ? brushSizePx : 1 / zoom}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={
            tool === "brush" && brushKind === "eraser" ? `${8 / zoom} ${5 / zoom}`
            : tool === "lasso" ? `${4 / zoom} ${4 / zoom}`
            : undefined
          }
        />
      );
    }

    const x = Math.min(first.x, last.x);
    const y = Math.min(first.y, last.y);
    const width = Math.abs(last.x - first.x);
    const height = Math.abs(last.y - first.y);
    if (tool === "marquee_ellipse") {
      return (
        <ellipse
          cx={x + width / 2} cy={y + height / 2} rx={width / 2} ry={height / 2}
          fill="none" stroke="#ffffff" strokeWidth={1 / zoom} strokeDasharray={`${4 / zoom} ${4 / zoom}`}
        />
      );
    }
    return (
      <rect
        x={x} y={y} width={width} height={height}
        fill="none" stroke="#ffffff" strokeWidth={1 / zoom} strokeDasharray={`${4 / zoom} ${4 / zoom}`}
      />
    );
  };

  return (
    <div
      ref={hostRef}
      className={`canvas-tool-overlay canvas-tool-overlay--${tool}`}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div className="canvas-tool-overlay__doc">
        {outline ? (
          <canvas ref={antsRef} className="canvas-tool-overlay__ants" aria-hidden="true" />
        ) : null}
        <svg
          ref={svgRef}
          className="canvas-tool-overlay__preview"
          viewBox={`0 0 ${documentWidthPx} ${documentHeightPx}`}
          width={documentWidthPx} height={documentHeightPx}
          aria-hidden="true"
        >
          {previewShape()}
        </svg>
      </div>
    </div>
  );
}
