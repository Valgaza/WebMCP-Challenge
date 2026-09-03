import { useEffect, useRef, useState, type FormEvent } from "react";
import { ModalDialog } from "./ModalDialog";
import { ProjectError } from "../domain/project-error";

interface ProjectNameDialogProps {
  open: boolean;
  mode: "create" | "rename" | "save-as" | "snapshot";
  initialName?: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}

export function ProjectNameDialog({
  open,
  mode,
  initialName = "",
  onClose,
  onSubmit,
}: ProjectNameDialogProps) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setError(null);
      setPending(false);
    }
  }, [initialName, open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      await onSubmit(name);
      onClose();
    } catch (submissionError) {
      const message =
        submissionError instanceof ProjectError
          ? submissionError.message
          : "Unable to save the project. Your entered name is preserved; try again.";
      setError(message);
      queueMicrotask(() => inputRef.current?.focus());
    } finally {
      setPending(false);
    }
  }

  const isCreate = mode === "create";
  const title = isCreate ? "Create a project" : mode === "rename" ? "Rename project" : mode === "save-as" ? "Save project as" : "Save named snapshot";
  const action = isCreate ? "Create project" : mode === "rename" ? "Rename project" : mode === "save-as" ? "Save as new project" : "Save snapshot";
  const fieldLabel = mode === "snapshot" ? "Snapshot name" : "Project name";
  const fieldHelp = mode === "snapshot" ? "Use a clear milestone name you will recognize later." : "Use a clear name you will recognize later.";

  return (
    <ModalDialog
      open={open}
      title={title}
      description={
        isCreate
          ? "A new photo project, with a canvas ready to work on. Everything stays in this browser."
          : mode === "rename"
            ? "The new name is saved in this browser."
            : mode === "save-as"
              ? "This creates a separate project identity from the current revision."
              : "A named snapshot stays inside this project and can be inspected later."
      }
      onClose={onClose}
      initialFocusRef={inputRef}
      footer={
        <>
          <button className="button button--secondary" type="button" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button className="button button--primary" type="submit" form="project-name-form" disabled={pending}>
            {pending ? `${action.replace(/ project$/, "")}…` : action}
          </button>
        </>
      }
    >
      <form id="project-name-form" onSubmit={handleSubmit} noValidate>
        <label className="field-label" htmlFor="project-name">
          {fieldLabel}
        </label>
        <input
          ref={inputRef}
          id="project-name"
          name="projectName"
          className="text-field"
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? "project-name-error" : "project-name-help"}
          autoComplete="off"
          maxLength={120}
        />
        {error ? (
          <p className="field-error" id="project-name-error">
            {error}
          </p>
        ) : (
          <p className="field-help" id="project-name-help">
            {fieldHelp}
          </p>
        )}

      </form>
    </ModalDialog>
  );
}
