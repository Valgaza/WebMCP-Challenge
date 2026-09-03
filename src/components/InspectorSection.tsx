import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

interface InspectorSectionProps {
  /** Stable id. Used for `aria-controls` and to reopen a group when focus is requested inside it. */
  id: string;
  title: string;
  /**
   * Set when the wrapped panel's own first heading repeats this title, as most of them do —
   * the titles here are the names the semantic-target registry already uses, so "Masks" would
   * otherwise appear twice in a row. Inventing a synonym to avoid that would just move the
   * problem to the vocabulary.
   */
  dedupeHeading?: boolean;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: ReactNode;
}

/**
 * One collapsible group of the Inspector.
 *
 * The Inspector used to render every panel it had, always, in one column: 32 sections and
 * 9,431px of continuous scroll inside an 810px viewport — 11.6 screens — holding 156 focusable
 * controls. "Guides and snapping" began at 9,192px, so reaching it meant scrolling past
 * everything else, and a keyboard user reached it after roughly 150 presses of Tab. Every
 * section was also an `h3` at the same size, so 32 siblings announced no hierarchy at all: the
 * panel had a heading level but no structure.
 *
 * A group is a real disclosure rather than a styling trick. The body is removed from layout
 * when closed, which is what takes its controls out of the tab order too — hiding it with
 * `visibility` or opacity would have left all 156 of them there. The whole subtree still
 * mounts, so a panel keeps its state and its subscriptions across a collapse and nothing has
 * to re-fetch when the group opens again.
 *
 * Which groups start open is decided by the selection, not stored: with an image layer
 * selected the useful ones are already open, and with nothing selected the document's own
 * facts are. That is the difference between the Inspector answering the question you have and
 * making you find where the answer lives.
 */
export function InspectorSection({ id, title, dedupeHeading, open, onToggle, children }: InspectorSectionProps) {
  const bodyId = `${id}-body`;

  return (
    <section
      className="inspector-section"
      data-inspector-section={id}
      data-open={open ? "true" : "false"}
      data-dedupe-heading={dedupeHeading ? "true" : undefined}
    >
      <h3 className="inspector-section__heading">
        <button
          type="button"
          className="inspector-section__toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => onToggle(!open)}
        >
          <ChevronRight className="inspector-section__chevron" aria-hidden="true" size={14} />
          <span className="inspector-section__title">{title}</span>
        </button>
      </h3>
      <div id={bodyId} className="inspector-section__body">
        {children}
      </div>
    </section>
  );
}
