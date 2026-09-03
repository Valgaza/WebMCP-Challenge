import { z } from "zod";
import { rationalSchema, toSeconds, type Rational } from "./time";
import { ProjectError } from "./project-error";

export const REVIEW_SCHEMA_VERSION = 1 as const;

/**
 * Showing work to someone else and hearing back about it.
 *
 * There is no server, so none of this can be enforced. A role does not stop anyone doing
 * anything; a lock does not prevent an edit on another machine; a read-only link is read-only
 * because the thing shared is a rendered file rather than a project.
 *
 * That is stated everywhere it matters rather than hidden, because a permission model that
 * looks like it enforces something and does not is worse than no permission model at all. What
 * these records *do* is carry intent between people who are cooperating — which is what
 * permissions mostly do anyway, and the only thing they can honestly do here.
 */

/* ----------------------------------- roles ----------------------------------- */

/**
 * What someone is expected to do with a project.
 *
 * Advisory. The editor shows a viewer fewer controls and warns before a reviewer commits an
 * edit, and neither is a security boundary — a person with the file has the file.
 */
export const ROLES = ["owner", "editor", "reviewer", "viewer"] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export const CAPABILITIES = [
  "edit", "comment", "resolve_comments", "export", "share", "manage_people", "delete",
] as const;
export const capabilitySchema = z.enum(CAPABILITIES);
export type Capability = z.infer<typeof capabilitySchema>;

const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  owner: [...CAPABILITIES],
  editor: ["edit", "comment", "resolve_comments", "export", "share"],
  // A reviewer's whole job is to comment, and resolving their own point is part of that.
  reviewer: ["comment", "resolve_comments"],
  viewer: [],
};

export function capabilitiesOf(role: Role): Capability[] {
  return [...ROLE_CAPABILITIES[role]];
}

export function roleAllows(role: Role, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}

/**
 * Explains what a role does and does not stop.
 *
 * The second half of the sentence is the important one, and it is the part a permission model
 * usually leaves out.
 */
export function describeRole(role: Role): string {
  const allowed = capabilitiesOf(role);
  const what = allowed.length
    ? `can ${allowed.join(", ").replace(/_/g, " ")}`
    : "can look, and nothing else";
  return `A ${role} ${what}. This is what Estro will offer them, not something it can enforce: anyone holding the file holds the work.`;
}

export const collaboratorSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  role: roleSchema,
  /** Optional; a name is enough for a record that enforces nothing. */
  email: z.string().trim().email().nullable().default(null),
  addedAt: z.string().datetime(),
});
export type Collaborator = z.infer<typeof collaboratorSchema>;

/* ---------------------------------- comments ---------------------------------- */

/**
 * What a comment is attached to.
 *
 * Four kinds because four things are actually pointed at: the whole project, one object, a
 * moment in time, and a region of the frame. A comment that could only be attached to a project
 * is a message; a comment attached to a timecode and a rectangle is a note, and a note is what
 * review consists of.
 */
export const commentAnchorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project") }),
  z.object({
    kind: z.literal("object"),
    objectType: z.enum(["layer", "clip", "track", "sequence", "asset"]),
    objectId: z.string().min(1),
  }),
  /**
   * A moment on a sequence.
   *
   * Rational, like every other time here, because a comment at 00:01:23:14 has to still be at
   * 00:01:23:14 after the timebase is inspected — a float would drift and put the note on the
   * wrong frame.
   */
  z.object({
    kind: z.literal("time"),
    sequenceId: z.string().min(1),
    time: rationalSchema,
    /** For a note about a stretch rather than an instant. */
    duration: rationalSchema.nullable().default(null),
  }),
  /**
   * A rectangle on the frame at a moment.
   *
   * Normalised to the frame, so a note drawn on a proxy preview lands in the same place on the
   * full-size render.
   */
  z.object({
    kind: z.literal("region"),
    sequenceId: z.string().min(1).nullable(),
    time: rationalSchema.nullable(),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0).max(1),
    height: z.number().min(0).max(1),
  }),
]);
export type CommentAnchor = z.infer<typeof commentAnchorSchema>;

