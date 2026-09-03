import { z } from "zod";
import { ProjectError } from "./project-error";

export const CATALOGUE_SCHEMA_VERSION = 1 as const;

/**
 * How a person finds one shot among four hundred.
 *
 * Five ways of marking media, and they are not redundant. A rating is how good something is; a
 * label is what kind of thing it is; a tag is what is in it; a favourite is what someone is
 * working on right now; a collection is a question rather than a place. Collapsing any two of
 * them into one produces a system where "five stars" and "interview" and "use this one" all
 * live in the same list and none of them can be sorted on.
 */

/**
 * Zero to five, with zero meaning "not rated" rather than "bad".
 *
 * The distinction matters for filtering: "show me everything unrated" is a real request, and a
 * scale where zero was the bottom rating could not answer it.
 */
export const ratingSchema = z.number().int().min(0).max(5);

/**
 * The colour labels, named rather than numbered.
 *
 * Colours mean whatever a person decides they mean, so the names here are the colours
 * themselves — not "approved" or "rejected", which would be Estro deciding a workflow on their
 * behalf and being wrong for most of them.
 */
export const LABELS = ["red", "orange", "yellow", "green", "blue", "purple", "grey"] as const;
export const labelSchema = z.enum(LABELS);
export type Label = z.infer<typeof labelSchema>;

/** Everything a person can mark a piece of media with. */
export const catalogueEntrySchema = z.object({
  schemaVersion: z.literal(CATALOGUE_SCHEMA_VERSION),
  /** Only assets now: subclips and sequences were video ideas and left with the video half. */
  itemType: z.enum(["asset"]),
  itemId: z.string().min(1),
  rating: ratingSchema.default(0),
  label: labelSchema.nullable().default(null),
  favourite: z.boolean().default(false),
  tags: z.array(z.string().trim().min(1).max(60)).max(64).default([]),
  /** A free note, for the thing that is not a tag. */
  note: z.string().max(2000).default(""),
});
export type CatalogueEntry = z.infer<typeof catalogueEntrySchema>;

export function emptyEntry(itemType: CatalogueEntry["itemType"], itemId: string): CatalogueEntry {
  return catalogueEntrySchema.parse({ schemaVersion: CATALOGUE_SCHEMA_VERSION, itemType, itemId });
}

/* -------------------------------- collections -------------------------------- */

/**
 * One condition in a collection.
 *
 * Kept as data rather than as a function so a collection can be stored, shown, edited a field at
 * a time, and explained back to the person who wrote it — none of which is possible once a
 * query has become a closure.
 */
export const collectionRuleSchema = z.discriminatedUnion("field", [
  z.object({
    field: z.literal("rating"),
    comparison: z.enum(["at_least", "at_most", "exactly"]),
    value: ratingSchema,
  }),
  z.object({
    field: z.literal("label"),
    comparison: z.enum(["is", "is_not"]),
    value: labelSchema.nullable(),
  }),
  z.object({ field: z.literal("favourite"), value: z.boolean() }),
  z.object({
    field: z.literal("tag"),
    comparison: z.enum(["has", "lacks"]),
    value: z.string().trim().min(1).max(60),
  }),
  z.object({
    field: z.literal("name"),
    comparison: z.enum(["contains", "starts_with", "excludes"]),
    value: z.string().trim().min(1).max(120),
  }),
  z.object({
    field: z.literal("kind"),
    comparison: z.enum(["is", "is_not"]),
    value: z.enum(["video", "audio", "image", "unknown"]),
  }),
  z.object({
    field: z.literal("duration"),
    comparison: z.enum(["at_least", "at_most"]),
    /** In seconds. Media with no duration never matches, rather than matching as zero. */
    value: z.number().min(0).max(86_400),
  }),
  z.object({
    field: z.literal("used"),
    /** True for media a sequence uses; false for media nothing uses. */
    value: z.boolean(),
  }),
]);
export type CollectionRule = z.infer<typeof collectionRuleSchema>;

/**
 * A saved question.
 *
 * A collection is not a folder: nothing is moved into it, and a shot that stops matching leaves
 * on its own. That is the difference worth having — a bin says where something is filed, a
 * collection says what is true about it, and an editor needs both.
 */
export const collectionSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(CATALOGUE_SCHEMA_VERSION),
  name: z.string().trim().min(1).max(80),
  /** All means every rule has to hold; any means one is enough. */
  match: z.enum(["all", "any"]).default("all"),
  rules: z.array(collectionRuleSchema).min(1).max(16),
  createdAt: z.string().datetime(),
});
export type Collection = z.infer<typeof collectionSchema>;

export const MAX_COLLECTIONS_PER_PROJECT = 100;

/** What a rule is asked about. */
export interface CatalogueSubject {
  itemType: CatalogueEntry["itemType"];
  itemId: string;
  name: string;
  kind: "video" | "audio" | "image" | "unknown";
  durationSeconds: number | null;
  /** Whether any sequence uses it. */
  used: boolean;
  entry: CatalogueEntry;
}

