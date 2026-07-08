// OpenAI Whisper transcription provider. POSTs multipart/form-data to
// /v1/audio/transcriptions with response_format=verbose_json so we can
// surface the duration alongside the text.

import {
  TranscriptionError,
  type TranscriptionProvider,
  type TranscriptionResult,
} from "./types";

const DEFAULT_BASE_URL = "https://api.openai.com";
const DEFAULT_MODEL = "whisper-1";
const DEFAULT_TIMEOUT_MS = 60_000;

export interface OpenAIWhisperProviderOpts {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface VerboseJsonResponse {
  text?: string;
  duration?: number;
}

interface OpenAIErrorBody {
  error?: { message?: string; type?: string; code?: string | null };
}

export function createOpenAIWhisperProvider(
  opts: OpenAIWhisperProviderOpts,
): TranscriptionProvider {
  const apiKey = opts.apiKey;
  if (!apiKey) {
    throw new Error(
      "createOpenAIWhisperProvider: apiKey is required (set OPENAI_TRANSCRIPTION_KEY)",
    );
  }
  const model = opts.model ?? DEFAULT_MODEL;
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async transcribe(audio, mimeType): Promise<TranscriptionResult> {
      const form = new FormData();
      form.append("model", model);
      form.append("response_format", "verbose_json");
      // Buffer is converted to a Blob; arrayBuffer slice is required for
      // Node's undici fetch to read the bytes correctly.
      const blob = new Blob(
        [
          audio.buffer.slice(
            audio.byteOffset,
            audio.byteOffset + audio.byteLength,
          ),
        ],
        {
          type: mimeType,
        },
      );
      const filename = filenameForMime(mimeType);
      form.append("file", blob, filename);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let res: Response;
      try {
        res = await fetchImpl(`${baseUrl}/v1/audio/transcriptions`, {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}` },
          body: form,
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        if (isAbortError(err)) {
          throw new TranscriptionError(
            "timeout",
            "transcription request aborted (timeout)",
          );
        }
        throw new TranscriptionError(
          "provider_error",
          `transcription network error: ${stringifyError(err)}`,
        );
      }
      clearTimeout(timer);

      if (!res.ok) {
        const body = await safeReadBody(res);
        throw mapHttpError(res.status, body);
      }

      let parsed: VerboseJsonResponse;
      try {
        parsed = (await res.json()) as VerboseJsonResponse;
      } catch (err) {
        throw new TranscriptionError(
          "provider_error",
          `transcription response not JSON: ${stringifyError(err)}`,
          { status: res.status },
        );
      }

      if (typeof parsed.text !== "string" || parsed.text.length === 0) {
        throw new TranscriptionError(
          "provider_error",
          "transcription response missing text",
          { status: res.status, body: parsed },
        );
      }

      const durationSec =
        typeof parsed.duration === "number" && Number.isFinite(parsed.duration)
          ? parsed.duration
          : 0;

      return { text: parsed.text, durationSec };
    },
  };
}

function mapHttpError(status: number, body: unknown): TranscriptionError {
  const errBody =
    (body && typeof body === "object"
      ? (body as OpenAIErrorBody).error
      : null) ?? null;
  const msg = errBody?.message ?? `transcription HTTP ${status}`;

  if (status === 401 || status === 403) {
    return new TranscriptionError("auth", msg, { status, body });
  }
  if (status === 429) {
    return new TranscriptionError("quota", msg, { status, body });
  }
  if (status === 413) {
    return new TranscriptionError("audio_too_long", msg, { status, body });
  }
  if (status === 415 || (status === 400 && /format|codec|file/i.test(msg))) {
    return new TranscriptionError("unsupported_format", msg, { status, body });
  }
  return new TranscriptionError("provider_error", msg, { status, body });
}

async function safeReadBody(res: Response): Promise<unknown> {
  try {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch {
    return null;
  }
}

function filenameForMime(mimeType: string): string {
  if (/ogg|opus/i.test(mimeType)) return "audio.ogg";
  if (/mp3|mpeg/i.test(mimeType)) return "audio.mp3";
  if (/wav/i.test(mimeType)) return "audio.wav";
  if (/m4a|mp4/i.test(mimeType)) return "audio.m4a";
  if (/webm/i.test(mimeType)) return "audio.webm";
  return "audio.bin";
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || /aborted/i.test(err.message))
  );
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
