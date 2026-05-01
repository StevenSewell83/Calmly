import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { Update } from "grammy/types";
import type { TelegramConfig } from "./config";
import { dispatchUpdate } from "./dispatcher";
import { getBot } from "./bot";

export function telegramPlugin(tgConfig: TelegramConfig): FastifyPluginAsync {
  return async function (app: FastifyInstance) {
    // Webhook — Telegram posts Updates here.
    app.post("/telegram/webhook", async (req, reply) => {
      const secret = (req.headers["x-telegram-bot-api-secret-token"] ?? "") as string;
      if (secret !== tgConfig.TELEGRAM_WEBHOOK_SECRET) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const update = req.body as Update;
      dispatchUpdate(update, req.log, req.server.pool);
      return reply.status(200).send({ ok: true });
    });

    // Health — confirms getMe succeeds and reports webhook status.
    app.get("/telegram/health", async (_req, reply) => {
      try {
        const bot = getBot();
        const [me, webhookInfo] = await Promise.all([
          bot.api.getMe(),
          bot.api.getWebhookInfo(),
        ]);
        return reply.send({
          ok: true,
          botUsername: me.username,
          webhookSet: webhookInfo.url !== "",
          webhookUrl: webhookInfo.url || null,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(502).send({ ok: false, error: message });
      }
    });
  };
}
