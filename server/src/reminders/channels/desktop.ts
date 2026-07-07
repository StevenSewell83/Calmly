// TGR-10 — DesktopChannel: the real Channel implementation for the desktop
// notification fallback. Rebuilds lost RM-05 (calmly-91t.5), simplified to
// the transport that actually exists: server/src/sync/ is pull-based (see
// sync/routes.ts's /sync/pull), there is no live push stream to a
// connected desktop client. So "delivering" over this channel is just
// recording the fact that this delivery is desktop's to pick up — the
// scheduler's store.createDelivery already wrote the row with
// channel='desktop', and attemptDispatch's recordAttempt (see
// scheduler.ts) flips it to status='sent' on this method's {ok:true}. The
// desktop client discovers it by polling GET /reminder-deliveries/pending
// (desktopDeliveries.ts / desktopDeliveryRoutes.ts) on its own cadence and
// ack-marks it once displayed.
//
// Never logs task content — only ids — per PRD §13 (no PII at info level),
// same convention as LogChannel (log.ts).
import { DESKTOP_CHANNEL_NAME } from "./types";
import type { Channel, ChannelDeliverResult, ChannelDeliveryInput } from "./types";

export interface MinimalLogger {
  info(obj: unknown, msg?: string): void;
}

export class DesktopChannel implements Channel {
  readonly name = DESKTOP_CHANNEL_NAME;

  constructor(private readonly logger: MinimalLogger = console) {}

  async deliver(input: ChannelDeliveryInput): Promise<ChannelDeliverResult> {
    this.logger.info(
      {
        channel: this.name,
        deliveryId: input.deliveryId,
        ruleId: input.ruleId,
        taskId: input.taskId,
      },
      "reminder delivery marked pending for desktop pickup",
    );
    return { ok: true };
  }
}
