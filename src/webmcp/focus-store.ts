import type { SemanticTargetId } from "../editor/semantic-targets";

export interface FocusRequest {
  id: string;
  projectId: string;
  targetId: SemanticTargetId;
  source: "webmcp" | "command";
  requestedAt: string;
}

type Listener = (request: FocusRequest) => void;

class FocusStore {
  private readonly listeners = new Set<Listener>();

  request(projectId: string, targetId: SemanticTargetId, source: FocusRequest["source"]): FocusRequest {
    const request = { id: crypto.randomUUID(), projectId, targetId, source, requestedAt: new Date().toISOString() };
    this.listeners.forEach((listener) => listener(request));
    return request;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const focusStore = new FocusStore();
