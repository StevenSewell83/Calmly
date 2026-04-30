import { z } from "zod";
import { unixMs, uuid } from "./common";

export const UserSchema = z.object({
  id: uuid,
  email: z.string().email(),
  created_at: unixMs,
});
export type User = z.infer<typeof UserSchema>;
