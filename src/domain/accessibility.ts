import { z } from "zod";
import { ProjectError } from "./project-error";

export const ACCESSIBILITY_SCHEMA_VERSION = 1 as const;

/**
 * Making the editor usable regardless of how someone sees, moves, or hears.
 *
 * Two principles decide everything here. The first is that a preference set in the operating
 * system is honoured by default and can still be overridden in the application — because a
 * person who needs reduced motion in one program and not another is not misconfigured, and an
 * editor that only reads the system setting cannot serve them.
 *
 * The second is that colour is never the only carrier of meaning. Not because a specification
 * says so, but because a timeline that shows "offline" as a red tint is unreadable to a
 * significant fraction of editors and unprintable for everybody.
 */

/* --------------------------------- preferences --------------------------------- */

/**
 * Three states rather than two.
 *
 * "System" is not the same as "on" or "off": it means follow the operating system, including
 * when that changes while the editor is open. Collapsing it into a boolean loses the ability to
 * go back to following.
 */
export const preferenceModeSchema = z.enum(["system", "on", "off"]);
export type PreferenceMode = z.infer<typeof preferenceModeSchema>;

export const accessibilityPreferencesSchema = z.object({
  schemaVersion: z.literal(ACCESSIBILITY_SCHEMA_VERSION),
  /** Removes animation and transitions. */
  reducedMotion: preferenceModeSchema.default("system"),
  /** Raises contrast and thickens borders. */
  highContrast: preferenceModeSchema.default("system"),
  /**
   * Always on, and not a preference.
   *
   * It is in this record so an interface can read one object, and it is fixed at `true` because
   * a mode where colour is the only signal is not a mode this editor offers. Making it optional
   * would be offering it.
   */
  nonColourIndicators: z.literal(true).default(true),
  /** Keeps focus visible even for a pointer user, which helps far more people than it annoys. */
  alwaysShowFocus: z.boolean().default(false),
  /** Captions on tutorials and previews, on by default rather than opt-in. */
  captions: z.boolean().default(true),
});
export type AccessibilityPreferences = z.infer<typeof accessibilityPreferencesSchema>;

export const DEFAULT_ACCESSIBILITY: AccessibilityPreferences =
  accessibilityPreferencesSchema.parse({ schemaVersion: ACCESSIBILITY_SCHEMA_VERSION });

/** What a three-state preference resolves to, given what the system says. */
export function resolvePreference(mode: PreferenceMode, systemPrefers: boolean): boolean {
  return mode === "system" ? systemPrefers : mode === "on";
}

/** The attributes to put on the root element, so CSS can act on the resolved answer. */
export function rootAttributes(
  preferences: AccessibilityPreferences,
  system: { reducedMotion: boolean; highContrast: boolean },
): Record<string, string> {
  return {
    "data-motion": resolvePreference(preferences.reducedMotion, system.reducedMotion) ? "reduced" : "full",
    "data-contrast": resolvePreference(preferences.highContrast, system.highContrast) ? "high" : "normal",
    "data-focus": preferences.alwaysShowFocus ? "always" : "keyboard",
  };
}

/* ----------------------------- status indicators ----------------------------- */

/**
 * Every state the interface shows, with a shape and a word as well as a colour.
 *
 * The glyph matters more than it looks. A timeline showing offline media as a red tint is
 * unreadable to a significant fraction of editors, invisible in high contrast where the tint is
 * flattened, and gone entirely in a printed screenshot. A shape survives all three.
 */
export const STATUS_KINDS = [
  "available", "offline", "missing", "processing", "queued", "failed", "warning", "modified", "locked",
] as const;
export const statusKindSchema = z.enum(STATUS_KINDS);
export type StatusKind = z.infer<typeof statusKindSchema>;

export interface StatusIndicator {
  kind: StatusKind;
  /** A short word, always shown or available to a screen reader. */
  label: string;
  /** A shape that reads without colour. */
  glyph: string;
  /** The colour, which is the least of the three signals rather than the only one. */
  colour: string;
  /** What it means, for a tooltip and for an agent explaining the interface. */
  meaning: string;
}

