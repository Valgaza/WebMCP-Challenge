import { describe, expect, it } from "vitest";
import { knownPhrases, resolvePhrase } from "./phrase-service";

const context = { projectId: "p1", layerId: "l1" };
const resolve = (phrase: string, over = context) => resolvePhrase({ phrase, context: over });

/**
 * `VI-064`. This is deliberately not a language model: an agent can already write JSON, so a
 * layer that *guessed* would add only a way to be wrong. What it adds is a resolution step that
 * says what it understood before anything happens, and returns a command the ordinary path runs.
 */
describe("reading a phrase", () => {
  it("turns a colour word into the adjustment it names", () => {
    const result = resolve("make it warmer");
    expect(result.understood).toBe(true);
    expect(result.command).toMatchObject({
      tool: "apply_color_adjustment",
      input: { projectId: "p1", layerId: "l1" },
    });
    expect((result.command!.input.adjustments as Record<string, number>).temperature).toBeGreaterThan(0);
  });

  it("points the same parameter the other way for the opposite word", () => {
    const warm = resolve("warmer").command!.input.adjustments as Record<string, number>;
    const cool = resolve("cooler").command!.input.adjustments as Record<string, number>;
    expect(warm.temperature).toBeGreaterThan(0);
    expect(cool.temperature).toBeLessThan(0);
  });

  /** "A slightly" that moved a slider a quarter of its range would be worse than useless. */
  it("scales the change by how strongly it was asked for", () => {
    const slight = resolve("slightly brighter").command!.input.adjustments as Record<string, number>;
    const lots = resolve("much brighter").command!.input.adjustments as Record<string, number>;
    const extreme = resolve("way brighter").command!.input.adjustments as Record<string, number>;
    expect(slight.brightness).toBeLessThan(lots.brightness);
    expect(lots.brightness).toBeLessThan(extreme.brightness);
    expect(slight.brightness).toBeLessThan(20);
  });

  it("says which words it read the strength from", () => {
    expect(resolve("a lot darker").interpretation).toContain("“a lot darker”");
  });

  it("reads a longer phrase in preference to a shorter one inside it", () => {
    const less = resolve("less contrast").command!.input.adjustments as Record<string, number>;
    const more = resolve("more contrast").command!.input.adjustments as Record<string, number>;
    expect(less.contrast).toBeLessThan(0);
    expect(more.contrast).toBeGreaterThan(0);
  });

  it("turns a request for something to happen into that command", () => {
    const mono = resolve("make it black and white");
    expect(mono.command).toMatchObject({
      tool: "apply_layer_operation",
      input: { operation: "add_effect", colourOperation: { kind: "black_and_white" } },
    });
    expect(mono.interpretation).toContain("black and white");
  });

  /** Reading "white" in "black and white" as a colour word would be a worse answer. */
  it("prefers an action to a colour word inside it", () => {
    expect(resolve("black and white").command!.tool).toBe("apply_layer_operation");
  });

  it("knows the other actions it advertises", () => {
    expect(resolve("add a blur").command!.input).toMatchObject({ filter: { kind: "blur" } });
    expect(resolve("sharpen it").command!.input).toMatchObject({ filter: { kind: "sharpen" } });
    expect(resolve("add grain").command!.input).toMatchObject({ filter: { kind: "noise" } });
    expect(resolve("hide it").command!.input).toMatchObject({ operation: "set_visibility", visible: false });
    expect(resolve("show it").command!.input).toMatchObject({ visible: true });
  });

  it("changes nothing itself: it returns a command for the caller to run", () => {
    const result = resolve("warmer");
    expect(result.command!.tool).toBeTruthy();
    // Everything needed to run it, and nothing that has run.
    expect(result.command!.input.projectId).toBe("p1");
  });
});

describe("when it does not understand", () => {
  /**
   * Doing the part it recognised and leaving the person to discover the rest was ignored is
   * the failure mode to avoid.
   */
  it("says so rather than doing something approximate", () => {
    const result = resolve("apply the Kubrick look");
    expect(result.understood).toBe(false);
    expect(result.command).toBeNull();
    expect(result.interpretation).toContain("Kubrick");
  });

  it("names the words it did not know", () => {
    expect(resolve("make it cinematic").unrecognised).toContain("cinematic");
  });

  it("suggests something close when there is something close", () => {
    const result = resolve("brightne");
    expect(result.suggestions.join(" ")).toContain("brighter");
  });

  it("lists what it does know when nothing is close", () => {
    expect(resolve("zxqv").suggestions.join(" ")).toContain("Try one of");
  });

  /** A command with nothing to act on is not a command. */
  it("asks for a selection rather than guessing one", () => {
    const result = resolvePhrase({ phrase: "warmer", context: { projectId: "p1" } });
    expect(result.understood).toBe(false);
    expect(result.interpretation).toContain("nothing is selected");
    expect(result.suggestions.join(" ")).toContain("Select a layer");

    const action = resolvePhrase({ phrase: "black and white", context: { projectId: "p1" } });
    expect(action.understood).toBe(false);
    expect(action.suggestions.join(" ")).toContain("Select a layer");
  });

  it("refuses an empty phrase", () => {
    expect(() => resolve("   ")).toThrowError();
  });
});

/** Making people guess at a vocabulary is worse than showing them. */
describe("what it knows", () => {
  it("can list every phrase it understands, with what each one means", () => {
    const known = knownPhrases();
    expect(known.length).toBeGreaterThan(15);
    expect(known.every((entry) => entry.phrase && entry.means)).toBe(true);
    expect(known.map((entry) => entry.phrase)).toContain("warmer");
    expect(known.find((entry) => entry.phrase === "slightly")?.means).toContain("10%");
  });
});
