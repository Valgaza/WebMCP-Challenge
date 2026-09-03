import { beforeEach, describe, expect, it } from "vitest";
import type { SelectionRecord } from "../data/estro-database";
import { ChannelService } from "./channel-service";
import { SelectionService, type SelectionPixelReader, type SelectionStore } from "./selection-service";

const PROJECT = "project-1";

/** A 4×4 image with a distinct level in each channel. */
const reader = (): SelectionPixelReader => {
  const data = new Uint8ClampedArray(4 * 4 * 4);
  for (let index = 0; index < 16; index += 1) data.set([40, 80, 120, 255], index * 4);
  const source = { widthPx: 4, heightPx: 4, data };
  return { readComposite: async () => source, readLayer: async () => source };
};

const memoryStore = (): SelectionStore => {
  const rows = new Map<string, SelectionRecord>();
  return {
    put: async (record) => { rows.set(record.id, record); },
    get: async (_projectId, id) => rows.get(id) ?? null,
    list: async (projectId) => [...rows.values()].filter((record) => record.projectId === projectId),
    delete: async (_projectId, id) => { rows.delete(id); },
    deleteForProject: async () => { rows.clear(); },
  };
};

/**
 * `PH-015`. An alpha channel is a saved selection, so the channels panel reads the selection
 * store rather than keeping a second copy of the same thing.
 */
describe("ChannelService", () => {
  let selections: SelectionService;
  let channels: ChannelService;

  beforeEach(() => {
    const pixels = reader();
    selections = new SelectionService(pixels, memoryStore());
    channels = new ChannelService(selections, pixels);
  });

  it("shows all four channels and nothing isolated to begin with", async () => {
    expect(channels.view(PROJECT).visible).toEqual(["red", "green", "blue", "alpha"]);
    expect(channels.summary(PROJECT)).toBe("Showing all channels.");
    expect(await channels.list(PROJECT)).toHaveLength(4);
  });

  it("hides a channel and isolates one", () => {
    expect(channels.setView(PROJECT, { visible: ["red", "green"] }).visible).toEqual(["red", "green"]);
    expect(channels.setView(PROJECT, { isolated: "red" }).isolated).toBe("red");
    // Isolation and visibility are separate: turning isolation off leaves the earlier choice.
    expect(channels.setView(PROJECT, { isolated: null }).visible).toEqual(["red", "green"]);
    expect(channels.reset(PROJECT).visible).toHaveLength(4);
  });

  it("refuses to hide every channel, which would leave an empty image", () => {
    expect(() => channels.setView(PROJECT, { visible: [] })).toThrowError(/at least one channel/i);
  });

  it("applies the view to the composite, and changes nothing when nothing is hidden", async () => {
    const plain = await channels.readComposite(PROJECT);
    expect([...plain.data.slice(0, 4)]).toEqual([40, 80, 120, 255]);

    channels.setView(PROJECT, { isolated: "green" });
    const isolated = await channels.readComposite(PROJECT);
    expect([...isolated.data.slice(0, 4)]).toEqual([80, 80, 80, 255]);
  });

  it("reports the level of each channel", async () => {
    expect(await channels.levels(PROJECT)).toEqual({ red: 40, green: 80, blue: 120, alpha: 255 });
  });

  /** The reuse that makes this worth doing: one saved thing, two panels. */
  it("lists a saved selection as an alpha channel", async () => {
    await selections.select({
      projectId: PROJECT,
      source: { kind: "marquee", shape: "rectangle", x: 0, y: 0, width: 2, height: 2, featherPx: 0 },
    });
    await selections.save(PROJECT, "Sky");

    const listed = await channels.list(PROJECT);
    expect(listed).toHaveLength(5);
    expect(listed[4]).toMatchObject({ name: "Sky", kind: "alpha", areaPx: 4, visible: false });
  });

  it("keeps each project's channel view to itself", () => {
    channels.setView(PROJECT, { isolated: "blue" });
    expect(channels.view("project-2").isolated).toBeNull();
  });
});
