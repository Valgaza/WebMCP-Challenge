import { ADJUSTMENT_RANGES, type AdjustmentName } from "./adjustment";

/**
 * What an editing term actually means, for someone who has never used an editor.
 *
 * This is the product's argument in one file. "Saturation" is not a hard idea — it is an
 * unfamiliar word for a familiar idea — and the gap between those two things is the reason
 * most people never touch the controls that would fix their photograph. Naming the idea in
 * ordinary words, at the moment a control moves, is how the vocabulary gets learned: not by
 * reading a manual first, but by seeing the word and the effect together.
 *
 * Deliberately kept away from the tool layer and the interface, so the person dragging a
 * slider and the agent reporting what it did are reading from the same page.
 */

interface Term {
  /** The idea, in words nobody needs a dictionary for. */
  meaning: string;
  /** What moving it up does, so the direction is never a guess. */
  more: string;
  /** And down. */
  less: string;
}

const ADJUSTMENT_TERMS: Record<AdjustmentName, Term> = {
  brightness: {
    meaning: "how light or dark the whole picture is",
    more: "lifts everything toward white, including the shadows",
    less: "pulls everything toward black",
  },
  contrast: {
    meaning: "the gap between the darkest and lightest parts",
    more: "makes darks darker and lights lighter, so the picture looks punchier",
    less: "closes that gap, so the picture looks flatter and softer",
  },
  temperature: {
    meaning: "whether the light in the picture feels warm or cold",
    more: "adds orange, the colour of late afternoon and indoor lamps",
    less: "adds blue, the colour of shade and overcast daylight",
  },
  tint: {
    meaning: "the green-to-pink cast that fluorescent light and shade leave behind",
    more: "adds magenta, which usually corrects a green cast",
    less: "adds green, which usually corrects a magenta cast",
  },
  hue: {
    meaning: "which colours things are, independent of how bright or vivid they are",
    more: "rotates every colour the same way around the colour wheel, taking grass toward blue",
    less: "rotates them the other way, taking grass toward yellow",
  },
  saturation: {
    meaning: "how strong and vivid the colours are",
    more: "makes colours richer, though pushed too far it turns skin sunburnt",
    less: "drains the colour out, all the way to black and white",
  },
  lightness: {
    meaning: "brightness again, but applied evenly rather than lifting the shadows",
    more: "raises the whole picture toward white without opening up the dark parts",
    less: "lowers it toward black",
  },
};

/**
 * A sentence explaining an adjustment in ordinary words, with the direction it was moved.
 *
 * Written to be read after the fact — "here is what just happened and what the word means" —
 * which is why it names the effect rather than the parameter.
 */
export function explainAdjustment(name: AdjustmentName, value: number): string {
  const term = ADJUSTMENT_TERMS[name];
  const range = ADJUSTMENT_RANGES[name];
  const label = range.label.toLowerCase();
  if (value === range.default) {
    return `${range.label} is ${term.meaning}. It is back at its default, so it is changing nothing.`;
  }
  return `${range.label} is ${term.meaning}. More ${label} ${term.more}; less ${term.less}.`;
}

/** Just the idea, without the direction — for a tooltip or a list of what Estro can change. */
export function meaningOf(name: AdjustmentName): string {
  return ADJUSTMENT_TERMS[name].meaning;
}

/**
 * The same treatment for the structural edits.
 *
 * Shorter, because "duplicate a layer" needs less explaining than "saturation" — but a person
 * who has never stacked layers still does not know that hiding one is not deleting it, or
 * that a group can be moved as a unit. Anything not listed returns null rather than an
 * invented explanation.
 */
const OPERATION_TERMS: Record<string, string> = {
  add_image: "A layer is one picture in a stack. Adding one puts it on top; the ones underneath are untouched and still there.",
  add_text: "Text is stored as text, not as pixels, so it can be re-worded or re-sized later without going blurry.",
  add_shape: "A shape is drawn from its description rather than from pixels, so it stays sharp at any size.",
  duplicate: "A copy of the layer, directly above the original. Changing one leaves the other alone.",
  remove: "The layer is taken out of the stack. Undo brings it back exactly as it was.",
  set_visibility: "Hiding a layer takes it out of the picture without deleting it. Everything about it is still there.",
  set_opacity: "Opacity is how much of the layer you can see through. At 50% the layers underneath show through it.",
  set_lock: "Locking a layer stops it being moved or changed by accident. It still draws normally.",
  group: "A group holds several layers and moves them as one, the way a folder holds files.",
  ungroup: "The layers come out of the group and keep their own positions.",
  reorder: "Stacking order decides what covers what. Higher in the list means nearer the front.",
  crop: "Cropping changes which part of the picture you keep. The rest is set aside rather than thrown away.",
  transform: "Position, size and rotation are stored as instructions, so moving something is never destructive.",
  flip: "Mirrors the layer. Text and anything with writing in it will read backwards.",
  straighten: "Rotates by a small angle to level a horizon, then trims the corners that rotating exposed.",
  fit: "Scales the layer until it fits inside the canvas without cropping anything.",
  align: "Lines the chosen layers up against a shared edge or centre.",
  set_blend_mode: "A blend mode changes how a layer's colours mix with what is underneath, rather than just covering it.",
  add_mask: "A mask hides part of a layer without erasing it. Paint the mask back and the picture returns.",
  add_effect: "Effects are re-run every time the picture is drawn, so they can be adjusted or removed at any point.",
};

export function explainOperation(operation: string): string | null {
  return OPERATION_TERMS[operation] ?? null;
}
