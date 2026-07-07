// TGR-08 — Fastify plugin: registers the cancel route and starts the
// interval-tick scheduler, stopping it cleanly via Fastify's onClose hook
// (index.ts's SIGTERM handler calls app.close(), which fires onClose).
import type { FastifyInstance } from "fastify";
import { getLinkingStatus } from "../telegram/linking";
import {
  DESKTOP_CHANNEL_NAME,
  TELEGRAM_CHANNEL_NAME,
} from "./channels/types";
import { LogChannel } from "./channels/log";
import { ChannelRouter } from "./router";
import { reminderDeliveryRoutes } from "./routes";
import { ReminderScheduler } from "./scheduler";
import { pgReminderStore } from "./store";

export interface ReminderSchedulerPluginOptions {
  tickIntervalMs: number;
}

export function reminderSchedulerPlugin(opts: ReminderSchedulerPluginOptions) {
  return async function plugin(app: FastifyInstance): Promise<void> {
    const store = pgReminderStore(app.pool);
    const router = new ChannelRouter({
      isTelegramLinked: async (userId) =>
        (await getLinkingStatus(app.pool, userId)).linked,
      // Real channels are TGR-09 (telegram) / TGR-10 (desktop); LogChannel
      // stands in for both until then — see channels/types.ts.
      telegram: new LogChannel(TELEGRAM_CHANNEL_NAME, app.log),
      desktop: new LogChannel(DESKTOP_CHANNEL_NAME, app.log),
    });
    const scheduler = new ReminderScheduler({ store, router, logger: app.log });

    const timer = setInterval(() => {
      scheduler.tick().catch((err: unknown) => {
        app.log.error({ err }, "reminder scheduler tick threw");
      });
    }, opts.tickIntervalMs);
    timer.unref();

    app.addHook("onClose", async () => {
      clearInterval(timer);
      await scheduler.stop();
    });

    await app.register(reminderDeliveryRoutes({ store }));
  };
}
