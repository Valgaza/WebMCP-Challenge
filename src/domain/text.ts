import { z } from "zod";
import { ProjectError } from "./project-error";

export const TEXT_SCHEMA_VERSION = 1 as const;

/**
 * Editable text, shared by photo and video.
 *
 * Text is stored as content plus formatting runs rather than as pixels, so a caption stays
 * editable after it is placed, a font can be swapped without redrawing anything, and the same
 * object serves a photo layer and a video title. Rasterising at authoring time would make all
 * three impossible.
 */

/**
 * Point text grows from a single anchor; paragraph text wraps inside a box.
 *
 * The distinction is not cosmetic: it decides whether a width even exists, so it is part of
 * the model rather than a flag on a shared shape.
 */
export const textLayoutSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("point") }),
  z.object({
    kind: z.literal("paragraph"),
    widthPx: z.number().min(1).max(32768),
    heightPx: z.number().min(1).max(32768),
    /** What happens when the text is taller than the box. */
    overflow: z.enum(["visible", "clip", "shrink"]).default("visible"),
  }),
]);
export type TextLayout = z.infer<typeof textLayoutSchema>;

export const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
export const fontWeightSchema = z.union(
  FONT_WEIGHTS.map((weight) => z.literal(weight)) as unknown as [z.ZodLiteral<number>, z.ZodLiteral<number>],
);

/**
 * A font as it was asked for, kept whole.
 *
 * The original descriptor survives substitution: if a project moves to a machine without the
 * font, Estro renders with a stand-in but still knows what was meant, so the text returns to
 * itself when the font comes back rather than being permanently rewritten.
 */
export const fontDescriptorSchema = z.object({
  family: z.string().trim().min(1).max(120),
  weight: z.number().int().min(100).max(900).default(400),
  italic: z.boolean().default(false),
  /** Set when this family is not available and something else is being drawn. */
  substitutedWith: z.string().trim().min(1).max(120).nullable().default(null),
});
export type FontDescriptor = z.infer<typeof fontDescriptorSchema>;

/** Formatting that can vary within a single block of text. */
export const textRunSchema = z.object({
  /** Character offsets into the block's content, half-open. */
  start: z.number().int().min(0).max(100_000),
  end: z.number().int().min(0).max(100_000),
  font: fontDescriptorSchema.optional(),
  sizePx: z.number().min(1).max(2000).optional(),
  /** Extra space between characters, in thousandths of an em, as type tools express it. */
  trackingMille: z.number().min(-500).max(2000).optional(),
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  underline: z.boolean().optional(),
  strikethrough: z.boolean().optional(),
});
export type TextRun = z.infer<typeof textRunSchema>;

export const paragraphStyleSchema = z.object({
  alignment: z.enum(["start", "center", "end", "justify"]).default("start"),
  /** Line height as a multiple of the font size. */
  leading: z.number().min(0.5).max(5).default(1.2),
  indentFirstPx: z.number().min(-500).max(500).default(0),
  indentStartPx: z.number().min(0).max(2000).default(0),
  indentEndPx: z.number().min(0).max(2000).default(0),
  spaceBeforePx: z.number().min(0).max(500).default(0),
  spaceAfterPx: z.number().min(0).max(500).default(0),
  /** Turns the paragraph into a list item; null is ordinary prose. */
  list: z.enum(["bullet", "number"]).nullable().default(null),
});
export type ParagraphStyle = z.infer<typeof paragraphStyleSchema>;

export const DEFAULT_PARAGRAPH: ParagraphStyle = {
  alignment: "start", leading: 1.2, indentFirstPx: 0, indentStartPx: 0, indentEndPx: 0,
  spaceBeforePx: 0, spaceAfterPx: 0, list: null,
};

export const MAX_TEXT_LENGTH = 20_000;

