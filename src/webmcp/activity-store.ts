export type ActivityStage = "targeting" | "inspecting" | "validating" | "proposing" | "awaiting_confirmation" | "committing" | "complete" | "failed" | "cancelled";

export interface WebMcpActivity {
  id: string;
  stage: ActivityStage;
  title: string;
  detail: string;
  projectId?: string;
  proposalId?: string;
  transactionId?: string;
  undoProjectId?: string;
}

export interface PendingConfirmation {
  id: string;
  title: string;
  consequence: string;
  projectId: string;
  projectName: string;
  status: "pending" | "confirming";
}

interface ActivityState {
  activity: WebMcpActivity | null;
  confirmation: PendingConfirmation | null;
}

let state: ActivityState = { activity: null, confirmation: null };
const listeners = new Set<() => void>();
const confirmationActions = new Map<string, () => Promise<void>>();

function publish(next: ActivityState) {
  state = next;
  listeners.forEach((listener) => listener());
}

export const webMcpActivityStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): ActivityState { return state; },
  show(activity: WebMcpActivity) { publish({ ...state, activity }); },
  clearActivity() { publish({ ...state, activity: null }); },
  requestConfirmation(
    confirmation: Omit<PendingConfirmation, "status">,
    execute: () => Promise<void>,
  ) {
    confirmationActions.set(confirmation.id, execute);
    publish({
      activity: {
        id: confirmation.id,
        stage: "awaiting_confirmation",
        title: "Waiting for confirmation",
        detail: confirmation.consequence,
        projectId: confirmation.projectId,
      },
      confirmation: { ...confirmation, status: "pending" },
    });
  },
  async confirm() {
    const confirmation = state.confirmation;
    if (!confirmation) return;
    const execute = confirmationActions.get(confirmation.id);
    if (!execute) return;
    publish({ ...state, confirmation: { ...confirmation, status: "confirming" } });
    try {
      await execute();
      confirmationActions.delete(confirmation.id);
      publish({
        confirmation: null,
        activity: {
          id: confirmation.id,
          stage: "complete",
          title: "Project deleted",
          detail: `“${confirmation.projectName}” was deleted from this browser.`,
          projectId: confirmation.projectId,
        },
      });
    } catch (error) {
      publish({
        confirmation: null,
        activity: {
          id: confirmation.id,
          stage: "failed",
          title: "Deletion failed",
          detail: error instanceof Error ? error.message : "The project was preserved. Try again.",
          projectId: confirmation.projectId,
        },
      });
    }
  },
  cancelConfirmation() {
    const confirmation = state.confirmation;
    if (!confirmation) return;
    confirmationActions.delete(confirmation.id);
    publish({
      confirmation: null,
      activity: {
        id: confirmation.id,
        stage: "cancelled",
        title: "Deletion cancelled",
        detail: `“${confirmation.projectName}” remains in this browser.`,
        projectId: confirmation.projectId,
      },
    });
  },
};
