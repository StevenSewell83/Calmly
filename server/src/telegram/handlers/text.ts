// TGR-03a-rebuild: plain-text inbox capture + fallback reply for
// unsupported media. Slash commands other than /start are intercepted
// upstream by the dispatcher or belong to other beads (TGR-04/05); this
// handler no-ops on them rather than guessing at a reply.
import type { Message } from "grammy/types";
import type { FastifyBaseLogger } from "fastify";
import type pg from "pg";
import { captureFromTelegram } from "../../inbox/createFromTelegram";

const UNLINKED_REPLY = "Link your account in Settings → Telegram first.";
const SAVED_REPLY = "Saved to inbox.";
const TRUNCATED_SUFFIX = " (trimmed at 4000 chars)";
const UNSUPPORTED_MEDIA_REPLY = "I only handle text and voice notes for now.";

// Returns the reply text to send, or null to send nothing (slash
// commands out of scope here).
export async function handleText(
  message: Message,
  pool: pg.Pool,
  log: FastifyBaseLogger,
): Promise<string | null> {
  const text = message.text;
  if (text === undefined) {
    // Voice is routed elsewhere by the dispatcher before reaching here;
    // anything else without text (photo, sticker, document, ...) gets
    // the same generic not-yet-supported reply.
    return UNSUPPORTED_MEDIA_REPLY;
  }

  if (text.trim().startsWith("/")) {
    return null;
  }

  const chatId = String(message.chat.id);
  const result = await captureFromTelegram(pool, {
    chatId,
    telegramMessageId: message.message_id,
    rawText: text,
    now: Date.now(),
  });

  if (!result.ok) {
    return UNLINKED_REPLY;
  }

  // No raw_text/PII here — chatId + row metadata only.
  log.info(
    {
      chatId,
      inboxId: result.inboxId,
      truncated: result.truncated,
      alreadyProcessed: result.alreadyProcessed,
    },
    "[telegram] text captured to inbox",
  );

  return result.truncated ? SAVED_REPLY + TRUNCATED_SUFFIX : SAVED_REPLY;
}
