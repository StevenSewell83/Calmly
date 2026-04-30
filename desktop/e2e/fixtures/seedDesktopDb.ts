import Database from "better-sqlite3";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface SeedTaskArgs {
  userId: string;
  title: string;
  status?: "open" | "in_progress";
  // Unix ms. If omitted, the task will have no due_at (only shows in Today
  // list for in_progress tasks; open tasks without due_at don't appear in Now/
  // Next/Today slots).
  dueAt?: number;
}

export interface SeedEventArgs {
  userId: string;
  title: string;
  startAt: number;
  endAt: number;
}

export interface SeededTask {
  id: string;
  title: string;
  status: "open" | "in_progress";
  dueAt: number | null;
}

export interface SeededEvent {
  id: string;
  title: string;
  startAt: number;
  endAt: number;
}

// Opens the app's SQLite file directly (better-sqlite3, same process) to
// insert canned tasks/events for a given user. The DB file lives at
// <userDataDir>/calmly.db — the path the Electron app writes when it is
// launched with `--user-data-dir=<userDataDir>`.
//
// Call this AFTER signInAsTestUser so the user row already exists (the
// FK on tasks/events references users(id)).
//
// The `now` param should match what the Home screen considers "today"; pass
// Date.now() unless you need deterministic scheduling across time-zone offsets.
export function seedDesktopDb(
  userDataDir: string,
  {
    tasks,
    events,
  }: {
    tasks?: SeedTaskArgs[];
    events?: SeedEventArgs[];
  },
): { tasks: SeededTask[]; events: SeededEvent[] } {
  const dbPath = join(userDataDir, "calmly.db");
  const db = new Database(dbPath, { readonly: false });

  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    const now = Date.now();
    const insertedTasks: SeededTask[] = [];
    const insertedEvents: SeededEvent[] = [];

    const insertTask = db.prepare(
      `INSERT INTO tasks (id, user_id, title, status, due_at, created_at, updated_at, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'desktop')`,
    );

    const insertEvent = db.prepare(
      `INSERT INTO events (id, user_id, title, start_at, end_at, created_at, source)
       VALUES (?, ?, ?, ?, ?, ?, 'manual')`,
    );

    const run = db.transaction(() => {
      for (const t of tasks ?? []) {
        const id = randomUUID();
        const status = t.status ?? "open";
        const dueAt = t.dueAt ?? null;
        insertTask.run(id, t.userId, t.title, status, dueAt, now, now);
        insertedTasks.push({ id, title: t.title, status, dueAt });
      }
      for (const e of events ?? []) {
        const id = randomUUID();
        insertEvent.run(id, e.userId, e.title, e.startAt, e.endAt, now);
        insertedEvents.push({ id, title: e.title, startAt: e.startAt, endAt: e.endAt });
      }
    });
    run();

    return { tasks: insertedTasks, events: insertedEvents };
  } finally {
    db.close();
  }
}
