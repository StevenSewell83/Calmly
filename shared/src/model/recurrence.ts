import { z } from "zod";
import { RecurrenceOwnerTypeSchema, uuid } from "./common";

export const RecurrenceRuleSchema = z.object({
  id: uuid,
  owner_type: RecurrenceOwnerTypeSchema,
  owner_id: uuid,
  rrule_text: z.string().min(1),
});
export type RecurrenceRule = z.infer<typeof RecurrenceRuleSchema>;
