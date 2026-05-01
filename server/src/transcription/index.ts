// Transcription factory. Selects a provider based on env so the bot voice
// handler (TG-04) doesn't have to care which one is wired.
//
// TRANSCRIPTION_PROVIDER=openai (default) — requires OPENAI_TRANSCRIPTION_KEY
// TRANSCRIPTION_PROVIDER=mock            — used in tests / dev

import { createOpenAIWhisperProvider } from "./openai";
import { createMockTranscriptionProvider } from "./mock";
import type { TranscriptionProvider } from "./types";

export { TranscriptionError } from "./types";
export type {
  TranscriptionErrorCode,
  TranscriptionProvider,
  TranscriptionResult,
} from "./types";
export { createOpenAIWhisperProvider } from "./openai";
export {
  createMockTranscriptionProvider,
  type MockTranscriptionProvider,
  type MockTranscriptionProviderOpts,
} from "./mock";

export interface TranscriptionEnv {
  TRANSCRIPTION_PROVIDER?: string;
  OPENAI_TRANSCRIPTION_KEY?: string;
  OPENAI_TRANSCRIPTION_MODEL?: string;
  OPENAI_TRANSCRIPTION_BASE_URL?: string;
}

export function getTranscriptionProvider(
  env: TranscriptionEnv,
): TranscriptionProvider {
  const choice = (env.TRANSCRIPTION_PROVIDER ?? "openai").toLowerCase();

  if (choice === "mock") {
    return createMockTranscriptionProvider();
  }

  if (choice === "openai") {
    const apiKey = env.OPENAI_TRANSCRIPTION_KEY;
    if (!apiKey) {
      throw new Error(
        "Transcription provider 'openai' requires OPENAI_TRANSCRIPTION_KEY",
      );
    }
    return createOpenAIWhisperProvider({
      apiKey,
      model: env.OPENAI_TRANSCRIPTION_MODEL,
      baseUrl: env.OPENAI_TRANSCRIPTION_BASE_URL,
    });
  }

  throw new Error(
    `Unknown TRANSCRIPTION_PROVIDER='${choice}' (expected 'openai' or 'mock')`,
  );
}
