import { z } from "zod";
import { ProjectError } from "./project-error";
import { rangeEnd, timeRangeSchema, toSeconds, type TimeRange } from "./time";

export const ORGANIZATION_SCHEMA_VERSION = 1 as const;

export const MAX_BINS_PER_PROJECT = 200;
export const MAX_BIN_DEPTH = 8;
export const MAX_SUBCLIPS_PER_PROJECT = 1000;

/**
 * A bin is a folder over things the project already owns. It never takes ownership of media
 * and never changes where the bytes live, so moving an asset between bins is organization,
 * not a source edit.
 */
export const binSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(ORGANIZATION_SCHEMA_VERSION),
  name: z.string().trim().min(1).max(120),
  parentBinId: z.string().min(1).nullable(),
  createdAt: z.string().datetime(),
});
export type Bin = z.infer<typeof binSchema>;

export const binItemTypeSchema = z.enum(["asset", "subclip", "sequence"]);
export type BinItemType = z.infer<typeof binItemTypeSchema>;

/**
 * Where one item sits: which bin holds it, its order inside that bin, and its free position
 * on the storyboard. Board coordinates are kept apart from bin membership so rearranging a
 * board never reorganizes the tree.
 */
export const binItemSchema = z.object({
  itemType: binItemTypeSchema,
  itemId: z.string().min(1),
  binId: z.string().min(1).nullable(),
  order: z.number().int().min(0).max(100000),
  storyboardX: z.number().min(-100000).max(100000).nullable(),
  storyboardY: z.number().min(-100000).max(100000).nullable(),
});
export type BinItem = z.infer<typeof binItemSchema>;

/**
 * A named range inside an asset. It references the original rather than copying media, so a
 * hundred subclips of one interview cost nothing but records.
 */
export const subclipSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(ORGANIZATION_SCHEMA_VERSION),
  assetId: z.string().min(1),
  name: z.string().trim().min(1).max(160),
  sourceRange: timeRangeSchema,
  createdAt: z.string().datetime(),
});
export type Subclip = z.infer<typeof subclipSchema>;

/** A marker owned by a source asset rather than by a sequence or a clip. */
export const sourceMarkerSchema = z.object({
  id: z.string().min(1),
  assetId: z.string().min(1),
  time: z.object({ numerator: z.number().int(), denominator: z.number().int().min(1) }),
  name: z.string().trim().min(1).max(120),
  comment: z.string().max(500),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  duration: z.object({ numerator: z.number().int(), denominator: z.number().int().min(1) }).nullable(),
});
export type SourceMarker = z.infer<typeof sourceMarkerSchema>;

export function binDepth(bins: readonly Bin[], binId: string | null): number {
  let depth = 0;
  let cursor = binId;
  const seen = new Set<string>();
  while (cursor) {
    if (seen.has(cursor)) return depth;
    seen.add(cursor);
    const bin = bins.find((entry) => entry.id === cursor);
    if (!bin) return depth;
    depth += 1;
    cursor = bin.parentBinId;
  }
  return depth;
}

/** A bin cannot be its own ancestor; without this check a move can orphan a whole subtree. */
export function assertNoBinCycle(bins: readonly Bin[], binId: string, nextParentId: string | null): void {
  let cursor = nextParentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === binId) {
      throw new ProjectError("INVALID_INPUT", "A bin cannot be moved inside itself.", { fieldPath: "parentBinId" });
    }
    if (seen.has(cursor)) break;
    seen.add(cursor);
    cursor = bins.find((entry) => entry.id === cursor)?.parentBinId ?? null;
  }
}

export function childBins(bins: readonly Bin[], parentBinId: string | null): Bin[] {
  return bins.filter((bin) => bin.parentBinId === parentBinId);
}

export function descendantBinIds(bins: readonly Bin[], binId: string): string[] {
  const collected: string[] = [];
  const walk = (parentId: string) => {
    for (const child of bins.filter((bin) => bin.parentBinId === parentId)) {
      collected.push(child.id);
      walk(child.id);
    }
  };
  walk(binId);
  return collected;
}

export function itemsInBin(items: readonly BinItem[], binId: string | null): BinItem[] {
  return items.filter((item) => item.binId === binId).sort((a, b) => a.order - b.order);
}

export function findBinItem(items: readonly BinItem[], itemType: BinItemType, itemId: string): BinItem | null {
  return items.find((item) => item.itemType === itemType && item.itemId === itemId) ?? null;
}

export function subclipDuration(subclip: Subclip): number {
  return toSeconds(subclip.sourceRange.duration);
}

/**
 * A subclip must fall inside the media it names. Without this a marked range survives a
 * source replacement that shortened the file and later requests frames that do not exist.
 */
export function assertSubclipWithinSource(
  range: TimeRange,
  sourceDurationSeconds: number | null,
  fieldPath = "sourceRange",
): void {
  if (range.duration.numerator <= 0) {
    throw new ProjectError("INVALID_INPUT", "A subclip must be longer than zero.", { fieldPath: `${fieldPath}.duration` });
  }
  if (range.start.numerator < 0) {
    throw new ProjectError("INVALID_INPUT", "A subclip cannot start before the beginning of its source.", { fieldPath: `${fieldPath}.start` });
  }
  if (sourceDurationSeconds === null) return;
  const end = toSeconds(rangeEnd(range));
  if (end > sourceDurationSeconds + 1e-6) {
    throw new ProjectError(
      "INVALID_INPUT",
      `That range ends at ${end.toFixed(3)}s but the source is only ${sourceDurationSeconds.toFixed(3)}s long.`,
      { fieldPath: `${fieldPath}.duration` },
    );
  }
}
