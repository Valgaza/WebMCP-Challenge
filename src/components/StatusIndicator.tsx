import { indicatorFor, type StatusKind } from "../domain/accessibility";

/**
 * A state, shown as a shape and a word before it is shown as a colour.
 *
 * The order matters and is the whole component. A timeline that signals offline media with a
 * red tint is unreadable to a significant fraction of editors, flattened away in forced-colours
 * mode, and gone entirely in a printed screenshot. The glyph survives all three, and the word
 * survives even the glyph not rendering.
 */
export function StatusIndicator({
  kind,
  subject,
  showLabel = true,
}: {
  kind: StatusKind;
  /** What the status is about, for the accessible name. */
  subject?: string;
  /** Hidden only where the surrounding text already says it; never hidden from assistive tech. */
  showLabel?: boolean;
}) {
  const indicator = indicatorFor(kind);
  const accessibleName = subject
    ? `${subject}: ${indicator.label}. ${indicator.meaning}`
    : `${indicator.label}. ${indicator.meaning}`;

  return (
    <span
      className="status-indicator"
      data-status={kind}
      // A live region would be wrong: this is a label, not an announcement, and a timeline of
      // forty of them would talk over everything else.
      role="img"
      aria-label={accessibleName}
      title={accessibleName}
    >
      <span className="status-indicator__glyph" style={{ color: indicator.colour }} aria-hidden="true">
        {indicator.glyph}
      </span>
      {showLabel ? <span className="status-indicator__label">{indicator.label}</span> : null}
    </span>
  );
}
