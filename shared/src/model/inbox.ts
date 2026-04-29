import { z } from "zod";
import { InboxSourceSchema, unixMs, uuid } from "./common";

export const InboxItemSchema = z.object({
  id: uuid,
  user_id: uuid,
  raw_text: z.string().min(1),
  source: InboxSourceSchema,
  created_at: unixMs,
  resolved_at: unixMs.nullable(),
});
export type InboxItem = z.infer<typeof InboxItemSchema>;
