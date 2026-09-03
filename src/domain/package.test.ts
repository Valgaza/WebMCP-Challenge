import { describe, expect, it } from "vitest";
import {
  assertReadable, compareHistories, describePackage, offlineState, packageManifestSchema,
  planResolution, type SyncComparison,
} from "./package";

const manifest = (overrides: Record<string, unknown> = {}) => packageManifestSchema.parse({
  schemaVersion: 1, historySchemaVersion: 1,
  projectId: "p1", projectName: "Documentary",
  headRevisionId: "rev-5",
  revisionIds: ["rev-1", "rev-2", "rev-3", "rev-4", "rev-5"],
  writtenAt: "2026-09-03T10:00:00.000Z",
  writtenBy: "Studio Mac",
  mediaPolicy: "used_only",
  ...overrides,
});

const history = (ids: string[]) => ({ headRevisionId: ids[ids.length - 1], revisionIds: ids });

/**
 * `SH-006`, `SH-008`, `SH-009`. Estro has no server, so "sync" means a file: written out whole,
 * carried by whatever the person already uses, read back elsewhere. A weaker promise than a
 * sync service and a much more honest one — there is no moment where the editor claims to have
 * saved something somewhere it cannot reach.
 */
describe("comparing two copies", () => {
  it("says there is nothing to do when both are at the same point", () => {
    const result = compareHistories(history(["a", "b"]), history(["a", "b"]));
    expect(result.relation).toBe("same");
    expect(result.summary).toContain("nothing to bring across");
  });

  it("knows when the package is simply ahead", () => {
    const result = compareHistories(history(["a", "b"]), history(["a", "b", "c", "d"]));
    expect(result.relation).toBe("incoming_ahead");
    expect(result.incomingOnly).toEqual(["c", "d"]);
    expect(result.localOnly).toEqual([]);
  });

  it("knows when the package is simply old", () => {
    const result = compareHistories(history(["a", "b", "c"]), history(["a", "b"]));
    expect(result.relation).toBe("local_ahead");
    expect(result.summary).toContain("nothing to take");
  });

  /** A certainty rather than an edge case, once a project is portable at all. */
  it("knows when both have been edited since they last agreed", () => {
    const result = compareHistories(history(["a", "b", "mine"]), history(["a", "b", "theirs", "more"]));
    expect(result.relation).toBe("diverged");
    expect(result.commonAncestorId).toBe("b");
    expect(result.localOnly).toEqual(["mine"]);
    expect(result.incomingOnly).toEqual(["theirs", "more"]);
    expect(result.summary).toContain("Nothing has been changed");
  });

  /** Histories share their beginning by construction, so the *last* shared point is the one. */
  it("finds the last point they agreed on, not the first", () => {
    expect(compareHistories(history(["a", "b", "c", "mine"]), history(["a", "b", "c", "theirs"])).commonAncestorId)
      .toBe("c");
  });

  it("refuses to treat two unrelated projects as one", () => {
    const result = compareHistories(history(["a", "b"]), history(["x", "y"]));
    expect(result.relation).toBe("unrelated");
    expect(result.commonAncestorId).toBeNull();
    expect(result.summary).toContain("different projects");
  });
});

/**
 * Two people who both re-graded a sequence have not made changes that combine. An automatic
 * merge would produce a third result neither made and neither can recognise.
 */
