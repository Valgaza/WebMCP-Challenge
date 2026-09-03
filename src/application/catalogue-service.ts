import { z } from "zod";
import {
  CATALOGUE_SCHEMA_VERSION, MAX_COLLECTIONS_PER_PROJECT, assertCollectionCount,
  catalogueEntrySchema, collectionSchema, collectionRuleSchema, describeCollection, describeEntry,
  emptyEntry, labelSchema, ratingSchema, runCollection, sortSubjects,
  type CatalogueEntry, type CatalogueSubject, type Collection, type SortField,
} from "../domain/catalogue";
import { ProjectError, toProjectError } from "../domain/project-error";
import type { ProjectCommandContext, ProjectMutationResult, ProjectService } from "./project-service";

/**
 * Marking media so a person can find one shot among four hundred.
 *
 * Everything here goes through the project's own command path, so a rating is undoable and
 * travels with a duplicated project. That is not incidental: a four-hour session of marking
 * selects is work, and work that Undo cannot reach is work that can be lost in a way nothing
 * else in this editor can be.
 */

export const markInputSchema = z.object({
  projectId: z.string().min(1),
  items: z.array(z.object({
    itemType: z.enum(["asset"]).default("asset"),
    itemId: z.string().min(1),
  })).min(1).max(500),
  rating: ratingSchema.optional(),
  label: labelSchema.nullish(),
  favourite: z.boolean().optional(),
  /** Added to what is there; use `removeTags` to take one away. */
  addTags: z.array(z.string().trim().min(1).max(60)).max(32).optional(),
  removeTags: z.array(z.string().trim().min(1).max(60)).max(32).optional(),
  note: z.string().max(2000).optional(),
});
export type MarkInput = z.input<typeof markInputSchema>;

export const collectionInputSchema = z.object({
  projectId: z.string().min(1),
  collectionId: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(80).optional(),
  match: z.enum(["all", "any"]).optional(),
  rules: z.array(collectionRuleSchema).min(1).max(16).optional(),
  remove: z.boolean().optional(),
});
export type CollectionInput = z.input<typeof collectionInputSchema>;

export class CatalogueService {
  constructor(private readonly projects: ProjectService) {}

  private async stateOf(projectId: string) {
    const history = await this.projects.getProjectHistory(projectId);
    const state = history.headRevision.state;
    return {
      entries: state.catalogue ?? [],
      collections: state.collections ?? [],
      assets: state.assets ?? [],
    };
  }

  /** How one item is marked, whether or not anything has marked it yet. */
  async entryFor(projectId: string, itemId: string): Promise<CatalogueEntry> {
    const { entries } = await this.stateOf(projectId);
    return entries.find((entry) => entry.itemId === itemId) ?? emptyEntry("asset", itemId);
  }

