import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { searchEditorCommands, type EditorCommandId } from "../editor/editor-commands";
import { ModalDialog } from "./ModalDialog";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onRun: (commandId: EditorCommandId) => void;
}

export function CommandPalette({ open, onClose, onRun }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchEditorCommands(query), [query]);

  useEffect(() => { if (open) { setQuery(""); setActiveIndex(0); } }, [open]);
  useEffect(() => { if (activeIndex >= results.length) setActiveIndex(Math.max(0, results.length - 1)); }, [activeIndex, results.length]);

  function run(commandId: EditorCommandId) { onRun(commandId); onClose(); }

  return (
    <ModalDialog open={open} title="Search commands" description="Find a command by action, feature, or shortcut." onClose={onClose} initialFocusRef={inputRef} footer={<span className="command-palette__hint">↑↓ choose · Enter run · Esc close</span>}>
      <div className="command-palette">
        <label className="search-field command-palette__search" htmlFor="command-search"><Search aria-hidden="true" size={16} /><span className="sr-only">Search commands</span><input ref={inputRef} id="command-search" type="search" value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => Math.min(results.length - 1, index + 1)); }
          if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(0, index - 1)); }
          if (event.key === "Enter" && results[activeIndex]) { event.preventDefault(); run(results[activeIndex].id); }
        }} aria-controls="command-results" aria-describedby="command-result-count" autoComplete="off" /></label>
        <p className="command-palette__count" id="command-result-count" role="status">{results.length} {results.length === 1 ? "command" : "commands"}</p>
        <ul className="command-palette__results" id="command-results" aria-label="Matching commands">
          {results.map((command, index) => <li key={command.id}><button className="command-result" type="button" data-active={index === activeIndex ? "true" : undefined} onMouseEnter={() => setActiveIndex(index)} onClick={() => run(command.id)}><span><strong>{command.label}</strong><small>{command.category}</small></span>{command.shortcut ? <kbd>{command.shortcut}</kbd> : null}</button></li>)}
        </ul>
        {!results.length ? <p className="command-palette__empty">No matching command. Try “view,” “panel,” “grid,” or “tool.”</p> : null}
      </div>
    </ModalDialog>
  );
}
