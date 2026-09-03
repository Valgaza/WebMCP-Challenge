import { z } from "zod";
import {
  MAX_COMMENTS_PER_PROJECT, REVIEW_SCHEMA_VERSION, assertCommentCount, assertStackIsCoherent,
  capabilitiesOf, collaboratorSchema, commentAnchorSchema, commentSchema, commentsForSequence,
  describeComment, describeRole, describeShare, describeStack,
  lockIsCurrent, lockSchema, lockWarning, roleAllows, roleSchema, shareSchema, versionStackSchema,
  type Capability, type Comment, type Role,
} from "../domain/review";
import { ProjectError, toProjectError } from "../domain/project-error";
import type { ProjectCommandContext, ProjectMutationResult, ProjectService, ReviewState } from "./project-service";

/**
 * Showing work to someone and hearing back.
 *
 * Nothing here is enforcement. A role does not stop anyone doing anything, a lock does not
 * prevent an edit on another machine, and a read-only share is read-only because what is shared
 * is a rendered file rather than a project. Every method that could be mistaken for enforcement
 * says so in what it returns, because a permission model that looks like it enforces something
 * and does not is worse than none at all.
 */

export const commentInputSchema = z.object({
  projectId: z.string().min(1),
  anchor: commentAnchorSchema,
  body: z.string().trim().min(1).max(4000),
  authorName: z.string().trim().min(1).max(120).default("You"),
  authorId: z.string().min(1).nullish(),
});
export type CommentInput = z.input<typeof commentInputSchema>;

export class ReviewService {
  constructor(private readonly projects: ProjectService) {}

  private async stateOf(projectId: string): Promise<ReviewState & { revisionId: string }> {
    const history = await this.projects.getProjectHistory(projectId);
    const state = history.headRevision.state;
    return {
      collaborators: state.collaborators ?? [],
      comments: state.comments ?? [],
      versionStacks: state.versionStacks ?? [],
      locks: state.locks ?? [],
      shares: state.shares ?? [],
      revisionId: history.headRevision.id,
    };
  }

  private async commit(
    projectId: string,
    label: string,
    change: (state: ReviewState) => ReviewState,
    context: ProjectCommandContext,
  ): Promise<ProjectMutationResult> {
    const { revisionId: _revisionId, ...from } = await this.stateOf(projectId);
    return this.projects.applyReview({ projectId, label, from, to: change(from) }, context);
  }

  /* -------------------------------- people -------------------------------- */

  /**
   * Adds or changes someone on the project.
   *
   * The result says what the role permits *and* that it permits nothing technically, so an
   * interface built on this cannot accidentally present it as a guarantee.
   */
  async setCollaborator(
    input: { projectId: string; id?: string; name: string; role: Role; email?: string | null },
    context: ProjectCommandContext = {},
  ): Promise<ProjectMutationResult & { advisory: string }> {
    try {
      const role = roleSchema.parse(input.role);
      const state = await this.stateOf(input.projectId);
      const existing = input.id ? state.collaborators.find((entry) => entry.id === input.id) : undefined;
      if (input.id && !existing) {
        throw new ProjectError("INVALID_INPUT", "That person is not on this project.", { fieldPath: "id" });
      }

      const collaborator = collaboratorSchema.parse({
        id: existing?.id ?? crypto.randomUUID(),
        name: input.name, role,
        email: input.email ?? existing?.email ?? null,
        addedAt: existing?.addedAt ?? new Date().toISOString(),
      });

      const result = await this.commit(
        input.projectId,
        existing ? `Change ${collaborator.name} to ${role}` : `Add ${collaborator.name} as ${role}`,
        (from) => ({
          ...from,
          collaborators: existing
            ? from.collaborators.map((entry) => (entry.id === collaborator.id ? collaborator : entry))
            : [...from.collaborators, collaborator],
        }),
        context,
      );
      return { ...result, advisory: describeRole(role) };
    } catch (error) { throw toProjectError(error); }
  }

  async removeCollaborator(
    projectId: string, collaboratorId: string, context: ProjectCommandContext = {},
  ): Promise<ProjectMutationResult> {
    const state = await this.stateOf(projectId);
    const going = state.collaborators.find((entry) => entry.id === collaboratorId);
    if (!going) {
      throw new ProjectError("INVALID_INPUT", "That person is not on this project.", { fieldPath: "collaboratorId" });
    }
    return this.commit(
      projectId, `Remove ${going.name}`,
      (from) => ({ ...from, collaborators: from.collaborators.filter((entry) => entry.id !== collaboratorId) }),
      context,
    );
  }

