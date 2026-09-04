import { useCallback, useEffect, useState } from "react";
import { Download, MessageSquare, Package, Share2, Check } from "lucide-react";
import { SectionEmpty } from "./ui/SectionEmpty";
import type { PackageService } from "../application/package-service";
import type { ReviewService } from "../application/review-service";
import { count } from "../domain/plural";

/**
 * Getting the work to somebody else, and hearing back about it.
 *
 * There is no server behind Estro, so a package is the sync mechanism: a file carried by
 * whatever the person already uses. The exchange for that weaker promise is complete honesty
 * about what a package holds — the estimate names every photograph that will not fit in it,
 * before it is written rather than after.
 *
 * Comments anchor to a revision, so a note written about a version that has since been changed
 * is shown as exactly that rather than silently reattached to work the person never saw.
 */

/**
 * Above this, a package with its photographs inlined stops being a file anyone can send.
 *
 * There is no archive format here — bundling is base64 inside the JSON — so the honest move is
 * to refuse at a size where that becomes absurd and say why, rather than to produce a 400 MB
 * text file that no mail client will take.
 */
const MAX_BUNDLED_BYTES = 64 * 1024 * 1024;

type MediaPolicy = "none" | "used_only" | "everything";

interface SharingPanelProps {
  projectId: string;
  projectName: string;
  packageService: PackageService;
  reviewService: ReviewService;
  selectedLayerId: string | null;
  revisionKey: string;
  agentTarget?: string | null;
  onStatus: (message: string) => void;
  onError: (message: string) => void;
}

const POLICY_LABEL: Record<MediaPolicy, string> = {
  none: "Just the edits — no photographs",
  used_only: "The photographs actually used",
  everything: "Every photograph imported",
};

