/**
 * Mirrors the approved WebMCP state machine in the product blueprint, including the
 * job-bearing states — queued, running, preview ready — that long work needs.
 *
 * Two properties the blueprint asks for and a single-slot store cannot give:
 *
 * 1. Agent turns are not serial. A model routinely fires several reads alongside one
 *    mutation, and with one slot the last read to resolve erases the mutation's Undo
 *    button before anyone can press it. So this holds a short stack keyed by activity id:
 *    a lifecycle that advances through stages replaces its own entry in place, and an
 *    unrelated activity takes a new slot instead of overwriting.
 *
 * 2. Persistence is for errors and decisions only. Anything that finished on its own
 *    dismisses itself, so a completion notice does not sit over the Inspector for the
 *    rest of the session. Failures and awaiting_confirmation never expire, and the
 *    countdown is held while a pointer or the keyboard is inside the card, so an Undo
 *    button cannot vanish out from under the person reaching for it.
 */
export type ActivityStage =
  | "targeting" | "inspecting" | "validating" | "proposing" | "awaiting_confirmation"
  | "queued" | "running" | "preview_ready"
  | "committing" | "complete" | "failed" | "cancelled";

export interface WebMcpActivity {
  id: string;
  stage: ActivityStage;
  title: string;
  detail: string;
  projectId?: string;
  proposalId?: string;
  transactionId?: string;
  undoProjectId?: string;
  /**
   * What the edit means, for someone who does not know the word for it.
   *
   * Separate from `detail` because it is a different kind of sentence: `detail` says what
   * happened to this project, and this says what the term means in general. Watching an
   * agent work is the best chance a person gets to learn the vocabulary, and it is wasted
   * if the card only says "Set saturation to 30".
   */
  explanation?: string;
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
  /** Newest first. Capped so a long agent session cannot bury the interface. */
  activities: readonly WebMcpActivity[];
  /** The newest activity. Retained so every existing caller and test keeps working. */
  activity: WebMcpActivity | null;
  confirmation: PendingConfirmation | null;
}

/** Four is the most that fits beside the Inspector at the narrowest supported width. */
const MAX_VISIBLE = 4;

const NEVER_EXPIRES: ReadonlySet<ActivityStage> = new Set(["failed", "awaiting_confirmation"]);
const BUSY: ReadonlySet<ActivityStage> = new Set([
  "targeting", "inspecting", "validating", "proposing", "committing", "queued", "running",
]);

/** Long enough to read the summary and reach the Undo button; short enough not to linger. */
const DISMISS_WITH_UNDO_MS = 12_000;
const DISMISS_MS = 6_000;

function dismissDelay(activity: WebMcpActivity): number | null {
  if (NEVER_EXPIRES.has(activity.stage) || BUSY.has(activity.stage)) return null;
  // A proposal is a decision the person has to make, so it waits for them.
  if (activity.proposalId) return null;
  const hasUndo = Boolean(activity.undoProjectId && activity.transactionId);
  return hasUndo ? DISMISS_WITH_UNDO_MS : DISMISS_MS;
}

let state: ActivityState = { activities: [], activity: null, confirmation: null };
const listeners = new Set<() => void>();
const confirmationActions = new Map<string, () => Promise<void>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const held = new Set<string>();

function cancelTimer(id: string) {
  const timer = timers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(id);
  }
}

function scheduleDismissal(activity: WebMcpActivity) {
  cancelTimer(activity.id);
  if (held.has(activity.id)) return;
  const delay = dismissDelay(activity);
  if (delay === null) return;
  timers.set(activity.id, setTimeout(() => {
    timers.delete(activity.id);
    webMcpActivityStore.clearActivity(activity.id);
  }, delay));
}

function commit(activities: readonly WebMcpActivity[], confirmation: PendingConfirmation | null) {
  const visible = activities.slice(0, MAX_VISIBLE);
  // Anything pushed past the cap loses its timer along with its slot.
  for (const dropped of activities.slice(MAX_VISIBLE)) {
    cancelTimer(dropped.id);
    held.delete(dropped.id);
  }
  state = { activities: visible, activity: visible[0] ?? null, confirmation };
  listeners.forEach((listener) => listener());
}

export const webMcpActivityStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): ActivityState { return state; },

  show(activity: WebMcpActivity) {
    const rest = state.activities.filter((entry) => entry.id !== activity.id);
    commit([activity, ...rest], state.confirmation);
    scheduleDismissal(activity);
  },

  /** With no id, clears everything — which is what a route change and the tests want. */
  clearActivity(id?: string) {
    if (id === undefined) {
      state.activities.forEach((entry) => cancelTimer(entry.id));
      held.clear();
      commit([], state.confirmation);
      return;
    }
    cancelTimer(id);
    held.delete(id);
    if (!state.activities.some((entry) => entry.id === id)) return;
    commit(state.activities.filter((entry) => entry.id !== id), state.confirmation);
  },

  /**
   * Holds the countdown while the card has the pointer or the keyboard. Called from the
   * card's own hover and focus handlers, so a slow reader keeps the Undo button.
   */
  holdActivity(id: string) {
    held.add(id);
    cancelTimer(id);
  },
  releaseActivity(id: string) {
    held.delete(id);
    const activity = state.activities.find((entry) => entry.id === id);
    if (activity) scheduleDismissal(activity);
  },

  requestConfirmation(
    confirmation: Omit<PendingConfirmation, "status">,
    execute: () => Promise<void>,
  ) {
    // A second request while one is already waiting used to leave the first closure in the
    // map for the life of the page and silently replace the dialog, so the person answered a
    // question about one project and a different one was queued behind it. The earlier
    // request is cancelled outright and said to be cancelled.
    const outstanding = state.confirmation;
    if (outstanding && outstanding.id !== confirmation.id) {
      confirmationActions.delete(outstanding.id);
      webMcpActivityStore.show({
        id: outstanding.id,
        stage: "cancelled",
        title: "Earlier request cancelled",
        detail: `The request to delete “${outstanding.projectName}” was replaced by a newer one and was not carried out.`,
        projectId: outstanding.projectId,
      });
    }
    confirmationActions.set(confirmation.id, execute);
    this.show({
      id: confirmation.id,
      stage: "awaiting_confirmation",
      title: "Waiting for confirmation",
      detail: confirmation.consequence,
      projectId: confirmation.projectId,
    });
    commit(state.activities, { ...confirmation, status: "pending" });
  },

  async confirm() {
    const confirmation = state.confirmation;
    if (!confirmation) return;
    const execute = confirmationActions.get(confirmation.id);
    if (!execute) return;
    commit(state.activities, { ...confirmation, status: "confirming" });
    try {
      await execute();
      confirmationActions.delete(confirmation.id);
      commit(state.activities, null);
      this.show({
        id: confirmation.id,
        stage: "complete",
        title: "Project deleted",
        detail: `“${confirmation.projectName}” was deleted from this browser.`,
        projectId: confirmation.projectId,
      });
    } catch (error) {
      commit(state.activities, null);
      this.show({
        id: confirmation.id,
        stage: "failed",
        title: "Deletion failed",
        detail: error instanceof Error ? error.message : "The project was preserved. Try again.",
        projectId: confirmation.projectId,
      });
    }
  },

  cancelConfirmation() {
    const confirmation = state.confirmation;
    if (!confirmation) return;
    confirmationActions.delete(confirmation.id);
    commit(state.activities, null);
    webMcpActivityStore.show({
      id: confirmation.id,
      stage: "cancelled",
      title: "Deletion cancelled",
      detail: `“${confirmation.projectName}” remains in this browser.`,
      projectId: confirmation.projectId,
    });
  },
};
