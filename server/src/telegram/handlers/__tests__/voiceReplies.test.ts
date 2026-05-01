import { describe, expect, it } from "vitest";
import {
  voiceReplyForDownloadError,
  voiceReplyForTranscriptionError,
  voiceReplyForTooLongDuration,
  voiceReplySuccess,
} from "../voiceReplies";
import type { TranscriptionErrorCode } from "../../../transcription/types";
import type { TelegramDownloadErrorCode } from "../../files";

describe("voiceReplyForDownloadError", () => {
  const cases: { code: TelegramDownloadErrorCode; match: RegExp }[] = [
    { code: "too_large", match: /too long/i },
    { code: "not_found", match: /couldn't find|send it again/i },
    { code: "auth", match: /server config|wasn't saved/i },
    { code: "network", match: /couldn't download|send it again/i },
    { code: "timeout", match: /timed out|send it again/i },
    { code: "unsupported", match: /audio format/i },
  ];
  for (const c of cases) {
    it(`maps code='${c.code}' to a short reply mentioning the issue`, () => {
      const reply = voiceReplyForDownloadError({ code: c.code });
      expect(reply).toMatch(c.match);
      expect(reply.length).toBeLessThanOrEqual(160);
      expect(reply.length).toBeGreaterThan(0);
    });
  }
});

describe("voiceReplyForTranscriptionError", () => {
  const cases: { code: TranscriptionErrorCode; match: RegExp }[] = [
    { code: "audio_too_long", match: /too long/i },
    { code: "unsupported_format", match: /audio format/i },
    { code: "auth", match: /misconfigured|wasn't saved/i },
    { code: "quota", match: /rate-limited|wasn't saved|few minutes/i },
    { code: "timeout", match: /timed out|wasn't saved/i },
    { code: "provider_error", match: /transcription failed|wasn't saved/i },
  ];
  for (const c of cases) {
    it(`maps code='${c.code}' to a short reply mentioning the issue`, () => {
      const reply = voiceReplyForTranscriptionError({ code: c.code });
      expect(reply).toMatch(c.match);
      expect(reply.length).toBeLessThanOrEqual(160);
      expect(reply.length).toBeGreaterThan(0);
    });
  }
});

describe("voiceReplyForTooLongDuration", () => {
  it("renders the limit in minutes", () => {
    const reply = voiceReplyForTooLongDuration(360, 300);
    expect(reply).toMatch(/under 5 minutes/i);
    expect(reply).toMatch(/too long/i);
  });

  it("rounds the limit to the nearest minute", () => {
    const reply = voiceReplyForTooLongDuration(1000, 90);
    expect(reply).toMatch(/under 2 minutes/i);
  });
});

describe("voiceReplySuccess", () => {
  it("echoes a short transcript verbatim", () => {
    expect(voiceReplySuccess("buy milk")).toBe("Saved to inbox: buy milk");
  });

  it("truncates a long transcript at 80 chars with an ellipsis", () => {
    const longText = "a".repeat(100);
    const reply = voiceReplySuccess(longText);
    expect(reply.startsWith("Saved to inbox: ")).toBe(true);
    expect(reply.endsWith("…")).toBe(true);
    // 16 ("Saved to inbox: ") + 80 + 1 ("…") = 97
    expect(reply.length).toBe(97);
  });

  it("echoes exactly-80-char transcript without truncation", () => {
    const exact = "x".repeat(80);
    const reply = voiceReplySuccess(exact);
    expect(reply).toBe(`Saved to inbox: ${exact}`);
    expect(reply.endsWith("…")).toBe(false);
  });

  it("returns a neutral ack on empty transcript (defensive)", () => {
    expect(voiceReplySuccess("")).toBe("Saved to inbox.");
  });
});
