// TGR-08 — LogChannel: the only Channel implementation this bead ships.
// Stands in for both real channels (telegram = TGR-09, desktop = TGR-10)
// until they land, and is what tests inject directly.
//
// Never logs task content — only ids — per PRD §13 (no PII at info level).
import type {
  Channel,
  ChannelDeliverResult,
  ChannelDeliveryInput,
} from "./types";

export interface MinimalLogger {
  info(obj: unknown, msg?: string): void;
}

export class LogChannel implements Channel {
  constructor(
    readonly name: string,
    private readonly logger: MinimalLogger = console,
  ) {}

  async deliver(input: ChannelDeliveryInput): Promise<ChannelDeliverResult> {
    this.logger.info(
      {
        channel: this.name,
        deliveryId: input.deliveryId,
        ruleId: input.ruleId,
        taskId: input.taskId,
      },
      "reminder delivery logged (no real channel wired yet)",
    );
    return { ok: true };
  }
}
