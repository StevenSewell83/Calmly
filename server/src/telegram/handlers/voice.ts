// TGR-02 — voice-note orchestration: linked check -> duration guard ->
// download (files.ts, TG-04b) -> transcribe (transcription/, TG-04a) ->
// inbox write (createFromTelegram, source='telegram-voice') -> ack
// (voiceReplies.ts, TG-04c). Mirrors handleText's reply-or-null contract
// so the dispatcher can treat both handlers the same way.
//
// Simplification vs. the original TG-04 spec (noted at bead close,
// calmly-13d.2): downloadTelegramFile keeps the audio in memory only
// (no fs I/O — see files.ts), so there is no temp file to retain or
// clean up, and the "1h retained-file retry" design collapses to
// in-request retry only (the user just resends the voice note). We
// also don't persist a `meta: {duration_sec, original_message_id}`
// blob — inbox_items has no metadata column, original_message_id is
// already recoverable from external_ref (same `tg:` scheme as text),
// and duration_sec has no reader yet (desktop voice-item display is
// explicitly out of scope). Adding a column would ripple into the sync
// protocol (shared schema, server/src/sync/tables.ts, desktop mirror)
// for a value nothing consumes.

import type { Message } from "grammy/types";
import type { FastifyBaseLogger } from "fastify";
import type pg from "pg";
import {
  captureFromTelegram,
  findExistingTelegramCapture,
  isTelegramChatLinked,
} from "../../inbox/createFromTelegram";
import {
  downloadTelegramFile,
  TelegramDownloadError,
  type TelegramFileClient,
} from "../files";
import { getTranscriptionProvider, type TranscriptionEnv } from "../../transcription";
import {
  TranscriptionError,
  type TranscriptionProvider,
} from "../../transcription/types";
import {
  voiceReplyForDownloadError,
  voiceReplyForTranscriptionError,
  voiceReplyForTooLongDuration,
  voiceReplySuccess,
} from "./voiceReplies";

const UNLINKED_REPLY = "Link your account in Settings → Telegram first.";
const DEFAULT_VOICE_MIME_TYPE = "audio/ogg";
export const MAX_VOICE_DURATION_SEC = 300;

export interface HandleVoiceDeps {
  bot: TelegramFileClient;
  provider: TranscriptionProvider;
}

// Returns the reply text to send, or null to send nothing.
export async function handleVoice(
  message: Message,
  pool: pg.Pool,
  log: FastifyBaseLogger,
  deps: HandleVoiceDeps,
): Promise<string | null> {
  const voice = message.voice;
  if (!voice) return null; // dispatcher only routes voice messages here

  const chatId = String(message.chat.id);

  const linked = await isTelegramChatLinked(pool, chatId);
  if (!linked) {
    return UNLINKED_REPLY;
  }

  if (voice.duration > MAX_VOICE_DURATION_SEC) {
    return voiceReplyForTooLongDuration(voice.duration, MAX_VOICE_DURATION_SEC);
  }

  // Webhook replay: this exact message was already captured — re-ack with
  // the stored transcript rather than paying for download + transcription
  // again (the insert-time ON CONFLICT would dedupe the row, but only
  // after both spends).
  const existing = await findExistingTelegramCapture(pool, {
    chatId,
    telegramMessageId: message.message_id,
  });
  if (existing !== null) {
    return voiceReplySuccess(existing);
  }

  let downloaded;
  try {
    downloaded = await downloadTelegramFile(deps.bot, {
      fileId: voice.file_id,
      mimeType: voice.mime_type ?? DEFAULT_VOICE_MIME_TYPE,
    });
  } catch (err) {
    if (err instanceof TelegramDownloadError) {
      log.warn(
        { chatId, code: err.code },
        "[telegram] voice download failed",
      );
      return voiceReplyForDownloadError(err);
    }
    throw err;
  }

  let transcript;
  try {
    transcript = await deps.provider.transcribe(
      downloaded.buffer,
      downloaded.mimeType,
    );
  } catch (err) {
    if (err instanceof TranscriptionError) {
      log.warn(
        { chatId, code: err.code },
        "[telegram] voice transcription failed",
      );
      return voiceReplyForTranscriptionError(err);
    }
    throw err;
  }

  const result = await captureFromTelegram(pool, {
    chatId,
    telegramMessageId: message.message_id,
    rawText: transcript.text,
    source: "telegram-voice",
    now: Date.now(),
  });

  if (!result.ok) {
    // Chat was unlinked between the early check and the write (e.g. the
    // user unlinked mid-request) — same reply as the early guard.
    return UNLINKED_REPLY;
  }

  // No transcript/PII here — chatId + row metadata only.
  log.info(
    {
      chatId,
      inboxId: result.inboxId,
      durationSec: transcript.durationSec,
      truncated: result.truncated,
      alreadyProcessed: result.alreadyProcessed,
    },
    "[telegram] voice captured to inbox",
  );

  return voiceReplySuccess(transcript.text);
}

// Lazily-constructed default provider so a missing/misconfigured
// TRANSCRIPTION_PROVIDER env doesn't crash the process at import time —
// it only surfaces (as a caught rejection) when a voice note actually
// arrives. Mirrors the getBot()/initBot() singleton pattern in bot.ts.
let _defaultProvider: TranscriptionProvider | null = null;

export function getDefaultTranscriptionProvider(): TranscriptionProvider {
  if (!_defaultProvider) {
    // process.env is an index-signature type with every key optional;
    // TypeScript's weak-type check wants at least one named property in
    // common with TranscriptionEnv (also all-optional), which an index
    // signature alone doesn't satisfy. The values really are strings —
    // this cast documents that, it isn't hiding a real mismatch.
    _defaultProvider = getTranscriptionProvider(
      process.env as TranscriptionEnv,
    );
  }
  return _defaultProvider;
}