  /**
   * Marks one or many items at once.
   *
   * Many at once because that is how selects are actually made — a person picks fifteen shots
   * and rates them together — and doing it as fifteen transactions would make Undo fifteen
   * presses for one decision.
   */
  async mark(input: MarkInput, context: ProjectCommandContext = {}): Promise<ProjectMutationResult> {
    try {
      const parsed = markInputSchema.parse(input);
      const { entries, collections } = await this.stateOf(parsed.projectId);

      const changing = new Map(parsed.items.map((item) => [item.itemId, item]));
      const next = [...entries];

      for (const [itemId, item] of changing) {
        const existingIndex = next.findIndex((entry) => entry.itemId === itemId);
        const existing = existingIndex >= 0 ? next[existingIndex] : emptyEntry(item.itemType, itemId);

        // Tags are added and removed rather than replaced, because a person marking fifteen
        // shots "wide" does not mean to strip whatever else each of them was tagged.
        const removing = new Set((parsed.removeTags ?? []).map((tag) => tag.toLowerCase()));
        const tags = [
          ...existing.tags.filter((tag) => !removing.has(tag.toLowerCase())),
          ...(parsed.addTags ?? []).filter((tag) =>
            !existing.tags.some((held) => held.toLowerCase() === tag.toLowerCase())),
        ];

        const updated = catalogueEntrySchema.parse({
          ...existing,
          schemaVersion: CATALOGUE_SCHEMA_VERSION,
          itemType: item.itemType,
          rating: parsed.rating ?? existing.rating,
          label: parsed.label === undefined ? existing.label : parsed.label,
          favourite: parsed.favourite ?? existing.favourite,
          tags,
          note: parsed.note ?? existing.note,
        });

        if (existingIndex >= 0) next[existingIndex] = updated;
        else next.push(updated);
      }

      const what: string[] = [];
      if (parsed.rating !== undefined) what.push(parsed.rating === 0 ? "cleared the rating" : `rated ${parsed.rating}`);
      if (parsed.label !== undefined) what.push(parsed.label === null ? "removed the label" : `labelled ${parsed.label}`);
      if (parsed.favourite !== undefined) what.push(parsed.favourite ? "favourited" : "unfavourited");
      if (parsed.addTags?.length) what.push(`tagged ${parsed.addTags.map((tag) => `“${tag}”`).join(", ")}`);
      if (parsed.removeTags?.length) what.push(`untagged ${parsed.removeTags.map((tag) => `“${tag}”`).join(", ")}`);
      if (parsed.note !== undefined) what.push(parsed.note ? "noted" : "cleared the note");
      if (!what.length) {
        throw new ProjectError("INVALID_INPUT", "That command marks nothing.", { fieldPath: "rating" });
      }

      const count = parsed.items.length;
      return await this.projects.applyCatalogue({
        projectId: parsed.projectId,
        label: `${what.join(", ")}${count > 1 ? ` on ${count} items` : ""}`,
        fromEntries: entries, toEntries: next,
        fromCollections: collections, toCollections: collections,
      }, context);
    } catch (error) { throw toProjectError(error); }
  }

  /** Adds, changes, or removes a saved question. */
  async manageCollection(
    input: CollectionInput,
    context: ProjectCommandContext = {},
  ): Promise<ProjectMutationResult> {
    try {
      const parsed = collectionInputSchema.parse(input);
      const { entries, collections } = await this.stateOf(parsed.projectId);

      if (parsed.remove) {
        if (!parsed.collectionId) {
          throw new ProjectError("INVALID_INPUT", "Removing a collection needs its id.", { fieldPath: "collectionId" });
        }
        const going = collections.find((entry) => entry.id === parsed.collectionId);
        if (!going) {
          throw new ProjectError("INVALID_INPUT", "That collection is not in this project.", { fieldPath: "collectionId" });
        }
        return await this.projects.applyCatalogue({
          projectId: parsed.projectId,
          label: `Remove the collection “${going.name}”`,
          fromEntries: entries, toEntries: entries,
          fromCollections: collections,
          toCollections: collections.filter((entry) => entry.id !== parsed.collectionId),
        }, context);
      }

      const existing = parsed.collectionId
        ? collections.find((entry) => entry.id === parsed.collectionId)
        : undefined;
      if (parsed.collectionId && !existing) {
        throw new ProjectError("INVALID_INPUT", "That collection is not in this project.", { fieldPath: "collectionId" });
      }
      if (!existing && !parsed.rules?.length) {
        throw new ProjectError(
          "INVALID_INPUT",
          "A new collection needs at least one rule; a collection is a question rather than a place, so an empty one would mean nothing.",
          { fieldPath: "rules" },
        );
      }

      const collection = collectionSchema.parse({
        id: existing?.id ?? crypto.randomUUID(),
        schemaVersion: CATALOGUE_SCHEMA_VERSION,
        name: parsed.name ?? existing?.name ?? "Collection",
        match: parsed.match ?? existing?.match ?? "all",
        rules: parsed.rules ?? existing?.rules,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      });
      if (!existing) assertCollectionCount(collections.length + 1);

      return await this.projects.applyCatalogue({
        projectId: parsed.projectId,
        label: existing ? `Change the collection “${collection.name}”` : `Add the collection “${collection.name}”`,
        fromEntries: entries, toEntries: entries,
        fromCollections: collections,
        toCollections: existing
          ? collections.map((entry) => (entry.id === collection.id ? collection : entry))
          : [...collections, collection],
      }, context);
    } catch (error) { throw toProjectError(error); }
  }

