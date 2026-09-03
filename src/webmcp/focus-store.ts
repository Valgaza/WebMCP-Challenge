import type { SemanticTargetId } from "../editor/semantic-targets";

export interface FocusRequest {
  id: string;
  projectId: string;
  targetId: SemanticTargetId;
  source: "webmcp" | "command";
  requestedAt: string;
  /**
   * Whether an editor was mounted to receive this.
   *
   * A focus request with no listener used to return success and then be dropped two seconds
   * later, so an agent that focused the Import control and told the person to use it had no
   * way to know nobody was looking at an editor. Reporting delivery lets the tool say
   * "opened the editor first" instead of claiming something that did not happen.
   */
  delivered: boolean;
}

type Listener = (request: FocusRequest) => void;

/** How long a request stays deliverable to a listener that attaches just after it. */
const PENDING_REQUEST_WINDOW_MS = 2000;

class FocusStore {
  private readonly listeners = new Set<Listener>();
  private pending: { request: FocusRequest; at: number } | null = null;

  request(projectId: string, targetId: SemanticTargetId, source: FocusRequest["source"]): FocusRequest {
    const delivered = this.listeners.size > 0;
    const request = { id: crypto.randomUUID(), projectId, targetId, source, requestedAt: new Date().toISOString(), delivered };
    if (delivered) {
      this.listeners.forEach((listener) => listener(request));
    } else {
      // An agent can call focus_ui while the editor is still mounting. Holding the request
      // briefly means it lands once the target exists instead of being silently dropped.
      this.pending = { request, at: Date.now() };
    }
    return request;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    const pending = this.pending;
    if (pending && Date.now() - pending.at <= PENDING_REQUEST_WINDOW_MS) {
      this.pending = null;
      queueMicrotask(() => listener(pending.request));
    } else if (pending) {
      this.pending = null;
    }
    return () => this.listeners.delete(listener);
  }

  /** Full teardown: drops listeners and any held request so nothing leaks into a new session. */
  reset(): void {
    this.pending = null;
    this.listeners.clear();
  }
}

export const focusStore = new FocusStore();
