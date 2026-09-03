import { z } from "zod";
import { ProjectError, toProjectError } from "../domain/project-error";
import {
  MAX_BINS_PER_PROJECT, MAX_BIN_DEPTH, MAX_SUBCLIPS_PER_PROJECT,
  assertNoBinCycle, assertSubclipWithinSource, binDepth, descendantBinIds, findBinItem,
  type Bin, type BinItem, type BinItemType, type SourceMarker, type Subclip,
} from "../domain/organization";
import { rationalSchema, timeRangeSchema, toSeconds } from "../domain/time";
import type { ProjectCommandContext, ProjectMutationResult, ProjectService } from "./project-service";

export const organizationCommandSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("create_bin"), name: z.string().trim().min(1).max(120),
    parentBinId: z.string().min(1).nullable().default(null),
  }),
  z.object({ operation: z.literal("rename_bin"), binId: z.string().min(1), name: z.string().trim().min(1).max(120) }),
  z.object({
    operation: z.literal("move_bin"), binId: z.string().min(1),
    parentBinId: z.string().min(1).nullable(),
  }),
  z.object({
    operation: z.literal("delete_bin"), binId: z.string().min(1),
    /** Items in a deleted bin move to its parent rather than disappearing with it. */
    confirm: z.boolean().default(false),
  }),
  z.object({
    operation: z.literal("move_items"),
    items: z.array(z.object({
      itemType: z.enum(["asset", "subclip", "sequence"]),
      itemId: z.string().min(1),
    })).min(1).max(500),
    binId: z.string().min(1).nullable(),
  }),
  z.object({
    operation: z.literal("set_storyboard_position"),
    itemType: z.enum(["asset", "subclip", "sequence"]),
    itemId: z.string().min(1),
    x: z.number().min(-100000).max(100000).nullable(),
    y: z.number().min(-100000).max(100000).nullable(),
  }),
  z.object({
    operation: z.literal("reorder_item"),
    itemType: z.enum(["asset", "subclip", "sequence"]),
    itemId: z.string().min(1),
    toIndex: z.number().int().min(0).max(100000),
  }),
  z.object({
    operation: z.literal("create_subclip"), assetId: z.string().min(1),
    name: z.string().trim().min(1).max(160),
    sourceRange: timeRangeSchema,
    binId: z.string().min(1).nullable().default(null),
  }),
  z.object({ operation: z.literal("rename_subclip"), subclipId: z.string().min(1), name: z.string().trim().min(1).max(160) }),
  z.object({ operation: z.literal("delete_subclip"), subclipId: z.string().min(1) }),
  z.object({
    operation: z.literal("add_source_marker"), assetId: z.string().min(1), time: rationalSchema,
    name: z.string().trim().min(1).max(120), comment: z.string().max(500).default(""),
    color: z.string().regex(/^#[0-9a-f]{6}$/i).default("#4a9eff"),
    duration: rationalSchema.nullable().default(null),
  }),
  z.object({ operation: z.literal("remove_source_marker"), markerId: z.string().min(1) }),
]);
export type OrganizationCommand = z.input<typeof organizationCommandSchema>;

export interface OrganizationSnapshot {
  bins: Bin[];
  items: BinItem[];
  subclips: Subclip[];
  sourceMarkers: SourceMarker[];
}

export interface OrganizationServiceOptions {
  now?: () => Date;
  createId?: () => string;
}

/**
 * Bins, subclips, storyboard positions, and source markers.
 *
 * All of it is project state rather than a runtime convenience, so it is undoable, travels
 * with a duplicated project, and can be inspected by an agent through the same revision an
 * edit produced. None of it changes where media lives or who owns it.
 */
export class OrganizationService {
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(private readonly projects: ProjectService, options: OrganizationServiceOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? (() => crypto.randomUUID());
  }

  async getOrganization(projectId: string): Promise<OrganizationSnapshot> {
    const history = await this.projects.getProjectHistory(projectId);
    const state = history.headRevision.state;
    return {
      bins: state.bins ?? [],
      items: state.binItems ?? [],
      subclips: state.subclips ?? [],
      sourceMarkers: state.sourceMarkers ?? [],
    };
  }

  async apply(
    projectId: string,
    input: OrganizationCommand,
    context: ProjectCommandContext = {},
  ): Promise<ProjectMutationResult & { warnings: string[]; createdId: string | null }> {
    try {
      const command = organizationCommandSchema.parse(input);
      const history = await this.projects.getProjectHistory(projectId);
      const state = history.headRevision.state;
      const before: OrganizationSnapshot = {
        bins: state.bins ?? [],
        items: state.binItems ?? [],
        subclips: state.subclips ?? [],
        sourceMarkers: state.sourceMarkers ?? [],
      };

      const computed = this.computeNext(before, command, state.assets ?? []);
      const result = await this.projects.applyOrganization(
        {
          projectId,
          label: computed.label,
          from: before,
          to: computed.next,
          warnings: computed.warnings,
        },
        context,
      );
      return { ...result, warnings: computed.warnings, createdId: computed.createdId };
    } catch (error) { throw toProjectError(error); }
  }

