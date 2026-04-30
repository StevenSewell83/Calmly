import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
} from "@calmly/shared";

// F-05b: end-to-end SQL ↔ Zod round-trip for every domain table.
//
// Why node:sqlite. better-sqlite3's prebuilt binding is rebuilt for
// Electron's ABI by the project's postinstall (see package.json
// rebuild-native script), making it incompatible with vitest's host
// Node. Rather than juggle a second binding, we lean on node:sqlite —
// stable in Node 24+, available behind --experimental-sqlite in Node
// 22.5+. The libsqlite version Node ships (3.45+) supports STRICT
// tables, CHECK constraints, partial indices, and unixepoch() — i.e.
// every SQLite feature our migrations use, so it's a faithful
// portability check by construction.
//
// Risk: a quirk in libsqlite version drift between node:sqlite and
// better-sqlite3 could pass here and fail in the packaged app (or
// vice versa). For schema/Zod assertions this is low risk; for
// performance/feature claims it is not, so don't repurpose this file.

// Hand-rolled types for node:sqlite so we don't need to bump
// @types/node workspace-wide. Only the surface this test exercises.
interface NodeSqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
interface NodeSqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): NodeSqliteStatement;
}
interface NodeSqliteModule {
  DatabaseSync: new (path: string) => NodeSqliteDatabase;
}

// Lazy-require so a host Node without node:sqlite (e.g., Node <22.5
// or 22.x without --experimental-sqlite) skips the suite cleanly
// rather than crashing the whole test run.
let nodeSqlite: NodeSqliteModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  nodeSqlite = require("node:sqlite") as NodeSqliteModule;
} catch {
  nodeSqlite = null;
}

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "migrations");

function applyAllMigrations(db: NodeSqliteDatabase): string[] {
  const files = readdirSync(migrationsDir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();
  const applied: string[] = [];
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    db.exec(sql);
    applied.push(file);
  }
  return applied;
}

function freshDb(): NodeSqliteDatabase {
  if (!nodeSqlite) throw new Error("node:sqlite not available");
  const db = new nodeSqlite.DatabaseSync(":memory:");
  // Foreign keys are off by default in SQLite; turn them on so the
  // CASCADE assertion below actually exercises the chain.
  db.exec("PRAGMA foreign_keys = ON;");
  applyAllMigrations(db);
  return db;
}

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const NOW = 1_730_000_000_000;