/** Whether one rule holds for one subject. */
export function ruleMatches(rule: CollectionRule, subject: CatalogueSubject): boolean {
  const entry = subject.entry;
  switch (rule.field) {
    case "rating":
      return rule.comparison === "at_least" ? entry.rating >= rule.value
        : rule.comparison === "at_most" ? entry.rating <= rule.value
          : entry.rating === rule.value;
    case "label":
      return rule.comparison === "is" ? entry.label === rule.value : entry.label !== rule.value;
    case "favourite":
      return entry.favourite === rule.value;
    case "tag": {
      // Case-insensitive, because nobody types tags consistently and a collection that missed
      // "Interview" while matching "interview" would look broken.
      const wanted = rule.value.toLowerCase();
      const has = entry.tags.some((tag) => tag.toLowerCase() === wanted);
      return rule.comparison === "has" ? has : !has;
    }
    case "name": {
      const name = subject.name.toLowerCase();
      const value = rule.value.toLowerCase();
      return rule.comparison === "contains" ? name.includes(value)
        : rule.comparison === "starts_with" ? name.startsWith(value)
          : !name.includes(value);
    }
    case "kind":
      return rule.comparison === "is" ? subject.kind === rule.value : subject.kind !== rule.value;
    case "duration":
      // Media with no duration never matches a duration rule, rather than being treated as
      // zero seconds long — a still is not "shorter than five seconds", it has no length.
      if (subject.durationSeconds === null) return false;
      return rule.comparison === "at_least"
        ? subject.durationSeconds >= rule.value
        : subject.durationSeconds <= rule.value;
    case "used":
      return subject.used === rule.value;
  }
}

export function collectionMatches(collection: Collection, subject: CatalogueSubject): boolean {
  return collection.match === "all"
    ? collection.rules.every((rule) => ruleMatches(rule, subject))
    : collection.rules.some((rule) => ruleMatches(rule, subject));
}

export function runCollection(
  collection: Collection,
  subjects: readonly CatalogueSubject[],
): CatalogueSubject[] {
  return subjects.filter((subject) => collectionMatches(collection, subject));
}

/* ---------------------------------- sorting ---------------------------------- */

export const SORT_FIELDS = ["name", "rating", "duration", "kind", "label"] as const;
export type SortField = typeof SORT_FIELDS[number];

/**
 * Orders media for a list.
 *
 * Unrated media sorts last when sorting by rating descending, not first: "best first" should not
 * open with everything nobody has looked at yet.
 */
export function sortSubjects(
  subjects: readonly CatalogueSubject[],
  field: SortField,
  direction: "ascending" | "descending" = "ascending",
): CatalogueSubject[] {
  const sign = direction === "ascending" ? 1 : -1;
  const ordered = [...subjects].sort((a, b) => {
    switch (field) {
      case "rating": {
        if (direction === "descending") {
          // Unrated is not "worst", it is "unknown", so it goes to the end either way.
          if (a.entry.rating === 0 && b.entry.rating !== 0) return 1;
          if (b.entry.rating === 0 && a.entry.rating !== 0) return -1;
        }
        return (a.entry.rating - b.entry.rating) * sign;
      }
      case "duration": {
        // The same argument: no duration is not zero duration.
        if (a.durationSeconds === null && b.durationSeconds === null) return 0;
        if (a.durationSeconds === null) return 1;
        if (b.durationSeconds === null) return -1;
        return (a.durationSeconds - b.durationSeconds) * sign;
      }
      case "kind": return a.kind.localeCompare(b.kind) * sign;
      case "label": return (a.entry.label ?? "").localeCompare(b.entry.label ?? "") * sign;
      default: return a.name.localeCompare(b.name, undefined, { numeric: true }) * sign;
    }
  });
  return ordered;
}

/* --------------------------------- describing --------------------------------- */

export function assertCollectionCount(count: number): void {
  if (count > MAX_COLLECTIONS_PER_PROJECT) {
    throw new ProjectError(
      "INVALID_INPUT",
      `A project holds at most ${MAX_COLLECTIONS_PER_PROJECT} collections.`,
      { fieldPath: "collections" },
    );
  }
}

/** One rule in words, so a collection can be read back rather than decoded. */
export function describeRule(rule: CollectionRule): string {
  switch (rule.field) {
    case "rating":
      return rule.comparison === "exactly"
        ? `rated exactly ${rule.value}`
        : `rated ${rule.comparison === "at_least" ? "at least" : "at most"} ${rule.value}`;
    case "label":
      return rule.value === null
        ? (rule.comparison === "is" ? "unlabelled" : "labelled")
        : `${rule.comparison === "is" ? "labelled" : "not labelled"} ${rule.value}`;
    case "favourite":
      return rule.value ? "a favourite" : "not a favourite";
    case "tag":
      return `${rule.comparison === "has" ? "tagged" : "not tagged"} “${rule.value}”`;
    case "name":
      return rule.comparison === "contains" ? `named something containing “${rule.value}”`
        : rule.comparison === "starts_with" ? `named starting with “${rule.value}”`
          : `not named anything containing “${rule.value}”`;
    case "kind":
      return `${rule.comparison === "is" ? "" : "not "}${rule.value}`;
    case "duration":
      return `${rule.comparison === "at_least" ? "at least" : "at most"} ${rule.value}s long`;
    case "used":
      return rule.value ? "used somewhere" : "not used anywhere";
  }
}

export function describeCollection(collection: Collection): string {
  const parts = collection.rules.map(describeRule);
  const joined = parts.length === 1
    ? parts[0]
    : `${parts.slice(0, -1).join(", ")} ${collection.match === "all" ? "and" : "or"} ${parts[parts.length - 1]}`;
  return `“${collection.name}”: everything ${joined}.`;
}

/** A sentence describing how one item is marked. */
export function describeEntry(entry: CatalogueEntry): string {
  const parts: string[] = [];
  if (entry.rating > 0) parts.push(`${entry.rating} star${entry.rating === 1 ? "" : "s"}`);
  if (entry.label) parts.push(`labelled ${entry.label}`);
  if (entry.favourite) parts.push("a favourite");
  if (entry.tags.length) parts.push(`tagged ${entry.tags.map((tag) => `“${tag}”`).join(", ")}`);
  if (entry.note) parts.push("with a note");
  return parts.length ? `${parts.join(", ")}.` : "Not marked.";
}
