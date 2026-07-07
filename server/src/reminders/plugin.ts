// TGR-08 — Fastify plugin: registers the cancel route and starts the
// interval-tick scheduler, stopping it cleanly via Fastify's onClose hook
// (index.ts's SIGTERM handler calls app.close(), which fires onClose).
// TGR-10 additionally wires the real DesktopChannel (replacing the
// LogChannel stand-in) and registers its pending/ack pull endpoints.
// TGR-11 registers the Done/Snooze/Reschedule Telegram callback handlers
// (registerReminderActions — the first production caller of TGR-03's
// registerAction) and the desktop action route.
import type { FastifyInstance } from "fastify";
import { getLinkingStatus } from "../telegram/linking";
import { getBot as getTelegramBot } from "../telegram/bot";
import type { OutboundBotClient } from "../telegram/outbound";
import { DesktopChannel } from "./channels/desktop";
import { TelegramChannel } from "./channels/telegram";
import { ChannelRouter } from "./router";
import { desktopDeliveryRoutes } from "./desktopDeliveryRoutes";
import { pgDesktopDeliveryStore } from "./desktopDeliveries";
import { reminderDeliveryRoutes } from "./routes";
import { reminderActionRoutes } from "./actionRoutes";
import { pgReminderActionStore } from "./actionsStore";
import { registerReminderActions } from "./telegramActions";
import { ReminderScheduler } from "./scheduler";
import { pgReminderStore } from "./store";

export interface ReminderSchedulerPluginOptions {
  tickIntervalMs: number;
}

export function reminderSchedulerPlugin(opts: ReminderSchedulerPluginOptions) {
  return async function plugin(app: FastifyInstance): Promise<void> {
    const store = pgReminderStore(app.pool);
    const desktopStore = pgDesktopDeliveryStore(app.pool);
    const actionStore = pgReminderActionStore(app.pool, store);
    const router = new ChannelRouter({
      isTelegramLinked: async (userId) =>
        (await getLinkingStatus(app.pool, userId)).linked,
      telegram: new TelegramChannel({
        pool: app.pool,
        // grammy's Bot.api is structurally richer than OutboundBotClient's
        // narrow sendMessage/editMessageText shape (same friction
        // dispatcher.ts casts around for CallbackBotClient/TelegramFileClient).
        // Resolved lazily (not at registration time, which runs before
        // app.ts calls initBot) — see TelegramChannelDeps' getBot doc.
        getBot: () => getTelegramBot() as unknown as OutboundBotClient,
      }),
      // TGR-10: real desktop channel — see desktopDeliveries.ts for how the
      // desktop client actually discovers/acks this delivery.
      desktop: new DesktopChannel(app.log),
    });
    const scheduler = new ReminderScheduler({ store, router, logger: app.log });

    registerReminderActions({
      pool: app.pool,
      store: actionStore,
      getBot: () => getTelegramBot() as unknown as OutboundBotClient,
    });

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
    await app.register(desktopDeliveryRoutes({ store: desktopStore }));
    await app.register(reminderActionRoutes({ store: actionStore }));
  };
}
