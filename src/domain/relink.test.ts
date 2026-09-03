import { describe, expect, it } from "vitest";
import { assertPlanApplies, describeMatch, isAutomatic, planRelink } from "./relink";

const offline = (name: string, byteSize: number, contentHash: string, assetId = name) =>
  ({ assetId, name, byteSize, contentHash });

const file = (name: string, byteSize: number, contentHash?: string | null) =>
  ({ key: `/media/${name}`, name, byteSize, contentHash });

/**
 * `VI-010`. Relinking the wrong file is much worse than not relinking: a shot silently replaced
 * by a different take is a mistake nobody notices until the grade, whereas a file left offline
 * is obvious and harmless. Every match therefore carries how certain it is.
 */
describe("matching missing media", () => {
  it("matches identical bytes whatever the file is now called", () => {
    const plan = planRelink([offline("take1.mp4", 1000, "h1")], [file("renamed.mp4", 1000, "h1")]);
    expect(plan.matches).toHaveLength(1);
    expect(plan.matches[0]).toMatchObject({ strength: "exact", automatic: true });
    expect(plan.matches[0].reason).toContain("whatever it is now called");
  });

  it("matches the same name and size confidently, but not automatically", () => {
    const plan = planRelink([offline("take1.mp4", 1000, "h1")], [file("take1.mp4", 1000, null)]);
    expect(plan.matches[0]).toMatchObject({ strength: "confident", automatic: false });
  });

  it("offers a same-name file of a different size, saying what is odd about it", () => {
    const plan = planRelink([offline("take1.mp4", 1000, "h1")], [file("take1.mp4", 5000, null)]);
    expect(plan.matches[0]).toMatchObject({ strength: "likely", automatic: false });
    expect(plan.matches[0].reason).toContain("larger");
    expect(plan.matches[0].reason).toContain("possibly a different file");
  });

  it("ignores capitalisation and stray spaces in names", () => {
    // A file renamed by a system that lowercased the extension is still the same file.
    expect(planRelink([offline("Take 1.mp4", 1000, "h1")], [file("take 1.MP4", 1000, null)]).matches)
      .toHaveLength(1);
    expect(planRelink([offline("Take 1.mp4", 1000, "h1")], [file("  TAKE  1.mp4  ", 1000, null)]).matches)
      .toHaveLength(1);
    // A genuinely different name still does not match.
    expect(planRelink([offline("Take 1.mp4", 1000, "h1")], [file("Take 2.mp4", 1000, null)]).matches)
      .toHaveLength(0);
  });

  /** A definite match must never be lost to a guess made earlier on a different asset. */
  it("takes the certain match first, even when a weaker one was found first", () => {
    const plan = planRelink(
      [offline("a.mp4", 1000, "hA", "a"), offline("b.mp4", 1000, "hB", "b")],
      // The file named a.mp4 actually holds b's bytes.
      [file("a.mp4", 1000, "hB")],
    );
    expect(plan.matches).toHaveLength(1);
    expect(plan.matches[0]).toMatchObject({ assetId: "b", strength: "exact" });
    expect(plan.unmatched.map((entry) => entry.assetId)).toEqual(["a"]);
  });

  /** Two shots cannot both be the same file; a plan that said so could not be applied. */
  it("gives each file to at most one asset, and says why the other missed out", () => {
    const plan = planRelink(
      [offline("take.mp4", 1000, "h1", "first"), offline("take.mp4", 1000, "h2", "second")],
      [file("take.mp4", 1000, null)],
    );
    expect(plan.matches).toHaveLength(1);
    expect(plan.unmatched[0].reason).toContain("matched to something else");
  });

  it("names what it could not match and what it did not use", () => {
    const plan = planRelink(
      [offline("missing.mp4", 1000, "h1")],
      [file("something-else.mp4", 2000, "h9")],
    );
    expect(plan.matches).toEqual([]);
    expect(plan.unmatched[0].reason).toContain("nothing here has this name or these bytes");
    expect(plan.unused).toEqual(["something-else.mp4"]);
    expect(plan.summary).toContain("Nothing here matches");
  });

  it("says nothing has been relinked, because nothing has", () => {
    const plan = planRelink([offline("a.mp4", 1, "h1")], [file("a.mp4", 1, "h1")]);
    expect(plan.summary).toContain("Nothing has been relinked");
    expect(plan.summary).toContain("1 certain");
  });

  it("copes with nothing missing and with an empty folder", () => {
    expect(planRelink([], [file("a.mp4", 1)]).matches).toEqual([]);
    expect(planRelink([offline("a.mp4", 1, "h")], []).unmatched).toHaveLength(1);
  });
});

/** "Very probably right" is not good enough to silently repoint an edit at a different file. */
describe("what may be applied without being looked at", () => {
  it("automates only an exact byte match", () => {
    expect(isAutomatic("exact")).toBe(true);
    expect(isAutomatic("confident")).toBe(false);
    expect(isAutomatic("likely")).toBe(false);
    expect(isAutomatic("none")).toBe(false);
  });

  it("refuses to apply a choice that is not in the plan, and says the folder may have moved", () => {
    const plan = planRelink([offline("a.mp4", 1, "h1")], [file("a.mp4", 1, "h1")]);
    expect(() => assertPlanApplies(plan, ["a.mp4"])).not.toThrow();
    expect(() => assertPlanApplies(plan, ["ghost"])).toThrowError(/folder may have changed/);
  });

  it("describes a match so a person can disagree with the reasoning", () => {
    const plan = planRelink([offline("take1.mp4", 1000, "h1")], [file("take1.mp4", 5000, null)]);
    expect(describeMatch(plan.matches[0])).toContain("confirm this one");
    const certain = planRelink([offline("take1.mp4", 1000, "h1")], [file("x.mp4", 1000, "h1")]);
    expect(describeMatch(certain.matches[0])).not.toContain("confirm");
  });
});
