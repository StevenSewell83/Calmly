// TG-04a — provider-agnostic transcription interface. Concrete providers
// live alongside this file; the factory in ./index.ts picks one from env.

export interface TranscriptionResult {
  text: string;
  durationSec: number;
}

export interface TranscriptionProvider {
  transcribe(audio: Buffer, mimeType: string): Promise<TranscriptionResult>;
}

// Error codes are server-internal; the consuming handler maps them to the
// user-facing PRD §13 strings before replying. Do not leak these to the
// renderer (they're not part of shared/src/errors.ts).
export type TranscriptionErrorCode =
  | "provider_error" // upstream 5xx or unparseable response
  | "audio_too_long" // payload rejected by provider for length
  | "unsupported_format" // provider rejected the mime/codec
  | "auth" // 401 — bad / missing key
  | "quota" // 429 — rate limited or quota exhausted
  | "timeout"; // local AbortController fired

export class TranscriptionError extends Error {
  readonly code: TranscriptionErrorCode;
  readonly status: number | null;
  readonly body: unknown;

  constructor(
    code: TranscriptionErrorCode,
    message: string,
    opts: { status?: number | null; body?: unknown } = {},
  ) {
    super(message);
    this.name = "TranscriptionError";
    this.code = code;
    this.status = opts.status ?? null;
    this.body = opts.body;
  }
}
