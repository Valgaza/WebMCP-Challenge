import { describe, expect, it, vi } from "vitest";
import { adjustmentStackSchema, createDefaultAdjustments } from "../domain/adjustment";
import {
  createGroupLayer, createImageLayer, layerBounds, transformToMatrix, type ImageLayer,
} from "../domain/layer";
import { applyAdjustments, renderDocument, type RenderSource } from "./composite";

function layer(id: string, overrides: Partial<ImageLayer> = {}): ImageLayer {
  return { ...createImageLayer({ id, name: id, assetId: `asset-${id}` }), ...overrides };
}

function source(assetId: string): RenderSource {
  return { assetId, bitmap: {} as CanvasImageSource, widthPx: 100, heightPx: 100 };
}

/**
 * A canvas stub that records what the compositor asks a context to do.
 *
 * It tracks the current transform as well as the draw calls, because where a layer lands is
 * now the product of every ancestor group's transform and its own — and that is exactly the
 * thing worth asserting.
 */
interface StubCall { alpha: number; args: unknown[]; matrix: number[]; canvas: number; op?: string }
interface StubFill { op: string; alpha: number; filter: string }

function stubCanvas() {
  const calls: StubCall[] = [];
  const fills: StubFill[] = [];
  let canvasCount = 0;

  const makeContext = (index: number) => {
    const state = { globalAlpha: 1 };
    let matrix = [1, 0, 0, 1, 0, 0];
    const stack: number[][] = [];
    const compose = (next: number[]) => {
      const [a, b, c, d, e, f] = matrix;
      const [na, nb, nc, nd, ne, nf] = next;
      matrix = [
        a * na + c * nb, b * na + d * nb,
        a * nc + c * nd, b * nc + d * nd,
        a * ne + c * nf + e, b * ne + d * nf + f,
      ];
    };
    return {
      get globalAlpha() { return state.globalAlpha; },
      set globalAlpha(value: number) { state.globalAlpha = value; },
      clearRect: vi.fn(), fillRect: vi.fn(),
      save: () => { stack.push([...matrix]); },
      restore: () => { matrix = stack.pop() ?? [1, 0, 0, 1, 0, 0]; },
      transform: (a: number, b: number, c: number, d: number, e: number, f: number) => compose([a, b, c, d, e, f]),
      setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => { matrix = [a, b, c, d, e, f]; },
      translate: (x: number, y: number) => compose([1, 0, 0, 1, x, y]),
      rotate: (radians: number) => compose([Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians), 0, 0]),
      scale: (x: number, y: number) => compose([x, 0, 0, y, 0, 0]),
      fillStyle: "",
      globalCompositeOperation: "source-over",
      filter: "none",
      beginPath: vi.fn(), rect: vi.fn(), roundRect: vi.fn(), ellipse: vi.fn(),
      fill(this: { globalCompositeOperation: string; globalAlpha: number; filter: string }) {
        fills.push({ op: this.globalCompositeOperation, alpha: state.globalAlpha, filter: this.filter });
      },
      drawImage(this: { globalCompositeOperation: string }, ...args: unknown[]) {
        calls.push({ alpha: state.globalAlpha, args, matrix: [...matrix], canvas: index, op: this.globalCompositeOperation });
      },
      getImageData: (_x: number, _y: number, width: number, height: number) => ({
        data: new Uint8ClampedArray(Math.max(4, width * height * 4)),
      }),
      putImageData: vi.fn(),
    };
  };

  const contexts: ReturnType<typeof makeContext>[] = [];
  vi.stubGlobal("OffscreenCanvas", class {
    private readonly index = canvasCount++;
    getContext() {
      contexts[this.index] ??= makeContext(this.index);
      return contexts[this.index];
    }
  } as unknown as typeof OffscreenCanvas);

  return { calls, fills, contexts, canvasCount: () => canvasCount };
}

