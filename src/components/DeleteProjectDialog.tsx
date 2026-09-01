import { AlertTriangle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ProjectRecord } from "../domain/project";
import { ProjectError } from "../domain/project-error";
import { ModalDialog } from "./ModalDialog";

interface DeleteProjectDialogProps {
  project: ProjectRecord | null;
  onClose: () => void;
  onDelete: (projectId: string) => Promise<void>;
}

export function DeleteProjectDialog({ project, onClose, onDelete }: DeleteProjectDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (project) {
      setPending(false);
      setError(null);
    }
  }, [project]);

  async function handleDelete() {
    if (!project) return;
    setPending(true);
    setError(null);

    try {
      await onDelete(project.id);
      onClose();
    } catch (deletionError) {
      setError(
        deletionError instanceof ProjectError
          ? deletionError.message
          : "Unable to delete this project. The local project is unchanged; try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <ModalDialog
      open={project !== null}
      title={project ? `Delete “${project.name}”?` : "Delete project?"}
      description="This removes the local project record from this browser. This action cannot be undone."
      onClose={onClose}
      initialFocusRef={cancelButtonRef}
      tone="danger"
      footer={
        <>
          <button
            ref={cancelButtonRef}
            className="button button--secondary"
            type="button"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </button>
          <button className="button button--danger" type="button" onClick={handleDelete} disabled={pending}>
            {pending ? "Deleting project…" : "Delete project"}
          </button>
        </>
      }
    >
      <div className="consequence">
        <AlertTriangle aria-hidden="true" size={19} />
        <p>No project data will be uploaded or shared.</p>
      </div>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </ModalDialog>
  );
}