  private computeNext(
    before: OrganizationSnapshot,
    command: z.infer<typeof organizationCommandSchema>,
    assets: readonly { id: string; name: string; durationSeconds: number | null; kind: string }[],
  ): { next: OrganizationSnapshot; label: string; warnings: string[]; createdId: string | null } {
    const warnings: string[] = [];

    const requireBin = (binId: string): Bin => {
      const bin = before.bins.find((entry) => entry.id === binId);
      if (!bin) throw new ProjectError("INVALID_INPUT", "That bin is not in this project.", { fieldPath: "binId" });
      return bin;
    };

    const nextOrder = (binId: string | null): number => {
      const siblings = before.items.filter((item) => item.binId === binId);
      return siblings.length ? Math.max(...siblings.map((item) => item.order)) + 1 : 0;
    };

    const upsertItem = (items: BinItem[], itemType: BinItemType, itemId: string, patch: Partial<BinItem>): BinItem[] => {
      const existing = findBinItem(items, itemType, itemId);
      if (existing) {
        return items.map((item) =>
          item.itemType === itemType && item.itemId === itemId ? { ...item, ...patch } : item);
      }
      return [...items, {
        itemType, itemId, binId: null, order: nextOrder(null),
        storyboardX: null, storyboardY: null, ...patch,
      }];
    };

    switch (command.operation) {
      case "create_bin": {
        if (before.bins.length >= MAX_BINS_PER_PROJECT) {
          throw new ProjectError("INVALID_INPUT", `A project cannot hold more than ${MAX_BINS_PER_PROJECT} bins.`, { fieldPath: "name" });
        }
        if (command.parentBinId) {
          requireBin(command.parentBinId);
          if (binDepth(before.bins, command.parentBinId) >= MAX_BIN_DEPTH) {
            throw new ProjectError("INVALID_INPUT", `Bins cannot nest more than ${MAX_BIN_DEPTH} levels deep.`, { fieldPath: "parentBinId" });
          }
        }
        const bin: Bin = {
          id: this.createId(), schemaVersion: 1, name: command.name,
          parentBinId: command.parentBinId, createdAt: this.now().toISOString(),
        };
        return {
          next: { ...before, bins: [...before.bins, bin] },
          label: `Create bin “${bin.name}”`, warnings, createdId: bin.id,
        };
      }

      case "rename_bin": {
        const bin = requireBin(command.binId);
        return {
          next: { ...before, bins: before.bins.map((entry) => (entry.id === bin.id ? { ...entry, name: command.name } : entry)) },
          label: `Rename bin to “${command.name}”`, warnings, createdId: null,
        };
      }

      case "move_bin": {
        const bin = requireBin(command.binId);
        if (command.parentBinId) requireBin(command.parentBinId);
        assertNoBinCycle(before.bins, bin.id, command.parentBinId);
        const moved = before.bins.map((entry) => (entry.id === bin.id ? { ...entry, parentBinId: command.parentBinId } : entry));
        if (binDepth(moved, bin.id) > MAX_BIN_DEPTH) {
          throw new ProjectError("INVALID_INPUT", `Bins cannot nest more than ${MAX_BIN_DEPTH} levels deep.`, { fieldPath: "parentBinId" });
        }
        return { next: { ...before, bins: moved }, label: `Move bin “${bin.name}”`, warnings, createdId: null };
      }

      case "delete_bin": {
        const bin = requireBin(command.binId);
        const doomed = new Set([bin.id, ...descendantBinIds(before.bins, bin.id)]);
        const orphaned = before.items.filter((item) => item.binId && doomed.has(item.binId));
        if (orphaned.length && !command.confirm) {
          throw new ProjectError(
            "CONFIRMATION_REQUIRED",
            `“${bin.name}” holds ${orphaned.length} item(s). Deleting it moves them to ${bin.parentBinId ? "the parent bin" : "the top level"}. Confirm to continue.`,
            { fieldPath: "confirm" },
          );
        }
        if (orphaned.length) {
          warnings.push(`${orphaned.length} item(s) moved out of “${bin.name}”. Nothing was removed from the project.`);
        }
        return {
          next: {
            ...before,
            bins: before.bins.filter((entry) => !doomed.has(entry.id)),
            // Items are never deleted with their folder; only their location changes.
            items: before.items.map((item) => (item.binId && doomed.has(item.binId) ? { ...item, binId: bin.parentBinId } : item)),
          },
          label: `Delete bin “${bin.name}”`, warnings, createdId: null,
        };
      }

      case "move_items": {
        if (command.binId) requireBin(command.binId);
        let items = before.items;
        for (const target of command.items) {
          items = upsertItem(items, target.itemType, target.itemId, { binId: command.binId, order: nextOrder(command.binId) });
        }
        return {
          next: { ...before, items },
          label: command.binId
            ? `Move ${command.items.length} item(s) into a bin`
            : `Move ${command.items.length} item(s) to the top level`,
          warnings, createdId: null,
        };
      }

      case "set_storyboard_position": {
        return {
          next: {
            ...before,
            items: upsertItem(before.items, command.itemType, command.itemId, { storyboardX: command.x, storyboardY: command.y }),
          },
          label: command.x === null ? "Clear a storyboard position" : "Move an item on the storyboard",
          warnings, createdId: null,
        };
      }

      case "reorder_item": {
        const item = findBinItem(before.items, command.itemType, command.itemId);
        if (!item) throw new ProjectError("INVALID_INPUT", "That item is not organized yet, so it has no order to change.", { fieldPath: "itemId" });
        const siblings = before.items
          .filter((entry) => entry.binId === item.binId && !(entry.itemType === item.itemType && entry.itemId === item.itemId))
          .sort((a, b) => a.order - b.order);
        const index = Math.min(command.toIndex, siblings.length);
        const ordered = [...siblings.slice(0, index), item, ...siblings.slice(index)];
        const reindexed = new Map(ordered.map((entry, position) => [`${entry.itemType}:${entry.itemId}`, position]));
        return {
          next: {
            ...before,
            items: before.items.map((entry) => {
              const order = reindexed.get(`${entry.itemType}:${entry.itemId}`);
              return order === undefined ? entry : { ...entry, order };
            }),
          },
          label: "Reorder an item", warnings, createdId: null,
        };
      }

      case "create_subclip": {
        if (before.subclips.length >= MAX_SUBCLIPS_PER_PROJECT) {
          throw new ProjectError("INVALID_INPUT", `A project cannot hold more than ${MAX_SUBCLIPS_PER_PROJECT} subclips.`, { fieldPath: "name" });
        }
        const asset = assets.find((entry) => entry.id === command.assetId);
        if (!asset) throw new ProjectError("ASSET_NOT_FOUND", "Import that media before making a subclip of it.");
        if (asset.kind === "image") {
          throw new ProjectError("INVALID_INPUT", "A still image has no duration, so it cannot be subclipped.", { fieldPath: "assetId" });
        }
        assertSubclipWithinSource(command.sourceRange, asset.durationSeconds);
        if (command.binId) requireBin(command.binId);

        const subclip: Subclip = {
          id: this.createId(), schemaVersion: 1, assetId: asset.id, name: command.name,
          sourceRange: command.sourceRange, createdAt: this.now().toISOString(),
        };
        return {
          next: {
            ...before,
            subclips: [...before.subclips, subclip],
            items: [...before.items, {
              itemType: "subclip", itemId: subclip.id, binId: command.binId,
              order: nextOrder(command.binId), storyboardX: null, storyboardY: null,
            }],
          },
          label: `Create subclip “${subclip.name}” (${toSeconds(command.sourceRange.duration).toFixed(2)}s)`,
          warnings, createdId: subclip.id,
        };
      }

      case "rename_subclip": {
        const subclip = before.subclips.find((entry) => entry.id === command.subclipId);
        if (!subclip) throw new ProjectError("INVALID_INPUT", "That subclip is not in this project.", { fieldPath: "subclipId" });
        return {
          next: { ...before, subclips: before.subclips.map((entry) => (entry.id === subclip.id ? { ...entry, name: command.name } : entry)) },
          label: `Rename subclip to “${command.name}”`, warnings, createdId: null,
        };
      }

      case "delete_subclip": {
        const subclip = before.subclips.find((entry) => entry.id === command.subclipId);
        if (!subclip) throw new ProjectError("INVALID_INPUT", "That subclip is not in this project.", { fieldPath: "subclipId" });
        return {
          next: {
            ...before,
            subclips: before.subclips.filter((entry) => entry.id !== subclip.id),
            items: before.items.filter((item) => !(item.itemType === "subclip" && item.itemId === subclip.id)),
          },
          label: `Delete subclip “${subclip.name}”`,
          warnings: ["Clips already placed from this subclip keep playing; they reference the original media."],
          createdId: null,
        };
      }

      case "add_source_marker": {
        const asset = assets.find((entry) => entry.id === command.assetId);
        if (!asset) throw new ProjectError("ASSET_NOT_FOUND", "That asset is not registered in this project.");
        if (command.time.numerator < 0) {
          throw new ProjectError("INVALID_INPUT", "A source marker cannot sit before the beginning of its media.", { fieldPath: "time" });
        }
        if (command.duration && command.duration.numerator <= 0) {
          throw new ProjectError("INVALID_INPUT", "A marker's span must last longer than zero.", { fieldPath: "duration" });
        }
        const marker: SourceMarker = {
          id: this.createId(), assetId: asset.id, time: command.time, name: command.name,
          comment: command.comment, color: command.color, duration: command.duration,
        };
        return {
          next: { ...before, sourceMarkers: [...before.sourceMarkers, marker] },
          label: `Add source marker “${marker.name}”`, warnings, createdId: marker.id,
        };
      }

      case "remove_source_marker": {
        const marker = before.sourceMarkers.find((entry) => entry.id === command.markerId);
        if (!marker) throw new ProjectError("INVALID_INPUT", "That source marker is not in this project.", { fieldPath: "markerId" });
        return {
          next: { ...before, sourceMarkers: before.sourceMarkers.filter((entry) => entry.id !== marker.id) },
          label: `Remove source marker “${marker.name}”`, warnings, createdId: null,
        };
      }
    }
  }
}
