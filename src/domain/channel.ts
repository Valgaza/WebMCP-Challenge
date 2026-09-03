import { z } from "zod";
import { ProjectError } from "./project-error";

export const CHANNEL_SCHEMA_VERSION = 1 as const;

/**
 * The colour channels of a document, and the named greyscale ones stored alongside them.
 *
 * An alpha channel is a saved selection — a named greyscale image the same size as the
 * document, used to hold a mask for later. Rather than build a second store for the same
 * thing, alpha channels *are* saved selections, listed here under the name people expect. The
 * only cost is a translation; the benefit is that a selection saved in the selection panel
 * appears in the channels panel and can be loaded from either.
 */

export const colourChannelSchema = z.enum(["red", "green", "blue", "alpha"]);
export type ColourChannel = z.infer<typeof colourChannelSchema>;

export const COLOUR_CHANNELS: ColourChannel[] = ["red", "green", "blue", "alpha"];

/** Byte offset of each channel within an RGBA pixel. */
export const CHANNEL_OFFSET: Record<ColourChannel, number> = { red: 0, green: 1, blue: 2, alpha: 3 };

/** What a channel is currently doing in the interface, which is a view state, not document state. */
export const channelViewSchema = z.object({
  schemaVersion: z.literal(CHANNEL_SCHEMA_VERSION),
  /** Channels drawn in the composite. All four is the ordinary case. */
  visible: z.array(colourChannelSchema).default([...COLOUR_CHANNELS]),
  /**
   * A single channel shown on its own, in grey.
   *
   * Colouring an isolated channel is a common flourish and a bad one: a red channel painted
   * red cannot be judged for contrast, which is the only reason to look at it alone.
   */
  isolated: colourChannelSchema.nullable().default(null),
});
export type ChannelView = z.infer<typeof channelViewSchema>;

export const DEFAULT_CHANNEL_VIEW: ChannelView = {
  schemaVersion: CHANNEL_SCHEMA_VERSION,
  visible: [...COLOUR_CHANNELS],
  isolated: null,
};

/** One row in the channels panel: a colour channel or a stored alpha channel. */
export interface ChannelSummary {
  id: string;
  name: string;
  kind: "colour" | "alpha";
  /** Only for a colour channel. */
  channel: ColourChannel | null;
  visible: boolean;
  isolated: boolean;
  /** For an alpha channel, how much of the document it covers. */
  areaPx: number | null;
}

/**
 * Keeps only the chosen channels, writing the rest to zero.
 *
 * Alpha is treated apart from the colour channels: zeroing it would make the whole image
 * disappear rather than show what the channel contains, so hiding alpha means opaque.
 */
export function filterChannels(data: Uint8ClampedArray, visible: readonly ColourChannel[]): Uint8ClampedArray {
  const keep = new Set(visible);
  const result = new Uint8ClampedArray(data.length);
  for (let index = 0; index < data.length; index += 4) {
    result[index] = keep.has("red") ? data[index] : 0;
    result[index + 1] = keep.has("green") ? data[index + 1] : 0;
    result[index + 2] = keep.has("blue") ? data[index + 2] : 0;
    result[index + 3] = keep.has("alpha") ? data[index + 3] : 255;
  }
  return result;
}

/**
 * One channel on its own, as grey.
 *
 * Isolating alpha shows opacity as brightness, which is why the result is fully opaque: the
 * point is to see the alpha, not to see through it.
 */
export function isolateChannel(data: Uint8ClampedArray, channel: ColourChannel): Uint8ClampedArray {
  const offset = CHANNEL_OFFSET[channel];
  const result = new Uint8ClampedArray(data.length);
  for (let index = 0; index < data.length; index += 4) {
    const value = data[index + offset];
    result[index] = value;
    result[index + 1] = value;
    result[index + 2] = value;
    result[index + 3] = 255;
  }
  return result;
}

/** Applies whatever the channel view asks for, which is nothing in the ordinary case. */
export function applyChannelView(data: Uint8ClampedArray, view: ChannelView): Uint8ClampedArray {
  if (view.isolated) return isolateChannel(data, view.isolated);
  if (view.visible.length === COLOUR_CHANNELS.length) return data;
  return filterChannels(data, view.visible);
}

/** The average level of one channel, which is what a channel's histogram summarises to. */
export function channelAverage(data: Uint8ClampedArray, channel: ColourChannel): number {
  const offset = CHANNEL_OFFSET[channel];
  if (data.length === 0) return 0;
  let total = 0;
  for (let index = 0; index < data.length; index += 4) total += data[index + offset];
  return total / (data.length / 4);
}

export function assertVisibleChannels(visible: readonly ColourChannel[]): void {
  if (visible.length === 0) {
    throw new ProjectError(
      "INVALID_INPUT",
      "At least one channel has to stay visible; hiding them all would leave an empty image.",
      { fieldPath: "visible" },
    );
  }
}

/** A sentence describing what the channels panel is currently showing. */
export function describeChannelView(view: ChannelView): string {
  if (view.isolated) return `Showing the ${view.isolated} channel on its own, in grey.`;
  if (view.visible.length === COLOUR_CHANNELS.length) return "Showing all channels.";
  const hidden = COLOUR_CHANNELS.filter((channel) => !view.visible.includes(channel));
  return `Showing ${view.visible.join(", ")}; ${hidden.join(" and ")} hidden.`;
}
