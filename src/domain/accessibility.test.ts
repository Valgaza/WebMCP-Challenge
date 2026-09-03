import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACCESSIBILITY, STATUS_KINDS, accessibilityPreferencesSchema, allIndicators,
  assertFollowableWithoutVideo, assertIndicatorsAreDistinguishable, assertKeyboardMap,
  checkCaptionTiming, describeStatus, indicatorFor, keyboardActionSchema, resolvePreference,
  rootAttributes, shortcutSheet, tutorialStepSchema, type KeyboardAction,
} from "./accessibility";

const action = (overrides: Partial<KeyboardAction>): KeyboardAction => keyboardActionSchema.parse({
  id: "a", label: "Do the thing", group: "global",
  keys: "Cmd+K", reachedBy: "In the command palette.",
  ...overrides,
});

const step = (overrides: Record<string, unknown> = {}) => tutorialStepSchema.parse({
  id: "s1", title: "Add a clip",
  text: "Drag a clip from the media panel onto the timeline, or select it and press full stop.",
  ...overrides,
});

/**
 * `SH-084`, `SH-087` through `SH-089`. A preference set in the operating system is honoured and
 * can still be overridden here — a person who needs reduced motion in one program and not
 * another is not misconfigured.
 */
describe("preferences", () => {
  it("follows the system by default", () => {
    expect(DEFAULT_ACCESSIBILITY.reducedMotion).toBe("system");
    expect(DEFAULT_ACCESSIBILITY.highContrast).toBe("system");
  });

  /** Collapsing "system" into a boolean loses the ability to go back to following. */
  it("keeps three states, so following can be resumed", () => {
    expect(resolvePreference("system", true)).toBe(true);
    expect(resolvePreference("system", false)).toBe(false);
    expect(resolvePreference("on", false)).toBe(true);
    expect(resolvePreference("off", true)).toBe(false);
  });

  it("resolves to attributes CSS can act on", () => {
    const attributes = rootAttributes(DEFAULT_ACCESSIBILITY, { reducedMotion: true, highContrast: false });
    expect(attributes["data-motion"]).toBe("reduced");
    expect(attributes["data-contrast"]).toBe("normal");
  });

  it("lets someone turn a mode on even when the system does not ask for it", () => {
    const preferences = accessibilityPreferencesSchema.parse({ schemaVersion: 1, highContrast: "on" });
    expect(rootAttributes(preferences, { reducedMotion: false, highContrast: false })["data-contrast"])
      .toBe("high");
  });

  /** A mode where colour is the only signal is not a mode this editor offers. */
  it("will not let non-colour indicators be switched off", () => {
    expect(DEFAULT_ACCESSIBILITY.nonColourIndicators).toBe(true);
    expect(() => accessibilityPreferencesSchema.parse({ schemaVersion: 1, nonColourIndicators: false }))
      .toThrowError();
  });

  it("has captions on by default rather than opt-in", () => {
    expect(DEFAULT_ACCESSIBILITY.captions).toBe(true);
  });
});

/**
 * A timeline showing offline media as a red tint is unreadable to a significant fraction of
 * editors, invisible in high contrast, and gone in a printed screenshot.
 */
describe("status indicators", () => {
  it("gives every state a word and a shape as well as a colour", () => {
    for (const kind of STATUS_KINDS) {
      const indicator = indicatorFor(kind);
      expect(indicator.label.length).toBeGreaterThan(0);
      expect(indicator.glyph.length).toBeGreaterThan(0);
      expect(indicator.meaning.length).toBeGreaterThan(10);
    }
  });

  /** This is exactly the sort of thing that decays as a tenth status gets added. */
  it("checks that no two states share a shape", () => {
    expect(() => assertIndicatorsAreDistinguishable()).not.toThrow();
    expect(new Set(allIndicators().map((indicator) => indicator.glyph)).size).toBe(STATUS_KINDS.length);
  });

  /** "Red" tells a person nothing they can act on, and nothing at all if they cannot see it. */
  it("never names the colour when describing a state", () => {
    for (const kind of STATUS_KINDS) {
      const described = describeStatus(kind, "take1.mp4").toLowerCase();
      for (const colour of ["red", "green", "amber", "yellow", "blue", "grey", "gray", "orange"]) {
        // Word boundaries, or "registered" would count as naming red.
        expect(described).not.toMatch(new RegExp(`\\b${colour}\\b`));
      }
    }
  });

  it("says what to do about it, not only what it is", () => {
    expect(describeStatus("offline")).toContain("Relink it");
    expect(describeStatus("missing", "take1.mp4")).toContain("take1.mp4: Missing");
  });
});

