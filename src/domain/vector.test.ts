import { describe, expect, it } from "vitest";
import {
  parsePathData, parseSvg, shapeBounds, toCommands, toPathData, toSvgDocument, toSvgElement,
  vectorObjectSchema, type Shape, type Swatch, type VectorObject,
} from "./vector";

const object = (shape: Shape, overrides: Partial<VectorObject> = {}): VectorObject =>
  vectorObjectSchema.parse({ schemaVersion: 1, shape, ...overrides });

/**
 * `SH-061`, `SH-062`, and `SH-063`. Vector work is commands and parameters rather than pixels,
 * so a shape stays crisp at any export size and SVG interchange is a translation rather than a
 * re-drawing.
 */
describe("shape geometry", () => {
  it("turns every shape into commands so one renderer serves them all", () => {
    expect(toCommands({ kind: "rectangle", x: 0, y: 0, width: 10, height: 5, cornerRadius: 0 }))
      .toHaveLength(5);
    expect(toCommands({ kind: "ellipse", cx: 5, cy: 5, rx: 5, ry: 5 }).filter((c) => c.kind === "cubic"))
      .toHaveLength(4);
    expect(toCommands({ kind: "polygon", points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 }], closed: true }).at(-1))
      .toEqual({ kind: "close" });
  });

  it("rounds a rectangle's corners with curves rather than cutting them", () => {
    const commands = toCommands({ kind: "rectangle", x: 0, y: 0, width: 20, height: 20, cornerRadius: 5 });
    expect(commands.filter((command) => command.kind === "cubic")).toHaveLength(4);
  });

  it("never rounds a corner past the shape's own size", () => {
    const commands = toCommands({ kind: "rectangle", x: 0, y: 0, width: 10, height: 4, cornerRadius: 100 });
    const bounds = shapeBounds({ kind: "path", commands });
    expect(bounds.width).toBeLessThanOrEqual(10.001);
    expect(bounds.height).toBeLessThanOrEqual(4.001);
  });

  it("measures a shape's box", () => {
    expect(shapeBounds({ kind: "rectangle", x: 4, y: 6, width: 10, height: 5, cornerRadius: 0 }))
      .toEqual({ x: 4, y: 6, width: 10, height: 5 });
    expect(shapeBounds({ kind: "path", commands: [] })).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it("writes commands as path data a browser understands", () => {
    expect(toPathData([{ kind: "move", x: 0, y: 0 }, { kind: "line", x: 10, y: 0 }, { kind: "close" }]))
      .toBe("M 0 0 L 10 0 Z");
  });
});

describe("path parsing", () => {
  it("reads absolute commands", () => {
    expect(parsePathData("M 0 0 L 10 10 Z")).toEqual([
      { kind: "move", x: 0, y: 0 }, { kind: "line", x: 10, y: 10 }, { kind: "close" },
    ]);
  });

  it("converts relative commands to absolute rather than carrying both forms", () => {
    expect(parsePathData("M 10 10 l 5 5")).toEqual([
      { kind: "move", x: 10, y: 10 }, { kind: "line", x: 15, y: 15 },
    ]);
  });

  it("expands the shorthand horizontal and vertical commands", () => {
    expect(parsePathData("M 0 0 H 10 V 20")).toEqual([
      { kind: "move", x: 0, y: 0 }, { kind: "line", x: 10, y: 0 }, { kind: "line", x: 10, y: 20 },
    ]);
  });

  /** SVG lets a repeated command's letter be omitted, which real files rely on. */
  it("repeats the previous command when its letter is omitted", () => {
    expect(parsePathData("M 0 0 L 1 1 2 2")).toEqual([
      { kind: "move", x: 0, y: 0 }, { kind: "line", x: 1, y: 1 }, { kind: "line", x: 2, y: 2 },
    ]);
  });

  it("treats coordinates after a move as line commands, as the spec requires", () => {
    expect(parsePathData("M 0 0 5 5")).toEqual([
      { kind: "move", x: 0, y: 0 }, { kind: "line", x: 5, y: 5 },
    ]);
  });

  it("returns to the subpath start after a close", () => {
    const commands = parsePathData("M 5 5 L 10 10 Z l 1 1");
    expect(commands.at(-1)).toEqual({ kind: "line", x: 6, y: 6 });
  });

  it("keeps curves rather than flattening them", () => {
    expect(parsePathData("M 0 0 C 1 2 3 4 5 6")).toEqual([
      { kind: "move", x: 0, y: 0 }, { kind: "cubic", x1: 1, y1: 2, x2: 3, y2: 4, x: 5, y: 6 },
    ]);
    expect(parsePathData("M 0 0 Q 1 2 3 4").at(-1)).toEqual({ kind: "quadratic", x1: 1, y1: 2, x: 3, y: 4 });
  });

  it("refuses a path that starts with a number rather than guessing a command", () => {
    expect(() => parsePathData("5 5 L 10 10")).toThrowError(/starts with a number/);
  });

  it("round-trips its own output", () => {
    const original = "M 0 0 C 1 2 3 4 5 6 L 10 10 Z";
    expect(toPathData(parsePathData(original))).toBe(original);
  });
});

