import { z } from "zod";

export const uuid = z.string().uuid();
export const unixMs = z.number().int().nonnegative();

export const inboxSources = [
  "desktop",
  "telegram-text",
  "telegram-voice",
  "ai-split",
  "manual-split",
] as const;
export const InboxSourceSchema = z.enum(inboxSources);
export type InboxSource = z.infer<typeof InboxSourceSchema>;

export const eventSources = ["manual", "calendar-import"] as const;
export const EventSourceSchema = z.enum(eventSources);
export type EventSource = z.infer<typeof EventSourceSchema>;

export const calendarProviders = ["google", "microsoft"] as const;
export const CalendarProviderSchema = z.enum(calendarProviders);
export type CalendarProvider = z.infer<typeof CalendarProviderSchema>;

export const reminderImportances = ["important", "soft"] as const;
export const ReminderImportanceSchema = z.enum(reminderImportances);
export type ReminderImportance = z.infer<typeof ReminderImportanceSchema>;

export const recurrenceOwnerTypes = ["task", "reminder"] as const;
export const RecurrenceOwnerTypeSchema = z.enum(recurrenceOwnerTypes);
export type RecurrenceOwnerType = z.infer<typeof RecurrenceOwnerTypeSchema>;

export const aiSuggestionOwnerTypes = ["inbox_item", "task", "event"] as const;
export const AiSuggestionOwnerTypeSchema = z.enum(aiSuggestionOwnerTypes);
export type AiSuggestionOwnerType = z.infer<typeof AiSuggestionOwnerTypeSchema>;

export const aiOutcomes = [
  "accepted",
  "rejected",
  "edited",
  "pending",
] as const;
export const AiOutcomeSchema = z.enum(aiOutcomes);
export type AiOutcome = z.infer<typeof AiOutcomeSchema>;

export const taskStatuses = [
  "open",
  "in_progress",
  "done",
  "dropped",
  "snoozed",
] as const;
export const TaskStatusSchema = z.enum(taskStatuses);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const SqliteBoolSchema = z
  .union([z.literal(0), z.literal(1)])
  .transform((v) => v === 1);
export const BoolToSqliteSchema = z.boolean().transform((v) => (v ? 1 : 0));

export const JsonStringSchema = z.string().refine((s) => {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}, "must be valid JSON");
