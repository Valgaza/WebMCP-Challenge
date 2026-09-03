import { Sparkles } from "lucide-react";
import { getRegisteredToolCount } from "../../webmcp/site-tools";
import { Tooltip } from "./Tooltip";

interface WebMcpChipProps {
  available: boolean;
  /** The workspace bar is tighter than the hub's, so the count drops to the tooltip there. */
  compact?: boolean;
  /** Only the workspace registers this as an agent target; the hub and landing pages do not. */
  semanticId?: "activity-island";
}

/**
 * Whether an agent can drive this page, said once.
 *
 * There were two of these — `.webmcp-status` on the landing and hub pages, `.activity-island`
 * in the workspace — differing by a couple of pixels of padding and by the words they used for
 * the same fact: "WebMCP not detected", "Manual controls" and "Manual controls available" were
 * three strings for one state.
 *
 * The gradient border is gone. It was the loudest thing in a bar of quiet controls and the
 * only 999px corner among 6px ones, which made a status read as an advertisement; at 900px
 * wide it also wrapped to two lines and stood 53px tall inside a 52px bar. A dot carries the
 * state, the shape matches its neighbours, and the detail is on hover.
 */
export function WebMcpChip({ available, compact = false, semanticId }: WebMcpChipProps) {
  const count = getRegisteredToolCount();
  const detail = available
    ? `${count} WebMCP tools registered on this page`
    : "No agent is connected. Every control here works by hand.";

  return (
    <Tooltip label={detail}>
      <span
        className="webmcp-chip"
        data-state={available ? "ready" : "manual"}
        data-semantic-id={semanticId}
        role="status"
        aria-label={available ? `WebMCP ready, ${count} tools` : "WebMCP unavailable, manual controls"}
      >
        <Sparkles aria-hidden="true" size={14} />
        <span aria-hidden="true">{available ? "WebMCP" : "Manual"}</span>
        {available && !compact ? <span className="webmcp-chip__count" aria-hidden="true">{count}</span> : null}
      </span>
    </Tooltip>
  );
}
