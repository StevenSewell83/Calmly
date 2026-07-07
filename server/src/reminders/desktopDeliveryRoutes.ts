// TGR-10 — HTTP surface for the desktop notification fallback's pull
// endpoints. Auth + ownership follow the same requireSession/store-scoped-
// by-user_id pattern as reminders/routes.ts's cancel route; ack is
// idempotent by design (desktopDeliveries.ts's ack sets desktop_acked_at
// unconditionally when owned, so a second call is a harmless no-op that
// still returns {ok:true}).
import type { FastifyInstance } from "fastify";
import { requireSession } from "../middleware/requireSession";
import type { DesktopDeliveryStore } from "./desktopDeliveries";

export interface DesktopDeliveryRoutesDeps {
  store: DesktopDeliveryStore;
  now?: () => number;
}

export function desktopDeliveryRoutes(deps: DesktopDeliveryRoutesDeps) {
  const now = deps.now ?? Date.now;
  return async function routes(app: FastifyInstance): Promise<void> {
    app.get(
      "/reminder-deliveries/pending",
      { preHandler: requireSession },
      async (req) => {
        const user = req.sessionUser!;
        const deliveries = await deps.store.listPending(user.id, now());
        return { deliveries };
      },
    );

    app.post(
      "/reminder-deliveries/:id/desktop-ack",
      { preHandler: requireSession },
      async (req, reply) => {
        const user = req.sessionUser!;
        const { id } = req.params as { id: string };
        const result = await deps.store.ack(id, user.id, now());
        if (!result.ok) {
          return reply.code(404).send({ error: "not_found" });
        }
        return reply.code(200).send({ ok: true });
      },
    );
  };
}
