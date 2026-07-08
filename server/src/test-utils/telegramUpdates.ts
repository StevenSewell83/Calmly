// TG-09b — fixture builders for grammy `Update` objects used by the
// TG-09 integration test pass. Pure data factories, no handler coupling.
// Companion to MockTelegramBotApi (TG-09a / calmly-2g0).

import type { Update } from "@grammyjs/types";
import type { Chat, User } from "@grammyjs/types";
import type { Message, Voice, PhotoSize } from "@grammyjs/types";
import type { CallbackQuery } from "@grammyjs/types";

const DEFAULT_CHAT_ID = 12345;
const DEFAULT_USER_ID = 67890;
const DEFAULT_USERNAME = "testuser";
const DEFAULT_FIRST_NAME = "Test";
const DEFAULT_BOT_NAME = "Calmly Test Bot";

let _seqUpdateId = 1_000_000;
let _seqMessageId = 1;

function nextUpdateId(): number {
  return _seqUpdateId++;
}

function nextMessageId(): number {
  return _seqMessageId++;
}

export interface BaseUpdateOpts {
  update_id?: number;
  chat_id?: number;
  user_id?: number;
  username?: string;
  message_id?: number;
  date?: number;
}

export function makeUser(opts: BaseUpdateOpts = {}): User {
  return {
    id: opts.user_id ?? DEFAULT_USER_ID,
    is_bot: false,
    first_name: DEFAULT_FIRST_NAME,
    username: opts.username ?? DEFAULT_USERNAME,
    language_code: "en",
  };
}

export function makePrivateChat(opts: BaseUpdateOpts = {}): Chat.PrivateChat {
  return {
    id: opts.chat_id ?? DEFAULT_CHAT_ID,
    type: "private",
    first_name: DEFAULT_FIRST_NAME,
    username: opts.username ?? DEFAULT_USERNAME,
  };
}

interface MessageBaseFields {
  message_id: number;
  date: number;
  chat: Chat.PrivateChat;
  from: User;
}

function messageBase(opts: BaseUpdateOpts): MessageBaseFields {
  return {
    message_id: opts.message_id ?? nextMessageId(),
    date: opts.date ?? Math.floor(Date.now() / 1000),
    chat: makePrivateChat(opts),
    from: makeUser(opts),
  };
}

export function makeBaseUpdate(opts: BaseUpdateOpts = {}): Pick<Update, "update_id"> {
  return { update_id: opts.update_id ?? nextUpdateId() };
}

export function makeTextUpdate(text: string, opts: BaseUpdateOpts = {}): Update {
  const message: Message.TextMessage & { chat: Chat.PrivateChat; from: User } = {
    ...messageBase(opts),
    text,
  };
  return {
    update_id: opts.update_id ?? nextUpdateId(),
    message,
  };
}

export function makeStartUpdate(code?: string, opts: BaseUpdateOpts = {}): Update {
  const text = code ? `/start ${code}` : "/start";
  return makeTextUpdate(text, opts);
}

export type TelegramSlashCommand = "/now" | "/today" | "/inbox";

export function makeCommandUpdate(
  command: TelegramSlashCommand,
  args?: string,
  opts: BaseUpdateOpts = {},
): Update {
  const text = args ? `${command} ${args}` : command;
  return makeTextUpdate(text, opts);
}

export interface VoiceUpdateOpts extends BaseUpdateOpts {
  fileId?: string;
  fileUniqueId?: string;
  durationSec?: number;
  mimeType?: string;
  fileSize?: number;
}

export function makeVoiceUpdate(opts: VoiceUpdateOpts = {}): Update {
  const fileId = opts.fileId ?? `voice-file-${nextMessageId()}`;
  const voice: Voice = {
    file_id: fileId,
    file_unique_id: opts.fileUniqueId ?? `${fileId}-uniq`,
    duration: opts.durationSec ?? 3,
    mime_type: opts.mimeType ?? "audio/ogg",
    ...(opts.fileSize !== undefined ? { file_size: opts.fileSize } : {}),
  };
  const message = {
    ...messageBase(opts),
    voice,
  } as unknown as NonNullable<Update["message"]>;
  return {
    update_id: opts.update_id ?? nextUpdateId(),
    message,
  };
}

export interface PhotoUpdateOpts extends BaseUpdateOpts {
  fileId?: string;
  width?: number;
  height?: number;
}

export function makePhotoUpdate(opts: PhotoUpdateOpts = {}): Update {
  const fileId = opts.fileId ?? `photo-file-${nextMessageId()}`;
  const photo: PhotoSize[] = [
    {
      file_id: fileId,
      file_unique_id: `${fileId}-uniq`,
      width: opts.width ?? 320,
      height: opts.height ?? 240,
    },
  ];
  const message = {
    ...messageBase(opts),
    photo,
  } as unknown as NonNullable<Update["message"]>;
  return {
    update_id: opts.update_id ?? nextUpdateId(),
    message,
  };
}

export interface CallbackQueryUpdateOpts extends BaseUpdateOpts {
  callbackQueryId?: string;
  chatInstance?: string;
}

export function makeCallbackQueryUpdate(
  callback_data: string,
  opts: CallbackQueryUpdateOpts = {},
): Update {
  const cq: CallbackQuery = {
    id: opts.callbackQueryId ?? `cq-${nextMessageId()}`,
    from: makeUser(opts),
    chat_instance: opts.chatInstance ?? `chat-instance-${opts.chat_id ?? DEFAULT_CHAT_ID}`,
    data: callback_data,
  };
  return {
    update_id: opts.update_id ?? nextUpdateId(),
    callback_query: cq,
  };
}

// Test-time only: reset internal counters so each spec starts deterministic.
export function resetUpdateCounters(): void {
  _seqUpdateId = 1_000_000;
  _seqMessageId = 1;
}

// Default exposed bot identity for specs that need to seed the mock with a
// recognisable receiver. Kept here so tests that need a bot User reference
// (e.g. forwarded message author) don't have to redefine it.
export const TEST_BOT_USER: User = {
  id: 999_001,
  is_bot: true,
  first_name: DEFAULT_BOT_NAME,
  username: "calmly_test_bot",
};
