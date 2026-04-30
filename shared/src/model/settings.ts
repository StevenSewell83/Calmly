import { z } from "zod";
import { JsonStringSchema, unixMs, uuid } from "./common";

export const UserSettingsSchema = z.object({
  id: uuid,
  user_id: uuid,
  settings_json: JsonStringSchema,
  updated_at: unixMs,
});
export type UserSettings = z.infer<typeof UserSettingsSchema>;

// updated_at already in UserSettingsSchema
export const UserSettingsRecordSchema = UserSettingsSchema.extend({
  version: z.number().int().nonnegative(),
  deleted_at: z.number().int().nonnegative().nullable(),
});
export type UserSettingsRecord = z.infer<typeof UserSettingsRecordSchema>;
