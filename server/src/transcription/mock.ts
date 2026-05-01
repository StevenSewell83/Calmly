// Mock transcription provider for tests. Returns canned text + duration,
// or throws a TranscriptionError when `failWith` is set.

import {
  TranscriptionError,
  type TranscriptionErrorCode,
  type TranscriptionProvider,
} from "./types";

export interface MockTranscriptionProviderOpts {
  text?: string;
  durationSec?: number;
  failWith?: TranscriptionErrorCode;
}

export interface MockTranscriptionProvider extends TranscriptionProvider {
  calls(): { mimeType: string; byteLength: number }[];
  reset(): void;
}

export function createMockTranscriptionProvider(
  opts: MockTranscriptionProviderOpts = {},
): MockTranscriptionProvider {
  const text = opts.text ?? "buy milk";
  const durationSec = opts.durationSec ?? 1.5;
  const failWith = opts.failWith;
  const recorded: { mimeType: string; byteLength: number }[] = [];

  return {
    async transcribe(audio, mimeType) {
      recorded.push({ mimeType, byteLength: audio.byteLength });
      if (failWith) {
        throw new TranscriptionError(failWith, `mock failure: ${failWith}`);
      }
      return { text, durationSec };
    },
    calls() {
      return [...recorded];
    },
    reset() {
      recorded.length = 0;
    },
  };
}
