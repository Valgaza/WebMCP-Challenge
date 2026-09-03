import { describe, expect, it } from "vitest";
import { rational } from "./time";
import {
  MAX_COMMENTS_PER_PROJECT, assertCommentCount, assertStackIsCoherent, capabilitiesOf,
  commentSchema, commentTime, commentsForSequence, describeAnchor, describeComment, describeRole,
  describeShare, describeStack, isAgainstOlderRevision, lockIsCurrent, lockSchema, lockWarning,
  roleAllows, shareSchema, versionStackSchema, type Comment,
} from "./review";

const comment = (overrides: Record<string, unknown> = {}): Comment => commentSchema.parse({
  id: "c1", schemaVersion: 1,
  anchor: { kind: "project" },
  body: "Needs to be tighter", authorName: "Sam",
  createdAt: "2026-09-03T10:00:00.000Z",
  ...overrides,
});

/**
 * `SH-081` through `SH-083`, `VI-065` through `VI-068`. There is no server, so none of this can
 * be enforced — and that is stated everywhere it matters, because a permission model that looks
 * like it enforces something and does not is worse than no permission model at all.
 */
describe("roles", () => {
  it("gives an owner everything and a viewer nothing", () => {
    expect(capabilitiesOf("owner")).toContain("delete");
    expect(capabilitiesOf("viewer")).toEqual([]);
  });

  /** A reviewer's whole job is to comment, and resolving their own point is part of that. */
  it("lets a reviewer comment and resolve, but not edit", () => {
    expect(roleAllows("reviewer", "comment")).toBe(true);
    expect(roleAllows("reviewer", "resolve_comments")).toBe(true);
    expect(roleAllows("reviewer", "edit")).toBe(false);
  });

  it("lets an editor edit and export but not manage people", () => {
    expect(roleAllows("editor", "edit")).toBe(true);
    expect(roleAllows("editor", "manage_people")).toBe(false);
  });

  /** The part a permission model usually leaves out. */
  it("says what a role does not stop, not only what it allows", () => {
    expect(describeRole("viewer")).toContain("can look, and nothing else");
    for (const role of ["owner", "editor", "reviewer", "viewer"] as const) {
      expect(describeRole(role)).toContain("not something it can enforce");
    }
  });
});

describe("comments", () => {
  /** A comment attached only to a project is a message; one on a timecode is a note. */
  it("points at a project, an object, a moment, or a region", () => {
    expect(describeAnchor({ kind: "project" })).toContain("project as a whole");
    expect(describeAnchor({ kind: "object", objectType: "clip", objectId: "c" })).toBe("on a clip");
    expect(describeAnchor({ kind: "time", sequenceId: "s", time: rational(5), duration: null }))
      .toBe("at 5.00s");
    expect(describeAnchor({ kind: "time", sequenceId: "s", time: rational(5), duration: rational(2) }))
      .toContain("over 2.00s from 5.00s");
    expect(describeAnchor({
      kind: "region", sequenceId: "s", time: rational(3), x: 0.25, y: 0.5, width: 0.2, height: 0.2,
    })).toContain("25%, 50% of the frame");
  });

  /** A float would drift and put a note on the wrong frame. */
  it("keeps a timecode exact", () => {
    const timed = comment({ anchor: { kind: "time", sequenceId: "s", time: rational(1001, 30000), duration: null } });
    expect(commentTime(timed)).toEqual(rational(1001, 30000));
    expect(commentTime(comment())).toBeNull();
  });

  it("orders a sequence's comments by time, with unanchored ones after", () => {
    const timed = (id: string, seconds: number) => comment({
      id, anchor: { kind: "time", sequenceId: "s1", time: rational(seconds), duration: null },
    });
    const onObject = comment({ id: "obj", anchor: { kind: "object", objectType: "sequence", objectId: "s1" } });
    const ordered = commentsForSequence([timed("late", 20), onObject, timed("early", 2)], "s1");
    expect(ordered.map((entry) => entry.id)).toEqual(["early", "late", "obj"]);
  });

  it("leaves out comments about other sequences", () => {
    const elsewhere = comment({
      id: "other", anchor: { kind: "time", sequenceId: "s2", time: rational(1), duration: null },
    });
    expect(commentsForSequence([elsewhere], "s1")).toEqual([]);
  });

  /**
   * Saying "this was written three versions ago" is more useful than quietly showing it as
   * though it were current.
   */
  it("says when a comment was written against an earlier version", () => {
    const old = comment({ revisionId: "rev-1" });
    expect(isAgainstOlderRevision(old, "rev-5")).toBe(true);
    expect(isAgainstOlderRevision(old, "rev-1")).toBe(false);
    // A comment with no revision recorded makes no claim either way.
    expect(isAgainstOlderRevision(comment(), "rev-5")).toBe(false);
    expect(describeComment(old, "rev-5")).toContain("written against an earlier version");
  });

  it("is resolved rather than deleted, so the conversation survives", () => {
    const resolved = comment({ resolvedAt: "2026-09-03T11:00:00.000Z", resolvedBy: "Alex" });
    expect(describeComment(resolved)).toContain("(resolved)");
    expect(describeComment(comment())).toContain("(open)");
  });

  it("counts replies, and shortens a long note for a list", () => {
    const long = comment({
      body: "x".repeat(200),
      replies: [{ id: "r", body: "Agreed", authorName: "Alex", createdAt: "2026-09-03T11:00:00.000Z" }],
    });
    expect(describeComment(long)).toContain("1 reply");
    expect(describeComment(long)).toContain("…");
  });

  it("refuses an empty comment and more than a project holds", () => {
    expect(() => comment({ body: "   " })).toThrowError();
    expect(() => assertCommentCount(MAX_COMMENTS_PER_PROJECT + 1)).toThrowError(/at most 5000 comments/);
  });
});

