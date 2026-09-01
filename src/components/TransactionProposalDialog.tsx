import { useEffect, useRef, useState, type FormEvent } from "react";
import { ProjectError } from "../domain/project-error";
import { ModalDialog } from "./ModalDialog";

interface TransactionProposalDialogProps {
  open: boolean;
  currentName: string;
  onClose: () => void;
  onSubmit: (projectName: string, snapshotName: string) => Promise<void>;
}

export function TransactionProposalDialog({ open, currentName, onClose, onSubmit }: TransactionProposalDialogProps) {
  const [projectName, setProjectName] = useState(currentName);
  const [snapshotName, setSnapshotName] = useState("Before next phase");
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<"project" | "snapshot" | "both">("both");
  const [pending, setPending] = useState(false);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const snapshotInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setProjectName(currentName);
    setSnapshotName("Before next phase");
    setError(null);
    setErrorField("both");
    setPending(false);
  }, [currentName, open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await onSubmit(projectName, snapshotName);
      onClose();
    } catch (submissionError) {
      const fieldPath = submissionError instanceof ProjectError ? submissionError.fieldPath : undefined;
      const nextErrorField = fieldPath?.includes("operations.1")
        ? "snapshot"
        : fieldPath === "operations.name" || fieldPath?.includes("operations.0")
          ? "project"
          : "both";
      setErrorField(nextErrorField);
      setError(submissionError instanceof ProjectError ? submissionError.message : "The proposal could not be prepared. No project revision was changed.");
      queueMicrotask(() => (nextErrorField === "snapshot" ? snapshotInputRef.current : firstInputRef.current)?.focus());
    } finally {
      setPending(false);
    }
  }

  return (
    <ModalDialog
      open={open}
      title="Prepare a transaction"
      description="Estro validates both changes together. Preparing this proposal does not change the project."
      onClose={onClose}
      initialFocusRef={firstInputRef}
      footer={
        <>
          <button className="button button--secondary" type="button" disabled={pending} onClick={onClose}>Cancel</button>
          <button className="button button--primary" type="submit" form="transaction-proposal-form" disabled={pending}>{pending ? "Validating…" : "Prepare proposal"}</button>
        </>
      }
    >
      <form id="transaction-proposal-form" className="field-stack" onSubmit={submit} noValidate>
        <label className="field-label" htmlFor="proposal-project-name">New project name</label>
        <input ref={firstInputRef} id="proposal-project-name" className="text-field" value={projectName} onChange={(event) => setProjectName(event.target.value)} aria-invalid={error && errorField !== "snapshot" ? "true" : undefined} aria-describedby={error && errorField !== "snapshot" ? "proposal-error" : "proposal-help"} />
        <label className="field-label" htmlFor="proposal-snapshot-name">Snapshot name</label>
        <input ref={snapshotInputRef} id="proposal-snapshot-name" className="text-field" value={snapshotName} onChange={(event) => setSnapshotName(event.target.value)} aria-invalid={error && errorField !== "project" ? "true" : undefined} aria-describedby={error && errorField !== "project" ? "proposal-error" : "proposal-help"} />
        <p className="field-help" id="proposal-help">The proposal expires after ten minutes and only applies to the current source revision.</p>
        {error ? <p className="field-error" id="proposal-error">{error}</p> : null}
      </form>
    </ModalDialog>
  );
}
