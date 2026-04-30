import { z } from "zod";
import { unixMs, uuid } from "./common";

export const TelegramLinkSchema = z.object({
  id: uuid,
  user_id: uuid,
  chat_id: z.string().min(1),
  linked_at: unixMs,
});
export type TelegramLink = z.infer<typeof TelegramLinkSchema>;

export const TelegramLinkRecordSchema = TelegramLinkSchema.extend({
  version: z.number().int().nonnegative(),
  updated_at: z.number().int().nonnegative(),
  deleted_at: z.number().int().nonnegative().nullable(),
});
export type TelegramLinkRecord = z.infer<typeof TelegramLinkRecordSchema>;
