import {
  COLOUR_CHANNELS, DEFAULT_CHANNEL_VIEW, applyChannelView, assertVisibleChannels,
  channelAverage, channelViewSchema, describeChannelView,
  type ChannelSummary, type ChannelView, type ColourChannel,
} from "../domain/channel";
import type { SelectionService } from "./selection-service";
import type { SelectionPixelReader } from "./selection-service";

/**
 * The channels panel: colour channels, and the named greyscale ones stored beside them.
 *
 * An alpha channel is a saved selection — a named greyscale image the same size as the
 * document, kept for later. Rather than build a second store for the same thing, this service
 * reads the selection store and lists what it finds under the name people expect. A selection
 * saved in the selection panel appears in the channels panel, and either one can load it.
 *
 * Which channels are shown is a view state, not document state, so it lives in memory here
 * rather than in the revision: hiding the blue channel is not an edit and does not belong in
 * Undo.
 */
export class ChannelService {
  private readonly views = new Map<string, ChannelView>();

  constructor(
    private readonly selections: SelectionService,
    private readonly pixels: SelectionPixelReader,
  ) {}

  view(projectId: string): ChannelView {
    return this.views.get(projectId) ?? DEFAULT_CHANNEL_VIEW;
  }

  /** Shows or hides colour channels, or isolates one of them in grey. */
  setView(projectId: string, changes: Partial<Pick<ChannelView, "visible" | "isolated">>): ChannelView {
    const current = this.view(projectId);
    const next = channelViewSchema.parse({
      schemaVersion: current.schemaVersion,
      visible: changes.visible ?? current.visible,
      isolated: changes.isolated === undefined ? current.isolated : changes.isolated,
    });
    assertVisibleChannels(next.visible);
    this.views.set(projectId, next);
    return next;
  }

  reset(projectId: string): ChannelView {
    this.views.delete(projectId);
    return DEFAULT_CHANNEL_VIEW;
  }

  /** Every row the channels panel shows, colour and alpha together. */
  async list(projectId: string): Promise<ChannelSummary[]> {
    const view = this.view(projectId);
    const colour: ChannelSummary[] = COLOUR_CHANNELS.map((channel) => ({
      id: channel,
      name: `${channel[0].toUpperCase()}${channel.slice(1)}`,
      kind: "colour",
      channel,
      visible: view.visible.includes(channel),
      isolated: view.isolated === channel,
      areaPx: null,
    }));

    const saved = await this.selections.list(projectId);
    const alpha: ChannelSummary[] = saved.map((entry) => ({
      id: entry.id,
      name: entry.name,
      kind: "alpha",
      channel: null,
      // A stored channel is not part of the composite, so it is never "visible" in that sense.
      visible: false,
      isolated: false,
      areaPx: Math.round(entry.areaPx),
    }));

    return [...colour, ...alpha];
  }

  /** The composite as the channel view asks for it, which is unchanged in the ordinary case. */
  async readComposite(projectId: string): Promise<{ widthPx: number; heightPx: number; data: Uint8ClampedArray }> {
    const composite = await this.pixels.readComposite(projectId);
    return { ...composite, data: applyChannelView(composite.data, this.view(projectId)) };
  }

  /** The average level of each colour channel, which is what a channel's histogram sums to. */
  async levels(projectId: string): Promise<Record<ColourChannel, number>> {
    const composite = await this.pixels.readComposite(projectId);
    return {
      red: channelAverage(composite.data, "red"),
      green: channelAverage(composite.data, "green"),
      blue: channelAverage(composite.data, "blue"),
      alpha: channelAverage(composite.data, "alpha"),
    };
  }

  summary(projectId: string): string {
    return describeChannelView(this.view(projectId));
  }
}
