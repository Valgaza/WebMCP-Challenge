import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EstroDatabase } from "../data/estro-database";
import { ProjectRepository } from "../data/project-repository";
import { rational } from "../domain/time";
import { ProjectService } from "./project-service";
import { ReviewService } from "./review-service";

/**
 * `SH-081` through `SH-083`, `VI-065` through `VI-068`. Nothing here is enforcement, and every
 * method that could be mistaken for it says so — a permission model that looks like it enforces
 * something and does not is worse than none at all.
 */
describe("ReviewService", () => {
  let database: EstroDatabase;
  let projects: ProjectService;
  let review: ReviewService;
  let projectId: string;

  beforeEach(async () => {
    database = new EstroDatabase(`estro-review-${crypto.randomUUID()}`);
    projects = new ProjectService(new ProjectRepository(database));
    review = new ReviewService(projects);
    const project = await projects.createProject({ name: `Cut ${crypto.randomUUID()}`, kind: "video" });
    projectId = project.id;
  });

  afterEach(async () => database.delete());

  describe("people", () => {
    it("adds someone, and says what the role does not stop", async () => {
      const result = await review.setCollaborator({ projectId, name: "Alex", role: "reviewer" });
      expect(result.transaction.summary).toBe("Add Alex as reviewer");
      expect(result.advisory).toContain("not something it can enforce");
    });

    it("changes a role without adding a second person", async () => {
      const added = await review.setCollaborator({ projectId, name: "Alex", role: "viewer" });
      const id = added.headRevision.state.collaborators![0].id;
      const changed = await review.setCollaborator({ projectId, id, name: "Alex", role: "editor" });
      expect(changed.headRevision.state.collaborators).toHaveLength(1);
      expect(changed.headRevision.state.collaborators![0].role).toBe("editor");
    });

    it("removes someone, and says so rather than ignoring one who is not there", async () => {
      const added = await review.setCollaborator({ projectId, name: "Alex", role: "viewer" });
      const id = added.headRevision.state.collaborators![0].id;
      const removed = await review.removeCollaborator(projectId, id);
      expect(removed.headRevision.state.collaborators).toEqual([]);
      await expect(review.removeCollaborator(projectId, "ghost")).rejects.toThrowError(/not on this project/);
    });

    /** Separating these would let an interface show the first without the second. */
    it("returns what a role permits together with the fact that it enforces nothing", () => {
      const permissions = review.permissions("reviewer");
      expect(permissions.capabilities).toContain("comment");
      expect(permissions.enforced).toBe(false);
      expect(permissions.advisory).toContain("not something it can enforce");
    });

    it("says both what will be offered and what cannot be prevented", () => {
      expect(review.canDo("reviewer", "edit").allowed).toBe(false);
      expect(review.canDo("reviewer", "edit").advisory).toContain("cannot prevent it");
      expect(review.canDo("editor", "edit").allowed).toBe(true);
    });
  });

  describe("comments", () => {
    it("records which version a comment was written against", async () => {
      const before = (await projects.getProjectHistory(projectId)).headRevision.id;
      await review.comment({ projectId, anchor: { kind: "project" }, body: "Too long", authorName: "Alex" });
      const comment = (await projects.getProjectHistory(projectId)).headRevision.state.comments![0];
      expect(comment.revisionId).toBe(before);
    });

    it("does not call a note stale just because writing it moved the head", async () => {
      await review.comment({ projectId, anchor: { kind: "project" }, body: "Sky is too blue", authorName: "Alex" });
      const fresh = await review.comments(projectId);
      // Writing the note is itself a commit; that must not make the note look outdated.
      expect(fresh.comments[0].againstOlderRevision).toBe(false);
      expect(fresh.comments[0].summary).not.toContain("earlier version");

      // Nor may another note, a reply, or a resolution — none of them changes the picture.
      await review.comment({ projectId, anchor: { kind: "project" }, body: "And the crop", authorName: "Sam" });
      const second = await review.comments(projectId);
      expect(second.comments.map((entry) => entry.againstOlderRevision)).toEqual([false, false]);

      // Renaming the project does change it, and every note written before that is now stale.
      await projects.renameProject({ projectId, name: "Recut" });
      const after = await review.comments(projectId);
      expect(after.comments.map((entry) => entry.againstOlderRevision)).toEqual([true, true]);
      expect(after.comments[0].summary).toContain("earlier version");
    });

    it("anchors to a moment on a sequence, exactly", async () => {
      await review.comment({
        projectId, body: "Cut here", authorName: "Alex",
        anchor: { kind: "time", sequenceId: "s1", time: rational(1001, 30000), duration: null },
      });
      const comment = (await projects.getProjectHistory(projectId)).headRevision.state.comments![0];
      expect(comment.anchor).toMatchObject({ kind: "time", time: { numerator: 1001, denominator: 30000 } });
    });

    it("anchors to a region of the frame", async () => {
      await review.comment({
        projectId, body: "Boom in shot", authorName: "Alex",
        anchor: { kind: "region", sequenceId: "s1", time: rational(3), x: 0.1, y: 0, width: 0.3, height: 0.2 },
      });
      expect((await review.comments(projectId)).comments[0].summary).toContain("region");
    });

    it("threads replies inline rather than as a tree to navigate", async () => {
      const added = await review.comment({ projectId, anchor: { kind: "project" }, body: "Too long" });
      const commentId = added.headRevision.state.comments![0].id;
      await review.reply({ projectId, commentId, body: "Agreed", authorName: "Sam" });
      const comment = (await projects.getProjectHistory(projectId)).headRevision.state.comments![0];
      expect(comment.replies).toHaveLength(1);
      expect(comment.replies[0].authorName).toBe("Sam");
    });

    /** "Why is this shot like that" is answered by the thread that led to it. */
    it("resolves rather than deleting, and can be reopened", async () => {
      const added = await review.comment({ projectId, anchor: { kind: "project" }, body: "Too long" });
      const commentId = added.headRevision.state.comments![0].id;

      await review.resolve({ projectId, commentId, by: "Sam" });
      const resolved = (await projects.getProjectHistory(projectId)).headRevision.state.comments![0];
      expect(resolved.resolvedAt).toBeTruthy();
      expect(resolved.body).toBe("Too long");

      await review.resolve({ projectId, commentId, reopen: true });
      expect((await projects.getProjectHistory(projectId)).headRevision.state.comments![0].resolvedAt).toBeNull();
    });

    it("shows open comments by default and resolved ones on request", async () => {
      const first = await review.comment({ projectId, anchor: { kind: "project" }, body: "One" });
      await review.comment({ projectId, anchor: { kind: "project" }, body: "Two" });
      await review.resolve({ projectId, commentId: first.headRevision.state.comments![0].id });

      expect((await review.comments(projectId)).comments).toHaveLength(1);
      expect((await review.comments(projectId, { includeResolved: true })).comments).toHaveLength(2);
      expect((await review.comments(projectId)).summary).toContain("1 still open");
    });

    /** Quietly showing an old note as though it were current is the failure. */
    it("marks a comment written against an earlier version", async () => {
      await review.comment({ projectId, anchor: { kind: "project" }, body: "Too long" });
      await projects.renameProject({ projectId, name: "Renamed" });
      const listed = await review.comments(projectId);
      expect(listed.comments[0].againstOlderRevision).toBe(true);
      expect(listed.comments[0].summary).toContain("written against an earlier version");
    });

    it("refuses an empty comment or reply", async () => {
      await expect(review.comment({ projectId, anchor: { kind: "project" }, body: "   " }))
        .rejects.toThrowError();
      const added = await review.comment({ projectId, anchor: { kind: "project" }, body: "Note" });
      await expect(review.reply({
        projectId, commentId: added.headRevision.state.comments![0].id, body: "  ",
      })).rejects.toThrowError(/needs something in it/);
    });

    it("says so rather than acting on a comment that is not there", async () => {
      await expect(review.resolve({ projectId, commentId: "ghost" })).rejects.toThrowError(/not on this project/);
    });
  });

  /** "Cut v3 final FINAL" is what happens when the editor does not offer this. */
  describe("version stacks", () => {
    it("takes the newest as current when nobody says otherwise", async () => {
      const added = await review.setStack({ projectId, name: "Opening", versionIds: ["v1", "v2", "v3"] });
      expect(added.headRevision.state.versionStacks![0].currentId).toBe("v3");
    });

    it("records which version was approved", async () => {
      const added = await review.setStack({ projectId, name: "Opening", versionIds: ["v1", "v2"] });
      const id = added.headRevision.state.versionStacks![0].id;
      await review.setStack({ projectId, id, approvedId: "v1" });
      expect((await review.stacks(projectId))[0].summary).toContain("version 1 is the approved one");
    });

    it("refuses a current or approved version that is not in the stack", async () => {
      const added = await review.setStack({ projectId, name: "Opening", versionIds: ["v1"] });
      const id = added.headRevision.state.versionStacks![0].id;
      await expect(review.setStack({ projectId, id, approvedId: "ghost" }))
        .rejects.toThrowError(/marked approved is not in this stack/);
    });

    it("removes a stack", async () => {
      const added = await review.setStack({ projectId, name: "Opening", versionIds: ["v1"] });
      const id = added.headRevision.state.versionStacks![0].id;
      const removed = await review.setStack({ projectId, id, remove: true });
      expect(removed.headRevision.state.versionStacks).toEqual([]);
    });
  });

  /** Pretending a claim is a lock would be the most misleading thing this module could do. */
  describe("claims", () => {
    it("says a claim is a note to whoever else opens the project, not a lock", async () => {
      const claimed = await review.claim({
        projectId, objectType: "sequence", objectId: "s1", heldBy: "Alex", note: "grading",
      });
      expect(claimed.advisory).toContain("nothing to enforce it against");
    });

    it("warns before editing something claimed, without refusing", async () => {
      await review.claim({ projectId, objectType: "sequence", objectId: "s1", heldBy: "Alex" });
      const warning = await review.warningFor(projectId, "sequence", "s1");
      expect(warning).toContain("Alex claimed this");
      expect(warning).toContain("Nothing stops you editing it");
    });

    it("says nothing about something nobody has claimed", async () => {
      expect(await review.warningFor(projectId, "sequence", "s2")).toBeNull();
    });

    it("replaces a claim on the same thing rather than stacking two", async () => {
      await review.claim({ projectId, objectType: "sequence", objectId: "s1", heldBy: "Alex" });
      await review.claim({ projectId, objectType: "sequence", objectId: "s1", heldBy: "Sam" });
      const current = await review.currentClaims(projectId);
      expect(current).toHaveLength(1);
      expect(current[0].lock.heldBy).toBe("Sam");
    });

    it("releases a claim, and says nothing was ever prevented by it", async () => {
      await review.claim({ projectId, objectType: "sequence", objectId: "s1", heldBy: "Alex" });
      const released = await review.claim({
        projectId, objectType: "sequence", objectId: "s1", heldBy: "Alex", release: true,
      });
      expect(released.advisory).toContain("Nothing was ever prevented");
      expect(await review.currentClaims(projectId)).toEqual([]);
    });

    /** Otherwise a claim outlives the person who took it. */
    it("leaves out a claim that has expired", async () => {
      await review.claim({
        projectId, objectType: "sequence", objectId: "s1", heldBy: "Alex", expiresInMinutes: 0.0001,
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(await review.currentClaims(projectId)).toEqual([]);
    });
  });

  /** Sharing the project and marking it read-only would be a claim this editor cannot back. */
  describe("sharing", () => {
    it("shares a rendered file, and says that is what makes it read-only", async () => {
      const shared = await review.share({ projectId, name: "Rough cut", outputId: "out-1" });
      expect(shared.summary).toContain("sees a file rather than the project");
    });

    it("records the revision it came from, so a comment can be traced to what was seen", async () => {
      const before = (await projects.getProjectHistory(projectId)).headRevision.id;
      await review.share({ projectId, name: "Rough cut", outputId: "out-1" });
      expect((await review.shares(projectId))[0].share.revisionId).toBe(before);
    });

    it("says plainly when there is nothing rendered to show yet", async () => {
      const shared = await review.share({ projectId, name: "Rough cut" });
      expect(shared.summary).toContain("render one first");
    });
  });

  it("is all undoable, because resolving a comment is work someone did", async () => {
    const added = await review.comment({ projectId, anchor: { kind: "project" }, body: "Too long" });
    await projects.undoTransaction(projectId, added.transaction.id);
    expect((await projects.getProjectHistory(projectId)).headRevision.state.comments ?? []).toEqual([]);
  });
});
