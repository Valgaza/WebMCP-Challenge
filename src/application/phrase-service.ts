import { z } from "zod";
import { ADJUSTMENT_RANGES, type AdjustmentName } from "../domain/adjustment";
import { BLEND_MODES } from "../domain/effect";
import { ProjectError, toProjectError } from "../domain/project-error";

/**
 * Turning a phrase into a command Estro already has.
 *
 * This is deliberately not a language model. It is a lookup from words people actually use onto
 * the deterministic commands the rest of the editor is built from, and its value is precisely
 * that: an agent can already write JSON, so a second natural-language layer that *guessed* would
 * add nothing but a way to be wrong. What it adds instead is a resolution step that says what it
 * understood, what it did not, and what it would do — before anything happens.
 *
 * Nothing here changes a project. It returns a command for the caller to run, so the same phrase
 * can be shown to a person for approval, run through the ordinary command path, and appear in
 * history as the edit it actually was rather than as "an AI thing".
 */

export const phraseInputSchema = z.object({
  phrase: z.string().trim().min(1).max(500),
  /** What the phrase is about, when it does not say. */
  context: z.object({
    projectId: z.string().min(1),
    layerId: z.string().min(1).optional(),
    clipId: z.string().min(1).optional(),
    sequenceId: z.string().min(1).optional(),
  }),
});
export type PhraseInput = z.input<typeof phraseInputSchema>;

export interface PhraseResolution {
  understood: boolean;
  /** The tool to call and what to pass it, ready to run unchanged. */
  command: { tool: string; input: Record<string, unknown> } | null;
  /** What the phrase was read as, in words, for a person to confirm before it runs. */
  interpretation: string;
  /** Parts of the phrase that meant nothing here, named rather than ignored. */
  unrecognised: string[];
  /** What to try instead, when nothing was understood. */
  suggestions: string[];
}

/* --------------------------------- the vocabulary --------------------------------- */

/**
 * How strong a word is, as a fraction of a parameter's range.
 *
 * These are the words people actually reach for, and the numbers are deliberately modest: a
 * "slightly" that moved a slider a quarter of its range would be worse than useless, and every
 * one of these is a starting point someone then adjusts.
 */
const INTENSITIES: { words: string[]; amount: number }[] = [
  { words: ["barely", "a touch", "a hair", "slightly", "a little", "a bit", "subtly"], amount: 0.1 },
  { words: ["somewhat", "a fair bit", "moderately", "noticeably"], amount: 0.25 },
  { words: ["a lot", "much", "considerably", "significantly", "heavily"], amount: 0.45 },
  { words: ["way", "far", "massively", "hugely", "dramatically", "completely"], amount: 0.7 },
];

/** Words that mean "the other way", which is how "less" and "not so" are handled. */
const NEGATIONS = ["less", "reduce", "decrease", "lower", "drop", "down", "cut", "de", "un"];

/**
 * What each adjustment is called out loud.
 *
 * More words than parameters, because "warmer" and "warm it up" and "less cold" are one
 * request. Each entry says which way the word points, so "darker" and "brighter" reach the same
 * parameter from opposite ends.
 */
const ADJUSTMENT_WORDS: { words: string[]; name: AdjustmentName; direction: 1 | -1 }[] = [
  { words: ["brighter", "brighten", "lighter", "lighten"], name: "brightness", direction: 1 },
  { words: ["darker", "darken", "dimmer"], name: "brightness", direction: -1 },
  { words: ["punchier", "contrastier", "more contrast", "punch"], name: "contrast", direction: 1 },
  { words: ["flatter", "softer contrast", "less contrast"], name: "contrast", direction: -1 },
  { words: ["warmer", "warm"], name: "temperature", direction: 1 },
  { words: ["cooler", "colder", "cool"], name: "temperature", direction: -1 },
  { words: ["greener"], name: "tint", direction: -1 },
  { words: ["magenta", "pinker"], name: "tint", direction: 1 },
  { words: ["more saturated", "richer", "more colourful", "more colorful", "punchier colour"], name: "saturation", direction: 1 },
  { words: ["desaturated", "muted", "washed out", "less saturated", "duller"], name: "saturation", direction: -1 },
];

