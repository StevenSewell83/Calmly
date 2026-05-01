import { describe, expect, it } from "vitest";
import type { File as TelegramFile } from "@grammyjs/types";
import {
  downloadTelegramFile,
  TelegramDownloadError,
  type TelegramFileClient,
} from "../files";

interface FakeFetchOpts {
  status?: number;
  bodyBytes?: Uint8Array;
  throwError?: Error;
  abortAfterMs?: number;
}

function makeFakeFetch(opts: FakeFetchOpts): {
  fetchImpl: typeof fetch;
  calls: { url: string }[];
} {
  const calls: { url: string }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    calls.push({ url });

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
    const body = opts.bodyBytes ?? new Uint8Array();
    return new Response(body, { status });
  };
  return { fetchImpl, calls };
}

function makeClient(file: TelegramFile, opts: { token?: string; throwError?: Error } = {}): TelegramFileClient {
  const token = opts.token ?? "test-bot-token";
  return {
    token,
    api: {
      async getFile() {
        if (opts.throwError) throw opts.throwError;
        return file;
      },
    },
  };
}

describe("downloadTelegramFile", () => {
  it("downloads bytes and returns buffer + meta", async () => {
    const client = makeClient({
      file_id: "voice-1",
      file_unique_id: "u1",
      file_size: 5,
      file_path: "voice/file_1.ogg",
    });
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const { fetchImpl, calls } = makeFakeFetch({ bodyBytes: bytes });

    const result = await downloadTelegramFile(client, {
      fileId: "voice-1",
      mimeType: "audio/ogg",
      fetchImpl,
    });

    expect(result.fileId).toBe("voice-1");
    expect(result.sizeBytes).toBe(5);
    expect(result.mimeType).toBe("audio/ogg");
    expect(Array.from(result.buffer)).toEqual([1, 2, 3, 4, 5]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "https://api.telegram.org/file/bottest-bot-token/voice/file_1.ogg",
    );
  });

  it("respects baseUrl override", async () => {
    const client = makeClient({
      file_id: "v",
      file_unique_id: "u",
      file_size: 1,
      file_path: "voice/x.ogg",
    });
    const { fetchImpl, calls } = makeFakeFetch({
      bodyBytes: new Uint8Array([0]),
    });
    await downloadTelegramFile(client, {
      fileId: "v",
      mimeType: "audio/ogg",
      fetchImpl,
      baseUrl: "https://proxy.example.com/",
    });
    expect(calls[0]!.url).toBe(
      "https://proxy.example.com/file/bottest-bot-token/voice/x.ogg",
    );
  });

  it("rejects when file_size > maxBytes BEFORE fetching", async () => {
    const client = makeClient({
      file_id: "big",
      file_unique_id: "u",
      file_size: 30 * 1024 * 1024,
      file_path: "voice/big.ogg",
    });
    const { fetchImpl, calls } = makeFakeFetch({ bodyBytes: new Uint8Array() });

    const err = await downloadTelegramFile(client, {
      fileId: "big",
      mimeType: "audio/ogg",
      fetchImpl,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TelegramDownloadError);
    expect((err as TelegramDownloadError).code).toBe("too_large");
    expect(calls).toHaveLength(0);
  });

  it("rejects with not_found when Telegram omits file_path (>20 MB)", async () => {
    const client = makeClient({
      file_id: "huge",
      file_unique_id: "u",
      // file_size omitted; file_path missing
    });
    const { fetchImpl } = makeFakeFetch({ bodyBytes: new Uint8Array() });
    await expect(
      downloadTelegramFile(client, {
        fileId: "huge",
        mimeType: "audio/ogg",
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("maps HTTP 404 to not_found", async () => {
    const client = makeClient({
      file_id: "x",
      file_unique_id: "u",
      file_size: 1,
      file_path: "voice/x.ogg",
    });
    const { fetchImpl } = makeFakeFetch({ status: 404 });
    await expect(
      downloadTelegramFile(client, {
        fileId: "x",
        mimeType: "audio/ogg",
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  it("maps HTTP 401 to auth", async () => {
    const client = makeClient({
      file_id: "x",
      file_unique_id: "u",
      file_size: 1,
      file_path: "voice/x.ogg",
    });
    const { fetchImpl } = makeFakeFetch({ status: 401 });
    await expect(
      downloadTelegramFile(client, {
        fileId: "x",
        mimeType: "audio/ogg",
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "auth", status: 401 });
  });

  it("maps HTTP 5xx to network", async () => {
    const client = makeClient({
      file_id: "x",
      file_unique_id: "u",
      file_size: 1,
      file_path: "voice/x.ogg",
    });
    const { fetchImpl } = makeFakeFetch({ status: 503 });
    await expect(
      downloadTelegramFile(client, {
        fileId: "x",
        mimeType: "audio/ogg",
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "network", status: 503 });
  });

  it("maps fetch network throw to network", async () => {
    const client = makeClient({
      file_id: "x",
      file_unique_id: "u",
      file_size: 1,
      file_path: "voice/x.ogg",
    });
    const { fetchImpl } = makeFakeFetch({
      throwError: new Error("ECONNRESET"),
    });
    await expect(
      downloadTelegramFile(client, {
        fileId: "x",
        mimeType: "audio/ogg",
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "network" });
  });

  it("maps abort/timeout to timeout", async () => {
    const client = makeClient({
      file_id: "x",
      file_unique_id: "u",
      file_size: 1,
      file_path: "voice/x.ogg",
    });
    const { fetchImpl } = makeFakeFetch({ abortAfterMs: 1000 });
    const err = await downloadTelegramFile(client, {
      fileId: "x",
      mimeType: "audio/ogg",
      fetchImpl,
      timeoutMs: 10,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TelegramDownloadError);
    expect((err as TelegramDownloadError).code).toBe("timeout");
  });

  it("maps getFile() throw to network", async () => {
    const client = makeClient(
      { file_id: "x", file_unique_id: "u" },
      { throwError: new Error("upstream 502") },
    );
    const { fetchImpl } = makeFakeFetch({});
    await expect(
      downloadTelegramFile(client, {
        fileId: "x",
        mimeType: "audio/ogg",
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "network" });
  });

  it("rejects when downloaded buffer exceeds maxBytes (size lied or chunked)", async () => {
    const client = makeClient({
      file_id: "x",
      file_unique_id: "u",
      file_size: 10,
      file_path: "voice/x.ogg",
    });
    const { fetchImpl } = makeFakeFetch({
      // body is much bigger than the advertised file_size
      bodyBytes: new Uint8Array(100),
    });
    await expect(
      downloadTelegramFile(client, {
        fileId: "x",
        mimeType: "audio/ogg",
        fetchImpl,
        maxBytes: 50,
      }),
    ).rejects.toMatchObject({ code: "too_large" });
  });

  it("rejects when fileId is empty", async () => {
    const client = makeClient({
      file_id: "",
      file_unique_id: "u",
      file_size: 1,
      file_path: "voice/x.ogg",
    });
    const { fetchImpl } = makeFakeFetch({
      bodyBytes: new Uint8Array([0]),
    });
    await expect(
      downloadTelegramFile(client, {
        fileId: "",
        mimeType: "audio/ogg",
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
