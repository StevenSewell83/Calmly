// TG-04c — user-facing reply copy for the Telegram voice handler.
// Pure mappers: TranscriptionError / TelegramDownloadError / duration-cap
// → short reply string per PRD §13 (what happened, what to do, anything
// lost). The voice handler (TG-04 orchestrator) calls these to produce
// the bot's reply; nothing here logs or talks to a DB.

import type { TranscriptionError } from "../../transcription/types";
import type { TelegramDownloadError } from "../files";

const SUCCESS_ECHO_MAX = 80;

export function voiceReplyForDownloadError(
  err: Pick<TelegramDownloadError, "code">,
): string {
  switch (err.code) {
    case "too_large":
      return "Voice note too long; please shorten and resend.";
    case "not_found":
      return "I couldn't find that voice note. Please send it again.";
    case "auth":
      return "I can't download voice notes right now (server config). Your audio wasn't saved — please try again later.";
    case "network":
      return "I couldn't download your voice note. Please send it again.";
    case "timeout":
      return "Downloading your voice note timed out. Please send it again.";
    case "unsupported":
      return "I couldn't process that audio format. Please send a standard voice note.";
  }
}

export function voiceReplyForTranscriptionError(
  err: Pick<TranscriptionError, "code">,
): string {
  switch (err.code) {
    case "audio_too_long":
      return "Voice note too long; please shorten and resend.";
    case "unsupported_format":
      return "I couldn't process that audio format. Please send a standard voice note.";
    case "auth":
      return "Transcription is misconfigured on the server. Your audio wasn't saved — please try again later.";
    case "quota":
      return "Transcription is rate-limited right now. Your audio wasn't saved — please try again in a few minutes.";
    case "timeout":
      return "Transcription timed out. Your audio wasn't saved — please try again.";
    case "provider_error":
      return "Voice transcription failed. Your audio wasn't saved — please try again.";
  }
}

export function voiceReplyForTooLongDuration(
  _durationSec: number,
  limitSec: number,
): string {
  const limitMin = Math.round(limitSec / 60);
  return `Voice note too long; please shorten to under ${limitMin} minutes.`;
}

export function voiceReplySuccess(transcript: string): string {
  if (!transcript) {
    // Defensive — handler should never call with empty; keep ack neutral.
    return "Saved to inbox.";
  }
  if (transcript.length <= SUCCESS_ECHO_MAX) {
    return `Saved to inbox: ${transcript}`;
  }
  return `Saved to inbox: ${transcript.slice(0, SUCCESS_ECHO_MAX)}…`;
}
