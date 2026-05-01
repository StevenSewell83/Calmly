import type { SyncTable } from "@calmly/shared";

export interface TableSpec {
  name: SyncTable;
  // Domain columns (NOT including user_id and the sync trio
  // version/updated_at/deleted_at which every table shares).
  columns: readonly string[];
  // Columns whose values are JSON objects in the wire payload but persist as
  // jsonb on the server. The handler stringifies on insert.
  jsonColumns?: readonly string[];
}

export const TABLES: Record<SyncTable, TableSpec> = {
  inbox_items: {
    name: "inbox_items",
    columns: [
      "id",
      "raw_text",
      "source",
      "created_at",
      "resolved_at",
      "snoozed_until",
      "external_ref",
    ],
  },
  tasks: {
    name: "tasks",
    columns: [
      "id",
      "title",
      "notes",
      "type",
      "status",
      "due_at",
      "parent_task_id",
      "source",
      "created_at",
      "scheduled_start",
      "scheduled_end",
    ],
  },
  events: {
    name: "events",
    columns: ["id", "title", "start_at", "end_at", "source", "created_at"],
  },
  reminder_rules: {
    name: "reminder_rules",
    columns: [
      "id",
      "task_id",
      "importance",
      "interval_seconds",
      "escalation_json",
      "active",
    ],
    jsonColumns: ["escalation_json"],
  },
  recurrence_rules: {
    name: "recurrence_rules",
    columns: ["id", "owner_type", "owner_id", "rrule_text"],
  },
  calendar_event_imports: {
    name: "calendar_event_imports",
    columns: [
      "id",
      "account_id",
      "provider",
      "external_id",
      "raw_json",
      "start_at",
      "end_at",
      "last_seen_at",
    ],
    jsonColumns: ["raw_json"],
  },
  ai_suggestions: {
    name: "ai_suggestions",
    columns: [
      "id",
      "owner_type",
      "owner_id",
      "model",
      "prompt_class",
      "suggestion_json",
      "outcome",
      "created_at",
    ],
    jsonColumns: ["suggestion_json"],
  },
  telegram_links: {
    name: "telegram_links",
    columns: ["id", "chat_id", "linked_at"],
  },
  user_settings: {
    name: "user_settings",
    columns: ["id", "settings_json"],
    jsonColumns: ["settings_json"],
  },
} as const;
