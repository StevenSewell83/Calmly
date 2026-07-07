import { z } from "zod";
import { JsonStringSchema, ReminderImportanceSchema, uuid } from "./common";

export const ReminderRuleSchema = z.object({
  id: uuid,
  task_id: uuid,
  importance: ReminderImportanceSchema,
  interval_seconds: z.number().int().positive(),
  escalation_json: JsonStringSchema,
  active: z.union([z.literal(0), z.literal(1)]),
});
export type ReminderRule = z.infer<typeof ReminderRuleSchema>;

export const ReminderRuleRecordSchema = ReminderRuleSchema.extend({
  version: z.number().int().nonnegative(),
  updated_at: z.number().int().nonnegative(),
  deleted_at: z.number().int().nonnegative().nullable(),
});
export type ReminderRuleRecord = z.infer<typeof ReminderRuleRecordSchema>;

// TGR-10 — wire shape for GET /reminder-deliveries/pending, the desktop
// notification fallback's pull endpoint (no live push transport exists —
// see server/src/reminders/desktopDeliveries.ts). Shared so the desktop
// client's fetch parsing and the server's response both derive from one
// canonical schema instead of two hand-written mirrors.
export const PendingDesktopDeliverySchema = z.object({
  id: uuid,
  taskId: uuid,
  taskTitle: z.string(),
  importance: ReminderImportanceSchema,
  scheduledFor: z.number().int().nonnegative(),
});
export type PendingDesktopDelivery = z.infer<typeof PendingDesktopDeliverySchema>;

export const PendingDesktopDeliveriesResponseSchema = z.object({
  deliveries: z.array(PendingDesktopDeliverySchema),
});
export type PendingDesktopDeliveriesResponse = z.infer<
  typeof PendingDesktopDeliveriesResponseSchema
>;