/** Phrases that ask for something to happen, rather than for a value to change. */
const ACTIONS: { words: string[]; describe: string; build: (context: PhraseInput["context"]) => { tool: string; input: Record<string, unknown> } | null }[] = [
  {
    words: ["black and white", "monochrome", "greyscale", "grayscale", "mono"],
    describe: "convert to black and white",
    build: (context) => (context.layerId
      ? {
        tool: "apply_layer_operation",
        input: {
          projectId: context.projectId, operation: "add_effect", layerId: context.layerId,
          name: "Black and white", colourOperation: { kind: "black_and_white" },
        },
      }
      : null),
  },
  {
    words: ["invert", "negative"],
    describe: "invert the colours",
    build: (context) => (context.layerId
      ? {
        tool: "apply_layer_operation",
        input: {
          projectId: context.projectId, operation: "add_effect", layerId: context.layerId,
          name: "Invert", colourOperation: { kind: "invert" },
        },
      }
      : null),
  },
  {
    words: ["blur it", "blur this", "add a blur", "soften it", "out of focus"],
    describe: "add a blur",
    build: (context) => (context.layerId
      ? {
        tool: "apply_layer_operation",
        input: {
          projectId: context.projectId, operation: "add_effect", layerId: context.layerId,
          name: "Blur", filter: { kind: "blur", shape: "gaussian", radiusPx: 12 },
        },
      }
      : null),
  },
  {
    words: ["sharpen", "sharper", "crisper"],
    describe: "sharpen it",
    build: (context) => (context.layerId
      ? {
        tool: "apply_layer_operation",
        input: {
          projectId: context.projectId, operation: "add_effect", layerId: context.layerId,
          name: "Sharpen", filter: { kind: "sharpen", method: "unsharp_mask", amount: 100, radiusPx: 1 },
        },
      }
      : null),
  },
  {
    words: ["add grain", "film grain", "grainier"],
    describe: "add film grain",
    build: (context) => (context.layerId
      ? {
        tool: "apply_layer_operation",
        input: {
          projectId: context.projectId, operation: "add_effect", layerId: context.layerId,
          name: "Grain", filter: { kind: "noise", mode: "add", amount: 8, monochrome: true },
        },
      }
      : null),
  },
  {
    words: ["hide", "hide it", "turn it off", "make it invisible"],
    describe: "hide the layer",
    build: (context) => (context.layerId
      ? {
        tool: "apply_layer_operation",
        input: { projectId: context.projectId, operation: "set_visibility", layerId: context.layerId, visible: false },
      }
      : null),
  },
  {
    words: ["show", "show it", "turn it on", "make it visible", "unhide"],
    describe: "show the layer",
    build: (context) => (context.layerId
      ? {
        tool: "apply_layer_operation",
        input: { projectId: context.projectId, operation: "set_visibility", layerId: context.layerId, visible: true },
      }
      : null),
  },
];

/* ---------------------------------- the resolver ---------------------------------- */

function intensityIn(phrase: string): { amount: number; matched: string | null } {
  // The strongest match wins, so "a lot" is not read as the "a" in "a bit". Longer phrases are
  // checked first for the same reason.
  const all = INTENSITIES.flatMap((entry) => entry.words.map((word) => ({ word, amount: entry.amount })));
  all.sort((a, b) => b.word.length - a.word.length);
  for (const entry of all) {
    if (phrase.includes(entry.word)) return { amount: entry.amount, matched: entry.word };
  }
  return { amount: 0.25, matched: null };
}

/**
 * Reads a phrase into a command.
 *
 * A phrase mentioning something Estro has no parameter for is *not* understood, and says which
 * word it did not know — rather than doing the part it recognised and leaving the person to
 * discover the rest was ignored.
 */
