import { z } from "zod";
import { unixMs, uuid } from "./common";

export const UserSchema = z.object({
  id: uuid,
  email: z.string().email(),
  magic_link_token_hash: z.string().nullable(),
  magic_link_expires_at: unixMs.nullable(),
  created_at: unixMs,
});
export type User = z.infer<typeof UserSchema>;