function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SharingPanel({
  projectId, projectName, packageService, reviewService, selectedLayerId,
  revisionKey, agentTarget, onStatus, onError,
}: SharingPanelProps) {
  const [policy, setPolicy] = useState<MediaPolicy>("used_only");
  const [estimate, setEstimate] = useState<{ byteSize: number; summary: string; missing: number } | null>(null);
  const [comments, setComments] = useState<{ id: string; summary: string; body: string; authorName: string; againstOlderRevision: boolean }[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void reviewService.comments(projectId, { includeResolved: false })
      .then((result) => { setComments(result.comments); setOpenCount(result.open); })
      .catch(() => { setComments([]); setOpenCount(0); });
  }, [reviewService, projectId]);

  useEffect(load, [load, revisionKey]);
  // The estimate describes one policy at one revision; either changing makes it a stale number.
  useEffect(() => { setEstimate(null); }, [policy, revisionKey]);

  async function costIt() {
    setBusy(true);
    try {
      const result = await packageService.estimate({ projectId, mediaPolicy: policy });
      setEstimate({ byteSize: result.byteSize, summary: result.summary, missing: result.missing.length });
    } catch (error) {
      onError(error instanceof Error ? error.message : "That package could not be costed.");
    } finally { setBusy(false); }
  }

  async function writeIt() {
    setBusy(true);
    try {
      const written = await packageService.write({ projectId, mediaPolicy: policy });
      if (written.byteSize > MAX_BUNDLED_BYTES) {
        onError(`That package would be ${readableSize(written.byteSize)}, which is too large to write as one file. Choose “${POLICY_LABEL.none}” to send the edits on their own.`);
        return;
      }

      // Media is inlined as data URLs because there is no archive format here; the project JSON
      // has to arrive as a single file or it is not a package at all.
      const media: Record<string, string> = {};
      for (const [assetId, blob] of written.media) {
        media[assetId] = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
      }

      const file = new Blob([JSON.stringify({ project: JSON.parse(written.project), media })], { type: "application/json" });
      const url = URL.createObjectURL(file);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${projectName.replace(/[^\w\- ]+/g, "").trim() || "project"}.estro.json`;
      anchor.click();
      URL.revokeObjectURL(url);

      onStatus(written.warnings.length
        ? `Wrote the package, ${readableSize(file.size)}. ${written.warnings[0]}`
        : `Wrote the package, ${readableSize(file.size)}, holding every edit and ${written.media.size} photograph(s).`);
    } catch (error) {
      onError(error instanceof Error ? error.message : "That package could not be written.");
    } finally { setBusy(false); }
  }

  async function addComment() {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await reviewService.comment({
        projectId, body: note.trim(),
        anchor: selectedLayerId
          ? { kind: "object", objectType: "layer", objectId: selectedLayerId }
          : { kind: "project" },
      }, { intent: "Leave a note from the Inspector." });
      setNote("");
      onStatus(selectedLayerId ? "Noted against the selected layer." : "Noted against the project.");
      load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "That note could not be saved.");
    } finally { setBusy(false); }
  }

  async function resolveComment(commentId: string) {
    try {
      await reviewService.resolve({ projectId, commentId });
      onStatus("Marked as done.");
      load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "That note could not be resolved.");
    }
  }

  async function recordShare() {
    setBusy(true);
    try {
      const result = await reviewService.share({ projectId, name: `${projectName} — for review` });
      onStatus(result.summary);
      load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "That share could not be recorded.");
    } finally { setBusy(false); }
  }

  return (
    <section
      data-semantic-id="inspector-sharing" tabIndex={-1}
      data-agent-target={agentTarget === "inspector-sharing" ? "true" : undefined}
    >
      <h3>Hand it over</h3>

      <label className="slider-field">
        <span>What goes in the file</span>
        <select
          className="select-field" value={policy} disabled={busy}
          onChange={(event) => setPolicy(event.target.value as MediaPolicy)}
        >
          {(Object.keys(POLICY_LABEL) as MediaPolicy[]).map((key) => (
            <option key={key} value={key}>{POLICY_LABEL[key]}</option>
          ))}
        </select>
      </label>

      <div className="inspector-actions">
        <button className="button button--ghost" type="button" disabled={busy} onClick={() => void costIt()}>
          <Package aria-hidden="true" size={14} /> How big is it?
        </button>
        <button className="button button--secondary" type="button" disabled={busy} onClick={() => void writeIt()}>
          <Download aria-hidden="true" size={15} /> Write the package
        </button>
      </div>

      {estimate ? (
        <div className="plan-reading plan-reading--ok">
          <p className="plan-reading__text">{estimate.summary} About {readableSize(estimate.byteSize)}.</p>
          {estimate.missing > 0 ? (
            <ul className="plan-caveats">
              <li>{count(estimate.missing, "photograph")} cannot be read from this machine and will not be in it.</li>
            </ul>
          ) : null}
        </div>
      ) : (
        <p className="field-help">
          A package is the whole project as one file: every edit, its history, and the
          photographs if you ask for them. There is no server, so this file is how work moves.
        </p>
      )}

      <h3>Notes {openCount ? `— ${openCount} open` : ""}</h3>
      <div className="inspector-actions">
        <button className="button button--ghost" type="button" disabled={busy} onClick={() => void recordShare()}>
          <Share2 aria-hidden="true" size={14} /> Record that this version went out
        </button>
      </div>

      <label className="field-label" htmlFor="review-note">
        {selectedLayerId ? "A note about the selected layer" : "A note about this project"}
      </label>
      <input
        id="review-note" className="text-field" type="text" value={note}
        placeholder="The sky is still too blue" maxLength={4000} disabled={busy}
        onChange={(event) => setNote(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void addComment(); } }}
      />
      <div className="inspector-actions">
        <button className="button button--secondary" type="button" disabled={busy || !note.trim()} onClick={() => void addComment()}>
          <MessageSquare aria-hidden="true" size={15} /> Leave the note
        </button>
      </div>

      {comments.length === 0 ? (
        <SectionEmpty title="Nothing outstanding.">
          A note records the version it was written about.
        </SectionEmpty>
      ) : (
        <ul className="effect-list">
          {comments.map((comment) => (
            <li key={comment.id} className={comment.againstOlderRevision ? "effect-row effect-row--off" : "effect-row"}>
              <div className="effect-row__head">
                <span className="effect-row__title" role="presentation">
                  <strong>{comment.body}</strong>
                  <small>{comment.summary}</small>
                </span>
                <div className="effect-row__actions">
                  <button
                    type="button" className="icon-button icon-button--tight"
                    aria-label="Mark this note as done"
                    onClick={() => void resolveComment(comment.id)}
                  >
                    <Check aria-hidden="true" size={14} />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