export const textBlockSchema = z.object({
  schemaVersion: z.literal(TEXT_SCHEMA_VERSION),
  content: z.string().max(MAX_TEXT_LENGTH),
  layout: textLayoutSchema,
  /** Applies to everything not covered by a run. */
  font: fontDescriptorSchema,
  sizePx: z.number().min(1).max(2000).default(48),
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#ffffff"),
  trackingMille: z.number().min(-500).max(2000).default(0),
  runs: z.array(textRunSchema).max(500).default([]),
  /** One entry per paragraph, in order. Missing entries fall back to the default. */
  paragraphs: z.array(paragraphStyleSchema).max(500).default([]),
  /** Right-to-left scripts need this at the block level, not per run. */
  direction: z.enum(["ltr", "rtl"]).default("ltr"),
  language: z.string().trim().max(35).nullable().default(null),
});
export type TextBlock = z.infer<typeof textBlockSchema>;

/* ---------------------------------- editing ---------------------------------- */

/** The paragraphs of a block, split the way a text engine sees them. */
export function paragraphsOf(block: TextBlock): string[] {
  return block.content.split("\n");
}

export function styleForParagraph(block: TextBlock, index: number): ParagraphStyle {
  return block.paragraphs[index] ?? DEFAULT_PARAGRAPH;
}

/**
 * Formatting that applies to one character.
 *
 * Later runs win, so applying a run over an existing one behaves the way a user expects from
 * selecting text and pressing bold: the newest instruction is the one in force.
 */
export function formattingAt(block: TextBlock, offset: number): {
  font: FontDescriptor; sizePx: number; colour: string; trackingMille: number;
  underline: boolean; strikethrough: boolean;
} {
  let font = block.font;
  let sizePx = block.sizePx;
  let colour = block.colour;
  let trackingMille = block.trackingMille;
  let underline = false;
  let strikethrough = false;

  for (const run of block.runs) {
    if (offset < run.start || offset >= run.end) continue;
    if (run.font) font = run.font;
    if (run.sizePx !== undefined) sizePx = run.sizePx;
    if (run.colour !== undefined) colour = run.colour;
    if (run.trackingMille !== undefined) trackingMille = run.trackingMille;
    if (run.underline !== undefined) underline = run.underline;
    if (run.strikethrough !== undefined) strikethrough = run.strikethrough;
  }
  return { font, sizePx, colour, trackingMille, underline, strikethrough };
}

export function assertRangeWithin(block: TextBlock, start: number, end: number): void {
  if (start < 0 || end > block.content.length || start >= end) {
    throw new ProjectError(
      "INVALID_INPUT",
      `That range does not lie inside the text, which is ${block.content.length} characters long.`,
      { fieldPath: "range" },
    );
  }
}

/**
 * Adds a run, keeping the list from growing without bound.
 *
 * Runs that a newer one entirely covers are dropped: they can never affect a character again,
 * and keeping them would let a heavily edited block accumulate thousands of dead entries.
 */
export function addRun(block: TextBlock, run: TextRun): TextBlock {
  assertRangeWithin(block, run.start, run.end);
  const surviving = block.runs.filter((existing) => !(existing.start >= run.start && existing.end <= run.end));
  if (surviving.length + 1 > 500) {
    throw new ProjectError("INVALID_INPUT", "This text has too many separate formatting runs.", { fieldPath: "runs" });
  }
  return { ...block, runs: [...surviving, run] };
}

/**
 * Rewrites content and moves the runs with it.
 *
 * Editing the words is the common case, and formatting that stayed at fixed offsets would
 * drift onto the wrong characters the moment anything was typed. Runs entirely after the
 * edit shift; runs spanning it stretch; runs the edit swallowed disappear.
 */
