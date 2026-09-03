import { z } from "zod";
import { HISTORY_SCHEMA_VERSION } from "./project-history";
import { ProjectError } from "./project-error";

export const PACKAGE_SCHEMA_VERSION = 1 as const;

/**
 * Moving a project between machines, and reconciling it when it comes back changed.
 *
 * Estro has no server, so "sync" cannot mean what it usually means. What it means here is a
 * file: a project is written out whole, carried by whatever the person already uses — a shared
 * folder, a drive, an attachment — and read back somewhere else. That is a weaker promise than
 * a sync service and a much more honest one, because there is no moment where the editor claims
 * to have saved something to a place it cannot reach.
 *
 * The interesting part is not the writing. It is what happens when two machines have both
 * edited, which is a certainty rather than an edge case once a project is portable at all.
 */

/**
 * What a package carries besides the project itself.
 *
 * Media is the whole question. A project without it is small and useless on a machine that has
 * not got the files; a project with it is correct and enormous. Both are legitimate, so it is a
 * choice that has to be made rather than a default that surprises someone.
 */
export const mediaPolicySchema = z.enum([
  /** The project only. Smallest, and needs the media to already be there. */
  "none",
  /** Only what a sequence or document actually uses, trimmed to the parts in use. */
  "used_only",
  /** Everything registered, in full. */
  "everything",
]);
export type MediaPolicy = z.infer<typeof mediaPolicySchema>;

export const packageManifestSchema = z.object({
  schemaVersion: z.literal(PACKAGE_SCHEMA_VERSION),
  /** The history model the contents were written against, so an older reader can refuse. */
  historySchemaVersion: z.literal(HISTORY_SCHEMA_VERSION),
  projectId: z.string().min(1),
  projectName: z.string().min(1).max(200),
  /**
   * The revision this package was written from.
   *
   * The single most important field: it is what makes reconciliation possible. Two packages
   * from a common ancestor can be compared; two with no shared history cannot be merged and
   * have to be told apart as separate projects.
   */
  headRevisionId: z.string().min(1),
  /** Every revision id in the project's history, oldest first. */
  revisionIds: z.array(z.string().min(1)).min(1).max(100_000),
  writtenAt: z.string().datetime(),
  /** Which machine wrote it, so a person can tell two packages apart. */
  writtenBy: z.string().trim().min(1).max(120),
  mediaPolicy: mediaPolicySchema,
  media: z.array(z.object({
    assetId: z.string().min(1),
    name: z.string().min(1).max(400),
    contentHash: z.string().min(1).max(200),
    byteSize: z.number().int().min(0),
    /** Absent when the policy left it out; the reader then needs it locally. */
    included: z.boolean(),
  })).max(10_000).default([]),
});
export type PackageManifest = z.infer<typeof packageManifestSchema>;

/* -------------------------------- reconciliation -------------------------------- */

/**
 * What two versions of one project turn out to be, relative to each other.
 *
 * Named as relationships rather than as outcomes, because the outcome depends on what the person
 * wants and the relationship does not.
 */
export type SyncRelation =
  /** Identical: same head. Nothing to do. */
  | "same"
  /** The incoming one is ahead: it contains everything local plus more. Fast-forward. */
  | "incoming_ahead"
  /** Local is ahead: the package is old. Nothing to take. */
  | "local_ahead"
  /** Both moved since a shared ancestor. Someone has to decide. */
  | "diverged"
  /** No shared history at all: two different projects that happen to share an id. */
  | "unrelated";

export interface SyncComparison {
  relation: SyncRelation;
  /** The last revision both sides agree on, when there is one. */
  commonAncestorId: string | null;
  /** Revisions the incoming package has that this machine does not. */
  incomingOnly: string[];
  /** Revisions this machine has that the package does not. */
  localOnly: string[];
  summary: string;
}

/**
 * Works out how two histories relate.
 *
 * Comparing the full revision lists rather than just the heads is what makes the difference
 * between "you are behind" and "you have both edited" answerable — and those need entirely
 * different things offered to the person.
 */
