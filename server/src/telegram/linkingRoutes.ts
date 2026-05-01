// TG-02b: HTTP routes for Telegram account linking.
//
// POST /telegram/linking/code   — generate a new one-time linking code
// GET  /telegram/linking/status — check whether the session user is linked
// POST /telegram/linking/unlink — remove the Telegram link
import type { FastifyInstance } from "fastify";
import { requireSession } from "../middleware/requireSession";
import {
  generateLinkingCode,
  getLinkingStatus,
  unlinkTelegram,
} from "./linking";

export async function telegramLinkingRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/telegram/linking/code",
    { preHandler: requireSession },
    async (req, reply) => {
      const user = req.sessionUser!;
      const result = await generateLinkingCode(app.pool, user.id, Date.now());
      if (!result.ok) {
        return reply.code(429).send({ error: result.error });
      }
      return reply.code(200).send({ code: result.code, expiresAt: result.expiresAt });
    },
  );

  app.get(
    "/telegram/linking/status",
    { preHandler: requireSession },
    async (req, reply) => {
      const user = req.sessionUser!;
      const status = await getLinkingStatus(app.pool, user.id);
      return reply.code(200).send(status);
    },
  );

  app.post(
    "/telegram/linking/unlink",
    { preHandler: requireSession },
    async (req, reply) => {
      const user = req.sessionUser!;
      const result = await unlinkTelegram(app.pool, user.id);
      return reply.code(200).send(result);
    },
  );
}