  /**
   * What a role permits, and the fact that it permits nothing technically.
   *
   * Returned together on purpose: separating them would let an interface show the first without
   * the second.
   */
  permissions(role: Role): { capabilities: Capability[]; advisory: string; enforced: false } {
    return { capabilities: capabilitiesOf(role), advisory: describeRole(role), enforced: false };
  }

  canDo(role: Role, capability: Capability): { allowed: boolean; advisory: string } {
    return {
      allowed: roleAllows(role, capability),
      advisory: roleAllows(role, capability)
        ? `A ${role} is expected to ${capability.replace(/_/g, " ")}.`
        : `A ${role} is not expected to ${capability.replace(/_/g, " ")}. Estro will not offer it, and cannot prevent it.`,
    };
  }

  /* ------------------------------- comments ------------------------------- */

  /** Leaves a note, recording which version it was written against. */
  async comment(input: CommentInput, context: ProjectCommandContext = {}): Promise<ProjectMutationResult> {
    try {
      const parsed = commentInputSchema.parse(input);
      const state = await this.stateOf(parsed.projectId);
      assertCommentCount(state.comments.length + 1);

      const comment = commentSchema.parse({
        id: crypto.randomUUID(), schemaVersion: REVIEW_SCHEMA_VERSION,
        anchor: parsed.anchor, body: parsed.body,
        authorName: parsed.authorName, authorId: parsed.authorId ?? null,
        createdAt: new Date().toISOString(),
        // Recorded so a note about a shot that has since been recut can be shown as what it is.
        revisionId: state.revisionId,
      });

      return this.commit(
        parsed.projectId, `Comment from ${comment.authorName}`,
        (from) => ({ ...from, comments: [...from.comments, comment] }),
        context,
      );
    } catch (error) { throw toProjectError(error); }
  }

  async reply(
    input: { projectId: string; commentId: string; body: string; authorName?: string },
    context: ProjectCommandContext = {},
  ): Promise<ProjectMutationResult> {
    const state = await this.stateOf(input.projectId);
    const target = state.comments.find((entry) => entry.id === input.commentId);
    if (!target) {
      throw new ProjectError("INVALID_INPUT", "That comment is not on this project.", { fieldPath: "commentId" });
    }
    const reply = {
      id: crypto.randomUUID(),
      body: input.body.trim(),
      authorName: input.authorName ?? "You",
      createdAt: new Date().toISOString(),
    };
    if (!reply.body) {
      throw new ProjectError("INVALID_INPUT", "A reply needs something in it.", { fieldPath: "body" });
    }

    return this.commit(
      input.projectId, `Reply from ${reply.authorName}`,
      (from) => ({
        ...from,
        comments: from.comments.map((entry) => (entry.id === input.commentId
          ? { ...entry, replies: [...entry.replies, reply] }
          : entry)),
      }),
      context,
    );
  }

  /**
   * Marks a comment dealt with.
   *
   * Resolved rather than deleted, so the conversation survives: "why is this shot like that" is
   * answered by the thread that led to it, and deleting the thread deletes the answer.
   */
  async resolve(
    input: { projectId: string; commentId: string; by?: string; reopen?: boolean },
    context: ProjectCommandContext = {},
  ): Promise<ProjectMutationResult> {
    const state = await this.stateOf(input.projectId);
    const target = state.comments.find((entry) => entry.id === input.commentId);
    if (!target) {
      throw new ProjectError("INVALID_INPUT", "That comment is not on this project.", { fieldPath: "commentId" });
    }

    const resolving = !input.reopen;
    return this.commit(
      input.projectId,
      resolving ? "Resolve a comment" : "Reopen a comment",
      (from) => ({
        ...from,
        comments: from.comments.map((entry) => (entry.id === input.commentId
          ? {
            ...entry,
            resolvedAt: resolving ? new Date().toISOString() : null,
            resolvedBy: resolving ? input.by ?? "You" : null,
          }
          : entry)),
      }),
      context,
    );
  }

