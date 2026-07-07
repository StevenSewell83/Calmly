// TGR-10 — desktop-side client for the pull-based reminder-deliveries
// endpoints (server/src/reminders/desktopDeliveryRoutes.ts). There is no
// live push transport from server to desktop — server/src/sync/ is a
// pull/poll design (see sync/routes.ts's /sync/pull) — so "desktop channel
// delivery" means: this client polls GET /reminder-deliveries/pending on
// its own cadence (see notifier.ts's poll loop) and acks each delivery it
// has displayed via POST .../desktop-ack.
import type { ReminderImportance } from "@calmly/shared";
import { PendingDesktopDeliveriesResponseSchema } from "@calmly/shared";
import type { ApiClient } from "../net/client";

export interface PendingDesktopDelivery {
  id: string;
  taskId: string;
  taskTitle: string;
  importance: ReminderImportance;
  scheduledFor: number;
}

export interface DesktopDeliveriesClient {
  fetchPending(): Promise<PendingDesktopDelivery[]>;
  ack(deliveryId: string): Promise<void>;
}

export function createDesktopDeliveriesClient(apiClient: ApiClient): DesktopDeliveriesClient {
  return {
    async fetchPending() {
      const res = await apiClient.request<unknown>("GET", "/reminder-deliveries/pending");
      return PendingDesktopDeliveriesResponseSchema.parse(res.body).deliveries;
    },
    async ack(deliveryId) {
      await apiClient.request("POST", `/reminder-deliveries/${deliveryId}/desktop-ack`);
    },
  };
}
