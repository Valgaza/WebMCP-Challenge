import { describe, expect, it } from "vitest";
import {
  DEFAULT_PARAGRAPH, addRun, cssFont, describeTypography, fontsUsed, formattingAt,
  paragraphsOf, replaceText, resolveFonts, styleForParagraph, substituteFont, textBlockSchema,
  type TextBlock,
} from "./text";

const block = (overrides: Partial<TextBlock> = {}): TextBlock => textBlockSchema.parse({
  schemaVersion: 1,
  content: "Hello world",
  layout: { kind: "point" },
  font: { family: "Inter", weight: 400, italic: false, substitutedWith: null },
  sizePx: 48, colour: "#ffffff", trackingMille: 0, runs: [], paragraphs: [], direction: "ltr", language: null,
  ...overrides,
});

/**
 * `SH-056`, `SH-057`, `SH-042`, and `SH-058`. Text is content plus formatting runs rather than
 * pixels, which is what keeps a caption editable after it is placed and lets the same object
 * serve a photo layer and a video title.
 */
describe("text formatting", () => {
  it("falls back to the block's own formatting outside every run", () => {
    const formatting = formattingAt(block(), 0);
    expect(formatting.font.family).toBe("Inter");
    expect(formatting.sizePx).toBe(48);
    expect(formatting.underline).toBe(false);
  });

  it("applies a run only to the characters it covers", () => {
    const styled = addRun(block(), { start: 0, end: 5, sizePx: 96, underline: true });
    expect(formattingAt(styled, 2)).toMatchObject({ sizePx: 96, underline: true });
    // "world" is outside the run and keeps the block's formatting.
    expect(formattingAt(styled, 8)).toMatchObject({ sizePx: 48, underline: false });
  });

  it("lets a later run win, the way selecting text and pressing bold behaves", () => {
    const first = addRun(block(), { start: 0, end: 11, colour: "#ff0000" });
    const second = addRun(first, { start: 0, end: 5, colour: "#00ff00" });
    expect(formattingAt(second, 1).colour).toBe("#00ff00");
    expect(formattingAt(second, 8).colour).toBe("#ff0000");
  });

  it("drops a run a newer one entirely covers rather than accumulating dead entries", () => {
    const inner = addRun(block(), { start: 2, end: 4, colour: "#111111" });
    const outer = addRun(inner, { start: 0, end: 11, colour: "#222222" });
    expect(outer.runs).toHaveLength(1);
  });

  it("refuses a run that does not lie inside the text", () => {
    expect(() => addRun(block(), { start: 5, end: 99, sizePx: 10 })).toThrowError(/does not lie inside/);
    expect(() => addRun(block(), { start: 5, end: 5, sizePx: 10 })).toThrowError(/does not lie inside/);
  });
});

/**
 * Formatting pinned to fixed offsets drifts onto the wrong characters the moment anything is
 * typed, so runs move with the edit.
 */
describe("editing content", () => {
  it("shifts a run that sits after an insertion", () => {
    const styled = addRun(block(), { start: 6, end: 11, colour: "#abcdef" });
    const edited = replaceText(styled, 0, 0, ">> ");
    expect(edited.content).toBe(">> Hello world");
    expect(edited.runs[0]).toMatchObject({ start: 9, end: 14 });
    expect(formattingAt(edited, 9).colour).toBe("#abcdef");
  });

  it("leaves a run that sits before an edit exactly where it was", () => {
    const styled = addRun(block(), { start: 0, end: 5, colour: "#abcdef" });
    const edited = replaceText(styled, 6, 11, "there");
    expect(edited.content).toBe("Hello there");
    expect(edited.runs[0]).toMatchObject({ start: 0, end: 5 });
  });

  it("stretches a run that spans the edit", () => {
    const styled = addRun(block(), { start: 0, end: 11, colour: "#abcdef" });
    const edited = replaceText(styled, 5, 6, " glorious ");
    expect(edited.content).toBe("Hello glorious world");
    expect(edited.runs[0].end).toBe(edited.content.length);
  });

  it("drops a run the edit swallowed whole", () => {
    const styled = addRun(block(), { start: 6, end: 11, colour: "#abcdef" });
    const edited = replaceText(styled, 0, 11, "Gone");
    expect(edited.content).toBe("Gone");
    expect(edited.runs).toEqual([]);
  });

  it("refuses an edit outside the text and one that would exceed the limit", () => {
    expect(() => replaceText(block(), 0, 99, "x")).toThrowError(/does not lie inside/);
    expect(() => replaceText(block(), 0, 0, "x".repeat(20_001))).toThrowError(/limited to/);
  });
});

