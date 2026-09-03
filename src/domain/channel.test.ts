import { describe, expect, it } from "vitest";
import {
  COLOUR_CHANNELS, DEFAULT_CHANNEL_VIEW, applyChannelView, assertVisibleChannels, channelAverage,
  channelViewSchema, describeChannelView, filterChannels, isolateChannel,
} from "./channel";

const pixels = (...values: number[]) => new Uint8ClampedArray(values);

/**
 * `PH-015`. Channels are a view over the composite rather than a second copy of it, and an
 * alpha channel is a saved selection under the name people expect for it.
 */
describe("channels", () => {
  it("shows everything by default", () => {
    expect(DEFAULT_CHANNEL_VIEW.visible).toEqual(COLOUR_CHANNELS);
    expect(channelViewSchema.parse({ schemaVersion: 1 })).toMatchObject({ isolated: null });
  });

  /** Zeroing alpha would make the image vanish rather than show what the channel holds. */
  it("keeps the chosen channels and treats alpha as opaque rather than blanking the image", () => {
    const filtered = filterChannels(pixels(10, 20, 30, 40), ["red"]);
    expect([...filtered]).toEqual([10, 0, 0, 255]);
  });

  it("shows one channel on its own as grey, not as its own colour", () => {
    expect([...isolateChannel(pixels(10, 200, 30, 128), "green")]).toEqual([200, 200, 200, 255]);
  });

  it("shows opacity as brightness when alpha is isolated", () => {
    expect([...isolateChannel(pixels(0, 0, 0, 90), "alpha")]).toEqual([90, 90, 90, 255]);
  });

  it("changes nothing at all in the ordinary case", () => {
    const data = pixels(1, 2, 3, 4);
    expect(applyChannelView(data, DEFAULT_CHANNEL_VIEW)).toBe(data);
  });

  it("isolation wins over visibility, because that is what isolating means", () => {
    const view = channelViewSchema.parse({ schemaVersion: 1, visible: ["red"], isolated: "blue" });
    expect([...applyChannelView(pixels(10, 20, 30, 255), view)]).toEqual([30, 30, 30, 255]);
  });

  it("averages a channel", () => {
    expect(channelAverage(pixels(0, 0, 0, 255, 100, 0, 0, 255), "red")).toBe(50);
    expect(channelAverage(new Uint8ClampedArray(0), "red")).toBe(0);
  });

  it("refuses to hide every channel, which would leave an empty image", () => {
    expect(() => assertVisibleChannels([])).toThrowError(/at least one channel/i);
    expect(() => assertVisibleChannels(["red"])).not.toThrow();
  });

  it("says what it is showing", () => {
    expect(describeChannelView(DEFAULT_CHANNEL_VIEW)).toBe("Showing all channels.");
    expect(describeChannelView(channelViewSchema.parse({ schemaVersion: 1, isolated: "red" })))
      .toContain("red channel on its own");
    expect(describeChannelView(channelViewSchema.parse({ schemaVersion: 1, visible: ["red", "green"] })))
      .toBe("Showing red, green; blue and alpha hidden.");
  });
});