describe("renderDocument", () => {
  const document = {
    widthPx: 200, heightPx: 100,
    background: { type: "transparent" as const },
    layers: [] as ImageLayer[],
  };

  it("skips hidden layers and reports them", () => {
    stubCanvas();
    const result = renderDocument(
      { ...document, layers: [layer("a"), layer("b", { visible: false })] },
      [source("asset-a"), source("asset-b")],
    );
    expect(result.renderedLayerIds).toEqual(["a"]);
    expect(result.skippedLayerIds).toEqual(["b"]);
  });

  it("multiplies group opacity into the layers it contains", () => {
    const { calls } = stubCanvas();
    const group = createGroupLayer({ id: "g", name: "G", children: [layer("a", { opacity: 0.5 })] });
    renderDocument({ ...document, layers: [{ ...group, opacity: 0.5 }] as never }, [source("asset-a")]);
    expect(calls[0].alpha).toBeCloseTo(0.25, 5);
  });

  it("warns and skips when a layer's image is unavailable rather than failing the render", () => {
    stubCanvas();
    const result = renderDocument({ ...document, layers: [layer("a")] }, []);
    expect(result.renderedLayerIds).toEqual([]);
    expect(result.warnings[0]).toContain("could not be drawn");
  });

  it("excludes named layers, which is how before and after are isolated", () => {
    stubCanvas();
    const result = renderDocument(
      { ...document, layers: [layer("a"), layer("b")] },
      [source("asset-a"), source("asset-b")],
      { excludeLayerIds: ["b"] },
    );
    expect(result.renderedLayerIds).toEqual(["a"]);
    expect(result.skippedLayerIds).toEqual(["b"]);
  });

  it("scales the output surface for a proxy render", () => {
    stubCanvas();
    const result = renderDocument({ ...document, layers: [] }, [], { scale: 0.5 });
    expect([result.widthPx, result.heightPx]).toEqual([100, 50]);
  });

  it("never produces a zero-sized surface", () => {
    stubCanvas();
    const result = renderDocument({ ...document, layers: [] }, [], { scale: 0.001 });
    expect(result.widthPx).toBeGreaterThanOrEqual(1);
    expect(result.heightPx).toBeGreaterThanOrEqual(1);
  });

  it("is deterministic for identical input", () => {
    stubCanvas();
    const layers = [layer("a"), layer("b", { opacity: 0.4 })];
    const sources = [source("asset-a"), source("asset-b")];
    const first = renderDocument({ ...document, layers }, sources);
    const second = renderDocument({ ...document, layers }, sources);
    expect(first.renderedLayerIds).toEqual(second.renderedLayerIds);
    expect(first.warnings).toEqual(second.warnings);
  });
});

describe("applyAdjustments", () => {
  function grey(value: number): Uint8ClampedArray {
    return new Uint8ClampedArray([value, value, value, 255]);
  }

  it("does nothing when the stack is neutral", () => {
    const data = grey(128);
    applyAdjustments(data, createDefaultAdjustments());
    expect([...data]).toEqual([128, 128, 128, 255]);
  });

  it("lifts values when brightness rises", () => {
    const data = grey(100);
    applyAdjustments(data, adjustmentStackSchema.parse({ ...createDefaultAdjustments(), brightness: 40 }));
    expect(data[0]).toBeGreaterThan(100);
  });

  it("leaves fully transparent pixels untouched", () => {
    const data = new Uint8ClampedArray([10, 20, 30, 0]);
    applyAdjustments(data, adjustmentStackSchema.parse({ ...createDefaultAdjustments(), brightness: 100 }));
    expect([...data]).toEqual([10, 20, 30, 0]);
  });

  it("desaturates toward grey and never leaves the byte range", () => {
    const data = new Uint8ClampedArray([200, 50, 50, 255]);
    applyAdjustments(data, adjustmentStackSchema.parse({ ...createDefaultAdjustments(), saturation: -100 }));
    expect(data[0]).toBeCloseTo(data[1], -1);
    expect(Math.max(data[0], data[1], data[2])).toBeLessThanOrEqual(255);
  });

  it("warms and cools through the white balance gains", () => {
    const warm = grey(128);
    applyAdjustments(warm, adjustmentStackSchema.parse({ ...createDefaultAdjustments(), temperature: 80 }));
    expect(warm[0]).toBeGreaterThan(warm[2]);

    const cool = grey(128);
    applyAdjustments(cool, adjustmentStackSchema.parse({ ...createDefaultAdjustments(), temperature: -80 }));
    expect(cool[2]).toBeGreaterThan(cool[0]);
  });

  it("keeps luminance roughly stable when only hue rotates", () => {
    const data = new Uint8ClampedArray([200, 100, 50, 255]);
    const before = 0.2126 * data[0] + 0.7152 * data[1] + 0.0722 * data[2];
    applyAdjustments(data, adjustmentStackSchema.parse({ ...createDefaultAdjustments(), hue: 120 }));
    const after = 0.2126 * data[0] + 0.7152 * data[1] + 0.0722 * data[2];
    expect(Math.abs(after - before)).toBeLessThan(40);
  });
});

/**
 * Phase 5 renders video through the same visual model as photo, so these two failures were
 * not photo-only problems: an adjustment that reached other layers, and a group transform
 * that reached none.
 */
