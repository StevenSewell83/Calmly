import type { FastifyInstance } from "fastify";
import {
  type PushOpResult,
  PullRequestSchema,
  PushRequestSchema,
} from "@calmly/shared";
import { requireSession } from "../middleware/requireSession";
import { TABLES } from "./tables";
import { applyOp } from "./apply";
import { pullSince } from "./pull";

async function getMaxVersion(
  app: FastifyInstance,
  userId: string,
  fallback: number,
): Promise<number> {
  const tableNames = Object.keys(TABLES);
  const unions = tableNames
    .map((t) => `SELECT max(version) AS v FROM ${t} WHERE user_id = $1`)
    .join("\n       UNION ALL ");
  // Postgres bigserial values fit in JS number range until 2^53; fine here.
  const r = await app.pool.query<{ v: string | null }>(
    `WITH versions AS (\n       ${unions}\n     )\n     SELECT max(v)::text AS v FROM versions`,
    [userId],
  );
  const v = r.rows[0]?.v;
  return v ? Number(v) : fallback;
}

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  app.post("/sync/pull", { preHandler: requireSession }, async (req, reply) => {
    const parsed = PullRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      reply.code(400).send({ error: "invalid_request" });
      return;
    }
    const userId = req.sessionUser!.id;
    return pullSince(app.pool, userId, parsed.data.since);
  });

  app.post("/sync/push", { preHandler: requireSession }, async (req, reply) => {
    const parsed = PushRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      reply.code(400).send({ error: "invalid_request" });
      return;
    }
    const userId = req.sessionUser!.id;
    const client = await app.pool.connect();
    const results: PushOpResult[] = [];
    try {
      await client.query("BEGIN");
      for (let i = 0; i < parsed.data.ops.length; i++) {
        const op = parsed.data.ops[i]!;
        const result = await applyOp({ client, userId }, i, op);
        results.push(result);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      req.log.error({ err }, "sync push transaction failed");
      reply.code(500).send({ error: "push_failed" });
      return;
    } finally {
      client.release();
    }

    const maxAccepted = results.reduce<number>((acc, r) => {
      if (r.status === "accepted" && r.version !== null && r.version > acc) {
        return r.version;
      }
      return acc;
    }, 0);
    const version = await getMaxVersion(app, userId, maxAccepted);
    return { results, version };
  });
}
