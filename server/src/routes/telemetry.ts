// POL-01: Telemetry ingest endpoint.
//
// Accepts batched events from desktop clients, validates against the shared
// allow-list schema, and appends to the server-side telemetry_events table.
// Rejects unknown event names or non-allow-listed prop keys with 400.
// No user content, no free text, no emails — only allow-listed fields.
import type { FastifyInstance } from "fastify";
import { TelemetryBatchSchema } from "@calmly/shared";

const MAX_PAYLOAD_BYTES = 256 * 1024; // 256 KB

export async function telemetryRoute(app: FastifyInstance): Promise<void> {
  app.post("/telemetry/ingest", {
    config: { rawBody: false },
  }, async (req, reply) => {
    // Reject oversized payloads early.
    const contentLength = parseInt(req.headers["content-length"] ?? "0", 10);
    if (contentLength > MAX_PAYLOAD_BYTES) {
      return reply.code(413).send({ error: "payload_too_large" });
    }

    const parsed = TelemetryBatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_payload",
        issues: parsed.error.issues.map((i: { message: string }) => i.message),
      });
    }

    const { events } = parsed.data;
    if (events.length === 0) {
      return reply.code(202).send({ accepted: 0 });
    }

    const appVersion = (req.headers["x-app-version"] as string | undefined) ?? null;

    // Insert all events in a single transaction.
    const client = await app.pool.connect();
    try {
      await client.query("BEGIN");
      for (const ev of events) {
        await client.query(
          `INSERT INTO telemetry_events
             (event_name, anonymous_id, session_id, props_json, app_version, received_at)
           VALUES ($1, $2, $3, $4, $5, now())`,
          [
            ev.event,
            ev.anonymous_id,
            ev.session_id,
            JSON.stringify(ev.props ?? {}),
            appVersion,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      app.log.error({ err }, "telemetry ingest failed");
      return reply.code(500).send({ error: "internal" });
    } finally {
      client.release();
    }

    return reply.code(202).send({ accepted: events.length });
  });
}