  /**
   * Comments, with the ones written against an older version of the picture marked as such.
   *
   * "Older" has to mean the picture changed, not merely that the head moved: writing a comment
   * is itself a commit, so comparing the recorded revision against the current head would mark
   * every note as stale the instant it was written. A note, a reply, a resolution and a rating
   * all commit revisions without altering a pixel, so those are excluded — what is left is
   * exactly the question the reader has, which is whether the thing they were looking at has
   * since been edited.
   */
  async comments(projectId: string, options: { sequenceId?: string; includeResolved?: boolean } = {}): Promise<{
    comments: (Comment & { againstOlderRevision: boolean; summary: string })[];
    open: number;
    summary: string;
  }> {
    const state = await this.stateOf(projectId);
    const history = await this.projects.getProjectHistory(projectId);

    const changesThePicture = (transaction: { operations: readonly { type: string }[] }): boolean =>
      transaction.operations.some((operation) => operation.type !== "project.review" && operation.type !== "project.catalogue");

    const sequenceOf = new Map(history.transactions.map((transaction) => [transaction.resultingRevisionId, transaction.sequence]));
    const lastPictureChange = history.transactions
      .filter(changesThePicture)
      .reduce((latest, transaction) => Math.max(latest, transaction.sequence), -1);

    const staleFor = (comment: Comment): boolean => {
      if (comment.revisionId === null) return false;
      const seen = sequenceOf.get(comment.revisionId);
      // A revision that is no longer in the transaction list was reverted out from under it.
      if (seen === undefined) return true;
      return lastPictureChange > seen;
    };
    const scoped = options.sequenceId
      ? commentsForSequence(state.comments, options.sequenceId)
      : state.comments;
    const filtered = options.includeResolved ? scoped : scoped.filter((entry) => !entry.resolvedAt);

    const comments = filtered.map((comment) => ({
      ...comment,
      againstOlderRevision: staleFor(comment),
      // The describer takes a revision to compare against, so it is handed the comment's own
      // when nothing has changed since — which is what makes it say "current".
      summary: describeComment(comment, staleFor(comment) ? state.revisionId : comment.revisionId ?? state.revisionId),
    }));
    const open = scoped.filter((entry) => !entry.resolvedAt).length;

    return {
      comments, open,
      summary: `${comments.length} comment(s) shown, ${open} still open.`,
    };
  }

  /* ---------------------------- version stacks ---------------------------- */

  async setStack(
    input: {
      projectId: string; id?: string; name?: string;
      versionIds?: string[]; currentId?: string; approvedId?: string | null; remove?: boolean;
    },
    context: ProjectCommandContext = {},
  ): Promise<ProjectMutationResult> {
    try {
      const state = await this.stateOf(input.projectId);
      const existing = input.id ? state.versionStacks.find((entry) => entry.id === input.id) : undefined;
      if (input.id && !existing) {
        throw new ProjectError("INVALID_INPUT", "That version stack is not in this project.", { fieldPath: "id" });
      }

      if (input.remove) {
        if (!existing) {
          throw new ProjectError("INVALID_INPUT", "Removing a stack needs its id.", { fieldPath: "id" });
        }
        return this.commit(
          input.projectId, `Remove the version stack “${existing.name}”`,
          (from) => ({ ...from, versionStacks: from.versionStacks.filter((entry) => entry.id !== existing.id) }),
          context,
        );
      }

      const versionIds = input.versionIds ?? existing?.versionIds;
      if (!versionIds?.length) {
        throw new ProjectError("INVALID_INPUT", "A version stack needs at least one version.", { fieldPath: "versionIds" });
      }

      const stack = versionStackSchema.parse({
        id: existing?.id ?? crypto.randomUUID(),
        schemaVersion: REVIEW_SCHEMA_VERSION,
        name: input.name ?? existing?.name ?? "Versions",
        versionIds,
        // The newest is the sensible current one when nobody says otherwise.
        currentId: input.currentId ?? existing?.currentId ?? versionIds[versionIds.length - 1],
        approvedId: input.approvedId === undefined ? existing?.approvedId ?? null : input.approvedId,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      });
      assertStackIsCoherent(stack);

      return this.commit(
        input.projectId,
        existing ? `Change the version stack “${stack.name}”` : `Add the version stack “${stack.name}”`,
        (from) => ({
          ...from,
          versionStacks: existing
            ? from.versionStacks.map((entry) => (entry.id === stack.id ? stack : entry))
            : [...from.versionStacks, stack],
        }),
        context,
      );
    } catch (error) { throw toProjectError(error); }
  }

  async stacks(projectId: string): Promise<{ stack: ReturnType<typeof versionStackSchema.parse>; summary: string }[]> {
    const state = await this.stateOf(projectId);
    return state.versionStacks.map((stack) => ({ stack, summary: describeStack(stack) }));
  }