describe("paragraphs", () => {
  it("splits content the way a text engine sees it", () => {
    expect(paragraphsOf(block({ content: "One\nTwo\nThree" }))).toEqual(["One", "Two", "Three"]);
  });

  it("falls back to the default style for a paragraph with none of its own", () => {
    const styled = block({
      content: "One\nTwo",
      paragraphs: [{ ...DEFAULT_PARAGRAPH, alignment: "center", list: "bullet" }],
    });
    expect(styleForParagraph(styled, 0)).toMatchObject({ alignment: "center", list: "bullet" });
    expect(styleForParagraph(styled, 1)).toEqual(DEFAULT_PARAGRAPH);
  });

  it("keeps paragraph text's box, which point text does not have", () => {
    const wrapped = block({ layout: { kind: "paragraph", widthPx: 400, heightPx: 200, overflow: "shrink" } });
    expect(wrapped.layout).toMatchObject({ kind: "paragraph", widthPx: 400, overflow: "shrink" });
    expect(block().layout).toEqual({ kind: "point" });
  });
});

/**
 * `SH-042`. Substituting silently is the failure worth avoiding: someone would send a file
 * believing it used their brand face.
 */
describe("missing fonts", () => {
  const available = new Set(["Inter", "Georgia", "system-ui", "Courier New"]);

  it("leaves an available font alone", () => {
    const font = substituteFont({ family: "Inter", weight: 400, italic: false, substitutedWith: null }, available);
    expect(font.substitutedWith).toBeNull();
  });

  it("keeps the original family so the text returns when the font comes back", () => {
    const font = substituteFont({ family: "Brand Sans", weight: 700, italic: false, substitutedWith: null }, available);
    expect(font.family).toBe("Brand Sans");
    expect(font.substitutedWith).toBe("system-ui");
    expect(font.weight).toBe(700);
  });

  it("matches a serif with a serif rather than the interface face", () => {
    expect(substituteFont({ family: "Times New Roman", weight: 400, italic: false, substitutedWith: null }, available).substitutedWith).toBe("Georgia");
    expect(substituteFont({ family: "Fira Mono", weight: 400, italic: false, substitutedWith: null }, available).substitutedWith).toBe("Courier New");
  });

  it("reports every substitution across a block, including inside runs", () => {
    const styled = addRun(block(), {
      start: 0, end: 5, font: { family: "Missing Display", weight: 400, italic: false, substitutedWith: null },
    });
    const resolved = resolveFonts(styled, available);
    expect(resolved.substitutions).toEqual([{ wanted: "Missing Display", used: "system-ui" }]);
    expect(resolved.block.runs[0].font!.family).toBe("Missing Display");
  });

  it("lists every font a block asks for", () => {
    const styled = addRun(block(), {
      start: 0, end: 5, font: { family: "Other", weight: 700, italic: true, substitutedWith: null },
    });
    expect(fontsUsed(styled).map((font) => font.family).sort()).toEqual(["Inter", "Other"]);
  });

  it("draws with the stand-in while naming it, and always has a fallback stack", () => {
    const substituted = { family: "Brand Sans", weight: 700, italic: true, substitutedWith: "system-ui" };
    const css = cssFont(substituted, 32);
    expect(css).toContain("italic 700 32px system-ui");
    expect(css).toContain("Georgia");
    expect(cssFont({ family: "Brand Sans Pro", weight: 400, italic: false, substitutedWith: null }, 20))
      .toContain('"Brand Sans Pro"');
  });

  it("says in words when a font is standing in for another", () => {
    const resolved = resolveFonts(block({ font: { family: "Brand", weight: 400, italic: false, substitutedWith: null } }), available);
    expect(describeTypography(resolved.block)).toContain("standing in for the missing “Brand”");
    expect(describeTypography(block())).toContain("Inter at 48px");
    expect(describeTypography(block({ layout: { kind: "paragraph", widthPx: 300, heightPx: 100, overflow: "visible" } })))
      .toContain("300px box");
  });
});
