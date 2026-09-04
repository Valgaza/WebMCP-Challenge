import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface SectionEmptyProps {
  icon?: LucideIcon;
  /** What is missing, as a short sentence: "No image layer is selected." */
  title: string;
  /** What to do about it. One sentence, plain. */
  children?: ReactNode;
  /** The action that resolves it, when there is one obvious action. */
  action?: ReactNode;
}

/**
 * What a section says when it has nothing to show.
 *
 * Opening "Crop" with nothing selected produced an empty box: the disclosure animated open
 * onto zero pixels of content, which reads as a broken control rather than an unmet condition.
 * Several groups did this, because the guard for "no layer selected" was `return null` — the
 * panel had an answer and simply declined to give it.
 *
 * Shaped after the empty state Figma uses for an unpopulated panel: name the situation, say
 * what to do, and offer the action when there is one.
 */
export function SectionEmpty({ icon: Icon, title, children, action }: SectionEmptyProps) {
  return (
    <div className="section-empty">
      {Icon ? <Icon aria-hidden="true" size={18} /> : null}
      <p className="section-empty__title">{title}</p>
      {children ? <p className="section-empty__body">{children}</p> : null}
      {action}
    </div>
  );
}
