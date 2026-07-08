import { describe, expect, it } from "vitest";
import { createOpenAIWhisperProvider } from "../openai";
import { TranscriptionError } from "../types";

interface RecordedRequest {
  url: string;
  method: string;
  authorization: string | null;
  formEntries: { name: string; value: string }[];
  fileBytes: Uint8Array | null;
  fileName: string | null;
  fileType: string | null;
}

interface FakeFetchOpts {
  status?: number;
  json?: unknown;
  text?: string;
  throwError?: Error;
  abortAfterMs?: number;
}

function makeFakeFetch(opts: FakeFetchOpts): {
  fetchImpl: typeof fetch;
  calls: RecordedRequest[];
} {
  const calls: RecordedRequest[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = init?.headers as
      | Record<string, string>
      | Headers
      | undefined;
    let authorization: string | null = null;
    if (headers instanceof Headers) {
      authorization = headers.get("authorization");
    } else if (headers && typeof headers === "object") {
      authorization = (headers as Record<string, string>).authorization ?? null;
    }

    const recorded: RecordedRequest = {
      url,
      method,
      authorization,
      formEntries: [],
      fileBytes: null,
      fileName: null,
      fileType: null,
    };

    const body = init?.body;
    if (body instanceof FormData) {
      for (const [name, value] of body.entries()) {
        if (typeof value === "string") {
          recorded.formEntries.push({ name, value });
        } else {
          recorded.fileBytes = new Uint8Array(await value.arrayBuffer());
          recorded.fileName = value.name;
          recorded.fileType = value.type;
        }
      }
    }

    calls.push(recorded);

    if (opts.abortAfterMs !== undefined && init?.signal) {
      await new Promise<never>((_, reject) => {
        const onAbort = (): void => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        };
        if (init.signal!.aborted) onAbort();
        else init.signal!.addEventListener("abort", onAbort, { once: true });
      });
    }

    if (opts.throwError) throw opts.throwError;

    const status = opts.status ?? 200;
    const responseBody =
      opts.text !== undefined
        ? opts.text
        : opts.json !== undefined
          ? JSON.stringify(opts.json)
          : "";
    return new Response(responseBody, {
      status,
      headers: { "content-type": "application/json" },
    });
  };

  return { fetchImpl, calls };
}

