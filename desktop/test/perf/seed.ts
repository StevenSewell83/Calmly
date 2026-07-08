import type Database from "better-sqlite3";

const WORDS = [
  "call",
  "email",
  "review",
  "fix",
  "update",
  "write",
  "send",
  "check",
  "phone",
  "bill",
  "meeting",
  "doctor",
  "dentist",
  "report",
  "project",
  "deadline",
  "budget",
  "invoice",
  "client",
  "task",
  "note",
  "reminder",
  "friday",
  "monday",
  "morning",
  "urgent",
  "important",
  "follow",
  "up",
  "schedule",
  "cancel",
  "confirm",
  "prepare",
  "submit",
  "approve",
  "plan",
];

function pick(arr: string[], rng: () => number): string {
  return arr[Math.floor(rng() * arr.length)]!;
}

/** Mulberry32 — fast deterministic PRNG seeded with a 32-bit integer. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

function makeTitle(rng: () => number): string {
  const len = 3 + Math.floor(rng() * 5);
  return Array.from({ length: len }, () => pick(WORDS, rng)).join(" ");
}

function makeNotes(rng: () => number): string {
  const sentences = 1 + Math.floor(rng() * 3);
  return (
    Array.from({ length: sentences }, () => {
      const len = 5 + Math.floor(rng() * 10);
      return Array.from({ length: len }, () => pick(WORDS, rng)).join(" ");
    }).join(". ") + "."
  );
}

/** Seeds `taskCount` tasks and `inboxCount` inbox items into `db`. Returns the user_id used. */
export function seedDatabase(
  db: Database.Database,
  taskCount = 8000,
  inboxCount = 2000,
  seed = 42,
): string {
  const rng = mulberry32(seed);
  const userId = "perf-test-user";

  // Ensure user exists (may or may not be required by FK constraints)
  try {
    db.prepare("INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)").run(
      userId,
      "perf@test.local",
    );
  } catch {
    // no users table — skip
  }

  const insertTask = db.prepare(
    `INSERT INTO tasks (id, user_id, title, notes, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'todo', ?, ?)`,
  );
  const insertInbox = db.prepare(
    `INSERT INTO inbox_items (id, user_id, raw_text, source, created_at, updated_at)
     VALUES (?, ?, ?, 'manual', ?, ?)`,
  );

  const now = Date.now();

  db.transaction(() => {
    for (let i = 0; i < taskCount; i++) {
      const ts = now - Math.floor(rng() * 30 * 86400 * 1000);
      insertTask.run(
        `task-${i}`,
        userId,
        makeTitle(rng),
        makeNotes(rng),
        ts,
        ts,
      );
    }
    for (let i = 0; i < inboxCount; i++) {
      const ts = now - Math.floor(rng() * 30 * 86400 * 1000);
      insertInbox.run(`inbox-${i}`, userId, makeNotes(rng), ts, ts);
    }
  })();

  return userId;
}