describe("renderDocument isolation and inheritance", () => {
  const document = {
    widthPx: 200, heightPx: 100,
    background: { type: "transparent" as const },
    layers: [] as ImageLayer[],
  };

  const adjusted = (id: string, overrides: Partial<ImageLayer> = {}) => layer(id, {
    adjustments: adjustmentStackSchema.parse({ ...createDefaultAdjustments(), brightness: 40 }),
    ...overrides,
  });

  it("draws an adjusted layer on its own surface rather than over the composite", () => {
    const { calls } = stubCanvas();
    renderDocument(
      { ...document, layers: [layer("under"), adjusted("over")] },
      [source("asset-under"), source("asset-over")],
    );

    const under = calls.find((call) => call.canvas === 0 && call.args.length > 3)!;
    const over = calls.find((call) => call.canvas !== 0)!;
    // The unadjusted layer goes straight onto the document; the adjusted one does not.
    expect(under.canvas).toBe(0);
    expect(over.canvas).not.toBe(0);

    // The isolated surface is then composited back onto the document as a whole image.
    const composite = calls.filter((call) => call.canvas === 0).at(-1)!;
    expect(composite.args).toHaveLength(3);
  });

  it("applies a layer's opacity when compositing its adjusted surface, not while drawing it", () => {
    const { calls } = stubCanvas();
    renderDocument({ ...document, layers: [adjusted("a", { opacity: 0.4 })] }, [source("asset-a")]);

    // Drawn at full strength so the adjustment sees the layer's real colours…
    const drawn = calls.find((call) => call.canvas !== 0)!;
    expect(drawn.alpha).toBe(1);
    // …and faded only when it lands on the document.
    const composited = calls.filter((call) => call.canvas === 0).at(-1)!;
    expect(composited.alpha).toBeCloseTo(0.4, 5);
  });

  /**
   * The defect this covers: group inheritance carried visibility and opacity but not the
   * group's transform, so moving a group left every child exactly where it was.
   */
  it("moves a layer when the group above it moves", () => {
    const { calls } = stubCanvas();
    const group = createGroupLayer({ id: "g", name: "G", children: [layer("a")] });
    renderDocument(
      { ...document, layers: [{ ...group, transform: { ...group.transform, x: 40, y: 25 } }] as never },
      [source("asset-a")],
    );
    const [, , , , translateX, translateY] = calls[0].matrix;
    expect(translateX).toBeCloseTo(40, 5);
    expect(translateY).toBeCloseTo(25, 5);
  });

  it("scales and rotates a layer with its group", () => {
    const { calls } = stubCanvas();
    const group = createGroupLayer({ id: "g", name: "G", children: [layer("a")] });
    renderDocument(
      {
        ...document,
        layers: [{ ...group, transform: { ...group.transform, scaleX: 2, scaleY: 2, rotationDeg: 90 } }] as never,
      },
      [source("asset-a")],
    );
    const [a, b, c, d] = calls[0].matrix;
    // A 90° rotation at 2× maps (1,0) to (0,2) and (0,1) to (-2,0).
    expect(a).toBeCloseTo(0, 5);
    expect(b).toBeCloseTo(2, 5);
    expect(c).toBeCloseTo(-2, 5);
    expect(d).toBeCloseTo(0, 5);
  });

  it("composes nested group transforms in ancestor-to-child order", () => {
    const { calls } = stubCanvas();
    const inner = createGroupLayer({ id: "inner", name: "Inner", children: [layer("a")] });
    const outer = createGroupLayer({
      id: "outer", name: "Outer",
      children: [{ ...inner, transform: { ...inner.transform, x: 10 } }] as never,
    });
    renderDocument(
      { ...document, layers: [{ ...outer, transform: { ...outer.transform, x: 5, scaleX: 2, scaleY: 2 } }] as never },
      [source("asset-a")],
    );
    const [, , , , translateX] = calls[0].matrix;
    // The outer group scales the inner group's offset: 5 + 2 × 10.
    expect(translateX).toBeCloseTo(25, 5);
  });

  it("reports bounds that match where the group transform actually puts the layer", () => {
    const child = layer("a", { transform: { ...layer("a").transform, x: 10, y: 10 } });
    const groupMatrix = transformToMatrix({ ...createGroupLayer({ id: "g", name: "G", children: [] }).transform, x: 40, y: 25 });

    const own = layerBounds(child, { widthPx: 100, heightPx: 100 });
    const inherited = layerBounds(child, { widthPx: 100, heightPx: 100 }, groupMatrix);
    expect(inherited.x).toBeCloseTo(own.x + 40, 5);
    expect(inherited.y).toBeCloseTo(own.y + 25, 5);
    expect(inherited.width).toBeCloseTo(own.width, 5);
  });
});

