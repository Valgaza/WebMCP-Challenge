import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { LayerCrop } from "../domain/layer";

interface CropOverlayProps {
  crop: LayerCrop;
  /** Locks the crop to this width÷height while dragging; null leaves it free. */
  ratio: number | null;
  sourceWidthPx: number;
  sourceHeightPx: number;
  onPreview: (crop: LayerCrop) => void;
  onCommit: (crop: LayerCrop) => void;
  onCancel: () => void;
  agentTarget?: string | null;
}

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "move";

const HANDLES: { id: Handle; label: string; style: React.CSSProperties }[] = [
  { id: "nw", label: "top left", style: { insetInlineStart: 0, insetBlockStart: 0 } },
  { id: "n", label: "top", style: { insetInlineStart: "50%", insetBlockStart: 0 } },
  { id: "ne", label: "top right", style: { insetInlineStart: "100%", insetBlockStart: 0 } },
  { id: "e", label: "right", style: { insetInlineStart: "100%", insetBlockStart: "50%" } },
  { id: "se", label: "bottom right", style: { insetInlineStart: "100%", insetBlockStart: "100%" } },
  { id: "s", label: "bottom", style: { insetInlineStart: "50%", insetBlockStart: "100%" } },
  { id: "sw", label: "bottom left", style: { insetInlineStart: 0, insetBlockStart: "100%" } },
  { id: "w", label: "left", style: { insetInlineStart: 0, insetBlockStart: "50%" } },
];

function clamp(value: number, low = 0, high = 1): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * The crop rectangle on the canvas.
 *
 * Dragging previews without committing, so a crop is a decision the user confirms rather
 * than a stream of revisions. Every handle also has a keyboard route, because a one-pixel
 * adjustment is easier typed than dragged.
 */
