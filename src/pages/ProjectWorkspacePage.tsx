import { ArrowLeft, BookmarkPlus, Check, CloudOff, Pencil, Redo2, Save, Sparkles, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { projectService } from "../app/services";
import type {
  ProjectAutomationService,
  ProjectHistoryService,
  ProjectLifecycleService,
  ProjectMutationResult,
  ProjectPersistenceService,
} from "../application/project-service";
import { ProjectNameDialog } from "../components/ProjectNameDialog";
import { ModalDialog } from "../components/ModalDialog";
import { TransactionProposalDialog } from "../components/TransactionProposalDialog";
import type { ProjectHistorySnapshot } from "../data/project-repository";
import { ProjectError } from "../domain/project-error";
import type { ProjectTransaction } from "../domain/project-history";
import type { ProjectPersistenceSnapshot, ProjectProposal } from "../domain/project-persistence";
import { webMcpActivityStore } from "../webmcp/activity-store";
import { getWebMcpAvailability } from "../webmcp/model-context";

type ProjectWorkspaceService = ProjectLifecycleService & ProjectHistoryService & Partial<ProjectPersistenceService & ProjectAutomationService>;

export interface ProjectWorkspaceProps { service?: ProjectWorkspaceService; }

function formatTransactionTime(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(timestamp));
}

function transactionState(transaction: ProjectTransaction, history: ProjectHistorySnapshot): string {
  if (transaction.resultingRevisionId === history.headRevision.id) return "Current revision";
  if (transaction.kind === "undo") return "Undo record";
  if (transaction.kind === "redo") return "Redo record";
  if (history.project.redoTransactionIds.includes(transaction.id)) return "Undone";
  if (history.project.undoTransactionIds.includes(transaction.id)) return "Applied";
  return "Recorded";
}