const INDICATORS: Record<StatusKind, StatusIndicator> = {
  available: { kind: "available", label: "Ready", glyph: "●", colour: "#3fb950", meaning: "The media is readable and everything works." },
  offline: { kind: "offline", label: "Offline", glyph: "◌", colour: "#d29922", meaning: "The file is registered but cannot be read right now. Relink it." },
  missing: { kind: "missing", label: "Missing", glyph: "✕", colour: "#f85149", meaning: "The file is gone from where it was. Relink it or remove the reference." },
  processing: { kind: "processing", label: "Working", glyph: "◐", colour: "#58a6ff", meaning: "Something is being generated now." },
  queued: { kind: "queued", label: "Queued", glyph: "◔", colour: "#8b949e", meaning: "Waiting for something else to finish first." },
  failed: { kind: "failed", label: "Failed", glyph: "▲", colour: "#f85149", meaning: "It stopped with an error. The reason is on the job." },
  warning: { kind: "warning", label: "Check", glyph: "!", colour: "#d29922", meaning: "It worked, but something about it is worth looking at." },
  modified: { kind: "modified", label: "Edited", glyph: "◆", colour: "#58a6ff", meaning: "Changed since it was last saved or exported." },
  locked: { kind: "locked", label: "Locked", glyph: "▣", colour: "#8b949e", meaning: "Someone has claimed this, or it is locked against editing." },
};

export function indicatorFor(kind: StatusKind): StatusIndicator {
  return INDICATORS[kind];
}

export function allIndicators(): StatusIndicator[] {
  return STATUS_KINDS.map((kind) => INDICATORS[kind]);
}

/**
 * What a screen reader says, and what a tooltip shows.
 *
 * The colour is never named: "red" tells a person nothing they can act on, and is meaningless
 * to anyone who cannot see it.
 */
export function describeStatus(kind: StatusKind, subject?: string): string {
  const indicator = INDICATORS[kind];
  return subject
    ? `${subject}: ${indicator.label}. ${indicator.meaning}`
    : `${indicator.label}. ${indicator.meaning}`;
}

/**
 * Checks that no two states can be told apart only by colour.
 *
 * A test rather than a convention, because this is exactly the sort of thing that decays: a
 * tenth status gets added with a new colour and the same glyph as an existing one, and nobody
 * notices until someone cannot use the timeline.
 */
export function assertIndicatorsAreDistinguishable(): void {
  const byGlyph = new Map<string, StatusKind[]>();
  for (const indicator of allIndicators()) {
    const held = byGlyph.get(indicator.glyph) ?? [];
    held.push(indicator.kind);
    byGlyph.set(indicator.glyph, held);
  }
  const shared = [...byGlyph.entries()].filter(([, kinds]) => kinds.length > 1);
  if (shared.length) {
    throw new ProjectError(
      "INVALID_INPUT",
      `${shared.map(([glyph, kinds]) => `“${glyph}” is used by ${kinds.join(" and ")}`).join("; ")}. Two states that share a shape can only be told apart by colour.`,
      { fieldPath: "glyph" },
    );
  }
}

/* ------------------------------ keyboard operation ------------------------------ */

/**
 * One thing a person can do, and how to do it without a mouse.
 *
 * The record exists so the claim "everything is reachable from the keyboard" can be *checked*
 * rather than asserted. An action with no shortcut and no place in the tab order is a hole, and
 * a hole nobody can find is a hole that stays.
 */
export const keyboardActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1).max(120),
  /** Which part of the interface it belongs to, for a shortcut sheet people can read. */
  group: z.enum(["global", "project", "timeline", "canvas", "panels", "playback", "selection"]),
  /** The shortcut, written the way it is shown. Null when it is reached by tabbing instead. */
  keys: z.string().trim().min(1).max(60).nullable(),
  /**
   * How it is reached without a shortcut.
   *
   * Required when there is no shortcut: "you can tab to it" is only true if something says
   * where, and this is what makes the claim checkable.
   */
  reachedBy: z.string().trim().min(1).max(200),
});
export type KeyboardAction = z.infer<typeof keyboardActionSchema>;

/**
 * Refuses a keyboard map with a hole or a collision in it.
 *
 * Two actions on one shortcut is the failure that gets shipped: both appear to work in testing
 * because whichever is checked first wins, and the other is simply unreachable.
 */
