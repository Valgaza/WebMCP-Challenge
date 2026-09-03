import { useCallback, useEffect, useState } from "react";
import { BookmarkPlus, History, RotateCcw, Undo2 } from "lucide-react";
import type { ProjectHistorySnapshot } from "../data/project-repository";
import type { ProjectService } from "../application/project-service";
import type { ProjectTransaction } from "../domain/project-history";
import type { SelectiveRevertPlan } from "../domain/project-history";
import type { ProjectPersistenceSnapshot } from "../domain/project-persistence";
import { ProjectError } from "../domain/project-error";

export interface HistoryPanelProps {
  projectId: string;
  history: ProjectHistorySnapshot | null;
  persistence: ProjectPersistenceSnapshot | null;
  service: Pick<ProjectService, "planRevert" | "revertTransaction" | "restoreSnapshot">;
  agentTarget: string | null;
  onCreateSnapshot: () => void;
  onPrepareProposal: () => void;
  onChanged: (summary: string) => void;
  onStatus: (message: string) => void;
  onError: (message: string) => void;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * The state of an entry, or nothing when there is nothing to say.
 *
 * Every entry in a history is applied and recorded — that is what being in the history means —
 * so "Applied" and "Recorded" were badges on almost every row carrying no information, in the
 * same accent colour as the one badge that matters. Six identical "Applied" tags made
 * "Current revision" hard to pick out of its own list. Returning null for the unremarkable
 * states leaves the badge to the four that are genuinely worth reading, and `tone` keeps the
 * accent for "you are here" rather than spending it on "an undo happened".
 */
function stateOf(
  transaction: ProjectTransaction,
  history: ProjectHistorySnapshot,
): { label: string; tone: "current" | "noted" } | null {
  if (transaction.resultingRevisionId === history.headRevision.id) return { label: "Current revision", tone: "current" };
  if (transaction.kind === "undo") return { label: "Undo record", tone: "noted" };
  if (transaction.kind === "redo") return { label: "Redo record", tone: "noted" };
  if (history.project.redoTransactionIds.includes(transaction.id)) return { label: "Undone", tone: "noted" };
  return null;
}

/**
 * The project's record of what happened, and the two ways back: reverting one change, or
 * returning to a named snapshot.
 *
 * Reverting something from the middle of history can be refused, so the panel asks first and
 * shows the answer in place. A caller sees which later changes block a revert, and over which
 * objects, before committing to anything — the same plan the WebMCP `revert_transaction` tool
 * returns, because both go through one service method.
 */
export function HistoryPanel({
  projectId, history, persistence, service, agentTarget,
  onCreateSnapshot, onPrepareProposal, onChanged, onStatus, onError,
}: HistoryPanelProps) {
  const [plans, setPlans] = useState<Record<string, SelectiveRevertPlan>>({});
  const [considering, setConsidering] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A new head revision invalidates every plan, because what blocks a revert has changed.
  useEffect(() => { setPlans({}); setConsidering(null); }, [history?.headRevision.id]);

  const consider = useCallback(async (transactionId: string) => {
    setConsidering(transactionId);
    try {
      const plan = await service.planRevert(projectId, transactionId);
      setPlans((current) => ({ ...current, [transactionId]: plan }));
      if (!plan.safe) onStatus(plan.reason ?? "That change cannot be reverted on its own.");
    } catch (error) {
      onError(error instanceof ProjectError ? error.message : "That change could not be examined.");
      setConsidering(null);
    }
  }, [onError, onStatus, projectId, service]);

  const revert = useCallback(async (transactionId: string) => {
    setBusy(true);
    try {
      const result = await service.revertTransaction(projectId, transactionId, {
        expectedRevisionId: history?.headRevision.id,
      });
      onChanged(result.transaction.summary);
      setConsidering(null);
    } catch (error) {
      onError(error instanceof ProjectError ? error.message : "The revert was not applied.");
    } finally { setBusy(false); }
  }, [history?.headRevision.id, onChanged, onError, projectId, service]);

  const restore = useCallback(async (snapshotId: string, name: string) => {
    setBusy(true);
    try {
      await service.restoreSnapshot(projectId, snapshotId, { expectedRevisionId: history?.headRevision.id });
      onChanged(`Restored the snapshot “${name}”.`);
    } catch (error) {
      onError(error instanceof ProjectError ? error.message : "That snapshot could not be restored.");
    } finally { setBusy(false); }
  }, [history?.headRevision.id, onChanged, onError, projectId, service]);

  const snapshots = (persistence?.snapshots ?? []).filter((entry) => entry.status === "active");
  const entries = history ? [...history.transactions].sort((a, b) => b.sequence - a.sequence) : [];

  return (
    <div
      id="history-tabpanel" role="tabpanel" aria-labelledby="history-tab"
      className="history-panel history-panel--embedded"
      data-semantic-id="panel-history"
      data-agent-target={agentTarget === "panel-history" ? "true" : undefined}
    >
      <div className="panel-heading">
        <h2>History</h2>
        <span>{entries.length}</span>
      </div>

      {snapshots.length ? (
        <section className="history-snapshots" data-semantic-id="history-snapshots" aria-label="Snapshots">
          <h3>Snapshots</h3>
          <ul>
            {snapshots.map((snapshot) => (
              <li key={snapshot.id}>
                <div>
                  <strong>{snapshot.name}</strong>
                  <small>{relativeTime(snapshot.createdAt)}</small>
                </div>
                <button
                  className="button button--ghost" type="button" disabled={busy}
                  aria-label={`Restore the snapshot ${snapshot.name}`}
                  onClick={() => void restore(snapshot.id, snapshot.name)}
                >
                  <History aria-hidden="true" size={14} /> Restore
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ol className="history-list">
        {entries.map((transaction) => {
          const plan = plans[transaction.id];
          const isConsidering = considering === transaction.id;
          const canAsk = transaction.kind === "mutation" && transaction.undoable;
          const state = history ? stateOf(transaction, history) : null;
          return (
            <li key={transaction.id} className="history-entry">
              <div className="history-entry__summary">
                <strong>{transaction.summary}</strong>
                {state ? (
                  <span className={`history-entry__state history-entry__state--${state.tone}`}>{state.label}</span>
                ) : null}
              </div>
              <p>{transaction.actor.displayName} · {relativeTime(transaction.createdAt)}</p>

              {canAsk ? (
                <div className="history-entry__actions">
                  {!plan ? (
                    <button
                      className="button button--ghost" type="button" disabled={busy}
                      aria-label={`Check whether “${transaction.summary}” can be reverted`}
                      onClick={() => void consider(transaction.id)}
                    >
                      <Undo2 aria-hidden="true" size={14} /> Revert…
                    </button>
                  ) : plan.safe ? (
                    <>
                      <button
                        className="button button--secondary" type="button" disabled={busy}
                        onClick={() => void revert(transaction.id)}
                      >
                        <RotateCcw aria-hidden="true" size={14} /> Revert this change
                      </button>
                      <button className="button button--ghost" type="button" disabled={busy}
                        onClick={() => { setPlans((c) => { const next = { ...c }; delete next[transaction.id]; return next; }); setConsidering(null); }}>
                        Cancel
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}

              {plan && !plan.safe ? (
                <div className="history-entry__conflict" role="status">
                  <p className="field-error">{plan.reason}</p>
                  {plan.conflicts.length ? (
                    <ul>
                      {plan.conflicts.slice(0, 4).map((conflict) => (
                        <li key={conflict.transactionId}>{conflict.summary}</li>
                      ))}
                    </ul>
                  ) : null}
                  {snapshots.length ? <p className="field-help">Restoring a snapshot from before this point is the safe way back.</p> : null}
                </div>
              ) : null}

              {isConsidering && !plan ? <p className="field-help">Checking…</p> : null}
            </li>
          );
        })}
      </ol>

      <div className="history-panel__actions">
        <button className="button button--secondary" type="button" onClick={onCreateSnapshot}>
          <BookmarkPlus aria-hidden="true" size={15} /> Snapshot
        </button>
        <button className="button button--ghost" type="button" onClick={onPrepareProposal}>Prepare proposal</button>
      </div>
    </div>
  );
}
