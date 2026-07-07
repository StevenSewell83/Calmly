// TG-09a — reusable mock harness for the Telegram Bot API. Used by the
// TG-09 integration test pass to (a) replay canned Update payloads
// through the dispatcher, (b) record what the bot would have sent back
// (sendMessage / editMessageText) for assertions, and (c) stub getFile
// + the file-download endpoint so the voice handler runs hermetically.
//
// Pure test infrastructure; no fastify, no supertest, no real network.
// Spec'd in bd calmly-2g0.
//
// Lives under server/src/test-utils/ instead of server/test/mocks/ so
// the existing vitest config (include: src/**/*.test.ts) picks up its
// self-tests without a config change.

import type {
  BotCommand,
  File as TelegramFile,
  InlineKeyboardMarkup,
  ReplyKeyboardMarkup,
  ReplyKeyboardRemove,
  ForceReply,
  Message,
} from "@grammyjs/types";
import type { UserFromGetMe, WebhookInfo } from "@grammyjs/types";
import type { TelegramFileClient } from "../telegram/files";

const TEST_BOT_TOKEN = "test-bot-token";
const FILE_BASE_URL = "https://api.telegram.org";

export type ReplyMarkup =
  | InlineKeyboardMarkup
  | ReplyKeyboardMarkup
  | ReplyKeyboardRemove
  | ForceReply;

export interface SendMessageOther {
  reply_markup?: ReplyMarkup;
  parse_mode?: string;
  [k: string]: unknown;
}

export interface EditMessageTextOther {
  reply_markup?: InlineKeyboardMarkup;
  parse_mode?: string;
  [k: string]: unknown;
}

export interface AnswerCallbackQueryOther {
  text?: string;
  show_alert?: boolean;
  [k: string]: unknown;
}

export type RecordedCall =
  | {
      method: "sendMessage";
      chat_id: number | string;
      text: string;
      other?: SendMessageOther;
    }
  | {
      method: "editMessageText";
      chat_id: number | string;
      message_id: number;
      text: string;
      other?: EditMessageTextOther;
    }
  | {
      method: "answerCallbackQuery";
      callback_query_id: string;
      other?: AnswerCallbackQueryOther;
    }
  | {
      method: "setMyCommands";
      commands: readonly BotCommand[];
    };

const DEFAULT_BOT_IDENTITY: UserFromGetMe = {
  id: 12345,
  is_bot: true,
  first_name: "Calmly Test Bot",
  username: "calmly_test_bot",
  can_join_groups: false,
  can_read_all_group_messages: false,
  can_manage_bots: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
};

const DEFAULT_WEBHOOK_INFO: WebhookInfo = {
  url: "",
  has_custom_certificate: false,
  pending_update_count: 0,
};

interface FileBytesEntry {
  bytes: Uint8Array;
  mimeType: string;
}

export interface MockTelegramBotApiOptions {
  token?: string;
  baseUrl?: string;
  botIdentity?: UserFromGetMe;
  webhookInfo?: WebhookInfo;
}

export class MockTelegramBotApi implements TelegramFileClient {
  readonly token: string;
  readonly api: TelegramFileClient["api"] & {
    sendMessage(
      chat_id: number | string,
      text: string,
      other?: SendMessageOther,
    ): Promise<Message.TextMessage>;
    editMessageText(
      chat_id: number | string,
      message_id: number,
      text: string,
      other?: EditMessageTextOther,
    ): Promise<true>;
    getMe(): Promise<UserFromGetMe>;
    getWebhookInfo(): Promise<WebhookInfo>;
    answerCallbackQuery(
      callback_query_id: string,
      other?: AnswerCallbackQueryOther,
    ): Promise<true>;
    setMyCommands(commands: readonly BotCommand[]): Promise<true>;
  };

  readonly fetchImpl: typeof fetch;

  private readonly baseUrl: string;
  private readonly botIdentity: UserFromGetMe;
  private readonly webhookInfo: WebhookInfo;
  private readonly recordings: RecordedCall[] = [];
  private readonly fileBytes = new Map<string, FileBytesEntry>();
  private nextSendMessageId = 1000;
  private nextGetFile: TelegramFile | null = null;
  private nextGetFileError: Error | null = null;
  // Queues so retry specs can fail N times then succeed (shift on each call).
  private sendMessageErrors: Error[] = [];
  private editMessageTextErrors: Error[] = [];

