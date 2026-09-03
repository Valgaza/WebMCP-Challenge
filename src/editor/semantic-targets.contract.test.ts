import { describe, expect, it } from "vitest";
import { semanticTargets } from "./semantic-targets";

/*
 * The registry promises a place in the interface; this checks the place still exists.
 *
 * `data-semantic-id` is the only handle an agent has on the UI — focus, teaching and
 * explanation all address the interface through it. Nothing else in the suite notices when one
 * disappears: exactly one of them is covered by a rendering test, so deleting the attribute
 * while rewriting a panel leaves the other tests green and agent focus quietly broken.
 *
 * A source scan rather than a render, because a rendered check can only see the panels that
 * happen to be mounted for the current selection, and most of these are not.
 */
const sources = import.meta.glob("../**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true });

const attached = new Set(
  Object.entries(sources)
    .filter(([path]) => !path.includes(".test.") && !path.endsWith("semantic-targets.ts"))
    .flatMap(([, source]) => [...(source as string).matchAll(/["']([a-z0-9-]+)["']/g)].map((match) => match[1])),
);

describe("semantic target contract", () => {
  it("renders every registered target somewhere in the source", () => {
    const missing = semanticTargets.map((target) => target.id).filter((id) => !attached.has(id));
    expect(missing).toEqual([]);
  });

  it("registers a unique id for every target", () => {
    const ids = semanticTargets.map((target) => target.id);
    expect(ids).toHaveLength(new Set(ids).size);
  });
});
