import { z } from "zod";
import {
  InboxItemRecordSchema,
  TaskRecordSchema,
  CalendarEventRecordSchema,
  ReminderRuleRecordSchema,
  RecurrenceRuleRecordSchema,
  CalendarEventImportRecordSchema,
  AiSuggestionRecordSchema,
  TelegramLinkRecordSchema,
  UserSettingsRecordSchema,
} from "@calmly/shared";
import type { SyncTable } from "@calmly/shared";

export const TABLE_SCHEMAS: Record<SyncTable, z.ZodTypeAny> = {
  inbox_items: InboxItemRecordSchema,
  tasks: TaskRecordSchema,
  events: CalendarEventRecordSchema,
  reminder_rules: ReminderRuleRecordSchema,
  recurrence_rules: RecurrenceRuleRecordSchema,
  calendar_event_imports: CalendarEventImportRecordSchema,
  ai_suggestions: AiSuggestionRecordSchema,
  telegram_links: TelegramLinkRecordSchema,
  user_settings: UserSettingsRecordSchema,
};