/**
 * `SH-047`, `SH-051`, and `SH-052` reach the canvas here. Video renders through this same
 * compositor, so what these assert holds for clips as well as layers.
 */
describe("renderDocument blending, masking and clipping", () => {
  const document = {
    widthPx: 200, heightPx: 100,
    background: { type: "transparent" as const },
    layers: [] as ImageLayer[],
  };

  const shapeMask = (overrides: Record<string, unknown> = {}) => ({
    id: "mask-1",
    source: { kind: "rectangle" in overrides ? "shape" : "shape", shape: "rectangle", x: 0, y: 0, width: 0.5, height: 1, cornerRadius: 0 },
    featherPx: 0, density: 1, inverted: false, enabled: true, ...overrides,
  });

  it("blends a layer onto the document rather than onto its own empty surface", () => {
    const { calls } = stubCanvas();
    renderDocument(
      { ...document, layers: [layer("under"), layer("over", { blendMode: "multiply" } as never)] },
      [source("asset-under"), source("asset-over")],
    );
    // The blended layer is drawn in isolation first…
    const isolated = calls.find((call) => call.canvas !== 0)!;
    expect(isolated.op).toBe("source-over");
    // …then composited onto the document with its mode, where there is something to blend with.
    const onDocument = calls.filter((call) => call.canvas === 0).at(-1)!;
    expect(onDocument.op).toBe("multiply");
  });

  it("leaves a normal layer on the ordinary path", () => {
    const { calls } = stubCanvas();
    renderDocument({ ...document, layers: [layer("plain")] }, [source("asset-plain")]);
    expect(calls.every((call) => call.canvas === 0)).toBe(true);
  });

  it("keeps a mask by cutting the layer down to the shape", () => {
    const { fills } = stubCanvas();
    renderDocument(
      { ...document, layers: [layer("masked", { masks: [shapeMask()] } as never)] },
      [source("asset-masked")],
    );
    expect(fills).toHaveLength(1);
    expect(fills[0].op).toBe("destination-in");
  });

  it("turns an inverted mask into a hole rather than a window", () => {
    const { fills } = stubCanvas();
    renderDocument(
      { ...document, layers: [layer("holed", { masks: [shapeMask({ inverted: true })] } as never)] },
      [source("asset-holed")],
    );
    expect(fills[0].op).toBe("destination-out");
  });

  it("applies density to the mask so the layer stays visible outside it", () => {
    const { fills } = stubCanvas();
    renderDocument(
      { ...document, layers: [layer("soft", { masks: [shapeMask({ density: 0.4 })] } as never)] },
      [source("asset-soft")],
    );
    expect(fills[0].alpha).toBeCloseTo(0.4, 5);
  });

  it("softens a mask edge with a blur rather than a hard cut", () => {
    const { fills } = stubCanvas();
    renderDocument(
      { ...document, layers: [layer("feathered", { masks: [shapeMask({ featherPx: 8 })] } as never)] },
      [source("asset-feathered")],
    );
    expect(fills[0].filter).toContain("blur(8px)");
  });

  it("ignores a mask that is switched off", () => {
    const { fills } = stubCanvas();
    renderDocument(
      { ...document, layers: [layer("off", { masks: [shapeMask({ enabled: false })] } as never)] },
      [source("asset-off")],
    );
    expect(fills).toEqual([]);
  });

  /**
   * A clipping run composites as a unit: the clipped layer is cut to its base's alpha before
   * either reaches the document, so it blends against its base rather than everything below.
   */
  it("cuts a clipped layer to the layer below it", () => {
    const { calls } = stubCanvas();
    renderDocument(
      { ...document, layers: [layer("base"), layer("clipped", { clipToBelow: true } as never)] },
      [source("asset-base"), source("asset-clipped")],
    );
    // The clipped layer needed its own surface, and the base's image was drawn onto it as
    // the mask shape.
    const isolatedDraws = calls.filter((call) => call.canvas !== 0);
    expect(isolatedDraws.length).toBeGreaterThanOrEqual(2);
    expect(isolatedDraws.some((call) => call.op === "destination-in")).toBe(true);
  });

  it("leaves a layer whole when the layer it is clipped to has gone", () => {
    const { calls } = stubCanvas();
    const result = renderDocument(
      { ...document, layers: [layer("base"), layer("clipped", { clipToBelow: true } as never)] },
      // The base layer's image is missing, so it cannot supply a shape.
      [source("asset-clipped")],
    );
    expect(result.skippedLayerIds).toContain("base");
    // The clipped layer still renders rather than vanishing without explanation.
    expect(result.renderedLayerIds).toContain("clipped");
    expect(calls.length).toBeGreaterThan(0);
  });
});
