// TGR-08 — HTTP surface for reminder deliveries.
//
// POST /reminder-deliveries/:id/cancel — the only endpoint this bead
// ships. Marks a still-pending delivery 'skipped' so the scheduler's
// retry pass leaves it alone. Auth + ownership follow the same
// preHandler/store-scoped-by-user_id pattern as telegram/linkingRoutes.ts.
import type { FastifyInstance } from "fastify";
import { requireSession } from "../middleware/requireSession";
import type { ReminderStore } from "./store";

export interface ReminderDeliveryRoutesDeps {
  store: ReminderStore;
}

export function reminderDeliveryRoutes(deps: ReminderDeliveryRoutesDeps) {
  return async function routes(app: FastifyInstance): Promise<void> {
    app.post(
      "/reminder-deliveries/:id/cancel",
      { preHandler: requireSession },
      async (req, reply) => {
        const user = req.sessionUser!;
        const { id } = req.params as { id: string };
        const result = await deps.store.cancel(id, user.id);
        if (!result.ok) {
          const code = result.reason === "not_found" ? 404 : 409;
          return reply.code(code).send({ error: result.reason });
        }
        return reply.code(200).send({ ok: true });
      },
    );
  };
}
