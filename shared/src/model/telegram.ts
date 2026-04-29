import { z } from "zod";
import { unixMs, uuid } from "./common";

export const TelegramLinkSchema = z.object({
  id: uuid,
  user_id: uuid,
  chat_id: z.string().min(1),
  linked_at: unixMs,
});
export type TelegramLink = z.infer<typeof TelegramLinkSchema>;
