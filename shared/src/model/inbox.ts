import { z } from "zod";
import { InboxSourceSchema, unixMs, uuid } from "./common";

export const InboxItemSchema = z.object({
  id: uuid,
  user_id: uuid,
  raw_text: z.string().min(1),
  source: InboxSourceSchema,
  created_at: unixMs,
  resolved_at: unixMs.nullable(),
  // CL-03: when set in the future, the item is hidden from the inbox
  // list / unresolved count until the timestamp passes. Independent of
  // resolved_at — a snoozed item is still unresolved.
  snoozed_until: unixMs.nullable(),
  // TG-03a: opaque trace marker set by server-side ingestion paths
  // (Telegram bot uses 'tg:<chat_id>:<message_id>'). Null on rows
  // captured from desktop. The (user_id, external_ref) pair has a
  // partial UNIQUE so retried inserts collide instead of duplicating.
  external_ref: z.string().nullable(),
});
export type InboxItem = z.infer<typeof InboxItemSchema>;

export const InboxItemRecordSchema = InboxItemSchema.extend({
  version: z.number().int().nonnegative(),
  updated_at: unixMs,
  deleted_at: unixMs.nullable(),
});
export type InboxItemRecord = z.infer<typeof InboxItemRecordSchema>;