/** "Cut v3 final FINAL" is what everyone does when the editor does not offer this. */
describe("version stacks", () => {
  const stack = (overrides: Record<string, unknown> = {}) => versionStackSchema.parse({
    id: "st", schemaVersion: 1, name: "Opening",
    versionIds: ["v1", "v2", "v3"], currentId: "v3",
    createdAt: "2026-09-03T10:00:00.000Z",
    ...overrides,
  });

  it("says which version is showing and which was approved", () => {
    expect(describeStack(stack())).toContain("showing version 3, none approved yet");
    expect(describeStack(stack({ approvedId: "v3" }))).toContain("which is the approved one");
    expect(describeStack(stack({ approvedId: "v1" }))).toContain("version 1 is the approved one");
  });

  it("refuses a current or approved version that is not in the stack", () => {
    expect(() => assertStackIsCoherent(stack({ currentId: "ghost" }))).toThrowError(/marked current is not in this stack/);
    expect(() => assertStackIsCoherent(stack({ approvedId: "ghost" }))).toThrowError(/marked approved is not in this stack/);
  });

  /** "The next version" would be ambiguous. */
  it("refuses the same version twice", () => {
    expect(() => assertStackIsCoherent(stack({ versionIds: ["v1", "v1"], currentId: "v1" })))
      .toThrowError(/appears twice/);
  });
});

/** Refusing would pretend to enforce something that cannot be enforced. */
describe("locks", () => {
  const lock = (overrides: Record<string, unknown> = {}) => lockSchema.parse({
    objectType: "sequence", objectId: "s1", heldBy: "Alex",
    takenAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    ...overrides,
  });

  it("warns rather than refusing, and says the other person may be working too", () => {
    const warning = lockWarning(lock())!;
    expect(warning).toContain("Alex claimed this 5 minute(s) ago");
    expect(warning).toContain("Nothing stops you editing it");
  });

  it("includes the note when one was left", () => {
    expect(lockWarning(lock({ note: "grading" }))).toContain("“grading”");
  });

  /** Otherwise a lock outlives the person who took it. */
  it("treats an expired claim as abandoned", () => {
    const expired = lock({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(lockIsCurrent(expired)).toBe(false);
    expect(lockWarning(expired)).toBeNull();
    expect(lockIsCurrent(lock({ expiresAt: new Date(Date.now() + 60_000).toISOString() }))).toBe(true);
  });

  it("says hours rather than a large number of minutes", () => {
    const old = lock({ takenAt: new Date(Date.now() - 3 * 3600_000).toISOString() });
    expect(lockWarning(old)).toContain("3 hour(s) ago");
  });
});

/** Sharing the project and marking it read-only would be a claim this editor cannot back. */
describe("sharing for review", () => {
  const share = (overrides: Record<string, unknown> = {}) => shareSchema.parse({
    id: "sh", schemaVersion: 1, projectId: "p1", name: "Rough cut for Alex",
    revisionId: "rev-abcdef12", outputId: "out-1",
    createdAt: "2026-09-03T10:00:00.000Z",
    ...overrides,
  });

  it("says the recipient sees a file rather than the project", () => {
    expect(describeShare(share())).toContain("sees a file rather than the project");
    expect(describeShare(share())).toContain("which is what makes it read-only");
  });

  it("says plainly when there is nothing rendered to show yet", () => {
    expect(describeShare(share({ outputId: null }))).toContain("render one first");
  });

  it("mentions a watermark, so a review cut is not mistaken for a delivery", () => {
    expect(describeShare(share({ watermarked: true }))).toContain("watermarked");
  });

  it("invites a reviewer by default rather than an editor", () => {
    expect(share().role).toBe("reviewer");
  });
});