  /* -------------------------------- locking -------------------------------- */

  /**
   * Claims something, or releases it.
   *
   * Advisory, and the result says so. There is nothing to enforce it against, and pretending
   * otherwise would be the single most misleading thing this module could do.
   */
  async claim(
    input: {
      projectId: string; objectType: "project" | "sequence" | "layer" | "clip"; objectId: string;
      heldBy: string; note?: string; expiresInMinutes?: number; release?: boolean;
    },
    context: ProjectCommandContext = {},
  ): Promise<ProjectMutationResult & { advisory: string }> {
    const state = await this.stateOf(input.projectId);
    const held = state.locks.find(
      (lock) => lock.objectType === input.objectType && lock.objectId === input.objectId,
    );

    if (input.release) {
      if (!held) {
        throw new ProjectError("INVALID_INPUT", "Nothing is claimed on that.", { fieldPath: "objectId" });
      }
      const result = await this.commit(
        input.projectId, `Release ${input.objectType}`,
        (from) => ({
          ...from,
          locks: from.locks.filter(
            (lock) => !(lock.objectType === input.objectType && lock.objectId === input.objectId),
          ),
        }),
        context,
      );
      return { ...result, advisory: "Released. Nothing was ever prevented by it." };
    }

    const lock = lockSchema.parse({
      objectType: input.objectType, objectId: input.objectId,
      heldBy: input.heldBy,
      takenAt: new Date().toISOString(),
      expiresAt: input.expiresInMinutes
        ? new Date(Date.now() + input.expiresInMinutes * 60_000).toISOString()
        : null,
      note: input.note ?? "",
    });

    const result = await this.commit(
      input.projectId, `${input.heldBy} claimed a ${input.objectType}`,
      (from) => ({
        ...from,
        locks: [
          ...from.locks.filter(
            (entry) => !(entry.objectType === input.objectType && entry.objectId === input.objectId),
          ),
          lock,
        ],
      }),
      context,
    );
    return {
      ...result,
      advisory: "This is a note to whoever else opens the project, not a lock. Estro has nothing to enforce it against.",
    };
  }

  /** What to warn about before editing something someone has claimed. */
  async warningFor(
    projectId: string,
    objectType: "project" | "sequence" | "layer" | "clip",
    objectId: string,
  ): Promise<string | null> {
    const state = await this.stateOf(projectId);
    const lock = state.locks.find((entry) => entry.objectType === objectType && entry.objectId === objectId);
    return lock ? lockWarning(lock) : null;
  }

  /** Claims that have not expired. */
  async currentClaims(projectId: string): Promise<{ lock: ReturnType<typeof lockSchema.parse>; warning: string }[]> {
    const state = await this.stateOf(projectId);
    return state.locks
      .filter((lock) => lockIsCurrent(lock))
      .map((lock) => ({ lock, warning: lockWarning(lock) ?? "" }));
  }

  /* --------------------------------- shares --------------------------------- */

  /**
   * Records something handed out for review.
   *
   * What is shared is a rendered file, which is what makes it genuinely read-only: there is
   * nothing in it to edit. Recording the revision it came from is what lets a comment be traced
   * to what the person actually saw.
   */
  async share(
    input: {
      projectId: string; name: string; outputId?: string | null;
      role?: Role; watermarked?: boolean; note?: string;
    },
    context: ProjectCommandContext = {},
  ): Promise<ProjectMutationResult & { summary: string }> {
    const state = await this.stateOf(input.projectId);
    const share = shareSchema.parse({
      id: crypto.randomUUID(), schemaVersion: REVIEW_SCHEMA_VERSION,
      projectId: input.projectId, name: input.name,
      revisionId: state.revisionId,
      outputId: input.outputId ?? null,
      role: input.role ?? "reviewer",
      createdAt: new Date().toISOString(),
      watermarked: input.watermarked ?? false,
      note: input.note ?? "",
    });

    const result = await this.commit(
      input.projectId, `Share “${share.name}”`,
      (from) => ({ ...from, shares: [...from.shares, share] }),
      context,
    );
    return { ...result, summary: describeShare(share) };
  }

  async shares(projectId: string): Promise<{ share: ReturnType<typeof shareSchema.parse>; summary: string }[]> {
    const state = await this.stateOf(projectId);
    return state.shares.map((share) => ({ share, summary: describeShare(share) }));
  }
}

export { MAX_COMMENTS_PER_PROJECT };