export function resolvePhrase(input: PhraseInput): PhraseResolution {
  try {
    const parsed = phraseInputSchema.parse(input);
    const phrase = parsed.phrase.toLowerCase();
    const context = parsed.context;

    // Actions first: "black and white" is a thing to do, and reading "white" as a colour word
    // would be a worse answer.
    const sorted = [...ACTIONS].sort((a, b) =>
      Math.max(...b.words.map((word) => word.length)) - Math.max(...a.words.map((word) => word.length)));
    for (const action of sorted) {
      const matched = action.words.find((word) => phrase.includes(word));
      if (!matched) continue;
      const command = action.build(context);
      if (!command) {
        return {
          understood: false, command: null,
          interpretation: `“${matched}” means ${action.describe}, but nothing is selected to do it to.`,
          unrecognised: [],
          suggestions: ["Select a layer first, or name one in the request."],
        };
      }
      return {
        understood: true, command,
        interpretation: `Understood as: ${action.describe}.`,
        unrecognised: [], suggestions: [],
      };
    }

    // Then adjustments, longest phrase first so "less contrast" beats "contrast".
    const words = [...ADJUSTMENT_WORDS].sort((a, b) =>
      Math.max(...b.words.map((word) => word.length)) - Math.max(...a.words.map((word) => word.length)));

    for (const entry of words) {
      const matched = entry.words.find((word) => phrase.includes(word));
      if (!matched) continue;

      const range = ADJUSTMENT_RANGES[entry.name];
      const { amount, matched: intensityWord } = intensityIn(phrase);
      // A negating word flips the direction, so "less warm" cools rather than warming.
      const negated = NEGATIONS.some((word) => phrase.includes(`${word} ${matched.split(" ")[0]}`))
        && !entry.words.some((word) => word.startsWith("less"));
      const direction = negated ? -entry.direction : entry.direction;
      const span = direction > 0 ? range.max - range.default : range.default - range.min;
      const value = Math.round(range.default + direction * span * amount);

      if (!context.layerId) {
        return {
          understood: false, command: null,
          interpretation: `“${matched}” means ${range.label.toLowerCase()}, but nothing is selected to change.`,
          unrecognised: [],
          suggestions: ["Select a layer first, or name one in the request."],
        };
      }

      return {
        understood: true,
        command: {
          tool: "apply_color_adjustment",
          input: { projectId: context.projectId, layerId: context.layerId, adjustments: { [entry.name]: value } },
        },
        interpretation: intensityWord
          ? `Understood as: set ${range.label.toLowerCase()} to ${value}, from “${intensityWord} ${matched}”.`
          : `Understood as: set ${range.label.toLowerCase()} to ${value}.`,
        unrecognised: [], suggestions: [],
      };
    }

    // Nothing matched. Naming what is available beats "I did not understand".
    const known = [
      ...ADJUSTMENT_WORDS.flatMap((entry) => entry.words),
      ...ACTIONS.flatMap((entry) => entry.words),
    ];
    const nearby = known.filter((word) => {
      const first = word.split(" ")[0];
      return first.length > 3 && phrase.split(/\s+/).some((given) => given.startsWith(first.slice(0, 4)));
    });

    return {
      understood: false,
      command: null,
      interpretation: `Nothing in “${parsed.phrase}” maps onto a command Estro has.`,
      unrecognised: parsed.phrase.split(/\s+/).filter((word) => word.length > 2),
      suggestions: nearby.length
        ? [`Did you mean ${nearby.slice(0, 3).map((word) => `“${word}”`).join(", ")}?`]
        : [`Try one of: ${known.slice(0, 8).map((word) => `“${word}”`).join(", ")}.`],
    };
  } catch (error) { throw toProjectError(error); }
}

/**
 * Every phrase the resolver knows, so an interface can show them rather than make people guess.
 *
 * All of them, not one per group: the whole point of publishing the vocabulary is that someone
 * who says "slightly" finds it, and a list showing only the first synonym of each group would
 * send them away thinking it was not there.
 */
export function knownPhrases(): { phrase: string; means: string }[] {
  const adjustments = ADJUSTMENT_WORDS.flatMap((entry) => entry.words.map((phrase) => ({
    phrase,
    means: `${entry.direction > 0 ? "raises" : "lowers"} ${ADJUSTMENT_RANGES[entry.name].label.toLowerCase()}`,
  })));
  const actions = ACTIONS.flatMap((entry) => entry.words.map((phrase) => ({ phrase, means: entry.describe })));
  const intensities = INTENSITIES.flatMap((entry) => entry.words.map((phrase) => ({
    phrase,
    means: `scales the change to about ${Math.round(entry.amount * 100)}% of the range`,
  })));
  return [...adjustments, ...actions, ...intensities];
}

export function assertKnownBlendMode(name: string): void {
  if (!(BLEND_MODES as readonly string[]).includes(name)) {
    throw new ProjectError(
      "INVALID_INPUT",
      `“${name}” is not a blend mode Estro has. Available: ${BLEND_MODES.join(", ")}.`,
      { fieldPath: "blendMode" },
    );
  }
}
