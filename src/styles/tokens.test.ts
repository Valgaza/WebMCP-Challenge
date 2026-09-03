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
  return new Set([...css.matchAll(/^\s*(--[a-zA-Z0-9-]+)\s*:/gm)].map((match) => match[1]));
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
