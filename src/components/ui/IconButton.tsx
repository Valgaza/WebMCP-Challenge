import type { ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import type { SemanticTargetId } from "../../editor/semantic-targets";
import { Tooltip } from "./Tooltip";

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "title"> {
  /** The control's name. Becomes both the accessible name and the tooltip. */
  label: string;
  icon: LucideIcon;
  /** Also published as `aria-keyshortcuts`, so the tooltip and the shortcut cannot disagree. */
  shortcut?: string;
  size?: "sm" | "md";
  pressed?: boolean;
  /** Why the control is unavailable. Replaces `label` in the tooltip while it is off. */
  unavailableReason?: string;
  tooltip?: boolean;
  /**
   * The agent-facing name of this control, and which one the agent is currently pointing at.
   *
   * Typed against the registry rather than left as a string, so a mistyped id is a compile
   * error instead of a target that silently resolves to nothing forever.
   */
  semanticId?: SemanticTargetId;
  agentTarget?: string | null;
}

const ICON_SIZE = { sm: 14, md: 16 } as const;

/**
 * One icon button, so there is one of everything.
 *
 * There were 75 hand-written `.icon-button` call sites drawing their glyphs at eleven
 * different sizes — 11, 12, 13, 14, 15, 16, 17, 18, 19, 24 and 28 — because the size was a
 * prop typed fresh each time rather than a consequence of the button. Here it follows from
 * `size`, so two buttons the same size cannot hold two different glyphs.
 *
 * `unavailableReason` exists because "why is this off" is the question a disabled control
 * always raises and almost never answers. Passing it marks the button `aria-disabled` rather
 * than `disabled`: the control stays focusable and stays hoverable, so the reason can actually
 * reach the person who needs it, and a keyboard user is no longer skipped straight past the
 * thing they were looking for.
 */
export function IconButton({
  label, icon: Icon, shortcut, size = "md", pressed, unavailableReason, tooltip = true,
  semanticId, agentTarget, ...rest
}: IconButtonProps) {
  const unavailable = Boolean(unavailableReason);

  const button = (
    <button
      {...rest}
      type={rest.type ?? "button"}
      className={`icon-button${size === "sm" ? " icon-button--tight" : ""}${rest.className ? ` ${rest.className}` : ""}`}
      aria-label={label}
      aria-keyshortcuts={shortcut ? toKeyshortcuts(shortcut) : rest["aria-keyshortcuts"]}
      aria-pressed={pressed}
      aria-disabled={unavailable || undefined}
      data-semantic-id={semanticId}
      data-agent-target={semanticId && agentTarget === semanticId ? "true" : undefined}
      onClick={unavailable ? undefined : rest.onClick}
    >
      <Icon aria-hidden="true" size={ICON_SIZE[size]} />
    </button>
  );

  if (!tooltip) return button;
  return <Tooltip label={unavailableReason ?? label} shortcut={unavailable ? undefined : shortcut}>{button}</Tooltip>;
}

/** "⌘K" is what a person reads; "Meta+K" is what `aria-keyshortcuts` is defined to carry. */
function toKeyshortcuts(shortcut: string): string {
  return shortcut
    .replace("⌘", "Meta+")
    .replace("⇧", "Shift+")
    .replace("⌥", "Alt+")
    .replace("⌃", "Control+");
}
