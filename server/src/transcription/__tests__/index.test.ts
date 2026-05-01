import { describe, expect, it } from "vitest";
import { getTranscriptionProvider } from "../index";

describe("getTranscriptionProvider", () => {
  it("defaults to openai when TRANSCRIPTION_PROVIDER unset", () => {
    const p = getTranscriptionProvider({
      OPENAI_TRANSCRIPTION_KEY: "sk-test",
    });
    expect(typeof p.transcribe).toBe("function");
  });

  it("returns openai provider when TRANSCRIPTION_PROVIDER=openai and key set", () => {
    const p = getTranscriptionProvider({
      TRANSCRIPTION_PROVIDER: "openai",
      OPENAI_TRANSCRIPTION_KEY: "sk-test",
    });
    expect(typeof p.transcribe).toBe("function");
  });

  it("is case-insensitive on provider name", () => {
    const p = getTranscriptionProvider({
      TRANSCRIPTION_PROVIDER: "OpenAI",
      OPENAI_TRANSCRIPTION_KEY: "sk-test",
    });
    expect(typeof p.transcribe).toBe("function");
  });

  it("throws when openai chosen but OPENAI_TRANSCRIPTION_KEY missing", () => {
    expect(() =>
      getTranscriptionProvider({ TRANSCRIPTION_PROVIDER: "openai" }),
    ).toThrow(/OPENAI_TRANSCRIPTION_KEY/);
  });

  it("throws when default-openai but key missing", () => {
    expect(() => getTranscriptionProvider({})).toThrow(
      /OPENAI_TRANSCRIPTION_KEY/,
    );
  });

  it("returns mock provider when TRANSCRIPTION_PROVIDER=mock", async () => {
    const p = getTranscriptionProvider({ TRANSCRIPTION_PROVIDER: "mock" });
    const result = await p.transcribe(Buffer.from([1]), "audio/ogg");
    expect(result.text).toBe("buy milk");
  });

  it("throws on unknown provider", () => {
    expect(() =>
      getTranscriptionProvider({ TRANSCRIPTION_PROVIDER: "google" }),
    ).toThrow(/Unknown TRANSCRIPTION_PROVIDER/);
  });
});
