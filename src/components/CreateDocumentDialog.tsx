import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CreatePhotoDocumentInput, DocumentBackground, DocumentOrientation } from "../domain/photo-document";
import { createPhotoDocumentInputSchema, orientationForDimensions } from "../domain/photo-document";
import { ProjectError } from "../domain/project-error";
import { ModalDialog } from "./ModalDialog";

interface CreateDocumentDialogProps {
  open: boolean;
  projectId: string;
  expectedRevisionId: string;
  onClose: () => void;
  onSubmit: (input: CreatePhotoDocumentInput) => Promise<void>;
}

type BackgroundChoice = "transparent" | "white" | "black" | "custom";

export function CreateDocumentDialog({ open, projectId, expectedRevisionId, onClose, onSubmit }: CreateDocumentDialogProps) {
  const [width, setWidth] = useState("1920");
  const [height, setHeight] = useState("1080");
  const [resolution, setResolution] = useState("72");
  const [backgroundChoice, setBackgroundChoice] = useState<BackgroundChoice>("transparent");
  const [customColor, setCustomColor] = useState("#ffffff");
  const [error, setError] = useState<{ message: string; field: string } | null>(null);
  const [pending, setPending] = useState(false);
  const widthRef = useRef<HTMLInputElement>(null);
  const heightRef = useRef<HTMLInputElement>(null);
  const resolutionRef = useRef<HTMLInputElement>(null);
  const backgroundRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPending(false);
  }, [open]);

  const widthNumber = Number(width);
  const heightNumber = Number(height);
  const orientation = Number.isFinite(widthNumber) && Number.isFinite(heightNumber) && widthNumber > 0 && heightNumber > 0
    ? orientationForDimensions(widthNumber, heightNumber)
    : "landscape";

  function chooseOrientation(next: DocumentOrientation) {
    const longer = Math.max(widthNumber || 1920, heightNumber || 1080);
    const shorter = Math.min(widthNumber || 1920, heightNumber || 1080);
    if (next === "landscape") { setWidth(String(longer)); setHeight(String(shorter)); }
    if (next === "portrait") { setWidth(String(shorter)); setHeight(String(longer)); }
    if (next === "square") { setWidth(String(shorter)); setHeight(String(shorter)); }
  }

  function background(): DocumentBackground {
    if (backgroundChoice === "transparent") return { type: "transparent" };
    if (backgroundChoice === "black") return { type: "solid", color: "#000000" };
    if (backgroundChoice === "white") return { type: "solid", color: "#ffffff" };
    return { type: "solid", color: customColor };
  }

  function focusField(path: string) {
    if (path === "widthPx") widthRef.current?.focus();
    else if (path === "heightPx" || path === "orientation") heightRef.current?.focus();
    else if (path === "resolutionPpi") resolutionRef.current?.focus();
    else backgroundRef.current?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const parsed = createPhotoDocumentInputSchema.safeParse({
      projectId,
      expectedRevisionId,
      widthPx: Number(width),
      heightPx: Number(height),
      resolutionPpi: Number(resolution),
      orientation,
      background: background(),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = String(issue?.path[0] ?? "widthPx");
      setError({ message: issue?.message ?? "Check the document settings and try again.", field });
      queueMicrotask(() => focusField(field));
      return;
    }
    setPending(true);
    try {
      await onSubmit(parsed.data);
      onClose();
    } catch (submissionError) {
      const projectError = submissionError instanceof ProjectError ? submissionError : null;
      const field = projectError?.fieldPath?.split(".").at(-1) ?? "widthPx";
      setError({ message: projectError?.message ?? "The image document was not created. Your settings are preserved.", field });
      queueMicrotask(() => focusField(field));
    } finally { setPending(false); }
  }

  const describedBy = (field: string, help: string) => error?.field === field ? "document-create-error" : help;

  return (
    <ModalDialog
      open={open}
      title="Create image document"
      description="Set the canvas geometry. The source remains an empty, editable document until media or layers are added."
      onClose={onClose}
      initialFocusRef={widthRef}
      footer={<>
        <button className="button button--secondary" type="button" onClick={onClose} disabled={pending}>Cancel</button>
        <button className="button button--primary" type="submit" form="create-document-form" disabled={pending}>{pending ? "Creating…" : "Create document"}</button>
      </>}
    >
      <form id="create-document-form" className="document-form" onSubmit={handleSubmit} noValidate>
        <fieldset className="document-form__orientation">
          <legend>Orientation</legend>
          <div className="segmented-control" aria-label="Document orientation">
            {(["landscape", "portrait", "square"] as const).map((item) => (
              <button key={item} className="segmented-control__item" type="button" aria-pressed={orientation === item} onClick={() => chooseOrientation(item)}>{item}</button>
            ))}
          </div>
        </fieldset>
        <div className="document-form__grid">
          <label className="field-label" htmlFor="document-width">Width <span>px</span></label>
          <input ref={widthRef} id="document-width" className="text-field text-field--numeric" type="number" inputMode="numeric" min="1" max="32768" value={width} onChange={(event) => setWidth(event.target.value)} aria-invalid={error?.field === "widthPx" || error?.field === "orientation" ? "true" : undefined} aria-describedby={error?.field === "orientation" ? "document-create-error" : describedBy("widthPx", "document-size-help")} />
          <label className="field-label" htmlFor="document-height">Height <span>px</span></label>
          <input ref={heightRef} id="document-height" className="text-field text-field--numeric" type="number" inputMode="numeric" min="1" max="32768" value={height} onChange={(event) => setHeight(event.target.value)} aria-invalid={error?.field === "heightPx" || error?.field === "orientation" ? "true" : undefined} aria-describedby={error?.field === "orientation" ? "document-create-error" : describedBy("heightPx", "document-size-help")} />
          <label className="field-label" htmlFor="document-resolution">Resolution <span>ppi</span></label>
          <input ref={resolutionRef} id="document-resolution" className="text-field text-field--numeric" type="number" inputMode="decimal" min="1" max="2400" value={resolution} onChange={(event) => setResolution(event.target.value)} aria-invalid={error?.field === "resolutionPpi" ? "true" : undefined} aria-describedby={describedBy("resolutionPpi", "document-resolution-help")} />
          <label className="field-label" htmlFor="document-background">Background</label>
          <select ref={backgroundRef} id="document-background" className="select-field" value={backgroundChoice} onChange={(event) => setBackgroundChoice(event.target.value as BackgroundChoice)} aria-invalid={error?.field === "background" ? "true" : undefined}>
            <option value="transparent">Transparent</option><option value="white">White</option><option value="black">Black</option><option value="custom">Custom color</option>
          </select>
        </div>
        {backgroundChoice === "custom" ? <label className="color-field" htmlFor="document-color">Custom color <input id="document-color" type="color" value={customColor} onChange={(event) => setCustomColor(event.target.value)} /></label> : null}
        <p className="field-help" id="document-size-help">1–32,768 pixels per axis. Orientation follows the entered dimensions.</p>
        <p className="field-help" id="document-resolution-help">Resolution is metadata until image resampling arrives in Phase 4.</p>
        {error ? <p className="field-error" id="document-create-error">{error.message}</p> : null}
      </form>
    </ModalDialog>
  );
}