export function compareHistories(
  local: { headRevisionId: string; revisionIds: readonly string[] },
  incoming: { headRevisionId: string; revisionIds: readonly string[] },
): SyncComparison {
  if (local.headRevisionId === incoming.headRevisionId) {
    return {
      relation: "same", commonAncestorId: local.headRevisionId,
      incomingOnly: [], localOnly: [],
      summary: "Both are at the same point. There is nothing to bring across.",
    };
  }

  const localSet = new Set(local.revisionIds);
  const incomingSet = new Set(incoming.revisionIds);
  const incomingOnly = incoming.revisionIds.filter((id) => !localSet.has(id));
  const localOnly = local.revisionIds.filter((id) => !incomingSet.has(id));

  // The last point both lists agree on, walking the local history backwards. Taking the last
  // rather than the first shared id matters: histories share their beginning by construction.
  let commonAncestorId: string | null = null;
  for (let index = local.revisionIds.length - 1; index >= 0; index -= 1) {
    if (incomingSet.has(local.revisionIds[index])) {
      commonAncestorId = local.revisionIds[index];
      break;
    }
  }

  if (!commonAncestorId) {
    return {
      relation: "unrelated", commonAncestorId: null, incomingOnly, localOnly,
      summary: "These share no history at all. They are different projects that happen to have the same identifier, so nothing can be merged — open the package as a new project instead.",
    };
  }

  if (!localOnly.length) {
    return {
      relation: "incoming_ahead", commonAncestorId, incomingOnly, localOnly,
      summary: `The package is ${incomingOnly.length} edit(s) ahead and this copy has nothing of its own, so it can be brought across whole.`,
    };
  }
  if (!incomingOnly.length) {
    return {
      relation: "local_ahead", commonAncestorId, incomingOnly, localOnly,
      summary: `This copy is ${localOnly.length} edit(s) ahead of the package, so there is nothing to take from it.`,
    };
  }

  return {
    relation: "diverged", commonAncestorId, incomingOnly, localOnly,
    summary: `Both have been edited since they last agreed: ${localOnly.length} edit(s) here and ${incomingOnly.length} in the package. Nothing has been changed — choose which to keep, or keep both as separate projects.`,
  };
}

/**
 * What can be done about a divergence.
 *
 * Deliberately not a merge. Two people who both re-graded a sequence have not made changes that
 * combine; picking one, or keeping both, is what actually happens in editing, and offering an
 * automatic merge would produce a third result neither of them made and neither can recognise.
 */
export const resolutionSchema = z.enum([
  /** Take the package and set this copy's work aside as a separate project. */
  "take_incoming",
  /** Keep this copy; the package is left alone. */
  "keep_local",
  /** Both, as two projects, so nothing is lost while someone decides. */
  "keep_both",
]);
export type Resolution = z.infer<typeof resolutionSchema>;

export interface ResolutionPlan {
  resolution: Resolution;
  /** What the project will hold afterwards. */
  outcome: string;
  /** True when a copy of the discarded work is kept, so nothing is destroyed. */
  preservesBoth: boolean;
  warnings: string[];
}

/**
 * Says exactly what a choice will do before it is made.
 *
 * The warnings matter more than the plan: "take the package" sounds harmless right up until it
 * turns out to mean an afternoon's work is no longer the open project.
 */
