import { describe, expect, it } from "vitest";
import {
  MAX_STYLES_PER_LAYER, assertStyleCount, describeStyle, drawsBehind, layerStyleSchema,
  paintOrder, shadowOffset, type LayerStyle,
} from "./layer-style";

const style = (input: Record<string, unknown>): LayerStyle => layerStyleSchema.parse(input);

/**
 * `PH-014`. A style is not a filter: it draws something new derived from where the layer's
 * pixels are, which is why a shadow follows text as it is retyped rather than being baked in.
 */
describe("layer styles", () => {
  it("fills in the shape of each style so a caller need only name what it wants", () => {
    expect(style({ kind: "stroke", id: "a", paint: { kind: "solid", colour: "#ff0000", opacity: 1 } }))
      .toMatchObject({ widthPx: 3, position: "outside", enabled: true, blendMode: "normal" });
    expect(style({ kind: "drop_shadow", id: "b" }))
      .toMatchObject({ angleDegrees: 135, distancePx: 6, blurPx: 8, colour: "#000000" });
    expect(style({ kind: "glow", id: "c" })).toMatchObject({ direction: "outer", blendMode: "screen" });
  });

  it("refuses a colour that is not a colour", () => {
    expect(() => style({ kind: "drop_shadow", id: "b", colour: "red" })).toThrowError();
  });

  /**
   * The order styles are drawn in is not the order they are listed in. Without this, a shadow
   * listed last would be painted over the thing casting it.
   */
  it("paints shadows behind and glows last, whatever order the list is in", () => {
    const ordered = paintOrder([
      style({ kind: "glow", id: "g" }),
      style({ kind: "overlay", id: "o", paint: { kind: "solid", colour: "#ffffff", opacity: 1 } }),
      style({ kind: "drop_shadow", id: "d" }),
      style({ kind: "stroke", id: "s", paint: { kind: "solid", colour: "#000000", opacity: 1 } }),
    ]);
    expect(ordered.map((entry) => entry.kind)).toEqual(["drop_shadow", "stroke", "overlay", "glow"]);
  });

  it("keeps two styles of the same kind in the order they were added", () => {
    const ordered = paintOrder([
      style({ kind: "stroke", id: "first", paint: { kind: "solid", colour: "#000000", opacity: 1 } }),
      style({ kind: "stroke", id: "second", paint: { kind: "solid", colour: "#ffffff", opacity: 1 } }),
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual(["first", "second"]);
  });

  it("leaves out anything switched off rather than drawing it faintly", () => {
    expect(paintOrder([style({ kind: "glow", id: "g", enabled: false })])).toEqual([]);
  });

  it("knows which styles sit behind the layer", () => {
    expect(drawsBehind(style({ kind: "drop_shadow", id: "d" }))).toBe(true);
    expect(drawsBehind(style({ kind: "glow", id: "g", direction: "outer" }))).toBe(true);
    expect(drawsBehind(style({ kind: "glow", id: "g", direction: "inner" }))).toBe(false);
    expect(drawsBehind(style({ kind: "stroke", id: "s", position: "inside", paint: { kind: "solid", colour: "#000000", opacity: 1 } }))).toBe(false);
  });

  /** Screen y grows downwards, so a light from above has to cast its shadow below. */
  it("casts a shadow away from the light, with the angle read clockwise from straight up", () => {
    expect(shadowOffset(0, 10)).toMatchObject({ dx: 0 });
    expect(shadowOffset(0, 10).dy).toBeCloseTo(-10);
    expect(shadowOffset(180, 10).dy).toBeCloseTo(10);
    expect(shadowOffset(90, 10).dx).toBeCloseTo(10);
    expect(shadowOffset(135, 0).dx).toBeCloseTo(0);
    expect(shadowOffset(135, 0).dy).toBeCloseTo(0);
  });

  it("refuses more styles than a layer holds", () => {
    expect(() => assertStyleCount(MAX_STYLES_PER_LAYER)).not.toThrow();
    expect(() => assertStyleCount(MAX_STYLES_PER_LAYER + 1)).toThrowError(/at most 12 styles/);
  });

  it("describes each style in a sentence a person would say", () => {
    expect(describeStyle(style({ kind: "stroke", id: "s", widthPx: 4, paint: { kind: "solid", colour: "#000000", opacity: 1 } })))
      .toBe("A 4 px outside outline.");
    expect(describeStyle(style({ kind: "drop_shadow", id: "d" })))
      .toBe("A shadow 6 px away at 135°, blurred by 8 px.");
    expect(describeStyle(style({ kind: "glow", id: "g", enabled: false }))).toContain("(switched off)");
  });
});
