import { z } from "zod";
import { EventSourceSchema, unixMs, uuid } from "./common";

export const CalendarEventSchema = z
  .object({
    id: uuid,
    user_id: uuid,
    title: z.string().min(1),
    start_at: unixMs,
    end_at: unixMs,
    source: EventSourceSchema,
    created_at: unixMs,
  })
  .refine((e) => e.end_at >= e.start_at, {
    message: "end_at must be >= start_at",
    path: ["end_at"],
  });
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

export const CalendarEventRecordSchema = CalendarEventSchema.innerType().extend({
  version: z.number().int().nonnegative(),
  updated_at: unixMs,
  deleted_at: unixMs.nullable(),
});
export type CalendarEventRecord = z.infer<typeof CalendarEventRecordSchema>;
