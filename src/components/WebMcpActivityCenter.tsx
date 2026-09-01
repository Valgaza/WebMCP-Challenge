import { AlertTriangle, Check, LoaderCircle, Sparkles, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { projectService } from "../app/services";
import type { ProjectProposal } from "../domain/project-persistence";
import { webMcpActivityStore } from "../webmcp/activity-store";
import { ModalDialog } from "./ModalDialog";

export function WebMcpActivityCenter() {
  const snapshot = useSyncExternalStore(webMcpActivityStore.subscribe, webMcpActivityStore.getSnapshot);
  const [proposal, setProposal] = useState<ProjectProposal | null>(null);
  const [pending, setPending] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const proposalId = snapshot.activity?.proposalId;
    if (!proposalId) {
      setProposal(null);
      return;
    }
    void projectService.getProposal(proposalId).then(setProposal).catch(() => {
      setProposal(null);
      webMcpActivityStore.show({
        id: proposalId,
        stage: "failed",
        title: "Proposal is no longer available",
        detail: "The project was preserved. Inspect the latest revision and prepare a new proposal.",
      });
    });
  }, [snapshot.activity?.proposalId]);

  async function applyProposal() {
    if (!proposal) return;
    setPending(true);
    try {
      const result = await projectService.applyProposal(proposal.id, {
        actor: { type: "user", id: "local-user", displayName: "You" },
        intent: "Apply the reviewed WebMCP proposal.",
      });
      await projectService.waitForAutosave(result.project.id);
      webMcpActivityStore.show({
        id: proposal.id,
        stage: "complete",
        title: result.transaction.summary,
        detail: `Committed as transaction ${result.transaction.id}.`,
        projectId: result.project.id,
        transactionId: result.transaction.id,
        undoProjectId: result.project.id,
      });
      setProposal(null);
    } catch (error) {
      webMcpActivityStore.show({
        id: proposal.id,
        stage: "failed",
        title: "Proposal was not applied",
        detail: error instanceof Error ? error.message : "The project was preserved. Review the latest revision.",
      });
    } finally {
      setPending(false);
    }
  }

  async function rejectProposal() {
    if (!proposal) return;
    setPending(true);
    try {
      await projectService.rejectProposal(proposal.id);
      webMcpActivityStore.show({
        id: proposal.id,
        stage: "cancelled",
        title: "Proposal rejected",
        detail: "No project revision was changed.",
        projectId: proposal.projectId,
      });
      setProposal(null);
    } catch (error) {
      webMcpActivityStore.show({
        id: proposal.id,
        stage: "failed",
        title: "Proposal could not be rejected",
        detail: error instanceof Error ? error.message : "No project revision was changed.",
        projectId: proposal.projectId,
      });
    } finally {
      setPending(false);
    }
  }

  async function undoActivity() {
    const activity = snapshot.activity;
    if (!activity?.undoProjectId || !activity.transactionId) return;
    setPending(true);
    try {
      const result = await projectService.undoTransaction(activity.undoProjectId, activity.transactionId);
      await projectService.waitForAutosave(result.project.id);
      webMcpActivityStore.show({
        id: result.transaction.id,
        stage: "complete",
        title: result.transaction.summary,
        detail: `Restored revision ${result.headRevision.id}.`,
        projectId: result.project.id,
      });
    } catch (error) {
      webMcpActivityStore.show({
        id: activity.id,
        stage: "failed",
        title: "Transaction could not be undone",
        detail: error instanceof Error ? error.message : "The current project revision was preserved.",
        projectId: activity.projectId,
      });
    } finally {
      setPending(false);
    }
  }

  const activity = snapshot.activity;
  const isBusy = activity && ["inspecting", "validating", "committing"].includes(activity.stage);
  const isFailure = activity?.stage === "failed";

  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {activity ? `${activity.title}. ${activity.detail}` : ""}
      </div>
      {activity ? (
        <aside className={`activity-center activity-center--${activity.stage}`} aria-label="WebMCP activity">
          <div className="activity-center__icon" aria-hidden="true">
            {isBusy ? <LoaderCircle className="spin" size={17} /> : isFailure ? <AlertTriangle size={17} /> : activity.stage === "complete" ? <Check size={17} /> : <Sparkles size={17} />}
          </div>
          <div className="activity-center__content">
            <strong>{activity.title}</strong>
            <p>{activity.detail}</p>
            {proposal ? (
              <div className="proposal-review">
                <span>Source revision <code>{proposal.sourceRevisionId}</code></span>
                <ol>
                  {proposal.requestedOperations.map((operation, index) => (
                    <li key={`${operation.type}-${index}`}>{operation.type === "rename_project" ? `Rename project to “${operation.name}”` : `Save snapshot “${operation.name}”`}</li>
                  ))}
                </ol>
                <div className="proposal-review__actions">
                  <button className="button button--ghost" type="button" disabled={pending} onClick={() => void rejectProposal()}>Reject</button>
                  <button className="button button--primary" type="button" disabled={pending} onClick={() => void applyProposal()}>{pending ? "Applying…" : "Apply proposal"}</button>
                </div>
              </div>
            ) : null}
            {activity.undoProjectId && activity.transactionId ? (
              <button className="activity-undo" type="button" disabled={pending} onClick={() => void undoActivity()}>
                <Undo2 aria-hidden="true" size={14} /> Undo this transaction
              </button>
            ) : null}
          </div>
          <button className="icon-button activity-center__close" type="button" aria-label="Dismiss WebMCP activity" onClick={webMcpActivityStore.clearActivity}>
            <X aria-hidden="true" size={15} />
          </button>
        </aside>
      ) : null}

      <ModalDialog
        open={snapshot.confirmation !== null}
        title={snapshot.confirmation?.title ?? "Confirm project deletion"}
        description="WebMCP requested a destructive action. Estro will not continue without your decision."
        tone="danger"
        initialFocusRef={cancelRef}
        onClose={webMcpActivityStore.cancelConfirmation}
        footer={
          <>
            <button ref={cancelRef} className="button button--secondary" type="button" disabled={snapshot.confirmation?.status === "confirming"} onClick={webMcpActivityStore.cancelConfirmation}>Cancel</button>
            <button className="button button--danger" type="button" disabled={snapshot.confirmation?.status === "confirming"} onClick={() => void webMcpActivityStore.confirm()}>
              {snapshot.confirmation?.status === "confirming" ? "Deleting…" : "Delete local project"}
            </button>
          </>
        }
      >
        <p className="confirmation-copy">{snapshot.confirmation?.consequence}</p>
        <dl className="confirmation-facts">
          <div><dt>Data</dt><dd>{snapshot.confirmation?.projectName}</dd></div>
          <div><dt>Destination</dt><dd>This browser only</dd></div>
          <div><dt>Consequence</dt><dd>Permanent deletion</dd></div>
        </dl>
      </ModalDialog>
    </>
  );
}
