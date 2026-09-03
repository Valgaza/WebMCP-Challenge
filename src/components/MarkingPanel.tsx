import { useCallback, useEffect, useState } from "react";
import { Heart, Star, Tag, X } from "lucide-react";
import type { CatalogueService } from "../application/catalogue-service";
import { LABELS, type CatalogueEntry } from "../domain/catalogue";

/**
 * Rating, labelling and tagging one photograph.
 *
 * The point of marking is finding: with forty photographs from one afternoon, "the four-star
 * ones" and "the ones tagged portrait" is the only practical way back to anything. The
 * catalogue service does all of it — and goes through the project's own command path, so a
 * rating is undoable and travels with a duplicated project — and none of it had a control.
 *
 * A rating is a number and a label is a colour; both are shown as what they are rather than
 * as a dropdown, because a person scanning a library reads shapes, not words.
 */

interface MarkingPanelProps {
  projectId: string;
  assetId: string;
  catalogueService: CatalogueService;
  revisionKey: string;
  onStatus: (message: string) => void;
  onError: (message: string) => void;
}

export function MarkingPanel({
  projectId, assetId, catalogueService, revisionKey, onStatus, onError,
}: MarkingPanelProps) {
  const [entry, setEntry] = useState<CatalogueEntry | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void catalogueService.entryFor(projectId, assetId)
      .then(setEntry)
      .catch(() => setEntry(null));
  }, [assetId, catalogueService, projectId]);

  useEffect(load, [load, revisionKey]);

  async function mark(patch: { rating?: number; label?: string | null; favourite?: boolean; addTags?: string[]; removeTags?: string[] }) {
    setBusy(true);
    try {
      await catalogueService.mark({
        projectId,
        items: [{ itemType: "asset" as const, itemId: assetId }],
        ...patch,
      } as never);
      load();
      onStatus("Marking saved. It is an ordinary edit, so Undo puts it back.");
    } catch (error) {
      onError(error instanceof Error ? error.message : "That marking could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const rating = entry?.rating ?? 0;
  const tags = entry?.tags ?? [];

  return (
    <div className="marking" data-semantic-id="media-marking">
      <p className="eyebrow">Marking</p>

      <div className="marking__stars" role="group" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star} type="button"
            className={star <= rating ? "marking__star marking__star--on" : "marking__star"}
            aria-label={`${star} star${star === 1 ? "" : "s"}`}
            aria-pressed={star <= rating}
            disabled={busy}
            // Clicking the current rating clears it, which is what everyone tries.
            onClick={() => void mark({ rating: star === rating ? 0 : star })}
          >
            <Star aria-hidden="true" size={15} />
          </button>
        ))}
        <button
          type="button"
          className={entry?.favourite ? "marking__star marking__star--fav" : "marking__star"}
          aria-label="Favourite" aria-pressed={Boolean(entry?.favourite)}
          disabled={busy}
          onClick={() => void mark({ favourite: !entry?.favourite })}
        >
          <Heart aria-hidden="true" size={15} />
        </button>
      </div>

      <div className="marking__labels" role="group" aria-label="Colour label">
        {LABELS.map((label) => (
          <button
            key={label} type="button"
            className={entry?.label === label ? "marking__label marking__label--on" : "marking__label"}
            style={{ background: label }}
            aria-label={label} aria-pressed={entry?.label === label}
            disabled={busy}
            onClick={() => void mark({ label: entry?.label === label ? null : label })}
          />
        ))}
      </div>

      <form
        className="marking__tagform"
        onSubmit={(event) => {
          event.preventDefault();
          const value = tagDraft.trim();
          if (!value) return;
          setTagDraft("");
          void mark({ addTags: [value] });
        }}
      >
        <label className="search-field">
          <span className="sr-only">Add a tag</span>
          <Tag aria-hidden="true" size={14} />
          <input
            type="text" value={tagDraft} placeholder="Add a tag" maxLength={60}
            disabled={busy}
            onChange={(event) => setTagDraft(event.target.value)}
          />
        </label>
      </form>

      {tags.length ? (
        <ul className="marking__tags">
          {tags.map((tag) => (
            <li key={tag}>
              {tag}
              <button
                type="button" aria-label={`Remove the tag ${tag}`} disabled={busy}
                onClick={() => void mark({ removeTags: [tag] })}
              >
                <X aria-hidden="true" size={11} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
