// TGR-08 — ChannelRouter: picks which Channel a reminder goes out on and
// falls back to the other one if the primary attempt signals `fallback`.
// "Prefers telegram when linked else desktop" per the TGR-08 spec; real
// telegram/desktop Channel implementations are TGR-09/10 — this router
// is channel-agnostic and just orchestrates whatever it's given.
import type {
  Channel,
  ChannelDeliverResult,
  ChannelDeliveryInput,
} from "./channels/types";

export interface ChannelRouterDeps {
  /** Injected rather than a raw pg.Pool so this class stays unit-testable
   * without a database — real wiring passes telegram/linking.ts's
   * getLinkingStatus. */
  isTelegramLinked: (userId: string) => Promise<boolean>;
  telegram: Channel;
  desktop: Channel;
}

export interface RoutedDeliverResult extends ChannelDeliverResult {
  channel: string;
}

export class ChannelRouter {
  constructor(private readonly deps: ChannelRouterDeps) {}

  async pickChannel(userId: string): Promise<Channel> {
    const linked = await this.deps.isTelegramLinked(userId);
    return linked ? this.deps.telegram : this.deps.desktop;
  }

  async deliver(input: ChannelDeliveryInput): Promise<RoutedDeliverResult> {
    const primary = await this.pickChannel(input.userId);
    const primaryResult = await primary.deliver(input);
    if (primaryResult.ok || !primaryResult.fallback) {
      return { ...primaryResult, channel: primary.name };
    }
    const secondary =
      primary === this.deps.telegram ? this.deps.desktop : this.deps.telegram;
    const secondaryResult = await secondary.deliver(input);
    return { ...secondaryResult, channel: secondary.name };
  }
}
