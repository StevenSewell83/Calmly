// TG-04b — download a file's binary content from the Telegram Bot API.
// Two-step protocol: getFile(file_id) -> { file_path }, then GET
// https://api.telegram.org/file/bot<TOKEN>/<file_path>. The TG-04 voice
// handler composes this with the transcription provider (TG-04a) and
// the inbox writer (TG-03b); this helper deliberately does no fs I/O.

import type { File as TelegramFile } from "@grammyjs/types";

const FILE_BASE_URL = "https://api.telegram.org";
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024; // Whisper's hard limit
const DEFAULT_TIMEOUT_MS = 30_000;

export interface TelegramFileMeta {
  fileId: string;
  sizeBytes: number;
  mimeType: string;
}

export interface DownloadedTelegramFile extends TelegramFileMeta {
  buffer: Buffer;
}

export type TelegramDownloadErrorCode =
  | "too_large"
  | "not_found"
  | "auth"
  | "network"
  | "timeout"
  | "unsupported";

export class TelegramDownloadError extends Error {
  readonly code: TelegramDownloadErrorCode;
  readonly status: number | null;

  constructor(
    code: TelegramDownloadErrorCode,
    message: string,
    opts: { status?: number | null } = {},
  ) {
    super(message);
    this.name = "TelegramDownloadError";
    this.code = code;
    this.status = opts.status ?? null;
  }
}

// Structural subset of grammy's Bot. A real Bot satisfies this; tests
// pass a plain object stub.
export interface TelegramFileClient {
  readonly token: string;
  readonly api: {
    getFile(fileId: string, signal?: AbortSignal): Promise<TelegramFile>;
  };
}

export interface DownloadTelegramFileParams {
  fileId: string;
  mimeType: string;
  maxBytes?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

export async function downloadTelegramFile(
  client: TelegramFileClient,
  params: DownloadTelegramFileParams,
): Promise<DownloadedTelegramFile> {
  const fileId = params.fileId;
  if (!fileId) {
    throw new TelegramDownloadError("not_found", "fileId is required");
  }
  const mimeType = params.mimeType;
  const maxBytes = params.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = params.fetchImpl ?? fetch;
  const baseUrl = (params.baseUrl ?? FILE_BASE_URL).replace(/\/$/, "");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let file: TelegramFile;
  try {
    file = await client.api.getFile(fileId, controller.signal);
  } catch (err) {
    clearTimeout(timer);
    if (isAbortError(err)) {
      throw new TelegramDownloadError("timeout", "getFile aborted (timeout)");
    }
    throw new TelegramDownloadError(
      "network",
      `getFile failed: ${stringifyError(err)}`,
    );
  }

  if (typeof file.file_size === "number" && file.file_size > maxBytes) {
    clearTimeout(timer);
    throw new TelegramDownloadError(
      "too_large",
      `file_size=${file.file_size} exceeds maxBytes=${maxBytes}`,
    );
  }

  if (!file.file_path) {
    // Telegram omits file_path for files >20 MB; treat as too-large/unavailable.
    clearTimeout(timer);
    throw new TelegramDownloadError(
      "not_found",
      "Telegram returned no file_path (file may exceed 20 MB)",
    );
  }

  const url = `${baseUrl}/file/bot${client.token}/${file.file_path}`;

  let res: Response;
  try {
    res = await fetchImpl(url, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    if (isAbortError(err)) {
      throw new TelegramDownloadError("timeout", "file download aborted (timeout)");
    }
    throw new TelegramDownloadError(
      "network",
      `file download network error: ${stringifyError(err)}`,
    );
  }
  clearTimeout(timer);

  if (!res.ok) {
    throw mapHttpError(res.status);
  }

  let buffer: Buffer;
  try {
    const ab = await res.arrayBuffer();
    buffer = Buffer.from(ab);
  } catch (err) {
    throw new TelegramDownloadError(
      "network",
      `failed to read file body: ${stringifyError(err)}`,
      { status: res.status },
    );
  }

  if (buffer.byteLength > maxBytes) {
    throw new TelegramDownloadError(
      "too_large",
      `downloaded bytes=${buffer.byteLength} exceeds maxBytes=${maxBytes}`,
    );
  }

  return {
    fileId,
    sizeBytes: buffer.byteLength,
    mimeType,
    buffer,
  };
}

function mapHttpError(status: number): TelegramDownloadError {
  if (status === 404) {
    return new TelegramDownloadError("not_found", `file HTTP 404`, { status });
  }
  if (status === 401 || status === 403) {
    return new TelegramDownloadError("auth", `file HTTP ${status}`, { status });
  }
  if (status === 415) {
    return new TelegramDownloadError("unsupported", `file HTTP 415`, { status });
  }
  return new TelegramDownloadError("network", `file HTTP ${status}`, { status });
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error && (err.name === "AbortError" || /aborted/i.test(err.message))
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
