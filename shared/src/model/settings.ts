import { z } from "zod";
import { JsonStringSchema, unixMs, uuid } from "./common";

// BUG-AUDIT-1: id is a synthetic uuid PK; user_id stays UNIQUE so
// there's still one settings row per user. The id exists so the sync
// apply path's ON-CONFLICT-by-id branch works like every other table.
export const UserSettingsSchema = z.object({
  id: uuid,
  user_id: uuid,
  settings_json: JsonStringSchema,
  updated_at: unixMs,
});
export type UserSettings = z.infer<typeof UserSettingsSchema>;