export function planResolution(comparison: SyncComparison, resolution: Resolution): ResolutionPlan {
  if (comparison.relation === "unrelated" && resolution !== "keep_both") {
    throw new ProjectError(
      "INVALID_INPUT",
      "These share no history, so one cannot replace the other. Open the package as a separate project.",
      { fieldPath: "resolution" },
    );
  }

  switch (resolution) {
    case "take_incoming":
      return {
        resolution, preservesBoth: comparison.localOnly.length > 0,
        outcome: comparison.localOnly.length
          ? `The project becomes the package's version. This copy's ${comparison.localOnly.length} edit(s) are kept as a separate project rather than discarded.`
          : "The project becomes the package's version. This copy had nothing of its own.",
        warnings: comparison.localOnly.length
          ? [`${comparison.localOnly.length} edit(s) made here will no longer be in the open project. They are kept, but under another name.`]
          : [],
      };
    case "keep_local":
      return {
        resolution, preservesBoth: true,
        outcome: comparison.incomingOnly.length
          ? `This copy is kept unchanged. The package's ${comparison.incomingOnly.length} edit(s) are not brought across, and the package file is untouched.`
          : "This copy is kept unchanged; the package had nothing this copy lacks.",
        warnings: comparison.incomingOnly.length
          ? ["The package still holds those edits, so nothing is lost — but this project will not have them until they are brought across."]
          : [],
      };
    case "keep_both":
      return {
        resolution, preservesBoth: true,
        outcome: "Both are kept, as two separate projects, so nothing has to be decided now.",
        warnings: ["Two projects with similar names are easy to confuse later. Rename one while you still remember which is which."],
      };
  }
}

/* ---------------------------------- offline ---------------------------------- */

/**
 * What is waiting to leave this machine.
 *
 * Offline editing needs almost nothing built for it, because everything is local already: work
 * is saved to IndexedDB whether or not anything is reachable. What it does need is an honest
 * answer to "is my work anywhere but here", which is a different question from "did it save".
 */
export interface OfflineState {
  /** Edits made since this project was last written to a package. */
  unsharedEdits: number;
  lastSharedAt: string | null;
  lastSharedRevisionId: string | null;
  /** True when everything here has been written out at least once. */
  shared: boolean;
  summary: string;
}

export function offlineState(input: {
  headRevisionId: string;
  revisionIds: readonly string[];
  lastSharedRevisionId: string | null;
  lastSharedAt: string | null;
}): OfflineState {
  if (!input.lastSharedRevisionId) {
    return {
      unsharedEdits: input.revisionIds.length,
      lastSharedAt: null, lastSharedRevisionId: null, shared: false,
      summary: "This project exists only on this machine. Write a package to have a copy anywhere else.",
    };
  }

  const index = input.revisionIds.lastIndexOf(input.lastSharedRevisionId);
  // A shared revision that is no longer in the history means the project was reverted past it.
  // Counting from zero would claim everything is unshared, which is more alarming than true.
  const unsharedEdits = index < 0 ? 0 : input.revisionIds.length - 1 - index;

  return {
    unsharedEdits,
    lastSharedAt: input.lastSharedAt,
    lastSharedRevisionId: input.lastSharedRevisionId,
    shared: unsharedEdits === 0,
    summary: unsharedEdits === 0
      ? "Everything here has been written out at least once."
      : `${unsharedEdits} edit(s) exist only on this machine. Write a package to have them anywhere else.`,
  };
}

export function assertReadable(manifest: PackageManifest): void {
  if (manifest.historySchemaVersion !== HISTORY_SCHEMA_VERSION) {
    throw new ProjectError(
      "INVALID_INPUT",
      `This package was written by a different version of Estro (history format ${manifest.historySchemaVersion}, this one reads ${HISTORY_SCHEMA_VERSION}). Opening it could misread the edits, so it is refused rather than guessed at.`,
      { fieldPath: "historySchemaVersion" },
    );
  }
}

/** A sentence describing what a package contains. */
export function describePackage(manifest: PackageManifest): string {
  const included = manifest.media.filter((entry) => entry.included);
  const bytes = included.reduce((total, entry) => total + entry.byteSize, 0);
  const size = bytes > 1024 * 1024 * 1024 ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : bytes > 1024 * 1024 ? `${(bytes / 1024 ** 2).toFixed(0)} MB`
      : `${Math.round(bytes / 1024)} KB`;

  const media = manifest.mediaPolicy === "none"
    ? `no media — the ${manifest.media.length} file(s) it references have to already be on the machine that opens it`
    : `${included.length} of ${manifest.media.length} file(s), ${size}`;

  return `“${manifest.projectName}” at revision ${manifest.headRevisionId.slice(0, 8)}, written by ${manifest.writtenBy}, with ${media}.`;
}
