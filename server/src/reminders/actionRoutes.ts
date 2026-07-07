// TGR-11 — POST /reminder-deliveries/:id/action: the authenticated HTTP
// action endpoint for desktop in-app actions + notification click-through.
// Auth + ownership follow the same requireSession/store-scoped-by-user_id
// pattern as routes.ts's cancel route and desktopDeliveryRoutes.ts.
//
// Desktop doesn't get the Telegram reschedule chips (out of scope per the
// bead: "desktop UI for actions beyond the endpoint contract") — reschedule
// here just acks the delivery and hands back taskId so the client can
// navigate to its own date picker.
import type { FastifyInstance } from "fastify";
import { requireSession } from "../middleware/requireSession";
import { handleDone, handleReschedule, handleSnooze, type ActionParams } from "./actions";
import { DESKTOP_CHANNEL_NAME } from "./channels/types";
import type { ReminderActionStore } from "./actionsStore";

export interface ReminderActionRoutesDeps {
  store: ReminderActionStore;
  now?: () => number;
}

type ActionBody = {
  action?: "done" | "snooze" | "reschedule";
  minutes?: number;
};

export function reminderActionRoutes(deps: ReminderActionRoutesDeps) {
  const now = deps.now ?? Date.now;
  return async function routes(app: FastifyInstance): Promise<void> {
    app.post(
      "/reminder-deliveries/:id/action",
      { preHandler: requireSession },
      async (req, reply) => {
        const user = req.sessionUser!;
        const { id } = req.params as { id: string };
        const body = req.body as ActionBody | undefined;
        const params: ActionParams = {
          deliveryId: id,
          userId: user.id,
          actorSurface: DESKTOP_CHANNEL_NAME,
          now: now(),
        };

        const result =
          body?.action === "done"
            ? await handleDone(deps.store, params)
            : body?.action === "snooze"
              ? await handleSnooze(deps.store, { ...params, minutes: body.minutes })
              : body?.action === "reschedule"
                ? await handleReschedule(deps.store, params)
                : null;

        if (result === null) {
          return reply.code(400).send({ error: "invalid_action" });
        }
        if (!result.ok) {
          return reply.code(404).send({ error: result.reason });
        }
        return reply.code(200).send(result);
      },
    );
  };
}
