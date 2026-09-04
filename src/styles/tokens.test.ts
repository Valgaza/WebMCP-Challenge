import { describe, expect, it } from "vitest";
import css from "./index.css?raw";

/*
 * The stylesheet is the one part of this project TypeScript cannot see.
 *
 * `--canvas-surface` was referenced by the loading skeleton and defined nowhere, so that
 * element simply had no background and nothing anywhere reported it. A typo in a token name
 * fails exactly this quietly, which is why it is worth a test rather than a convention: the
 * token migration rewrites hundreds of declarations, and a single mistyped name would
 * otherwise reach the browser.
 */

function declaredTokens(): Set<string> {
  /*
   * A declaration can start after a brace or a semicolon, not only at the start of a line.
   *
   * Requiring line-start made this report two tokens as undefined that were declared inline on
   * one rule — a false alarm that would have sent someone hunting a typo that was not there.
   */
  return new Set([...css.matchAll(/(?:^|[{;])\s*(--[a-zA-Z0-9-]+)\s*:/gm)].map((match) => match[1]));
}

function referencedTokens(): Set<string> {
  return new Set([...css.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)].map((match) => match[1]));
}

describe("stylesheet tokens", () => {
  it("never references a custom property it does not define", () => {
    const declared = declaredTokens();
    const undefinedTokens = [...referencedTokens()].filter((token) => !declared.has(token)).sort();
    expect(undefinedTokens).toEqual([]);
  });

  /*
   * Removing one selector from a group leaves the group without a body.
   *
   * Deleting `.workspace-identity span { … }` from the end of a four-selector list left
   * `.storage-line svg,` followed by a closing brace. jsdom parsed it, the dev server served
   * it, and 928 tests passed; only the production minifier refused it. A trailing comma before
   * a brace is never valid, so it is worth one regex.
   */
  it("never leaves a selector list without a body", () => {
    const dangling = css
      .split("\n")
      .map((line, index) => ({ line: line.trim(), number: index + 1 }))
      .filter(({ line }, index, all) => line === "}" && all[index - 1]?.line.endsWith(","))
      .map(({ number }) => number);
    expect(dangling).toEqual([]);
  });

  it("keeps every declared custom property in use", () => {
    const referenced = referencedTokens();
    /* Tokens read from JavaScript rather than from another rule. */
    const readElsewhere = new Set(["--leading-panel-width", "--trailing-panel-width"]);
    const unused = [...declaredTokens()]
      .filter((token) => !referenced.has(token) && !readElsewhere.has(token))
      .sort();
    expect(unused).toEqual([]);
  });
});