/** "Everything is reachable from the keyboard" should be checkable, not asserted. */
describe("keyboard operation", () => {
  it("accepts a map with no collisions", () => {
    expect(() => assertKeyboardMap([
      action({ id: "a", keys: "Cmd+K" }),
      action({ id: "b", keys: "Cmd+S" }),
    ])).not.toThrow();
  });

  /**
   * Two actions on one shortcut ships because both appear to work in testing: whichever is
   * checked first wins, and the other is simply unreachable.
   */
  it("refuses two actions on one shortcut, and says why it would be missed", () => {
    expect(() => assertKeyboardMap([
      action({ id: "save", keys: "Cmd+S" }),
      action({ id: "share", keys: "cmd + s" }),
    ])).toThrowError(/whichever is checked first wins/i);
  });

  it("allows an action with no shortcut, as long as it says how it is reached", () => {
    expect(() => assertKeyboardMap([
      action({ id: "obscure", keys: null, reachedBy: "Tab from the export button." }),
    ])).not.toThrow();
  });

  it("refuses an action with no shortcut and no stated route", () => {
    // The schema requires a route, so the check catches a whitespace-only one.
    const hole = { ...action({ id: "hole", keys: null }), reachedBy: "   " } as KeyboardAction;
    expect(() => assertKeyboardMap([hole])).toThrowError(/nothing can confirm they are reachable/);
  });

  it("produces a sheet grouped the way a person would look for it", () => {
    const sheet = shortcutSheet([
      action({ id: "a", group: "timeline", label: "Split", keys: "Cmd+K" }),
      action({ id: "b", group: "timeline", label: "Ripple delete", keys: "Shift+Delete" }),
      action({ id: "c", group: "playback", label: "Play", keys: "Space" }),
    ]);
    expect(sheet.map((entry) => entry.group)).toEqual(["timeline", "playback"]);
    expect(sheet[0].actions).toHaveLength(2);
  });

  it("shows an em dash rather than an empty cell for an action with no shortcut", () => {
    const sheet = shortcutSheet([action({ id: "a", keys: null, reachedBy: "Tab from the toolbar." })]);
    expect(sheet[0].actions[0].keys).toBe("—");
    expect(sheet[0].actions[0].how).toContain("No shortcut");
  });
});

/** A tutorial that only exists as a video is a tutorial some people cannot use at all. */
describe("captioned tutorials", () => {
  it("accepts a step that can be followed by reading it", () => {
    expect(() => assertFollowableWithoutVideo(step())).not.toThrow();
  });

  it("refuses a step whose instruction is only in the video", () => {
    expect(() => assertFollowableWithoutVideo(step({ text: "Watch this." })))
      .toThrowError(/only be followed by watching/);
  });

  /** Captions carry what is said; someone who cannot see also needs what happens. */
  it("refuses a demonstration with captions but nothing describing what it shows", () => {
    expect(() => assertFollowableWithoutVideo(step({
      captions: [{ startSeconds: 0, endSeconds: 2, text: "Now drag it across" }],
    }))).toThrowError(/also needs what happens/);

    expect(() => assertFollowableWithoutVideo(step({
      captions: [{ startSeconds: 0, endSeconds: 2, text: "Now drag it across" }],
      audioDescription: "The pointer drags a clip from the media panel onto the first video track.",
    }))).not.toThrow();
  });

  it("reports overlapping captions rather than silently fixing them", () => {
    const overlapping = step({
      captions: [
        { startSeconds: 0, endSeconds: 3, text: "First" },
        { startSeconds: 2, endSeconds: 5, text: "Second" },
      ],
      audioDescription: "Something happens.",
    });
    expect(checkCaptionTiming(overlapping).overlaps).toBe(1);
    // Unchanged: reporting, not correcting.
    expect(overlapping.captions[0].endSeconds).toBe(3);
  });

  it("notices captions given out of order", () => {
    const jumbled = step({
      captions: [
        { startSeconds: 5, endSeconds: 7, text: "Later" },
        { startSeconds: 0, endSeconds: 2, text: "Earlier" },
      ],
      audioDescription: "Something happens.",
    });
    expect(checkCaptionTiming(jumbled).ordered).toBe(false);
  });

  it("is happy with a step that has no demonstration at all", () => {
    expect(checkCaptionTiming(step())).toEqual({ overlaps: 0, ordered: true });
  });
});
