import { beforeEach, describe, expect, it } from "vitest";
import {
  makeBaseUpdate,
  makeTextUpdate,
  makeStartUpdate,
  makeCommandUpdate,
  makeVoiceUpdate,
  makePhotoUpdate,
  makeCallbackQueryUpdate,
  makePrivateChat,
  makeUser,
  resetUpdateCounters,
  TEST_BOT_USER,
} from "../telegramUpdates";

describe("telegramUpdates fixture builders", () => {
  beforeEach(() => {
    resetUpdateCounters();
  });

  it("makeBaseUpdate returns a fresh update_id each call", () => {
    const a = makeBaseUpdate();
    const b = makeBaseUpdate();
    expect(typeof a.update_id).toBe("number");
    expect(b.update_id).toBe(a.update_id + 1);
  });

  it("makeBaseUpdate respects update_id override", () => {
    const u = makeBaseUpdate({ update_id: 42 });
    expect(u.update_id).toBe(42);
  });

  it("makePrivateChat carries chat_id + type='private'", () => {
    const c = makePrivateChat({ chat_id: 555 });
    expect(c.id).toBe(555);
    expect(c.type).toBe("private");
  });

  it("makeUser respects user_id and username overrides", () => {
    const u = makeUser({ user_id: 7, username: "alice" });
    expect(u.id).toBe(7);
    expect(u.username).toBe("alice");
    expect(u.is_bot).toBe(false);
  });

  it("makeTextUpdate produces a message with text", () => {
    const u = makeTextUpdate("hello world");
    expect(u.message).toBeDefined();
    expect(u.message?.text).toBe("hello world");
    expect(u.message?.chat.type).toBe("private");
    expect(u.message?.from?.is_bot).toBe(false);
  });

  it("makeTextUpdate uses default chat/user but applies overrides", () => {
    const u = makeTextUpdate("hi", { chat_id: 99, user_id: 11 });
    expect(u.message?.chat.id).toBe(99);
    expect(u.message?.from?.id).toBe(11);
  });

  it("makeStartUpdate('CODE') -> '/start CODE'", () => {
    const u = makeStartUpdate("ABC123");
    expect(u.message?.text).toBe("/start ABC123");
  });

  it("makeStartUpdate() -> '/start' (no code)", () => {
    const u = makeStartUpdate();
    expect(u.message?.text).toBe("/start");
  });

  it("makeCommandUpdate('/today') -> '/today'", () => {
    const u = makeCommandUpdate("/today");
    expect(u.message?.text).toBe("/today");
  });

  it("makeCommandUpdate('/today', 'tomorrow') -> '/today tomorrow'", () => {
    const u = makeCommandUpdate("/today", "tomorrow");
    expect(u.message?.text).toBe("/today tomorrow");
  });

  it("makeVoiceUpdate produces a message with voice and no text", () => {
    const u = makeVoiceUpdate({ fileId: "vfile-1", durationSec: 5 });
    const msg = u.message as NonNullable<typeof u.message> & {
      voice?: { file_id: string; duration: number };
    };
    expect(msg.voice?.file_id).toBe("vfile-1");
    expect(msg.voice?.duration).toBe(5);
    expect("text" in msg ? msg.text : undefined).toBeUndefined();
  });

  it("makeVoiceUpdate defaults to audio/ogg mime", () => {
    const u = makeVoiceUpdate();
    const msg = u.message as NonNullable<typeof u.message> & {
      voice?: { mime_type?: string };
    };
    expect(msg.voice?.mime_type).toBe("audio/ogg");
  });

  it("makePhotoUpdate produces a message with photo[] and neither text nor voice", () => {
    const u = makePhotoUpdate({ fileId: "pfile" });
    const msg = u.message as NonNullable<typeof u.message> & {
      photo?: { file_id: string }[];
      text?: string;
      voice?: unknown;
    };
    expect(msg.photo?.[0]?.file_id).toBe("pfile");
    expect(msg.text).toBeUndefined();
    expect(msg.voice).toBeUndefined();
  });

  it("makeCallbackQueryUpdate puts data on update.callback_query, not message", () => {
    const u = makeCallbackQueryUpdate("done:42");
    expect(u.callback_query?.data).toBe("done:42");
    expect(u.message).toBeUndefined();
  });

  it("makeCallbackQueryUpdate includes from + chat_instance", () => {
    const u = makeCallbackQueryUpdate("snooze:7", {
      callbackQueryId: "cq-test",
      chatInstance: "ci-9",
    });
    expect(u.callback_query?.id).toBe("cq-test");
    expect(u.callback_query?.chat_instance).toBe("ci-9");
    expect(u.callback_query?.from.is_bot).toBe(false);
  });

  it("resetUpdateCounters resets the update_id sequence", () => {
    const before = makeBaseUpdate().update_id;
    resetUpdateCounters();
    const after = makeBaseUpdate().update_id;
    expect(after).toBeLessThanOrEqual(before);
  });

  it("TEST_BOT_USER is a recognisable bot identity", () => {
    expect(TEST_BOT_USER.is_bot).toBe(true);
    expect(TEST_BOT_USER.username).toMatch(/bot/i);
  });

  it("text and voice updates emit incrementing update_ids by default", () => {
    const a = makeTextUpdate("a");
    const b = makeVoiceUpdate();
    expect(b.update_id).toBeGreaterThan(a.update_id);
  });
});
