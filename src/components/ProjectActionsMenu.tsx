import { BookmarkPlus, Copy, MoreHorizontal, Pencil, Save, Trash2 } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import type { ProjectRecord } from "../domain/project";

interface ProjectActionsMenuProps {
  project: ProjectRecord;
  onRename: (project: ProjectRecord) => void;
  onDuplicate: (project: ProjectRecord) => void;
  onSaveAs?: (project: ProjectRecord) => void;
  onSnapshot?: (project: ProjectRecord) => void;
  onDelete: (project: ProjectRecord) => void;
}

export function ProjectActionsMenu({
  project,
  onRename,
  onDuplicate,
  onSaveAs,
  onSnapshot,
  onDelete,
}: ProjectActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function focusMenuItem(index: number) {
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']");
    if (!items?.length) return;
    items[index < 0 ? items.length - 1 : index]?.focus();
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? []);
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);

    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusMenuItem((currentIndex + 1) % items.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusMenuItem((currentIndex - 1 + items.length) % items.length);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      queueMicrotask(() => triggerRef.current?.focus());
    } else if (event.key === "Home") {
      event.preventDefault();
      focusMenuItem(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusMenuItem(items.length - 1);
    }
  }

  function invoke(action: () => void) {
    setOpen(false);
    triggerRef.current?.focus();
    action();
  }

  return (
    <div
      className="project-actions"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        className="icon-button"
        type="button"
        aria-label={`Project actions for ${project.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            queueMicrotask(() => focusMenuItem(event.key === "ArrowDown" ? 0 : -1));
          }
        }}
      >
        <MoreHorizontal aria-hidden="true" size={18} />
      </button>
      {open ? (
        <div ref={menuRef} className="project-actions__menu" role="menu" onKeyDown={handleMenuKeyDown}>
          <button role="menuitem" type="button" onClick={() => invoke(() => onRename(project))}>
            <Pencil aria-hidden="true" size={15} /> Rename project
          </button>
          <button role="menuitem" type="button" onClick={() => invoke(() => onDuplicate(project))}>
            <Copy aria-hidden="true" size={15} /> Duplicate project
          </button>
          {onSaveAs ? <button role="menuitem" type="button" onClick={() => invoke(() => onSaveAs(project))}><Save aria-hidden="true" size={15} /> Save As</button> : null}
          {onSnapshot ? <button role="menuitem" type="button" onClick={() => invoke(() => onSnapshot(project))}><BookmarkPlus aria-hidden="true" size={15} /> Save snapshot</button> : null}
          <button className="menu-danger" role="menuitem" type="button" onClick={() => invoke(() => onDelete(project))}>
            <Trash2 aria-hidden="true" size={15} /> Delete project
          </button>
        </div>
      ) : null}
    </div>
  );
}