export const commentSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(REVIEW_SCHEMA_VERSION),
  anchor: commentAnchorSchema,
  body: z.string().trim().min(1).max(4000),
  authorName: z.string().trim().min(1).max(120),
  authorId: z.string().min(1).nullable().default(null),
  createdAt: z.string().datetime(),
  /** Set when it is dealt with, rather than the comment being deleted. */
  resolvedAt: z.string().datetime().nullable().default(null),
  resolvedBy: z.string().trim().max(120).nullable().default(null),
  /**
   * The revision the comment was made against.
   *
   * Recorded because a note about a shot that has since been recut may no longer make sense,
   * and saying "this was written three versions ago" is more useful than quietly showing it as
   * though it were current.
   */
  revisionId: z.string().min(1).nullable().default(null),
  /** Replies, kept inline: a thread is one conversation, not a tree to navigate. */
  replies: z.array(z.object({
    id: z.string().min(1),
    body: z.string().trim().min(1).max(4000),
    authorName: z.string().trim().min(1).max(120),
    createdAt: z.string().datetime(),
  })).max(200).default([]),
});
export type Comment = z.infer<typeof commentSchema>;

export const MAX_COMMENTS_PER_PROJECT = 5000;

/** Whether a comment is about a moment, for a timeline that shows them as markers. */
export function commentTime(comment: Comment): Rational | null {
  if (comment.anchor.kind === "time") return comment.anchor.time;
  if (comment.anchor.kind === "region") return comment.anchor.time;
  return null;
}

/** Comments on one sequence, in time order, with the unanchored ones after them. */
export function commentsForSequence(comments: readonly Comment[], sequenceId: string): Comment[] {
  return comments
    .filter((comment) => {
      if (comment.anchor.kind === "time") return comment.anchor.sequenceId === sequenceId;
      if (comment.anchor.kind === "region") return comment.anchor.sequenceId === sequenceId;
      if (comment.anchor.kind === "object") return comment.anchor.objectId === sequenceId;
      return false;
    })
    .sort((a, b) => {
      const at = commentTime(a);
      const bt = commentTime(b);
      if (at && bt) return toSeconds(at) - toSeconds(bt);
      if (at) return -1;
      if (bt) return 1;
      return a.createdAt.localeCompare(b.createdAt);
    });
}

/**
 * Whether a comment predates the current state.
 *
 * Not "is it stale" — that would be a judgement. It is "was this written about something that
 * has since changed", which the reader can weigh for themselves.
 */
export function isAgainstOlderRevision(comment: Comment, currentRevisionId: string): boolean {
  return comment.revisionId !== null && comment.revisionId !== currentRevisionId;
}

export function assertCommentCount(count: number): void {
  if (count > MAX_COMMENTS_PER_PROJECT) {
    throw new ProjectError(
      "INVALID_INPUT",
      `A project holds at most ${MAX_COMMENTS_PER_PROJECT} comments.`,
      { fieldPath: "comments" },
    );
  }
}

/** A sentence describing where a comment points. */
export function describeAnchor(anchor: CommentAnchor): string {
  switch (anchor.kind) {
    case "project": return "on the project as a whole";
    case "object": return `on a ${anchor.objectType}`;
    case "time":
      return anchor.duration
        ? `over ${toSeconds(anchor.duration).toFixed(2)}s from ${toSeconds(anchor.time).toFixed(2)}s`
        : `at ${toSeconds(anchor.time).toFixed(2)}s`;
    case "region": {
      const where = `${Math.round(anchor.x * 100)}%, ${Math.round(anchor.y * 100)}% of the frame`;
      return anchor.time ? `on a region at ${where}, at ${toSeconds(anchor.time).toFixed(2)}s` : `on a region at ${where}`;
    }
  }
}

export function describeComment(comment: Comment, currentRevisionId?: string): string {
  const state = comment.resolvedAt ? "resolved" : "open";
  const stale = currentRevisionId && isAgainstOlderRevision(comment, currentRevisionId)
    ? ", written against an earlier version"
    : "";
  const replies = comment.replies.length ? `, ${comment.replies.length} repl${comment.replies.length === 1 ? "y" : "ies"}` : "";
  return `${comment.authorName}, ${describeAnchor(comment.anchor)}: “${comment.body.slice(0, 80)}${comment.body.length > 80 ? "…" : ""}” (${state}${replies}${stale}).`;
}

/* -------------------------------- version stacks -------------------------------- */

/**
 * Several attempts at the same thing, kept together.
 *
 * A stack is a name and an ordered list of sequences. The alternative — a naming convention like
 * "Cut v3 final FINAL" — is what everyone does when the editor does not offer this, and it is
 * why nobody can find which one was approved.
 */
