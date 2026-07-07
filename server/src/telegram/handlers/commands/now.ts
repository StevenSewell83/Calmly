// TGR-04 — /now: reply with the user's current focus task + next step.
//
// There is no server-side focus-session concept: shared/src/sync/types.ts
// (syncTables) omits focus sessions entirely, and shared/src/model/focus.ts
// documents them as LOCAL-ONLY, per-device working state that never syncs.
// So "current focus" here is a fallback, not a mirror of the desktop Focus
// screen — the highest-priority in_progress/today task, same precedence
// rule the desktop Home screen's Now slot uses (desktop/src/main/today/
// store.ts listTodayTasks): in_progress first, then 'open' tasks due
// somewhere in the current calendar day. Unlike that helper we have no
// per-user timezone on the server (that lands with TGR-05's user_settings
// reads), so "today" here is the UTC calendar day rather than the user's
// local day — a known rough edge, not the real per-user Today window.
//
// "Next step" reuses the parent/child task relationship triage's AI/manual
// breakdown already creates (parent_task_id): the candidate task's oldest
// not-done subtask, if any.

import type { Message } from "grammy/types";
import type { FastifyBaseLogger } from "fastify";
import type pg from "pg";
import { getLinkedUserIdByChat } from "../../linking";
import { escapeMarkdownV2 } from "../../markdown";

// Static template text, MarkdownV2-escaped by hand (the only reserved
// chars either string contains are the trailing periods).
const UNLINKED_REPLY = "Link your account in Settings → Telegram first\\.";
const EMPTY_STATE_REPLY =
  "No focus task right now\\. Open Focus on desktop to start one\\.";
const NO_NEXT_STEP = "—";

const DAY_MS = 24 * 60 * 60 * 1000;

interface CandidateTask {
  id: string;
  title: string;
}

export async function handleNow(
  message: Message,
  pool: pg.Pool,
  log: FastifyBaseLogger,
): Promise<string> {
  const chatId = String(message.chat.id);
  const userId = await getLinkedUserIdByChat(pool, chatId);
  if (!userId) {
    return UNLINKED_REPLY;
  }

  const candidate = await getCandidateFocusTask(pool, userId, Date.now());
  if (!candidate) {
    return EMPTY_STATE_REPLY;
  }

  const nextStep = await getNextStep(pool, candidate.id);

  // No task titles/content at info level — id + chatId only.
  log.info(
    { chatId, taskId: candidate.id },
    "[telegram] /now replied with candidate focus task",
  );

  return `Now: ${escapeMarkdownV2(candidate.title)}\nNext: ${
    nextStep ? escapeMarkdownV2(nextStep) : NO_NEXT_STEP
  }`;
}

async function getCandidateFocusTask(
  pool: pg.Pool,
  userId: string,
  now: number,
): Promise<CandidateTask | null> {
  const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
  const dayEnd = dayStart + DAY_MS;
  const result = await pool.query<{ id: string; title: string }>(
    `SELECT id, title FROM tasks
      WHERE user_id = $1
        AND deleted_at IS NULL
        AND (
          status = 'in_progress'
          OR (status = 'open' AND due_at IS NOT NULL AND due_at >= $2 AND due_at < $3)
        )
      ORDER BY
        CASE WHEN status = 'in_progress' THEN 0 ELSE 1 END,
        COALESCE(due_at, updated_at) ASC
      LIMIT 1`,
    [userId, dayStart, dayEnd],
  );
  return result.rows[0] ?? null;
}

async function getNextStep(pool: pg.Pool, taskId: string): Promise<string | null> {
  const result = await pool.query<{ title: string }>(
    `SELECT title FROM tasks
      WHERE parent_task_id = $1
        AND deleted_at IS NULL
        AND status NOT IN ('done', 'dropped')
      ORDER BY created_at ASC
      LIMIT 1`,
    [taskId],
  );
  return result.rows[0]?.title ?? null;
}
