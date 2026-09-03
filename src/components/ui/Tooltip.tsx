import type { ReactElement, ReactNode } from "react";

interface TooltipProps {
  /**
   * What the control is. For an icon button this must be the same string as its `aria-label`,
   * so the name a sighted person reads and the name a screen reader announces are one string
   * rather than two that can drift.
   */
  label: ReactNode;
  /** Shown as a `kbd` after the label. Pass the display form, e.g. "V" or "⌘K". */
  shortcut?: string;
  placement?: "block-end" | "block-start" | "inline-end";
  children: ReactElement;
}

/**
 * A label that appears on hover, and on keyboard focus.
 *
 * The interface had 75 icon buttons carrying an `aria-label` and nothing else, so a person
 * using a mouse got no name for any of them — eight unlabelled glyphs sat together in the
 * workspace bar, two of them the same arrow pointing the same way. The names existed; they
 * were just only ever spoken.
 *
 * The bubble is `aria-hidden`. It adds no role and no accessible name, because the control
 * already has one: duplicating it here would make every icon button announce itself twice, and
 * the accessible names are what the test suite asserts against.
 *
 * It is also deliberately a wrapper rather than an attribute on the control. A disabled button
 * fires no pointer events, which is why the fifteen `title` attributes explaining *why*
 * something was disabled had never once been seen; the wrapper still receives the hover.
 *
 * No portal. Agent focus resolves a control to its Inspector group with
 * `element.closest("[data-inspector-section]")`, and a portalled control has no such ancestor.
 */
export function Tooltip({ label, shortcut, placement = "block-end", children }: TooltipProps) {
  return (
    <span className="tooltip-host" data-placement={placement}>
      {children}
      <span className="tooltip" role="presentation" aria-hidden="true">
        {label}
        {shortcut ? <kbd>{shortcut}</kbd> : null}
      </span>
    </span>
  );
}