export function CropOverlay({
  crop, ratio, sourceWidthPx, sourceHeightPx, onPreview, onCommit, onCancel, agentTarget,
}: CropOverlayProps) {
  const [draft, setDraft] = useState<LayerCrop>(crop);
  const dragRef = useRef<{ handle: Handle; startX: number; startY: number; origin: LayerCrop; width: number; height: number } | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setDraft(crop); }, [crop]);

  const applyRatio = useCallback((next: LayerCrop, anchor: Handle): LayerCrop => {
    if (!ratio) return next;
    const pixelWidth = (next.right - next.left) * sourceWidthPx;
    const pixelHeight = (next.bottom - next.top) * sourceHeightPx;
    const targetHeight = pixelWidth / ratio;
    if (Math.abs(targetHeight - pixelHeight) < 0.5) return next;

    const normalizedHeight = targetHeight / sourceHeightPx;
    if (anchor.startsWith("n")) {
      return { ...next, top: clamp(next.bottom - normalizedHeight) };
    }
    return { ...next, bottom: clamp(next.top + normalizedHeight) };
  }, [ratio, sourceHeightPx, sourceWidthPx]);

  function beginDrag(event: ReactPointerEvent<HTMLElement>, handle: Handle) {
    const host = hostRef.current;
    if (!host) return;
    const bounds = host.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      handle, startX: event.clientX, startY: event.clientY,
      origin: draft, width: bounds.width || 1, height: bounds.height || 1,
    };
  }

  function moveDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = (event.clientX - drag.startX) / drag.width;
    const dy = (event.clientY - drag.startY) / drag.height;
    let next = { ...drag.origin };

    if (drag.handle === "move") {
      const width = drag.origin.right - drag.origin.left;
      const height = drag.origin.bottom - drag.origin.top;
      const left = clamp(drag.origin.left + dx, 0, 1 - width);
      const top = clamp(drag.origin.top + dy, 0, 1 - height);
      next = { left, top, right: left + width, bottom: top + height };
    } else {
      if (drag.handle.includes("w")) next.left = clamp(drag.origin.left + dx, 0, drag.origin.right - 0.02);
      if (drag.handle.includes("e")) next.right = clamp(drag.origin.right + dx, drag.origin.left + 0.02, 1);
      if (drag.handle.includes("n")) next.top = clamp(drag.origin.top + dy, 0, drag.origin.bottom - 0.02);
      if (drag.handle.includes("s")) next.bottom = clamp(drag.origin.bottom + dy, drag.origin.top + 0.02, 1);
      next = applyRatio(next, drag.handle);
    }

    setDraft(next);
    onPreview(next);
  }

  function endDrag(event: ReactPointerEvent<HTMLElement>) {
    if (!dragRef.current) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    onCommit(draft);
  }

  function nudge(event: React.KeyboardEvent, handle: Handle) {
    const step = event.shiftKey ? 0.05 : 0.005;
    const horizontal = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const vertical = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    if (!horizontal && !vertical) return;
    event.preventDefault();

    let next = { ...draft };
    if (handle === "move") {
      const width = draft.right - draft.left;
      const height = draft.bottom - draft.top;
      const left = clamp(draft.left + horizontal, 0, 1 - width);
      const top = clamp(draft.top + vertical, 0, 1 - height);
      next = { left, top, right: left + width, bottom: top + height };
    } else {
      if (handle.includes("w")) next.left = clamp(draft.left + horizontal, 0, draft.right - 0.02);
      if (handle.includes("e")) next.right = clamp(draft.right + horizontal, draft.left + 0.02, 1);
      if (handle.includes("n")) next.top = clamp(draft.top + vertical, 0, draft.bottom - 0.02);
      if (handle.includes("s")) next.bottom = clamp(draft.bottom + vertical, draft.top + 0.02, 1);
      next = applyRatio(next, handle);
    }
    setDraft(next);
    onCommit(next);
  }

  const keptWidth = Math.round((draft.right - draft.left) * sourceWidthPx);
  const keptHeight = Math.round((draft.bottom - draft.top) * sourceHeightPx);

  return (
    <div
      ref={hostRef}
      className="crop-overlay"
      data-semantic-id="crop-overlay"
      data-agent-target={agentTarget === "crop-overlay" ? "true" : undefined}
      role="group"
      aria-label={`Crop rectangle, keeping ${keptWidth} by ${keptHeight} pixels`}
      onKeyDown={(event) => { if (event.key === "Escape") onCancel(); }}
    >
      <div className="crop-overlay__shade" aria-hidden="true" style={{ clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${draft.left * 100}% ${draft.top * 100}%, ${draft.left * 100}% ${draft.bottom * 100}%, ${draft.right * 100}% ${draft.bottom * 100}%, ${draft.right * 100}% ${draft.top * 100}%, ${draft.left * 100}% ${draft.top * 100}%)` }} />
      <div
        className="crop-overlay__frame"
        style={{
          insetInlineStart: `${draft.left * 100}%`,
          insetBlockStart: `${draft.top * 100}%`,
          inlineSize: `${(draft.right - draft.left) * 100}%`,
          blockSize: `${(draft.bottom - draft.top) * 100}%`,
        }}
        onPointerDown={(event) => beginDrag(event, "move")}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        role="button"
        tabIndex={0}
        aria-label="Move the crop rectangle"
        onKeyDown={(event) => nudge(event, "move")}
      >
        <span className="crop-overlay__readout">{keptWidth} × {keptHeight}</span>
        {HANDLES.map((handle) => (
          <span
            key={handle.id}
            className={`crop-overlay__handle crop-overlay__handle--${handle.id}`}
            style={handle.style}
            role="slider"
            tabIndex={0}
            aria-label={`Crop ${handle.label} edge`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round((handle.id.includes("w") ? draft.left : handle.id.includes("e") ? draft.right : handle.id.includes("n") ? draft.top : draft.bottom) * 100)}
            onPointerDown={(event) => { event.stopPropagation(); beginDrag(event, handle.id); }}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={(event) => { event.stopPropagation(); nudge(event, handle.id); }}
          />
        ))}
      </div>
      <div className="crop-overlay__actions">
        <button type="button" className="button button--ghost" onClick={onCancel}>Cancel</button>
        <button type="button" className="button button--primary" onClick={() => onCommit(draft)}>Apply crop</button>
      </div>
    </div>
  );
}
