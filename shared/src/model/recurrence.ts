import { z } from "zod";
import { RecurrenceOwnerTypeSchema, uuid } from "./common";

export const RecurrenceRuleSchema = z.object({
  id: uuid,
  owner_type: RecurrenceOwnerTypeSchema,
  owner_id: uuid,
  rrule_text: z.string().min(1),
});
export type RecurrenceRule = z.infer<typeof RecurrenceRuleSchema>;

export const RecurrenceRuleRecordSchema = RecurrenceRuleSchema.extend({
  version: z.number().int().nonnegative(),
  updated_at: z.number().int().nonnegative(),
  deleted_at: z.number().int().nonnegative().nullable(),
});
export type RecurrenceRuleRecord = z.infer<typeof RecurrenceRuleRecordSchema>;
