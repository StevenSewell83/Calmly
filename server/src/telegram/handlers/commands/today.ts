// TGR-05 — /today: numbered list of today's scheduled tasks + events,
// max 10 lines, in the user's local time.
//
// Timezone: server/migrations 0006_user_settings_id.cjs only adds a
// synthetic `id` column; shared/src/model/settings.ts UserSettingsSchema
// has no timezone field, and settings_json is an opaque JSONB blob with
// no shared schema for its contents either — grepping desktop/src turns
// up no "timezone" key anywhere near settings. So there is nowhere to
// read a per-user timezone from yet. Per the bead spec we default to
// UTC and say so, rather than adding schema here; a follow-up to add a
// real timezone field belongs in a future bead (noted in the PR report).
//
// "Scheduled today" = tasks placed as TimeBlocks today (scheduled_start,
// from 0005_task_schedule.cjs — real clock time, shown as HH:mm) OR,
// failing that, tasks merely due today (due_at only — no clock time,
// shown as '—'). Events always carry a start_at and always get a time.
// Undated ('—') entries sort before timed ones, same convention as an
// all-day entry heading a calendar day's agenda.

import type { Message } from "grammy/types";
import type { FastifyBaseLogger } from "fastify";
import type pg from "pg";
import { getLinkedUserIdByChat } from "../../linking";
import { escapeMarkdownV2 } from "../../markdown";

const UNLINKED_REPLY = "Link your account in Settings → Telegram first\\.";
const EMPTY_STATE_REPLY =
  "Nothing scheduled today\\. Open Plan on desktop to schedule\\.";
const TIMEZONE_HINT = "Set your timezone in Settings for local times\\.";
const NO_TIME = "—";
const MAX_ITEMS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

// No per-user timezone field exists yet (see header comment) — every
// caller gets this until a real one lands.
export const DEFAULT_TIMEZONE = "UTC";

interface TodayItem {
  title: string;
  /** Epoch ms of the item's clock time, or null for a dated-but-untimed task. */
  time: number | null;
}

export async function handleToday(
  message: Message,
  pool: pg.Pool,
  log: FastifyBaseLogger,
  now: number = Date.now(),
  timezone: string = DEFAULT_TIMEZONE,
): Promise<string> {
  const chatId = String(message.chat.id);
  const userId = await getLinkedUserIdByChat(pool, chatId);
  if (!userId) {
    return UNLINKED_REPLY;
  }

  const { start, endExclusive } = localDayWindow(now, timezone);
  const [tasks, events] = await Promise.all([
    getScheduledTasks(pool, userId, start, endExclusive),
    getTodayEvents(pool, userId, start, endExclusive),
  ]);

  const items = [...tasks, ...events].sort(
    (a, b) => (a.time ?? -Infinity) - (b.time ?? -Infinity),
  );

  log.info(
    { chatId, count: items.length },
    "[telegram] /today replied",
  );

  if (items.length === 0) {
    // No times are shown when there's nothing scheduled, so the
    // "for local times" hint below would be noise here — only the
    // populated reply appends it.
    return EMPTY_STATE_REPLY;
  }

  const lines = items.slice(0, MAX_ITEMS).map((item, i) => {
    const timeLabel = item.time === null ? NO_TIME : formatTimeInZone(item.time, timezone);
    return `${i + 1}\\. ${timeLabel} ${escapeMarkdownV2(item.title)}`;
  });

  return `${lines.join("\n")}\n\n${TIMEZONE_HINT}`;
}

async function getScheduledTasks(
  pool: pg.Pool,
  userId: string,
  start: number,
  endExclusive: number,
): Promise<TodayItem[]> {
  const result = await pool.query<{
    title: string;
    scheduled_start: string | null;
  }>(
    `SELECT title, scheduled_start::text AS scheduled_start FROM tasks
      WHERE user_id = $1
        AND deleted_at IS NULL
        AND status NOT IN ('done', 'dropped')
        AND (
          (scheduled_start IS NOT NULL AND scheduled_start >= $2 AND scheduled_start < $3)
          OR (scheduled_start IS NULL AND due_at IS NOT NULL AND due_at >= $2 AND due_at < $3)
        )`,
    [userId, start, endExclusive],
  );
  return result.rows.map((row) => ({
    title: row.title,
    time: row.scheduled_start === null ? null : parseInt(row.scheduled_start, 10),
  }));
}

async function getTodayEvents(
  pool: pg.Pool,
  userId: string,
  start: number,
  endExclusive: number,
): Promise<TodayItem[]> {
  const result = await pool.query<{ title: string; start_at: string }>(
    `SELECT title, start_at::text AS start_at FROM events
      WHERE user_id = $1
        AND deleted_at IS NULL
        AND start_at < $3
        AND end_at > $2`,
    [userId, start, endExclusive],
  );
  return result.rows.map((row) => ({
    title: row.title,
    time: parseInt(row.start_at, 10),
  }));
}

// Local-day window [start, endExclusive) for `now` in the given IANA
// timezone, computed via Intl rather than a fixed minute offset (unlike
// desktop's tzOffsetMinutes convention) since the server only ever has
// a zone name, never a live Date.getTimezoneOffset() reading.
export function localDayWindow(
  now: number,
  timeZone: string,
): { start: number; endExclusive: number } {
  const { year, month, day, offsetMs } = zonedParts(now, timeZone);
  const localMidnightAsUTC = Date.UTC(year, month - 1, day);
  const start = localMidnightAsUTC - offsetMs;
  return { start, endExclusive: start + DAY_MS };
}

export function formatTimeInZone(ms: number, timeZone: string): string {
  const { hour, minute } = zonedParts(ms, timeZone);
  return `${pad2(hour)}:${pad2(minute)}`;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function zonedParts(
  ms: number,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number; offsetMs: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(ms).map((p) => [p.type, p.value]),
  );
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  // Reinterpreting the zone's wall-clock reading as if it were UTC and
  // diffing against the real instant yields that zone's offset from UTC
  // at this instant (handles DST transitions correctly since it's
  // derived per-instant, not from a static table).
  const asUTC = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMs = asUTC - ms;
  return { year, month, day, hour, minute, offsetMs };
}