export function replaceText(block: TextBlock, start: number, end: number, insert: string): TextBlock {
  if (start < 0 || end > block.content.length || start > end) {
    throw new ProjectError("INVALID_INPUT", "That range does not lie inside the text.", { fieldPath: "range" });
  }
  const content = block.content.slice(0, start) + insert + block.content.slice(end);
  if (content.length > MAX_TEXT_LENGTH) {
    throw new ProjectError("INVALID_INPUT", `Text is limited to ${MAX_TEXT_LENGTH} characters.`, { fieldPath: "content" });
  }

  const delta = insert.length - (end - start);
  const shift = (offset: number) => (offset <= start ? offset : offset >= end ? offset + delta : start + insert.length);
  const runs = block.runs
    .map((run) => ({ ...run, start: shift(run.start), end: shift(run.end) }))
    .filter((run) => run.end > run.start);

  return { ...block, content, runs };
}

/* -------------------------------- font handling -------------------------------- */

/** Fonts every browser can be relied on to draw, used when a family is missing. */
export const FALLBACK_FAMILIES = ["system-ui", "Georgia", "Courier New"] as const;

/**
 * Picks a stand-in for a missing font and records what was wanted.
 *
 * Substituting silently is the failure worth avoiding: someone would send a file believing it
 * used their brand face. The descriptor keeps the original family, so the text is restored
 * rather than rewritten when the font becomes available.
 */
export function substituteFont(font: FontDescriptor, available: ReadonlySet<string>): FontDescriptor {
  if (available.has(font.family)) return { ...font, substitutedWith: null };
  // A serif asks for a serif; anything else gets the interface face.
  const guess = /serif|times|georgia|garamond|book/i.test(font.family)
    ? "Georgia"
    : /mono|code|courier|consol/i.test(font.family) ? "Courier New" : "system-ui";
  return { ...font, substitutedWith: guess };
}

/** Every font a block asks for, including inside its runs. */
export function fontsUsed(block: TextBlock): FontDescriptor[] {
  const seen = new Map<string, FontDescriptor>();
  const record = (font: FontDescriptor) => {
    const key = `${font.family}|${font.weight}|${font.italic}`;
    if (!seen.has(key)) seen.set(key, font);
  };
  record(block.font);
  for (const run of block.runs) if (run.font) record(run.font);
  return [...seen.values()];
}

/** Applies substitution across a whole block and reports what changed. */
export function resolveFonts(
  block: TextBlock,
  available: ReadonlySet<string>,
): { block: TextBlock; substitutions: { wanted: string; used: string }[] } {
  const substitutions: { wanted: string; used: string }[] = [];
  const resolve = (font: FontDescriptor) => {
    const next = substituteFont(font, available);
    if (next.substitutedWith) substitutions.push({ wanted: font.family, used: next.substitutedWith });
    return next;
  };
  return {
    block: {
      ...block,
      font: resolve(block.font),
      runs: block.runs.map((run) => (run.font ? { ...run, font: resolve(run.font) } : run)),
    },
    substitutions,
  };
}

/** The CSS font shorthand for a descriptor, honouring any substitution in force. */
export function cssFont(font: FontDescriptor, sizePx: number): string {
  const family = font.substitutedWith ?? font.family;
  const quoted = /^[\w-]+$/.test(family) ? family : JSON.stringify(family);
  return `${font.italic ? "italic " : ""}${font.weight} ${sizePx}px ${quoted}, ${FALLBACK_FAMILIES.join(", ")}`;
}

/** A sentence describing a block's typography, for the inspector and agent replies. */
export function describeTypography(block: TextBlock): string {
  const parts = [`${block.font.substitutedWith ?? block.font.family} at ${block.sizePx}px`];
  if (block.font.weight !== 400) parts.push(`weight ${block.font.weight}`);
  if (block.font.italic) parts.push("italic");
  if (block.trackingMille !== 0) parts.push(`tracking ${block.trackingMille}/1000 em`);
  if (block.layout.kind === "paragraph") parts.push(`wrapping in a ${block.layout.widthPx}px box`);
  else parts.push("growing from a point");
  if (block.font.substitutedWith) parts.push(`standing in for the missing “${block.font.family}”`);
  return `${parts.join(", ")}.`;
}