  /**
   * Everything in the project as the catalogue sees it.
   *
   * Built here rather than stored, because "is it used" and "how long is it" are facts about
   * the project that change without anyone marking anything — and a stored copy would go stale
   * the moment a clip was deleted.
   */
  async subjects(projectId: string): Promise<CatalogueSubject[]> {
    const { entries, assets } = await this.stateOf(projectId);

    const entryFor = (itemId: string, itemType: CatalogueEntry["itemType"]) =>
      entries.find((entry) => entry.itemId === itemId) ?? emptyEntry(itemType, itemId);

    // A photograph is "used" when a layer draws it, which is the only place media can be
    // used in a photo project.
    const used = new Set(
      (await this.projects.getProjectHistory(projectId)).headRevision.state.photoDocument?.layers
        .flatMap(function collect(layer): string[] {
          if (layer.kind === "image") return [layer.assetId];
          return layer.kind === "group" ? layer.children.flatMap(collect) : [];
        }) ?? [],
    );

    const fromAssets: CatalogueSubject[] = assets.map((asset) => ({
      itemType: "asset", itemId: asset.id, name: asset.name,
      kind: asset.kind === "image" ? asset.kind : "unknown",
      durationSeconds: asset.durationSeconds ?? null,
      used: used.has(asset.id),
      entry: entryFor(asset.id, "asset"),
    }));

    return fromAssets;
  }

  /** What a collection currently holds. Run rather than stored, so nothing goes stale. */
  async runCollection(projectId: string, collectionId: string, sort?: {
    field: SortField; direction?: "ascending" | "descending";
  }): Promise<{ collection: Collection; items: CatalogueSubject[]; summary: string }> {
    const { collections } = await this.stateOf(projectId);
    const collection = collections.find((entry) => entry.id === collectionId);
    if (!collection) {
      throw new ProjectError("INVALID_INPUT", "That collection is not in this project.", { fieldPath: "collectionId" });
    }
    const matched = runCollection(collection, await this.subjects(projectId));
    const items = sort ? sortSubjects(matched, sort.field, sort.direction) : matched;
    return {
      collection, items,
      summary: `${describeCollection(collection)} ${items.length} item(s) match right now.`,
    };
  }

  /** A browsable list, filtered and sorted, without a collection needing to exist. */
  async browse(projectId: string, options: {
    minimumRating?: number;
    label?: string | null;
    favouritesOnly?: boolean;
    tag?: string;
    sort?: { field: SortField; direction?: "ascending" | "descending" };
  } = {}): Promise<{ items: CatalogueSubject[]; summary: string }> {
    let items = await this.subjects(projectId);
    if (options.minimumRating !== undefined) {
      items = items.filter((item) => item.entry.rating >= options.minimumRating!);
    }
    if (options.label !== undefined) items = items.filter((item) => item.entry.label === options.label);
    if (options.favouritesOnly) items = items.filter((item) => item.entry.favourite);
    if (options.tag) {
      const wanted = options.tag.toLowerCase();
      items = items.filter((item) => item.entry.tags.some((tag) => tag.toLowerCase() === wanted));
    }
    const sorted = options.sort ? sortSubjects(items, options.sort.field, options.sort.direction) : items;
    return { items: sorted, summary: `${sorted.length} item(s).` };
  }

  /** Every collection in the project, with how many things each currently holds. */
  async listCollections(projectId: string): Promise<{
    collection: Collection; count: number; summary: string;
  }[]> {
    const { collections } = await this.stateOf(projectId);
    const subjects = await this.subjects(projectId);
    return collections.map((collection) => {
      const count = runCollection(collection, subjects).length;
      return { collection, count, summary: `${describeCollection(collection)} ${count} item(s).` };
    });
  }

  /** How one item is marked, in words. */
  async describe(projectId: string, itemId: string): Promise<string> {
    return describeEntry(await this.entryFor(projectId, itemId));
  }
}

export { MAX_COLLECTIONS_PER_PROJECT };