export function assertKeyboardMap(actions: readonly KeyboardAction[]): void {
  const byKeys = new Map<string, string[]>();
  for (const action of actions) {
    if (!action.keys) continue;
    const normalised = action.keys.toLowerCase().replace(/\s+/g, "");
    const held = byKeys.get(normalised) ?? [];
    held.push(action.id);
    byKeys.set(normalised, held);
  }

  const collisions = [...byKeys.entries()].filter(([, ids]) => ids.length > 1);
  if (collisions.length) {
    throw new ProjectError(
      "INVALID_INPUT",
      `${collisions.map(([keys, ids]) => `${keys} is bound to ${ids.join(" and ")}`).join("; ")}. Whichever is checked first wins and the other is unreachable.`,
      { fieldPath: "keys" },
    );
  }

  const unreachable = actions.filter((action) => !action.keys && !action.reachedBy.trim());
  if (unreachable.length) {
    throw new ProjectError(
      "INVALID_INPUT",
      `${unreachable.map((action) => action.id).join(", ")} have no shortcut and no stated way to be reached, so nothing can confirm they are reachable at all.`,
      { fieldPath: "reachedBy" },
    );
  }
}

/** The shortcut sheet, grouped, for a dialogue people can actually read. */
export function shortcutSheet(actions: readonly KeyboardAction[]): {
  group: KeyboardAction["group"];
  actions: { label: string; keys: string; how: string }[];
}[] {
  const groups = new Map<KeyboardAction["group"], KeyboardAction[]>();
  for (const action of actions) {
    const held = groups.get(action.group) ?? [];
    held.push(action);
    groups.set(action.group, held);
  }
  return [...groups.entries()].map(([group, held]) => ({
    group,
    actions: held.map((action) => ({
      label: action.label,
      keys: action.keys ?? "—",
      how: action.keys ? action.reachedBy : `No shortcut. ${action.reachedBy}`,
    })),
  }));
}

/* -------------------------------- captioned help -------------------------------- */

/**
 * A tutorial step, with everything needed to follow it without sound or sight.
 *
 * Captions are on by default rather than opt-in, and the transcript is not the captions: one is
 * timed to the demonstration and the other is readable on its own. A tutorial that only exists
 * as a video is a tutorial some people cannot use at all.
 */
export const tutorialStepSchema = z.object({
  id: z.string().min(1),
  /** What this step teaches, in one line. */
  title: z.string().trim().min(1).max(120),
  /** The full instruction, readable without watching anything. */
  text: z.string().trim().min(1).max(2000),
  /** Timed captions for the demonstration, when there is one. */
  captions: z.array(z.object({
    startSeconds: z.number().min(0),
    endSeconds: z.number().min(0),
    text: z.string().trim().min(1).max(300),
  })).max(200).default([]),
  /**
   * What the demonstration shows, for someone who cannot see it.
   *
   * Not the same as the caption text: captions carry what is said, this carries what happens.
   */
  audioDescription: z.string().trim().max(1000).default(""),
  /** Which control the step is about, so the interface can point at it. */
  targetId: z.string().min(1).nullable().default(null),
});
export type TutorialStep = z.infer<typeof tutorialStepSchema>;

/**
 * Refuses a tutorial that cannot be followed without watching it.
 *
 * The check is that the written instruction is substantial on its own — not that captions
 * exist, because captions of a demonstration are not instructions.
 */
export function assertFollowableWithoutVideo(step: TutorialStep): void {
  if (step.text.trim().length < 20) {
    throw new ProjectError(
      "INVALID_INPUT",
      `“${step.title}” has almost no written instruction, so it can only be followed by watching. Write out what to do.`,
      { fieldPath: "text" },
    );
  }
  if (step.captions.length && !step.audioDescription.trim()) {
    throw new ProjectError(
      "INVALID_INPUT",
      `“${step.title}” has a demonstration with captions but nothing describing what it shows. Captions carry what is said; someone who cannot see the screen also needs what happens.`,
      { fieldPath: "audioDescription" },
    );
  }
}

/** Captions in order, with any overlap reported rather than silently fixed. */
export function checkCaptionTiming(step: TutorialStep): { overlaps: number; ordered: boolean } {
  const sorted = [...step.captions].sort((a, b) => a.startSeconds - b.startSeconds);
  let overlaps = 0;
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].startSeconds < sorted[index - 1].endSeconds) overlaps += 1;
  }
  const ordered = step.captions.every((caption, index) =>
    index === 0 || caption.startSeconds >= step.captions[index - 1].startSeconds);
  return { overlaps, ordered };
}
