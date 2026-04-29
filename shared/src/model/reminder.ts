import { z } from "zod";
import {
  JsonStringSchema,
  ReminderImportanceSchema,
  uuid,
} from "./common";

export const ReminderRuleSchema = z.object({
  id: uuid,
  task_id: uuid,
  importance: ReminderImportanceSchema,
  interval_seconds: z.number().int().positive(),
  escalation_json: JsonStringSchema,
  active: z.union([z.literal(0), z.literal(1)]),
});
export type ReminderRule = z.infer<typeof ReminderRuleSchema>;
