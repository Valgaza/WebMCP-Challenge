import { describe, expect, it } from "vitest";
import {
  alignedTransforms,
  applyViewingModes,
  countLayers,
  createGroupLayer,
  createImageLayer,
  findLayer,
  fitScale,
  flattenLayers,
  groupDepth,
  imageLayerSchema,
  layerBounds,
  layerCropSchema,
  layerTransformSchema,
  removeLayer,
  replaceLayer,
  resolveInheritance,
  type ImageLayer,
} from "./layer";

function image(id: string, overrides: Partial<ImageLayer> = {}): ImageLayer {
  return { ...createImageLayer({ id, name: `Layer ${id}`, assetId: `asset-${id}` }), ...overrides };
}

describe("layer schema", () => {
  it("enforces documented transform bounds", () => {
    const base = createImageLayer({ id: "a", name: "A", assetId: "asset-a" }).transform;
    expect(layerTransformSchema.safeParse({ ...base, scaleX: 0 }).success).toBe(false);
    expect(layerTransformSchema.safeParse({ ...base, scaleX: 100 }).success).toBe(false);
    expect(layerTransformSchema.safeParse({ ...base, rotationDeg: 400 }).success).toBe(false);
    expect(layerTransformSchema.safeParse({ ...base, anchorX: 1.5 }).success).toBe(false);
  });

  it("rejects an opacity outside 0 to 1 and a crop that keeps nothing", () => {
    const layer = image("a");
    expect(imageLayerSchema.safeParse({ ...layer, opacity: 1.5 }).success).toBe(false);
    expect(layerCropSchema.safeParse({ left: 0.5, top: 0, right: 0.5, bottom: 1 }).success).toBe(false);
    expect(layerCropSchema.safeParse({ left: 0, top: 0, right: 1, bottom: 1 }).success).toBe(true);
  });
});

describe("layer tree", () => {
  const tree = [
    image("a"),
    createGroupLayer({ id: "g", name: "Group", children: [image("b"), image("c")] }),
  ];

  it("flattens in paint order with depth", () => {
    expect(flattenLayers(tree).map((entry) => [entry.layer.id, entry.depth])).toEqual([
      ["a", 0], ["g", 0], ["b", 1], ["c", 1],
    ]);
  });

  it("finds, replaces, and removes nested layers immutably", () => {
    expect(findLayer(tree, "c")?.id).toBe("c");
    expect(findLayer(tree, "missing")).toBeNull();

    const renamed = replaceLayer(tree, "c", (layer) => ({ ...layer, name: "Renamed" }));
    expect(findLayer(renamed, "c")?.name).toBe("Renamed");
    // The original tree is untouched, which is what makes replay deterministic.
    expect(findLayer(tree, "c")?.name).toBe("Layer c");

    expect(countLayers(removeLayer(tree, "b"))).toBe(3);
    expect(findLayer(removeLayer(tree, "g"), "b")).toBeNull();
  });

  it("counts layers and measures nesting depth", () => {
    expect(countLayers(tree)).toBe(4);
    expect(groupDepth(tree)).toBe(2);
    expect(groupDepth([image("solo")])).toBe(1);
  });
});

describe("inheritance", () => {
  it("multiplies opacity and propagates a hidden group", () => {
    const tree = [
      createGroupLayer({
        id: "g", name: "G",
        children: [image("a", { opacity: 0.5 })],
      }),
    ];
    const halfGroup = replaceLayer(tree, "g", (layer) => ({ ...layer, opacity: 0.5 }));
    expect(resolveInheritance(halfGroup)[0]).toMatchObject({ opacity: 0.25, visible: true });

    const hidden = replaceLayer(tree, "g", (layer) => ({ ...layer, visible: false }));
    expect(resolveInheritance(hidden)[0].visible).toBe(false);
  });

  it("returns only image layers, since groups paint nothing themselves", () => {
    const tree = [createGroupLayer({ id: "g", name: "G", children: [image("a"), image("b")] })];
    expect(resolveInheritance(tree).map((entry) => entry.layer.id)).toEqual(["a", "b"]);
  });
});

describe("bounds and alignment", () => {
  const source = { widthPx: 400, heightPx: 200 };

  it("accounts for crop, scale, and anchor", () => {
    const layer = image("a", { transform: { ...image("a").transform, x: 100, y: 50 } });
    expect(layerBounds(layer, source)).toEqual({ x: -100, y: -50, width: 400, height: 200 });
  });

  it("expands bounds when a layer is rotated", () => {
    const rotated = image("a", { transform: { ...image("a").transform, rotationDeg: 90 } });
    const bounds = layerBounds(rotated, source);
    expect(Math.round(bounds.width)).toBe(200);
    expect(Math.round(bounds.height)).toBe(400);
  });

  it("aligns to the document frame and skips locked layers", () => {
    const layer = image("a");
    const bounds = layerBounds(layer, source);
    const frame = { widthPx: 1000, heightPx: 1000 };

    const [left] = alignedTransforms([{ layer, bounds }], frame, "left");
    expect(left.x).toBe(200);

    const [centred] = alignedTransforms([{ layer, bounds }], frame, "horizontal-center");
    expect(centred.x).toBe(500);

    const [bottom] = alignedTransforms([{ layer, bounds }], frame, "bottom");
    expect(bottom.y).toBe(900);

    const locked = image("b", { locked: true });
    expect(alignedTransforms([{ layer: locked, bounds }], frame, "left")).toEqual([]);
  });
});

describe("fitScale", () => {
  it("fits inside and fills over the frame", () => {
    const source = { widthPx: 2000, heightPx: 1000 };
    const frame = { widthPx: 1000, heightPx: 1000 };
    expect(fitScale(source, frame, "fit")).toBe(0.5);
    expect(fitScale(source, frame, "fill")).toBe(1);
  });
});

describe("viewing modes", () => {
  const tree = [
    image("a"),
    createGroupLayer({ id: "g", name: "Group", children: [image("b"), image("c")] }),
  ];

  it("returns the tree untouched when nothing is soloed or isolated", () => {
    expect(applyViewingModes(tree, {})).toEqual(tree);
    expect(applyViewingModes(tree, { soloLayerIds: [], isolateGroupId: null })).toEqual(tree);
  });

  it("keeps only soloed layers, including through their groups", () => {
    const soloed = applyViewingModes(tree, { soloLayerIds: ["b"] });
    expect(flattenLayers(soloed).map((entry) => entry.layer.id)).toEqual(["g", "b"]);
  });

  it("drops a group entirely when none of its children are soloed", () => {
    expect(applyViewingModes(tree, { soloLayerIds: ["a"] }).map((layer) => layer.id)).toEqual(["a"]);
  });

  it("scopes to a group's contents when isolating", () => {
    expect(applyViewingModes(tree, { isolateGroupId: "g" }).map((layer) => layer.id)).toEqual(["b", "c"]);
  });

  it("combines isolate and solo", () => {
    expect(applyViewingModes(tree, { isolateGroupId: "g", soloLayerIds: ["c"] }).map((layer) => layer.id)).toEqual(["c"]);
  });

  it("ignores an isolate target that is not a group", () => {
    expect(applyViewingModes(tree, { isolateGroupId: "a" })).toEqual(tree);
    expect(applyViewingModes(tree, { isolateGroupId: "missing" })).toEqual(tree);
  });

  it("never mutates the source tree", () => {
    const before = JSON.stringify(tree);
    applyViewingModes(tree, { soloLayerIds: ["b"], isolateGroupId: "g" });
    expect(JSON.stringify(tree)).toBe(before);
  });
});
