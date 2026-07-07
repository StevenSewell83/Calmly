// TGR-05 — /inbox: unresolved-item count + up to 5 most recent previews,
// truncated to 80 chars each. Same "awaiting triage and not currently
// snoozed" predicate as desktop's countUnresolvedInbox/listInbox (main/
// today/store.ts) so the number matches what the Home screen badge and
// Inbox view would show for the same account.

import type { Message } from "grammy/types";
import type { FastifyBaseLogger } from "fastify";
import type pg from "pg";
import { getLinkedUserIdByChat } from "../../linking";
import { escapeMarkdownV2 } from "../../markdown";

const UNLINKED_REPLY = "Link your account in Settings → Telegram first\\.";
const EMPTY_STATE_REPLY = "Inbox is empty\\.";
const PREVIEW_LIMIT = 5;
const PREVIEW_MAX_CHARS = 80;

export async function handleInbox(
  message: Message,
  pool: pg.Pool,
  log: FastifyBaseLogger,
  now: number = Date.now(),
): Promise<string> {
  const chatId = String(message.chat.id);
  const userId = await getLinkedUserIdByChat(pool, chatId);
  if (!userId) {
    return UNLINKED_REPLY;
  }

  const { count, previews } = await getInboxSummary(pool, userId, now);

  log.info({ chatId, count }, "[telegram] /inbox replied");

  if (count === 0) {
    return EMPTY_STATE_REPLY;
  }

  const bullets = previews.map(
    (text) => `• ${escapeMarkdownV2(truncatePreview(text))}`,
  );
  return [`Inbox: ${count} items`, ...bullets].join("\n");
}

async function getInboxSummary(
  pool: pg.Pool,
  userId: string,
  now: number,
): Promise<{ count: number; previews: string[] }> {
  const countResult = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM inbox_items
      WHERE user_id = $1
        AND deleted_at IS NULL
        AND resolved_at IS NULL
        AND (snoozed_until IS NULL OR snoozed_until <= $2)`,
    [userId, now],
  );
  const count = parseInt(countResult.rows[0]?.count ?? "0", 10);
  if (count === 0) {
    return { count: 0, previews: [] };
  }

  const previewResult = await pool.query<{ raw_text: string }>(
    `SELECT raw_text FROM inbox_items
      WHERE user_id = $1
        AND deleted_at IS NULL
        AND resolved_at IS NULL
        AND (snoozed_until IS NULL OR snoozed_until <= $2)
      ORDER BY created_at DESC
      LIMIT $3`,
    [userId, now, PREVIEW_LIMIT],
  );
  return { count, previews: previewResult.rows.map((r) => r.raw_text) };
}

function truncatePreview(text: string): string {
  if (text.length <= PREVIEW_MAX_CHARS) return text;
  return `${text.slice(0, PREVIEW_MAX_CHARS - 1)}…`;
}