export function ProjectWorkspace({ service = projectService }: ProjectWorkspaceProps) {
  const { projectId } = useParams<{ projectId: string }>();
  const [history, setHistory] = useState<ProjectHistorySnapshot | null>(null);
  const [persistence, setPersistence] = useState<ProjectPersistenceSnapshot | null>(null);
  const [proposal, setProposal] = useState<ProjectProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "draft" | "autosaving" | "failed">("saved");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [nameDialog, setNameDialog] = useState<"rename" | "save-as" | "snapshot" | null>(null);
  const [proposalOpen, setProposalOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const autosaveGeneration = useRef(0);
  const cancelDiscardRef = useRef<HTMLButtonElement>(null);
  const workspaceHeadingRef = useRef<HTMLHeadingElement>(null);
  const hasFocusedRoute = useRef(false);

  const loadWorkspace = useCallback(async () => {
    if (!projectId) return;
    const [nextHistory, nextPersistence] = await Promise.all([
      service.getProjectHistory(projectId),
      service.getProjectPersistence?.(projectId) ?? Promise.resolve(null),
    ]);
    setHistory(nextHistory);
    setPersistence(nextPersistence);
    if (nextPersistence?.hasPendingAutosave) trackAutosave(projectId);
    else setSaveState(nextPersistence?.hasRecoverableDraft ? "draft" : "saved");
  }, [projectId, service]);

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    service.openProject(projectId)
      .then(() => Promise.all([
        service.getProjectHistory(projectId),
        service.getProjectPersistence?.(projectId) ?? Promise.resolve(null),
      ]))
      .then(([nextHistory, nextPersistence]) => {
        if (!active) return;
        setHistory(nextHistory);
        setPersistence(nextPersistence);
        if (nextPersistence?.hasPendingAutosave) trackAutosave(projectId);
        else setSaveState(nextPersistence?.hasRecoverableDraft ? "draft" : "saved");
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof ProjectError ? loadError.message : "This local project is no longer available.");
      });
    return () => {
      active = false;
      autosaveGeneration.current += 1;
    };
  }, [projectId, service]);

  function trackAutosave(targetProjectId: string) {
    if (!service.waitForAutosave) {
      setSaveState("draft");
      return;
    }
    const generation = ++autosaveGeneration.current;
    setSaveState("autosaving");
    void service.waitForAutosave(targetProjectId)
      .then(async () => {
        const nextPersistence = await service.getProjectPersistence?.(targetProjectId);
        if (generation !== autosaveGeneration.current) return;
        if (nextPersistence) setPersistence(nextPersistence);
        setSaveState("saved");
        setStatus("Autosave completed. The current revision is durable.");
      })
      .catch(() => {
        if (generation !== autosaveGeneration.current) return;
        setSaveState("failed");
        setError("Autosave did not complete. Your last durable revision is preserved; use Save to retry.");
      });
  }

  function acceptMutation(result: ProjectMutationResult) {
    setHistory(result);
    setStatus(result.transaction.summary);
    if (projectId) trackAutosave(projectId);
    else setSaveState("draft");
  }

  async function renameProject(name: string) {
    if (!projectId) return;
    acceptMutation(await service.renameProject({ projectId, name }));
  }

  async function submitName(name: string) {
    if (!projectId) return;
    if (nameDialog === "rename") return renameProject(name);
    if (nameDialog === "save-as" && service.saveProjectAs) {
      const copy = await service.saveProjectAs(projectId, name);
      setStatus(`Saved “${copy.name}” as a separate project.`);
      return;
    }
    if (nameDialog === "snapshot" && service.createSnapshot) {
      const result = await service.createSnapshot(projectId, name);
      setHistory(result);
      setPersistence(await service.getProjectPersistence?.(projectId) ?? null);
      setSaveState("saved");
      setStatus(result.transaction.summary);
    }
  }

  async function explicitSave() {
    if (!projectId || !service.saveProject) return;
    autosaveGeneration.current += 1;
    setPendingAction("save");
    try {
      await service.saveProject(projectId);
      setPersistence(await service.getProjectPersistence?.(projectId) ?? null);
      setSaveState("saved");
      setStatus("Saved the current project revision.");
    } catch (saveError) {
      setSaveState("failed");
      setError(saveError instanceof Error ? saveError.message : "Save failed. Your last durable revision is preserved.");
    } finally { setPendingAction(null); }
  }

  async function changeHistory(direction: "undo" | "redo") {
    if (!projectId) return;
    setPendingAction(direction);
    setError(null);
    try {
      const result = direction === "undo" ? await service.undoProject(projectId) : await service.redoProject(projectId);
      acceptMutation(result);
    } catch (historyError) {
      setError(historyError instanceof ProjectError ? historyError.message : `Unable to ${direction} this project change. The current revision is unchanged.`);
      await loadWorkspace().catch(() => undefined);
    } finally { setPendingAction(null); }
  }

  async function recoverDraft() {
    if (!projectId || !service.recoverDraft) return;
    setPendingAction("recover");
    setError(null);
    try {
      await service.recoverDraft(projectId);
      await loadWorkspace();
      setStatus("Recovered the interrupted draft and saved it as the current durable revision.");
    } catch (recoveryError) {
      setError(recoveryError instanceof Error ? recoveryError.message : "Recovery did not complete. The durable revision and draft remain preserved.");
    } finally {
      setPendingAction(null);
    }
  }

  async function openDurable(): Promise<boolean> {
    if (!projectId || !service.restoreDurableRevision) return false;
    setPendingAction("durable");
    setError(null);
    try {
      const result = await service.restoreDurableRevision(projectId);
      setHistory(result);
      setPersistence(await service.getProjectPersistence?.(projectId) ?? null);
      setSaveState("saved");
      setStatus(result.transaction.summary);
      return true;
    } catch (recoveryError) {
      setError(recoveryError instanceof Error ? recoveryError.message : "The durable revision could not be opened. The current project state was preserved.");
      return false;
    } finally {
      setPendingAction(null);
    }
  }

  async function discardDraft() {
    if (!(await openDurable())) return;
    setDiscardOpen(false);
    setStatus("Discarded the recoverable draft. Its immutable revision remains in project history.");
  }

  async function prepareProposal(projectName: string, snapshotName: string) {
    if (!projectId || !service.proposeTransaction) return;
    const nextProposal = await service.proposeTransaction({ projectId, operations: [
      { type: "rename_project", name: projectName },
      { type: "create_snapshot", name: snapshotName },
    ] });
    setProposal(nextProposal);
    setStatus("Proposal prepared. The project has not changed.");
  }

  async function applyProposal() {
    if (!proposal || !service.applyProposal) return;
    setPendingAction("proposal");
    setError(null);
    try {
      const result = await service.applyProposal(proposal.id);
      acceptMutation(result);
      setProposal(null);
      webMcpActivityStore.show({ id: proposal.id, stage: "complete", title: result.transaction.summary, detail: `One transaction committed from revision ${proposal.sourceRevisionId}.`, projectId: result.project.id, transactionId: result.transaction.id, undoProjectId: result.project.id });
    } catch (proposalError) {
      setError(proposalError instanceof Error ? proposalError.message : "The proposal was not applied. The current project revision was preserved.");
    } finally { setPendingAction(null); }
  }

  async function rejectProposal() {
    if (!proposal || !service.rejectProposal) return;
    setPendingAction("proposal-reject");
    setError(null);
    try {
      await service.rejectProposal(proposal.id);
      setProposal(null);
      setStatus("Proposal rejected. No project revision changed.");
    } catch (proposalError) {
      setError(proposalError instanceof Error ? proposalError.message : "The proposal could not be rejected. No project revision changed.");
    } finally {
      setPendingAction(null);
    }
  }

  const project = history?.project ?? null;
  const canUndo = Boolean(project?.undoTransactionIds.length);
  const canRedo = Boolean(project?.redoTransactionIds.length);
  const webMcpReady = getWebMcpAvailability() === "available";
  const saveLabel = saveState === "autosaving" ? "Autosaving…" : saveState === "draft" ? "Recovery available" : saveState === "failed" ? "Save needs attention" : `Revision ${history?.headRevision.sequence ?? 0} saved locally`;

  useEffect(() => {
    if (!project) return;
    document.title = `${project.name} · Estro`;
    if (!hasFocusedRoute.current) {
      hasFocusedRoute.current = true;
      queueMicrotask(() => workspaceHeadingRef.current?.focus());
    }
  }, [project]);

  return (
    <div className="workspace-foundation">
      <a className="skip-link" href="#workspace-main">Skip to project</a>
      <header className="workspace-top-bar">
        <Link className="icon-button" to="/projects" aria-label="Back to projects"><ArrowLeft aria-hidden="true" size={18} /></Link>
        <div className="workspace-identity">
          <h1 ref={workspaceHeadingRef} tabIndex={-1}>{project?.name ?? "Loading project…"}</h1>
          {project ? <span className={`workspace-save workspace-save--${saveState}`}>{saveState === "failed" ? <CloudOff aria-hidden="true" size={13} /> : <Check aria-hidden="true" size={13} />} {saveLabel}</span> : null}
        </div>
        <div className="workspace-save-controls" aria-label="Project save controls">
          <button className="button button--ghost" type="button" disabled={!service.saveProject || pendingAction !== null} onClick={() => void explicitSave()}><Save aria-hidden="true" size={15} /> Save</button>
          <button className="button button--ghost" type="button" disabled={!service.saveProjectAs} onClick={() => setNameDialog("save-as")}>Save As</button>
          <button className="button button--ghost" type="button" disabled={!service.createSnapshot} onClick={() => setNameDialog("snapshot")}><BookmarkPlus aria-hidden="true" size={15} /> Snapshot</button>
        </div>
        <div className="history-controls" aria-label="Project history controls">
          <button className="icon-button" type="button" aria-label="Undo last project change" title="Undo" disabled={!canUndo || pendingAction !== null} onClick={() => void changeHistory("undo")}><Undo2 aria-hidden="true" size={17} /></button>
          <button className="icon-button" type="button" aria-label="Redo last undone project change" title="Redo" disabled={!canRedo || pendingAction !== null} onClick={() => void changeHistory("redo")}><Redo2 aria-hidden="true" size={17} /></button>
        </div>
        <div className="workspace-agent-status"><Sparkles aria-hidden="true" size={15} /> {webMcpReady ? "WebMCP ready · 7 tools" : "Manual controls available"}</div>
      </header>

      <main id="workspace-main" className="workspace-main" tabIndex={-1}>
        {error ? <div className="inline-notice inline-notice--error workspace-error" role="alert"><div><strong>Project history needs attention</strong><p>{error}</p></div></div> : null}

        {persistence?.hasRecoverableDraft ? (
          <section className="recovery-banner" aria-labelledby="recovery-heading">
            <div><p className="eyebrow">Recovery available</p><h2 id="recovery-heading">An interrupted draft was preserved</h2><p>{persistence.durability.recoveryReason} The last durable revision is <code>{persistence.durability.durableRevisionId}</code>.</p></div>
            <div className="recovery-banner__actions">
              <button className="button button--secondary" type="button" disabled={pendingAction !== null} onClick={() => void openDurable()}>Open durable revision</button>
              <button className="button button--ghost" type="button" disabled={pendingAction !== null} onClick={() => setDiscardOpen(true)}>Discard draft</button>
              <button className="button button--primary" type="button" disabled={pendingAction !== null} onClick={() => void recoverDraft()}>Recover draft</button>
            </div>
          </section>
        ) : null}

        {!history && !error ? (
          <div className="foundation-card" aria-busy="true"><p className="eyebrow">Loading project history</p><h1>Opening the latest durable revision…</h1></div>
        ) : history ? (
          <div className="history-workspace">
            <section className="project-state-card" aria-labelledby="project-state-heading">
              <div className="project-state-card__heading">
                <div><p className="eyebrow">Phase 1 · Command foundation</p><h2 id="project-state-heading">Durable, inspectable project state</h2></div>
                <button className="button button--secondary" type="button" onClick={() => setNameDialog("rename")}><Pencil aria-hidden="true" size={15} /> Rename project</button>
              </div>
              <p className="project-state-card__summary">Every edit creates an immutable revision. Save, autosave, snapshots, WebMCP, proposals, and Undo all use the same transaction graph.</p>
              <dl className="revision-facts">
                <div><dt>Current name</dt><dd>{history.project.name}</dd></div>
                <div><dt>Revision</dt><dd>{history.headRevision.sequence}</dd></div>
                <div><dt>Transactions</dt><dd>{history.transactions.length}</dd></div>
                <div><dt>Head revision ID</dt><dd><code>{history.headRevision.id}</code></dd></div>
                <div><dt>Durable revision</dt><dd><code>{persistence?.durability.durableRevisionId ?? history.headRevision.id}</code></dd></div>
                <div><dt>Named snapshots</dt><dd>{persistence?.snapshots.length ?? 0}</dd></div>
              </dl>
              <div className="transaction-callout">
                <div><p className="eyebrow">Atomic proposal</p><h2>Rename and snapshot together</h2><p>Validate both changes without mutation, then apply or reject the complete transaction.</p></div>
                <button className="button button--secondary" type="button" disabled={!service.proposeTransaction} onClick={() => setProposalOpen(true)}>Prepare proposal</button>
              </div>
              {proposal ? (
                <section className="proposal-card" aria-labelledby="proposal-heading">
                  <div><p className="eyebrow">No changes applied</p><h2 id="proposal-heading">Proposal ready</h2><p>{proposal.summary}</p><code>{proposal.sourceRevisionId}</code></div>
                  <ol>{proposal.requestedOperations.map((operation, index) => <li key={`${operation.type}-${index}`}>{operation.type === "rename_project" ? `Rename to “${operation.name}”` : `Save snapshot “${operation.name}”`}</li>)}</ol>
                  <div className="proposal-card__actions"><button className="button button--ghost" type="button" disabled={pendingAction !== null} onClick={() => void rejectProposal()}>{pendingAction === "proposal-reject" ? "Rejecting…" : "Reject"}</button><button className="button button--primary" type="button" disabled={pendingAction !== null} onClick={() => void applyProposal()}>{pendingAction === "proposal" ? "Applying…" : "Apply transaction"}</button></div>
                </section>
              ) : null}
              {persistence?.snapshots.length ? (
                <section className="snapshot-list" aria-labelledby="snapshots-heading"><p className="eyebrow" id="snapshots-heading">Named snapshots</p><ul>{persistence.snapshots.map((snapshot) => <li key={snapshot.id}><strong>{snapshot.name}</strong><code>{snapshot.revisionId}</code></li>)}</ul></section>
              ) : null}
            </section>

            <aside className="history-panel" aria-labelledby="history-heading">
              <div className="history-panel__heading"><div><p className="eyebrow">Provenance</p><h2 id="history-heading">History</h2></div><span>{history.transactions.length}</span></div>
              <ol className="history-list">{[...history.transactions].reverse().map((transaction) => (
                <li key={transaction.id} className="history-entry"><div className="history-entry__summary"><strong>{transaction.summary}</strong><span className="history-entry__state">{transactionState(transaction, history)}</span></div><p>{transaction.actor.displayName} · {formatTransactionTime(transaction.createdAt)}</p><dl><div><dt>Revision</dt><dd>{transaction.sequence}</dd></div><div><dt>Transaction</dt><dd><code>{transaction.id}</code></dd></div></dl></li>
              ))}</ol>
            </aside>
          </div>
        ) : <div className="empty-state"><h1>Project unavailable</h1><p>{error}</p><Link className="button button--primary" to="/projects">Return to projects</Link></div>}
      </main>

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{status}</div>
      <ProjectNameDialog open={nameDialog !== null} mode={nameDialog ?? "rename"} initialName={nameDialog === "rename" ? project?.name ?? "" : nameDialog === "save-as" ? `${project?.name ?? "Project"} copy` : "Milestone"} onClose={() => setNameDialog(null)} onSubmit={submitName} />
      <TransactionProposalDialog open={proposalOpen} currentName={project?.name ?? ""} onClose={() => setProposalOpen(false)} onSubmit={prepareProposal} />
      <ModalDialog
        open={discardOpen}
        title="Discard the recoverable draft?"
        description="Estro will reopen the last durable state. The immutable draft revision remains in History, but it will no longer be offered for recovery."
        tone="danger"
        initialFocusRef={cancelDiscardRef}
        onClose={() => setDiscardOpen(false)}
        footer={
          <>
            <button ref={cancelDiscardRef} className="button button--secondary" type="button" disabled={pendingAction !== null} onClick={() => setDiscardOpen(false)}>Cancel</button>
            <button className="button button--danger" type="button" disabled={pendingAction !== null} onClick={() => void discardDraft()}>{pendingAction === "durable" ? "Discarding…" : "Discard draft"}</button>
          </>
        }
      >
        <p className="confirmation-copy">The last durable revision is preserved. The interrupted draft will not be opened.</p>
      </ModalDialog>
    </div>
  );
}

export function ProjectWorkspacePage() { return <ProjectWorkspace />; }
