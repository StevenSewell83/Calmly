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