describe("createOpenAIWhisperProvider", () => {
  it("requires apiKey", () => {
    expect(() => createOpenAIWhisperProvider({ apiKey: "" })).toThrow(
      /apiKey is required/,
    );
  });

  it("posts multipart form with model + auth + file and returns text/duration", async () => {
    const { fetchImpl, calls } = makeFakeFetch({
      json: { text: "buy milk", duration: 1.42 },
    });
    const provider = createOpenAIWhisperProvider({
      apiKey: "sk-test",
      fetchImpl,
    });

    const audio = Buffer.from([1, 2, 3, 4, 5]);
    const result = await provider.transcribe(audio, "audio/ogg");

    expect(result).toEqual({ text: "buy milk", durationSec: 1.42 });
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(call.method).toBe("POST");
    expect(call.authorization).toBe("Bearer sk-test");
    expect(call.formEntries).toEqual(
      expect.arrayContaining([
        { name: "model", value: "whisper-1" },
        { name: "response_format", value: "verbose_json" },
      ]),
    );
    expect(call.fileBytes).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    expect(call.fileName).toBe("audio.ogg");
    expect(call.fileType).toBe("audio/ogg");
  });

  it("respects custom model and baseUrl overrides", async () => {
    const { fetchImpl, calls } = makeFakeFetch({
      json: { text: "ok", duration: 0.5 },
    });
    const provider = createOpenAIWhisperProvider({
      apiKey: "sk-test",
      model: "whisper-large-v3",
      baseUrl: "https://proxy.example.com/",
      fetchImpl,
    });
    await provider.transcribe(Buffer.from([0]), "audio/ogg");
    expect(calls[0]!.url).toBe(
      "https://proxy.example.com/v1/audio/transcriptions",
    );
    expect(calls[0]!.formEntries).toEqual(
      expect.arrayContaining([{ name: "model", value: "whisper-large-v3" }]),
    );
  });

  it("falls back to durationSec=0 when provider omits duration", async () => {
    const { fetchImpl } = makeFakeFetch({ json: { text: "hello" } });
    const provider = createOpenAIWhisperProvider({
      apiKey: "sk-test",
      fetchImpl,
    });
    const result = await provider.transcribe(Buffer.from([0]), "audio/ogg");
    expect(result).toEqual({ text: "hello", durationSec: 0 });
  });

  it("maps 401 to TranscriptionError code='auth'", async () => {
    const { fetchImpl } = makeFakeFetch({
      status: 401,
      json: { error: { message: "Invalid API key" } },
    });
    const provider = createOpenAIWhisperProvider({
      apiKey: "sk-bad",
      fetchImpl,
    });
    await expect(
      provider.transcribe(Buffer.from([0]), "audio/ogg"),
    ).rejects.toMatchObject({
      name: "TranscriptionError",
      code: "auth",
      status: 401,
    });
  });

  it("maps 429 to TranscriptionError code='quota'", async () => {
    const { fetchImpl } = makeFakeFetch({
      status: 429,
      json: { error: { message: "rate limited" } },
    });
    const provider = createOpenAIWhisperProvider({
      apiKey: "sk-test",
      fetchImpl,
    });
    await expect(
      provider.transcribe(Buffer.from([0]), "audio/ogg"),
    ).rejects.toMatchObject({ code: "quota", status: 429 });
  });

  it("maps 413 to TranscriptionError code='audio_too_long'", async () => {
    const { fetchImpl } = makeFakeFetch({
      status: 413,
      json: { error: { message: "payload too large" } },
    });
    const provider = createOpenAIWhisperProvider({
      apiKey: "sk-test",
      fetchImpl,
    });
    await expect(
      provider.transcribe(Buffer.from([0]), "audio/ogg"),
    ).rejects.toMatchObject({ code: "audio_too_long", status: 413 });
  });

  it("maps 415 to TranscriptionError code='unsupported_format'", async () => {
    const { fetchImpl } = makeFakeFetch({
      status: 415,
      json: { error: { message: "unsupported codec" } },
    });
    const provider = createOpenAIWhisperProvider({
      apiKey: "sk-test",
      fetchImpl,
    });
    await expect(
      provider.transcribe(Buffer.from([0]), "audio/wav"),
    ).rejects.toMatchObject({ code: "unsupported_format", status: 415 });
  });

  it("maps 5xx to TranscriptionError code='provider_error'", async () => {
    const { fetchImpl } = makeFakeFetch({
      status: 503,
      json: { error: { message: "upstream down" } },
    });
    const provider = createOpenAIWhisperProvider({
      apiKey: "sk-test",
      fetchImpl,
    });
    await expect(
      provider.transcribe(Buffer.from([0]), "audio/ogg"),
    ).rejects.toMatchObject({ code: "provider_error", status: 503 });
  });

  it("maps network throw to TranscriptionError code='provider_error'", async () => {
    const { fetchImpl } = makeFakeFetch({
      throwError: new Error("ECONNRESET"),
    });
    const provider = createOpenAIWhisperProvider({
      apiKey: "sk-test",
      fetchImpl,
    });
    await expect(
      provider.transcribe(Buffer.from([0]), "audio/ogg"),
    ).rejects.toMatchObject({ code: "provider_error" });
  });

  it("maps abort/timeout to TranscriptionError code='timeout'", async () => {
    const { fetchImpl } = makeFakeFetch({ abortAfterMs: 1000 });
    const provider = createOpenAIWhisperProvider({
      apiKey: "sk-test",
      fetchImpl,
      timeoutMs: 10,
    });
    const err = await provider
      .transcribe(Buffer.from([0]), "audio/ogg")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TranscriptionError);
    expect((err as TranscriptionError).code).toBe("timeout");
  });

  it("maps 200 with empty text to provider_error (avoids creating empty inbox items)", async () => {
    const { fetchImpl } = makeFakeFetch({ json: { text: "", duration: 1 } });
    const provider = createOpenAIWhisperProvider({
      apiKey: "sk-test",
      fetchImpl,
    });
    await expect(
      provider.transcribe(Buffer.from([0]), "audio/ogg"),
    ).rejects.toMatchObject({ code: "provider_error" });
  });

  it("maps 200 with non-JSON body to provider_error", async () => {
    const { fetchImpl } = makeFakeFetch({ text: "<html>oops</html>" });
    const provider = createOpenAIWhisperProvider({
      apiKey: "sk-test",
      fetchImpl,
    });
    await expect(
      provider.transcribe(Buffer.from([0]), "audio/ogg"),
    ).rejects.toMatchObject({ code: "provider_error" });
  });
});