describe("resolving a divergence", () => {
  const diverged = compareHistories(history(["a", "mine"]), history(["a", "theirs"]));

  it("says what taking the package will actually do, including to work made here", () => {
    const plan = planResolution(diverged, "take_incoming");
    expect(plan.outcome).toContain("kept as a separate project");
    expect(plan.warnings.join(" ")).toContain("no longer be in the open project");
    expect(plan.preservesBoth).toBe(true);
  });

  it("says the package is untouched when this copy is kept", () => {
    const plan = planResolution(diverged, "keep_local");
    expect(plan.outcome).toContain("package file is untouched");
    expect(plan.warnings.join(" ")).toContain("nothing is lost");
  });

  it("offers keeping both, and warns about the obvious consequence", () => {
    const plan = planResolution(diverged, "keep_both");
    expect(plan.outcome).toContain("two separate projects");
    expect(plan.warnings.join(" ")).toContain("easy to confuse");
  });

  it("says nothing alarming when there was nothing local to lose", () => {
    const behind = compareHistories(history(["a"]), history(["a", "b"]));
    const plan = planResolution(behind, "take_incoming");
    expect(plan.warnings).toEqual([]);
    expect(plan.outcome).toContain("nothing of its own");
  });

  it("refuses to replace one project with an unrelated one", () => {
    const unrelated = compareHistories(history(["a"]), history(["x"]));
    expect(() => planResolution(unrelated, "take_incoming")).toThrowError(/share no history/);
    expect(() => planResolution(unrelated, "keep_both")).not.toThrow();
  });
});

/**
 * Offline editing needs almost nothing built for it: everything is local already. What it needs
 * is an honest answer to "is my work anywhere but here", which is not "did it save".
 */
describe("what is only on this machine", () => {
  it("says so plainly when a project has never left", () => {
    const state = offlineState({
      headRevisionId: "c", revisionIds: ["a", "b", "c"],
      lastSharedRevisionId: null, lastSharedAt: null,
    });
    expect(state.shared).toBe(false);
    expect(state.unsharedEdits).toBe(3);
    expect(state.summary).toContain("only on this machine");
  });

  it("counts the edits made since it was last written out", () => {
    const state = offlineState({
      headRevisionId: "e", revisionIds: ["a", "b", "c", "d", "e"],
      lastSharedRevisionId: "c", lastSharedAt: "2026-09-03T09:00:00.000Z",
    });
    expect(state.unsharedEdits).toBe(2);
    expect(state.shared).toBe(false);
  });

  it("says everything is out when nothing has changed since", () => {
    const state = offlineState({
      headRevisionId: "c", revisionIds: ["a", "b", "c"],
      lastSharedRevisionId: "c", lastSharedAt: "2026-09-03T09:00:00.000Z",
    });
    expect(state.shared).toBe(true);
    expect(state.summary).toContain("written out at least once");
  });

  /** Claiming everything is unshared after a revert is more alarming than true. */
  it("does not panic when the project was reverted past the point it was shared at", () => {
    const state = offlineState({
      headRevisionId: "b", revisionIds: ["a", "b"],
      lastSharedRevisionId: "gone", lastSharedAt: "2026-09-03T09:00:00.000Z",
    });
    expect(state.unsharedEdits).toBe(0);
    expect(state.shared).toBe(true);
  });
});

describe("the package itself", () => {
  /** Media is the whole question: without it small and useless, with it correct and enormous. */
  it("says what it contains, and what the reader will still need", () => {
    const withMedia = manifest({
      media: [
        { assetId: "a", name: "take1.mp4", contentHash: "h1", byteSize: 2 * 1024 ** 2, included: true },
        { assetId: "b", name: "take2.mp4", contentHash: "h2", byteSize: 3 * 1024 ** 2, included: false },
      ],
    });
    expect(describePackage(withMedia)).toContain("1 of 2 file(s), 2 MB");
    expect(describePackage(withMedia)).toContain("Studio Mac");
  });

  it("warns plainly when a package carries no media at all", () => {
    const bare = manifest({
      mediaPolicy: "none",
      media: [{ assetId: "a", name: "take1.mp4", contentHash: "h1", byteSize: 100, included: false }],
    });
    expect(describePackage(bare)).toContain("have to already be on the machine that opens it");
  });

  /** Misreading edits is worse than refusing to open them. */
  it("refuses a package written by a version whose history it cannot read", () => {
    const future = { ...manifest(), historySchemaVersion: 2 as unknown as 1 };
    expect(() => assertReadable(future)).toThrowError(/refused rather than guessed at/);
    expect(() => assertReadable(manifest())).not.toThrow();
  });

  it("refuses a manifest with no revisions, which could not be compared to anything", () => {
    expect(() => manifest({ revisionIds: [] })).toThrowError();
  });
});
