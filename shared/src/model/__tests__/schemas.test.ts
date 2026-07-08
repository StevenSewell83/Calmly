import { describe, expect, it } from "vitest";
import {
  AiSuggestionSchema,
  CalendarEventImportSchema,
  CalendarEventSchema,
  InboxItemSchema,
  ReminderRuleSchema,
  RecurrenceRuleSchema,
  TaskSchema,
  TelegramLinkSchema,
  UserSchema,
  UserSettingsSchema,
} from "../index";

const userId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const now = 1_730_000_000_000;

describe("UserSchema", () => {
  it("accepts a well-formed user", () => {
    expect(
      UserSchema.parse({
        id: userId,
        email: "alex@example.com",
        created_at: now,
      }),
    ).toMatchObject({ email: "alex@example.com" });
  });

  it("rejects bad emails", () => {
    expect(() =>
      UserSchema.parse({
        id: userId,
        email: "not-an-email",
        created_at: now,
      }),
    ).toThrow();
  });

  it("rejects non-uuid ids", () => {
    expect(() =>
      UserSchema.parse({
        id: "abc",
        email: "alex@example.com",
        created_at: now,
      }),
    ).toThrow();
  });
});

describe("InboxItemSchema", () => {
  it("accepts known sources", () => {
    expect(
      InboxItemSchema.parse({
        id: otherId,
        user_id: userId,
        raw_text: "milk",
        source: "telegram-voice",
        created_at: now,
        resolved_at: null,
        snoozed_until: null,
        external_ref: null,
      }).source,
    ).toBe("telegram-voice");
  });

  it("rejects an unknown source", () => {
    expect(() =>
      InboxItemSchema.parse({
        id: otherId,
        user_id: userId,
        raw_text: "milk",
        source: "fax",
        created_at: now,
        resolved_at: null,
        snoozed_until: null,
        external_ref: null,
      }),
    ).toThrow();
  });

  it("accepts a future snoozed_until", () => {
    expect(
      InboxItemSchema.parse({
        id: otherId,
        user_id: userId,
        raw_text: "buy gift",
        source: "desktop",
        created_at: now,
        resolved_at: null,
        snoozed_until: now + 3_600_000,
        external_ref: null,
      }).snoozed_until,
    ).toBe(now + 3_600_000);
  });

  it("accepts external_ref for server-ingested rows (TG-03a)", () => {
    expect(
      InboxItemSchema.parse({
        id: otherId,
        user_id: userId,
        raw_text: "from telegram",
        source: "telegram-text",
        created_at: now,
        resolved_at: null,
        snoozed_until: null,
        external_ref: "tg:42:101",
      }).external_ref,
    ).toBe("tg:42:101");
  });
});

describe("TaskSchema", () => {
  it("accepts an open task", () => {
    expect(
      TaskSchema.parse({
        id: otherId,
        user_id: userId,
        title: "Write PR",
        notes: null,
        type: "task",
        status: "open",
        due_at: null,
        parent_task_id: null,
        source: "desktop",
        created_at: now,
        updated_at: now,
        scheduled_start: null,
        scheduled_end: null,
      }).status,
    ).toBe("open");
  });

  it("rejects an unknown status", () => {
    expect(() =>
      TaskSchema.parse({
        id: otherId,
        user_id: userId,
        title: "Write PR",
        notes: null,
        type: "task",
        status: "abandoned",
        due_at: null,
        parent_task_id: null,
        source: "desktop",
        created_at: now,
        updated_at: now,
        scheduled_start: null,
        scheduled_end: null,
      }),
    ).toThrow();
  });

  it("rejects empty titles", () => {
    expect(() =>
      TaskSchema.parse({
        id: otherId,
        user_id: userId,
        title: "",
        notes: null,
        type: "task",
        status: "open",
        due_at: null,
        parent_task_id: null,
        source: "desktop",
        created_at: now,
        updated_at: now,
        scheduled_start: null,
        scheduled_end: null,
      }),
    ).toThrow();
  });

  it("accepts a placed task with start <= end", () => {
    expect(
      TaskSchema.parse({
        id: otherId,
        user_id: userId,
        title: "Lunch",
        notes: null,
        type: "task",
        status: "open",
        due_at: null,
        parent_task_id: null,
        source: "desktop",
        created_at: now,
        updated_at: now,
        scheduled_start: now + 60_000,
        scheduled_end: now + 180_000,
      }).scheduled_start,
    ).toBe(now + 60_000);
  });

  it("rejects half-placed schedule (only start set)", () => {
    expect(() =>
      TaskSchema.parse({
        id: otherId,
        user_id: userId,
        title: "Lunch",
        notes: null,
        type: "task",
        status: "open",
        due_at: null,
        parent_task_id: null,
        source: "desktop",
        created_at: now,
        updated_at: now,
        scheduled_start: now + 60_000,
        scheduled_end: null,
      }),
    ).toThrow();
  });

  it("rejects scheduled_end < scheduled_start", () => {
    expect(() =>
      TaskSchema.parse({
        id: otherId,
        user_id: userId,
        title: "Lunch",
        notes: null,
        type: "task",
        status: "open",
        due_at: null,
        parent_task_id: null,
        source: "desktop",
        created_at: now,
        updated_at: now,
        scheduled_start: now + 200_000,
        scheduled_end: now + 100_000,
      }),
    ).toThrow();
  });
});