  constructor(opts: MockTelegramBotApiOptions = {}) {
    this.token = opts.token ?? TEST_BOT_TOKEN;
    this.baseUrl = (opts.baseUrl ?? FILE_BASE_URL).replace(/\/$/, "");
    this.botIdentity = opts.botIdentity ?? DEFAULT_BOT_IDENTITY;
    this.webhookInfo = opts.webhookInfo ?? DEFAULT_WEBHOOK_INFO;

    this.api = {
      sendMessage: this.sendMessage.bind(this),
      editMessageText: this.editMessageText.bind(this),
      getMe: this.getMe.bind(this),
      getWebhookInfo: this.getWebhookInfo.bind(this),
      getFile: this.getFile.bind(this),
      answerCallbackQuery: this.answerCallbackQuery.bind(this),
      setMyCommands: this.setMyCommands.bind(this),
    };

    this.fetchImpl = this.handleFetch.bind(this) as typeof fetch;
  }

  get outbound(): readonly RecordedCall[] {
    return this.recordings;
  }

  reset(): void {
    this.recordings.length = 0;
    this.fileBytes.clear();
    this.nextSendMessageId = 1000;
    this.nextGetFile = null;
    this.nextGetFileError = null;
    this.sendMessageErrors = [];
    this.editMessageTextErrors = [];
  }

  setNextGetFile(file: TelegramFile): void {
    this.nextGetFile = file;
    this.nextGetFileError = null;
  }

  setNextGetFileError(err: Error): void {
    this.nextGetFileError = err;
    this.nextGetFile = null;
  }

  setFileBytes(filePath: string, bytes: Uint8Array, mimeType = "audio/ogg"): void {
    this.fileBytes.set(normalisePath(filePath), { bytes, mimeType });
  }

  /** Next N sendMessage calls throw `err` (in order) before calls succeed again. */
  enqueueSendMessageError(err: Error): void {
    this.sendMessageErrors.push(err);
  }

  /** Next N editMessageText calls throw `err` (in order) before calls succeed again. */
  enqueueEditMessageTextError(err: Error): void {
    this.editMessageTextErrors.push(err);
  }

  private async sendMessage(
    chat_id: number | string,
    text: string,
    other?: SendMessageOther,
  ): Promise<Message.TextMessage> {
    const err = this.sendMessageErrors.shift();
    if (err) throw err;
    this.recordings.push(
      other === undefined
        ? { method: "sendMessage", chat_id, text }
        : { method: "sendMessage", chat_id, text, other },
    );
    const message_id = this.nextSendMessageId++;
    return {
      message_id,
      date: Math.floor(Date.now() / 1000),
      chat: {
        id: typeof chat_id === "number" ? chat_id : Number(chat_id) || 0,
        type: "private",
        first_name: "test-user",
      },
      text,
      from: this.botIdentity,
    };
  }

  private async editMessageText(
    chat_id: number | string,
    message_id: number,
    text: string,
    other?: EditMessageTextOther,
  ): Promise<true> {
    const err = this.editMessageTextErrors.shift();
    if (err) throw err;
    this.recordings.push(
      other === undefined
        ? { method: "editMessageText", chat_id, message_id, text }
        : { method: "editMessageText", chat_id, message_id, text, other },
    );
    return true;
  }

  private async getMe(): Promise<UserFromGetMe> {
    return this.botIdentity;
  }

  private async getWebhookInfo(): Promise<WebhookInfo> {
    return this.webhookInfo;
  }

  private async answerCallbackQuery(
    callback_query_id: string,
    other?: AnswerCallbackQueryOther,
  ): Promise<true> {
    this.recordings.push(
      other === undefined
        ? { method: "answerCallbackQuery", callback_query_id }
        : { method: "answerCallbackQuery", callback_query_id, other },
    );
    return true;
  }

  private async setMyCommands(commands: readonly BotCommand[]): Promise<true> {
    this.recordings.push({ method: "setMyCommands", commands });
    return true;
  }

  private async getFile(fileId: string): Promise<TelegramFile> {
    if (this.nextGetFileError) {
      const err = this.nextGetFileError;
      this.nextGetFileError = null;
      throw err;
    }
    if (this.nextGetFile) {
      const file = this.nextGetFile;
      this.nextGetFile = null;
      return file;
    }
    return {
      file_id: fileId,
      file_unique_id: `${fileId}-unique`,
      file_size: 0,
      file_path: `voice/${fileId}.ogg`,
    };
  }

  private async handleFetch(
    input: string | URL | Request,
    _init?: RequestInit,
  ): Promise<Response> {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const expectedPrefix = `${this.baseUrl}/file/bot${this.token}/`;
    if (!url.startsWith(expectedPrefix)) {
      // Anything outside the file-download base is an unexpected real-network call.
      return new Response("mock telegramBot: unexpected URL", { status: 502 });
    }
    const filePath = normalisePath(url.slice(expectedPrefix.length));
    const entry = this.fileBytes.get(filePath);
    if (!entry) {
      return new Response("not found", { status: 404 });
    }
    return new Response(entry.bytes, {
      status: 200,
      headers: { "content-type": entry.mimeType },
    });
  }
}

function normalisePath(filePath: string): string {
  return filePath.replace(/^\/+/, "");
}
