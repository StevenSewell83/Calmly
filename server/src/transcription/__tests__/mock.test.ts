import { describe, expect, it } from "vitest";
import { createMockTranscriptionProvider } from "../mock";
import { TranscriptionError } from "../types";

describe("createMockTranscriptionProvider", () => {
  it("returns canned text and duration by default", async () => {
    const provider = createMockTranscriptionProvider();
    const result = await provider.transcribe(
      Buffer.from([1, 2, 3]),
      "audio/ogg",
    );
    expect(result).toEqual({ text: "buy milk", durationSec: 1.5 });
  });

  it("respects custom text and durationSec", async () => {
    const provider = createMockTranscriptionProvider({
      text: "lunch with sam",
      durationSec: 4.2,
    });
    const result = await provider.transcribe(Buffer.from([0]), "audio/ogg");
    expect(result).toEqual({ text: "lunch with sam", durationSec: 4.2 });
  });

  it("records calls with mimeType and byteLength", async () => {
    const provider = createMockTranscriptionProvider();
    await provider.transcribe(Buffer.from([1, 2, 3, 4]), "audio/ogg");
    await provider.transcribe(Buffer.from([5, 6]), "audio/mpeg");
    expect(provider.calls()).toEqual([
      { mimeType: "audio/ogg", byteLength: 4 },
      { mimeType: "audio/mpeg", byteLength: 2 },
    ]);
  });

  it("reset() clears recorded calls", async () => {
    const provider = createMockTranscriptionProvider();
    await provider.transcribe(Buffer.from([1]), "audio/ogg");
    provider.reset();
    expect(provider.calls()).toEqual([]);
  });

  it("throws TranscriptionError when failWith is set", async () => {
    const provider = createMockTranscriptionProvider({ failWith: "quota" });
    const err = await provider
      .transcribe(Buffer.from([0]), "audio/ogg")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TranscriptionError);
    expect((err as TranscriptionError).code).toBe("quota");
  });

  it("records calls even when failing", async () => {
    const provider = createMockTranscriptionProvider({
      failWith: "provider_error",
    });
    await provider
      .transcribe(Buffer.from([1, 2, 3]), "audio/ogg")
      .catch(() => null);
    expect(provider.calls()).toEqual([
      { mimeType: "audio/ogg", byteLength: 3 },
    ]);
  });
});
