import { z } from "zod";
import { unixMs, uuid } from "./common";

// CL-13 Daily Shutdown reflection.
//
// One row per (user_id, date). `date` is a 'YYYY-MM-DD' string in the
// user's local tz at shutdown time — see migration 0009 for the
// rationale. `text` holds the optional one-line (or longer) journal
// entry; the renderer caps it at 280 chars, the schema keeps a
// generous server-side ceiling at 4096 to stop pathological writes.

export const ReflectionDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

export const DailyReflectionSchema = z.object({
  id: uuid,
  user_id: uuid,
  date: ReflectionDateSchema,
  text: z.string().min(1).max(4096),
  created_at: unixMs,
});
export type DailyReflection = z.infer<typeof DailyReflectionSchema>;