describe("SVG interchange", () => {
  it("imports the shapes it can represent", () => {
    const { objects, warnings } = parseSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <rect x="1" y="2" width="10" height="20" fill="#ff0000" />
        <circle cx="50" cy="50" r="25" fill="#00ff00" />
        <path d="M 0 0 L 5 5" stroke="#0000ff" stroke-width="2" fill="none" />
      </svg>`);
    expect(objects).toHaveLength(3);
    expect(objects[0].shape).toMatchObject({ kind: "rectangle", x: 1, y: 2, width: 10, height: 20 });
    expect(objects[0].fill).toMatchObject({ kind: "solid", colour: "#ff0000" });
    expect(objects[1].shape).toMatchObject({ kind: "ellipse", rx: 25, ry: 25 });
    expect(objects[2].stroke).toMatchObject({ widthPx: 2 });
    expect(objects[2].fill).toEqual({ kind: "none" });
    expect(warnings).toEqual([]);
  });

  /**
   * An importer that quietly dropped a group would produce a picture missing pieces with
   * nothing to say which.
   */
  it("names what it left out instead of dropping it silently", () => {
    const { objects, warnings } = parseSvg(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="5" height="5" />
        <image href="photo.png" />
        <use href="#thing" />
      </svg>`);
    expect(objects).toHaveLength(1);
    expect(warnings.join(" ")).toContain("image");
    expect(warnings.join(" ")).toContain("use");
  });

  it("never imports script or foreign content from an untrusted file", () => {
    const { objects, warnings } = parseSvg(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <script>alert(1)</script>
        <rect x="0" y="0" width="5" height="5" />
      </svg>`);
    expect(objects).toHaveLength(1);
    expect(warnings.join(" ")).toContain("script");
  });

  it("says so when a file has nothing it can use", () => {
    const { objects, warnings } = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg"><text>Hi</text></svg>`);
    expect(objects).toEqual([]);
    expect(warnings.join(" ")).toContain("no shapes");
  });

  it("refuses a file that is not SVG at all", () => {
    expect(() => parseSvg("not xml <<<")).toThrowError(/not readable as SVG/);
  });

  it("exports a document that imports back to the same shapes", () => {
    const original = [
      object({ kind: "rectangle", x: 0, y: 0, width: 10, height: 10, cornerRadius: 0 }, { fill: { kind: "solid", colour: "#123456", opacity: 1 } }),
      object({ kind: "path", commands: parsePathData("M 0 0 L 5 5") }),
    ];
    const svg = toSvgDocument(original, { widthPx: 100, heightPx: 100 });
    expect(svg).toContain('width="100"');
    const round = parseSvg(svg);
    expect(round.objects).toHaveLength(2);
    expect(round.objects[0].fill).toMatchObject({ colour: "#123456" });
  });

  it("resolves a swatch to its colour on export", () => {
    const swatches = new Map<string, Swatch>([
      ["brand", { id: "brand", name: "Brand", paint: { kind: "solid", colour: "#abcdef", opacity: 1 } }],
    ]);
    const element = toSvgElement(
      object({ kind: "rectangle", x: 0, y: 0, width: 1, height: 1, cornerRadius: 0 }, { fill: { kind: "swatch", swatchId: "brand" } }),
      swatches,
    );
    expect(element).toContain('fill="#abcdef"');
  });

  it("leaves a shape unpainted when its swatch has gone rather than guessing a colour", () => {
    const element = toSvgElement(
      object({ kind: "rectangle", x: 0, y: 0, width: 1, height: 1, cornerRadius: 0 }, { fill: { kind: "swatch", swatchId: "missing" } }),
      new Map(),
    );
    expect(element).toContain('fill="none"');
  });
});