describe("CalendarEventSchema", () => {
  it("accepts a valid range", () => {
    expect(
      CalendarEventSchema.parse({
        id: otherId,
        user_id: userId,
        title: "Standup",
        start_at: now,
        end_at: now + 30 * 60 * 1000,
        source: "manual",
        created_at: now,
      }).title,
    ).toBe("Standup");
  });

  it("rejects end_at < start_at", () => {
    expect(() =>
      CalendarEventSchema.parse({
        id: otherId,
        user_id: userId,
        title: "Standup",
        start_at: now,
        end_at: now - 1,
        source: "manual",
        created_at: now,
      }),
    ).toThrow();
  });
});

describe("ReminderRuleSchema", () => {
  it("accepts importance + valid JSON escalation", () => {
    expect(
      ReminderRuleSchema.parse({
        id: otherId,
        task_id: userId,
        importance: "important",
        interval_seconds: 600,
        escalation_json: '{"steps":[]}',
        active: 1,
      }).interval_seconds,
    ).toBe(600);
  });

  it("rejects non-positive intervals", () => {
    expect(() =>
      ReminderRuleSchema.parse({
        id: otherId,
        task_id: userId,
        importance: "important",
        interval_seconds: 0,
        escalation_json: "{}",
        active: 1,
      }),
    ).toThrow();
  });

  it("rejects malformed JSON", () => {
    expect(() =>
      ReminderRuleSchema.parse({
        id: otherId,
        task_id: userId,
        importance: "soft",
        interval_seconds: 60,
        escalation_json: "{not-json",
        active: 0,
      }),
    ).toThrow();
  });
});

describe("RecurrenceRuleSchema", () => {
  it("requires owner_type to be task or reminder", () => {
    expect(() =>
      RecurrenceRuleSchema.parse({
        id: otherId,
        owner_type: "habit",
        owner_id: userId,
        rrule_text: "FREQ=DAILY",
      }),
    ).toThrow();
  });
});

describe("CalendarEventImportSchema", () => {
  const accountId = "44444444-4444-4444-8444-444444444444";

  it("accepts a google import", () => {
    expect(
      CalendarEventImportSchema.parse({
        id: otherId,
        user_id: userId,
        account_id: accountId,
        provider: "google",
        external_id: "abc123",
        raw_json: "{}",
        start_at: now,
        end_at: now + 1,
        last_seen_at: now,
      }).provider,
    ).toBe("google");
  });

  it("rejects unknown provider", () => {
    expect(() =>
      CalendarEventImportSchema.parse({
        id: otherId,
        user_id: userId,
        account_id: accountId,
        provider: "yahoo",
        external_id: "abc",
        raw_json: "{}",
        start_at: now,
        end_at: now + 1,
        last_seen_at: now,
      }),
    ).toThrow();
  });

  it("rejects missing account_id (CAL-04a)", () => {
    expect(() =>
      CalendarEventImportSchema.parse({
        id: otherId,
        user_id: userId,
        provider: "google",
        external_id: "abc",
        raw_json: "{}",
        start_at: now,
        end_at: now + 1,
        last_seen_at: now,
      }),
    ).toThrow();
  });
});

describe("AiSuggestionSchema", () => {
  it("defaults outcome to pending when explicitly set", () => {
    expect(
      AiSuggestionSchema.parse({
        id: otherId,
        owner_type: "task",
        owner_id: userId,
        model: "claude-haiku-4-5",
        prompt_class: "split_inbox_item",
        suggestion_json: '{"items":[]}',
        outcome: "pending",
        created_at: now,
      }).outcome,
    ).toBe("pending");
  });

  it("rejects unknown outcome", () => {
    expect(() =>
      AiSuggestionSchema.parse({
        id: otherId,
        owner_type: "task",
        owner_id: userId,
        model: "claude-haiku-4-5",
        prompt_class: "split_inbox_item",
        suggestion_json: "{}",
        outcome: "maybe",
        created_at: now,
      }),
    ).toThrow();
  });
});

describe("TelegramLinkSchema", () => {
  it("accepts a chat link", () => {
    expect(
      TelegramLinkSchema.parse({
        id: otherId,
        user_id: userId,
        chat_id: "chat-42",
        linked_at: now,
      }).chat_id,
    ).toBe("chat-42");
  });
});

describe("UserSettingsSchema", () => {
  it("accepts a valid JSON blob", () => {
    expect(
      UserSettingsSchema.parse({
        id: otherId,
        user_id: userId,
        settings_json: '{"version":1}',
        updated_at: now,
      }).user_id,
    ).toBe(userId);
  });

  it("rejects invalid JSON", () => {
    expect(() =>
      UserSettingsSchema.parse({
        id: otherId,
        user_id: userId,
        settings_json: "{not-json",
        updated_at: now,
      }),
    ).toThrow();
  });
});