describe.skipIf(!nodeSqlite)("F-05b · DB round-trip integration", () => {
  it("applies every migration on a fresh in-memory DB without errors", () => {
    // Bare existence check — every migration's CREATE/ALTER ran
    // cleanly in order. The test fixture freshDb() already does this;
    // sanity-checking one of the latest tables exists confirms the
    // chain made it all the way through.
    const db = freshDb();
    const cols = db
      .prepare(`PRAGMA table_info(focus_sessions)`)
      .all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        "id",
        "user_id",
        "task_id",
        "started_at",
        "ended_at",
        "source",
      ]),
    );
  });

  it("round-trips a User through INSERT + SELECT + Zod parse", () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)`,
    ).run(USER_ID, "alex@example.com", NOW);

    const row = db
      .prepare(`SELECT * FROM users WHERE id = ?`)
      .get(USER_ID) as Record<string, unknown>;
    const parsed = UserSchema.parse(row);
    expect(parsed.email).toBe("alex@example.com");
    expect(parsed.id).toBe(USER_ID);
  });

  it("round-trips an InboxItem", () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)`,
    ).run(USER_ID, "alex@example.com", NOW);
    db.prepare(
      `INSERT INTO inbox_items
         (id, user_id, raw_text, source, created_at, resolved_at, version, deleted_at, snoozed_until)
       VALUES (?, ?, ?, ?, ?, NULL, 0, NULL, NULL)`,
    ).run(OTHER_ID, USER_ID, "buy milk", "desktop", NOW);

    const row = db
      .prepare(`SELECT * FROM inbox_items WHERE id = ?`)
      .get(OTHER_ID) as Record<string, unknown>;
    const parsed = InboxItemSchema.parse(row);
    expect(parsed.raw_text).toBe("buy milk");
    expect(parsed.source).toBe("desktop");
  });

  it("round-trips a Task with the schedule pair", () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)`,
    ).run(USER_ID, "alex@example.com", NOW);
    db.prepare(
      `INSERT INTO tasks
         (id, user_id, title, notes, type, status, due_at, parent_task_id,
          source, created_at, updated_at, version, deleted_at,
          scheduled_start, scheduled_end)
       VALUES (?, ?, ?, NULL, 'task', 'open', ?, NULL, 'desktop', ?, ?, 0, NULL, ?, ?)`,
    ).run(
      OTHER_ID,
      USER_ID,
      "Write PR",
      NOW + 3_600_000,
      NOW,
      NOW,
      NOW + 1_000,
      NOW + 4_000,
    );

    const row = db
      .prepare(`SELECT * FROM tasks WHERE id = ?`)
      .get(OTHER_ID) as Record<string, unknown>;
    const parsed = TaskSchema.parse(row);
    expect(parsed.title).toBe("Write PR");
    expect(parsed.scheduled_start).toBe(NOW + 1_000);
    expect(parsed.scheduled_end).toBe(NOW + 4_000);
  });

  it("round-trips an Event", () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)`,
    ).run(USER_ID, "alex@example.com", NOW);
    db.prepare(
      `INSERT INTO events
         (id, user_id, title, start_at, end_at, source, created_at, version, deleted_at)
       VALUES (?, ?, ?, ?, ?, 'manual', ?, 0, NULL)`,
    ).run(OTHER_ID, USER_ID, "Standup", NOW, NOW + 1_800_000, NOW);

    const row = db
      .prepare(`SELECT * FROM events WHERE id = ?`)
      .get(OTHER_ID) as Record<string, unknown>;
    const parsed = CalendarEventSchema.parse(row);
    expect(parsed.title).toBe("Standup");
    expect(parsed.end_at - parsed.start_at).toBe(1_800_000);
  });

  it("round-trips a ReminderRule", () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)`,
    ).run(USER_ID, "alex@example.com", NOW);
    const taskId = "33333333-3333-4333-8333-333333333333";
    db.prepare(
      `INSERT INTO tasks
         (id, user_id, title, type, status, source, created_at, updated_at, version, deleted_at)
       VALUES (?, ?, ?, 'task', 'open', 'desktop', ?, ?, 0, NULL)`,
    ).run(taskId, USER_ID, "Take pill", NOW, NOW);
    db.prepare(
      `INSERT INTO reminder_rules
         (id, task_id, importance, interval_seconds, escalation_json, active, version, deleted_at)
       VALUES (?, ?, ?, ?, ?, 1, 0, NULL)`,
    ).run(OTHER_ID, taskId, "important", 3600, '{"step":"ping"}');

    const row = db
      .prepare(`SELECT * FROM reminder_rules WHERE id = ?`)
      .get(OTHER_ID) as Record<string, unknown>;
    const parsed = ReminderRuleSchema.parse(row);
    expect(parsed.importance).toBe("important");
    // ReminderRuleSchema persists active as a literal 0/1 (no
    // transform to boolean — the renderer reads it directly).
    expect(parsed.active).toBe(1);
  });

  it("round-trips a RecurrenceRule", () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO recurrence_rules
         (id, owner_type, owner_id, rrule_text, version, deleted_at)
       VALUES (?, 'task', ?, ?, 0, NULL)`,
    ).run(OTHER_ID, USER_ID, "FREQ=DAILY");

    const row = db
      .prepare(`SELECT * FROM recurrence_rules WHERE id = ?`)
      .get(OTHER_ID) as Record<string, unknown>;
    const parsed = RecurrenceRuleSchema.parse(row);
    expect(parsed.owner_type).toBe("task");
    expect(parsed.rrule_text).toBe("FREQ=DAILY");
  });

  it("round-trips a CalendarEventImport", () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)`,
    ).run(USER_ID, "alex@example.com", NOW);
    db.prepare(
      `INSERT INTO calendar_event_imports
         (id, user_id, provider, external_id, raw_json, start_at, end_at, last_seen_at,
          version, deleted_at)
       VALUES (?, ?, 'google', ?, ?, ?, ?, ?, 0, NULL)`,
    ).run(
      OTHER_ID,
      USER_ID,
      "ext-1",
      '{"summary":"x"}',
      NOW,
      NOW + 1_800_000,
      NOW,
    );

    const row = db
      .prepare(`SELECT * FROM calendar_event_imports WHERE id = ?`)
      .get(OTHER_ID) as Record<string, unknown>;
    const parsed = CalendarEventImportSchema.parse(row);
    expect(parsed.provider).toBe("google");
  });

  it("round-trips an AiSuggestion", () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO ai_suggestions
         (id, owner_type, owner_id, model, prompt_class, suggestion_json,
          outcome, created_at, version, deleted_at)
       VALUES (?, 'task', ?, ?, ?, ?, 'pending', ?, 0, NULL)`,
    ).run(
      OTHER_ID,
      USER_ID,
      "claude-haiku-4-5",
      "make-startable",
      '{"title":"buy milk"}',
      NOW,
    );

    const row = db
      .prepare(`SELECT * FROM ai_suggestions WHERE id = ?`)
      .get(OTHER_ID) as Record<string, unknown>;
    const parsed = AiSuggestionSchema.parse(row);
    expect(parsed.outcome).toBe("pending");
  });

  it("round-trips a TelegramLink", () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)`,
    ).run(USER_ID, "alex@example.com", NOW);
    db.prepare(
      `INSERT INTO telegram_links
         (id, user_id, chat_id, linked_at, version, deleted_at)
       VALUES (?, ?, ?, ?, 0, NULL)`,
    ).run(OTHER_ID, USER_ID, "tg-12345", NOW);

    const row = db
      .prepare(`SELECT * FROM telegram_links WHERE id = ?`)
      .get(OTHER_ID) as Record<string, unknown>;
    const parsed = TelegramLinkSchema.parse(row);
    expect(parsed.chat_id).toBe("tg-12345");
  });

  it("round-trips UserSettings", () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)`,
    ).run(USER_ID, "alex@example.com", NOW);
    db.prepare(
      `INSERT INTO user_settings
         (user_id, settings_json, updated_at, version, deleted_at)
       VALUES (?, ?, ?, 0, NULL)`,
    ).run(USER_ID, '{"theme":"warm"}', NOW);

    const row = db
      .prepare(`SELECT * FROM user_settings WHERE user_id = ?`)
      .get(USER_ID) as Record<string, unknown>;
    const parsed = UserSettingsSchema.parse(row);
    expect(parsed.user_id).toBe(USER_ID);
  });

  it("FK CASCADE wipes a user's children", () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)`,
    ).run(USER_ID, "alex@example.com", NOW);
    db.prepare(
      `INSERT INTO inbox_items
         (id, user_id, raw_text, source, created_at, version)
       VALUES (?, ?, ?, ?, ?, 0)`,
    ).run("ii-1", USER_ID, "x", "desktop", NOW);
    db.prepare(
      `INSERT INTO tasks
         (id, user_id, title, type, status, source, created_at, updated_at, version)
       VALUES (?, ?, ?, 'task', 'open', 'desktop', ?, ?, 0)`,
    ).run("t-1", USER_ID, "y", NOW, NOW);

    db.prepare(`DELETE FROM users WHERE id = ?`).run(USER_ID);

    const inboxCount = (
      db
        .prepare(`SELECT count(*) AS c FROM inbox_items WHERE user_id = ?`)
        .get(USER_ID) as { c: number }
    ).c;
    const taskCount = (
      db
        .prepare(`SELECT count(*) AS c FROM tasks WHERE user_id = ?`)
        .get(USER_ID) as { c: number }
    ).c;
    expect(inboxCount).toBe(0);
    expect(taskCount).toBe(0);
  });

  it("CHECK constraint rejects an unknown enum value", () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)`,
    ).run(USER_ID, "alex@example.com", NOW);

    expect(() =>
      db
        .prepare(
          `INSERT INTO inbox_items
             (id, user_id, raw_text, source, created_at, version)
           VALUES (?, ?, ?, ?, ?, 0)`,
        )
        .run("bad", USER_ID, "x", "fax", NOW),
    ).toThrow();
  });

  it("CHECK constraint rejects an invalid task status", () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)`,
    ).run(USER_ID, "alex@example.com", NOW);

    expect(() =>
      db
        .prepare(
          `INSERT INTO tasks
             (id, user_id, title, type, status, source, created_at, updated_at, version)
           VALUES (?, ?, ?, 'task', 'abandoned', 'desktop', ?, ?, 0)`,
        )
        .run("bad", USER_ID, "y", NOW, NOW),
    ).toThrow();
  });
});