export const versionStackSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(REVIEW_SCHEMA_VERSION),
  name: z.string().trim().min(1).max(120),
  /** Sequence ids, oldest first. */
  versionIds: z.array(z.string().min(1)).min(1).max(50),
  /** Which one is the current answer. Must be one of the versions. */
  currentId: z.string().min(1),
  /** Which one, if any, someone signed off. */
  approvedId: z.string().min(1).nullable().default(null),
  createdAt: z.string().datetime(),
});
export type VersionStack = z.infer<typeof versionStackSchema>;

export function assertStackIsCoherent(stack: VersionStack): void {
  if (!stack.versionIds.includes(stack.currentId)) {
    throw new ProjectError(
      "INVALID_INPUT",
      "The version marked current is not in this stack.",
      { fieldPath: "currentId" },
    );
  }
  if (stack.approvedId && !stack.versionIds.includes(stack.approvedId)) {
    throw new ProjectError(
      "INVALID_INPUT",
      "The version marked approved is not in this stack.",
      { fieldPath: "approvedId" },
    );
  }
  if (new Set(stack.versionIds).size !== stack.versionIds.length) {
    throw new ProjectError(
      "INVALID_INPUT",
      "A version appears twice in this stack, so “the next version” would be ambiguous.",
      { fieldPath: "versionIds" },
    );
  }
}

export function describeStack(stack: VersionStack): string {
  const position = stack.versionIds.indexOf(stack.currentId) + 1;
  const approved = stack.approvedId
    ? stack.approvedId === stack.currentId
      ? ", which is the approved one"
      : `, and version ${stack.versionIds.indexOf(stack.approvedId) + 1} is the approved one`
    : ", none approved yet";
  return `“${stack.name}”: ${stack.versionIds.length} version(s), showing version ${position}${approved}.`;
}

/* ----------------------------------- locking ----------------------------------- */

/**
 * A claim that someone is working on something.
 *
 * Advisory, and it has to be — there is nothing to enforce it against. Its value is that two
 * people cooperating can see each other's claims when they share a project, and the warning
 * says exactly that rather than implying a guarantee.
 */
export const lockSchema = z.object({
  objectType: z.enum(["project", "sequence", "layer", "clip"]),
  objectId: z.string().min(1),
  heldBy: z.string().trim().min(1).max(120),
  takenAt: z.string().datetime(),
  /** After this, the lock is treated as abandoned rather than held for ever. */
  expiresAt: z.string().datetime().nullable().default(null),
  note: z.string().trim().max(200).default(""),
});
export type Lock = z.infer<typeof lockSchema>;

export function lockIsCurrent(lock: Lock, now = new Date()): boolean {
  if (!lock.expiresAt) return true;
  return Date.parse(lock.expiresAt) > now.getTime();
}

/**
 * What to say when someone edits something another person has claimed.
 *
 * A warning rather than a refusal. Refusing would be pretending to enforce something that
 * cannot be enforced, and would also be wrong whenever the other person has simply gone home.
 */
export function lockWarning(lock: Lock, now = new Date()): string | null {
  if (!lockIsCurrent(lock, now)) return null;
  const since = Math.round((now.getTime() - Date.parse(lock.takenAt)) / 60_000);
  const how = since < 1 ? "just now" : since < 60 ? `${since} minute(s) ago` : `${Math.round(since / 60)} hour(s) ago`;
  return `${lock.heldBy} claimed this ${how}${lock.note ? ` — “${lock.note}”` : ""}. Nothing stops you editing it, but they may be working on it too.`;
}

/* --------------------------------- share links --------------------------------- */

/**
 * What is handed to someone for review.
 *
 * A rendered file plus its comments, not the project. That is what makes it genuinely
 * read-only: there is nothing in it to edit. The alternative — sharing the project and marking
 * it read-only — would be a claim this editor cannot back.
 */
export const shareSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(REVIEW_SCHEMA_VERSION),
  projectId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  /** The revision it was made from, so a comment can be traced to what was actually seen. */
  revisionId: z.string().min(1),
  /** The rendered output being shown. */
  outputId: z.string().min(1).nullable(),
  /** What the recipient is invited to do. */
  role: roleSchema.default("reviewer"),
  createdAt: z.string().datetime(),
  /** Burned into the picture, for a cut that must not be mistaken for a delivery. */
  watermarked: z.boolean().default(false),
  note: z.string().trim().max(500).default(""),
});
export type Share = z.infer<typeof shareSchema>;

export function describeShare(share: Share): string {
  const what = share.outputId ? "a rendered file" : "nothing yet — render one first";
  return `“${share.name}” shows ${what} from revision ${share.revisionId.slice(0, 8)}${share.watermarked ? ", watermarked" : ""}. The recipient sees a file rather than the project, which is what makes it read-only.`;
}
