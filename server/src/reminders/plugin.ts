// TGR-08 — Fastify plugin: registers the cancel route and starts the
// interval-tick scheduler, stopping it cleanly via Fastify's onClose hook
// (index.ts's SIGTERM handler calls app.close(), which fires onClose).
import type { FastifyInstance } from "fastify";
import { getLinkingStatus } from "../telegram/linking";
import { getBot as getTelegramBot } from "../telegram/bot";
import type { OutboundBotClient } from "../telegram/outbound";
import { DESKTOP_CHANNEL_NAME } from "./channels/types";
import { LogChannel } from "./channels/log";
import { TelegramChannel } from "./channels/telegram";
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
      // TGR-09 wires the real Telegram channel; desktop's real channel is
      // TGR-10 — LogChannel stands in for it until then, see channels/types.ts.
      telegram: new TelegramChannel({
        pool: app.pool,
        // grammy's Bot.api is structurally richer than OutboundBotClient's
        // narrow sendMessage/editMessageText shape (same friction
        // dispatcher.ts casts around for CallbackBotClient/TelegramFileClient).
        // Resolved lazily (not at registration time, which runs before
        // app.ts calls initBot) — see TelegramChannelDeps' getBot doc.
        getBot: () => getTelegramBot() as unknown as OutboundBotClient,
      }),
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
