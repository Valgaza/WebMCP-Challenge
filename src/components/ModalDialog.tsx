import { X } from "lucide-react";
import { useEffect, useId, useRef, type PropsWithChildren, type ReactNode, type RefObject } from "react";

interface ModalDialogProps extends PropsWithChildren {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  footer: ReactNode;
  tone?: "default" | "danger";
}

export function ModalDialog({
  open,
  title,
  description,
  onClose,
  initialFocusRef,
  footer,
  tone = "default",
  children,
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      queueMicrotask(() => initialFocusRef?.current?.focus());
    } else if (!open && dialog.open) {
      dialog.close();
      queueMicrotask(() => {
        if (returnFocusRef.current?.isConnected) {
          returnFocusRef.current.focus();
        }
        returnFocusRef.current = null;
      });
    }
  }, [initialFocusRef, open]);

  return (
    <dialog
      ref={dialogRef}
      className={`dialog dialog--${tone}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      <div className="dialog__header">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description ? <p id={descriptionId}>{description}</p> : null}
        </div>
        <button className="icon-button" type="button" aria-label="Close dialog" onClick={onClose}>
          <X aria-hidden="true" size={17} />
        </button>
      </div>
      <div className="dialog__body">{children}</div>
      <div className="dialog__footer">{footer}</div>
    </dialog>
  );
}
