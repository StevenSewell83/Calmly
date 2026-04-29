import type { FastifyReply, FastifyRequest } from "fastify";
import { resolveSessionByToken } from "../auth/session";
import { isWellFormedToken } from "../auth/tokens";

declare module "fastify" {
  interface FastifyRequest {
    sessionUser?: { id: string; email: string };
  }
}

export async function requireSession(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const cookieName = req.server.appConfig.COOKIE_NAME;
  const raw = req.cookies?.[cookieName];
  if (!raw || !isWellFormedToken(raw)) {
    reply.code(401).send({ error: "unauthorized" });
    return;
  }
  const resolved = await resolveSessionByToken(req.server.pool, raw);
  if (!resolved) {
    reply.code(401).send({ error: "unauthorized" });
    return;
  }
  req.sessionUser = resolved.user;
}
