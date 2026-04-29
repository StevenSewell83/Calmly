import type { FastifyInstance } from "fastify";
import { pingDb } from "../db/pool";
import { SERVER_VERSION } from "./version";

export async function healthRoute(app: FastifyInstance): Promise<void> {
  app.get("/health", async (_req, reply) => {
    const dbUp = await pingDb(app.pool);
    if (!dbUp) reply.code(503);
    return {
      ok: dbUp,
      version: SERVER_VERSION,
      db: dbUp ? "up" : "down",
    };
  });
}
