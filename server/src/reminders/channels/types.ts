// TGR-08 — Channel is the seam between the scheduler and however a
// reminder actually reaches the user. Real implementations (Telegram
// send, desktop toast/notification) are TGR-09/TGR-10; this bead only
// defines the interface, the router that picks between channels
// (router.ts), and a LogChannel stand-in used both in tests and as the
// production default until the real channels land.
//
// PREVENT-2 note: TELEGRAM_CHANNEL_NAME/DESKTOP_CHANNEL_NAME below are a
// typed-surface exception for the banned-literal rule (channel identifiers,
// same category as Source enum values) — see eslint.config.mjs's override
// list, where this file is included.

export const TELEGRAM_CHANNEL_NAME = "telegram";
export const DESKTOP_CHANNEL_NAME = "desktop";

export interface ChannelDeliveryInput {
  deliveryId: string;
  ruleId: string;
  userId: string;
  taskId: string;
  scheduledFor: number;
}

export interface ChannelDeliverResult {
  ok: boolean;
  // Signals the router should try the next channel in the fallback order
  // instead of treating this attempt as a normal retry candidate (e.g. the
  // user has no linked Telegram chat at all, versus a transient send
  // failure that should just retry on the same channel next tick).
  fallback?: boolean;
  outboundMessageId?: string;
  error?: string;
}

export interface Channel {
  readonly name: string;
  deliver(input: ChannelDeliveryInput): Promise<ChannelDeliverResult>;
}
