import { z } from "zod";
import { JsonStringSchema, unixMs, uuid } from "./common";

export const UserSettingsSchema = z.object({
  user_id: uuid,
  settings_json: JsonStringSchema,
  updated_at: unixMs,
});
export type UserSettings = z.infer<typeof UserSettingsSchema>;
