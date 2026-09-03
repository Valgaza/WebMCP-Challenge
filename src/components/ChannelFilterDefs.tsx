import type { ChannelView } from "../domain/channel";
import { CHANNEL_OFFSET } from "../domain/channel";

/**
 * Showing the channel view on the canvas without editing the document.
 *
 * Hiding the blue channel is not an edit and must not appear in Undo, so it cannot go through
 * the render path that produces a revision's pixels. It is applied as a display filter on the
 * way to the screen instead — which is both correct and free, because the browser does it on
 * the compositor rather than by re-running the render.
 *
 * A colour matrix is the right tool because that is exactly what this is: a 4×5 matrix that
 * keeps the channels asked for and zeroes the rest. Isolating one draws it in grey by copying
 * that channel into all three outputs — a red channel painted red cannot be judged for
 * contrast, which is the only reason anyone looks at one alone.
 */

const FILTER_ID = "estro-channel-view";

function matrixFor(view: ChannelView): number[] {
  if (view.isolated && view.isolated !== "alpha") {
    const at = CHANNEL_OFFSET[view.isolated];
    const row = [0, 0, 0, 0, 0];
    row[at] = 1;
    return [...row, ...row, ...row, 0, 0, 0, 1, 0];
  }
  if (view.isolated === "alpha") {
    // Opacity as a greyscale picture, drawn fully opaque so it can actually be seen.
    return [0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1];
  }
  const keep = (channel: keyof typeof CHANNEL_OFFSET) => (view.visible.includes(channel) ? 1 : 0);
  return [
    keep("red"), 0, 0, 0, 0,
    0, keep("green"), 0, 0, 0,
    0, 0, keep("blue"), 0, 0,
    0, 0, 0, keep("alpha"), 0,
  ];
}

/** The CSS to put on the canvas, or none when the view is the ordinary one. */
export function channelFilterCss(view: ChannelView): string | undefined {
  const ordinary = !view.isolated && view.visible.length === 4;
  return ordinary ? undefined : `url(#${FILTER_ID})`;
}

export function ChannelFilterDefs({ view }: { view: ChannelView }) {
  if (!channelFilterCss(view)) return null;
  return (
    <svg className="visually-hidden" aria-hidden="true" focusable="false">
      <defs>
        <filter id={FILTER_ID} colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values={matrixFor(view).join(" ")} />
        </filter>
      </defs>
    </svg>
  );
}
