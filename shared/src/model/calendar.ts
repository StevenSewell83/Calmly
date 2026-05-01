import { z } from "zod";
import {
  CalendarProviderSchema,
  JsonStringSchema,
  unixMs,
  uuid,
} from "./common";

export const CalendarEventImportSchema = z
  .object({
    id: uuid,
    user_id: uuid,
    provider: CalendarProviderSchema,
    external_id: z.string().min(1),
    raw_json: JsonStringSchema,
    start_at: unixMs,
    end_at: unixMs,
    last_seen_at: unixMs,
  })
  .refine((e) => e.end_at >= e.start_at, {
    message: "end_at must be >= start_at",
    path: ["end_at"],
  });
export type CalendarEventImport = z.infer<typeof CalendarEventImportSchema>;

export const CalendarEventImportRecordSchema = CalendarEventImportSchema.innerType().extend({
  version: z.number().int().nonnegative(),
  updated_at: z.number().int().nonnegative(),
  deleted_at: z.number().int().nonnegative().nullable(),
});
export type CalendarEventImportRecord = z.infer<typeof CalendarEventImportRecordSchema>;

export const calendarAccountStatuses = [
  "connected",
  "disconnected",
  "error",
  // CAL-03: a refresh attempt returned invalid_grant (token revoked or
  // explicitly de-authorized in the provider's UI). User must reconnect.
  "reauth_required",
] as const;
export const CalendarAccountStatusSchema = z.enum(calendarAccountStatuses);
export type CalendarAccountStatus = z.infer<typeof CalendarAccountStatusSchema>;

export const CalendarAccountSchema = z.object({
  id: uuid,
  provider: CalendarProviderSchema,
  external_account_id: z.string().min(1),
  email: z.string().email(),
  status: CalendarAccountStatusSchema,
});
export type CalendarAccount = z.infer<typeof CalendarAccountSchema>;
