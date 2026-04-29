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
