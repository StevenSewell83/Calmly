import { describe, expect, it, vi } from "vitest";
import { ChannelRouter } from "../router";
import type { Channel, ChannelDeliverResult } from "../channels/types";

function fakeChannel(name: string, result: ChannelDeliverResult): Channel {
  return {
    name,
    deliver: vi.fn().mockResolvedValue(result),
  };
}

const INPUT = {
  deliveryId: "d1",
  ruleId: "r1",
  userId: "u1",
  taskId: "t1",
  scheduledFor: 1000,
};

describe("ChannelRouter.pickChannel", () => {
  it("picks telegram when the user is linked", async () => {
    const telegram = fakeChannel("telegram", { ok: true });
    const desktop = fakeChannel("desktop", { ok: true });
    const router = new ChannelRouter({
      isTelegramLinked: async () => true,
      telegram,
      desktop,
    });
    expect(await router.pickChannel("u1")).toBe(telegram);
  });

  it("picks desktop when the user is not linked", async () => {
    const telegram = fakeChannel("telegram", { ok: true });
    const desktop = fakeChannel("desktop", { ok: true });
    const router = new ChannelRouter({
      isTelegramLinked: async () => false,
      telegram,
      desktop,
    });
    expect(await router.pickChannel("u1")).toBe(desktop);
  });
});

describe("ChannelRouter.deliver", () => {
  it("returns the primary channel's result when it succeeds", async () => {
    const telegram = fakeChannel("telegram", { ok: true, outboundMessageId: "m1" });
    const desktop = fakeChannel("desktop", { ok: true });
    const router = new ChannelRouter({
      isTelegramLinked: async () => true,
      telegram,
      desktop,
    });
    const result = await router.deliver(INPUT);
    expect(result).toMatchObject({ ok: true, channel: "telegram", outboundMessageId: "m1" });
    expect(desktop.deliver).not.toHaveBeenCalled();
  });

  it("does not fall back on a plain failure without the fallback signal", async () => {
    const telegram = fakeChannel("telegram", { ok: false, error: "boom" });
    const desktop = fakeChannel("desktop", { ok: true });
    const router = new ChannelRouter({
      isTelegramLinked: async () => true,
      telegram,
      desktop,
    });
    const result = await router.deliver(INPUT);
    expect(result).toMatchObject({ ok: false, channel: "telegram" });
    expect(desktop.deliver).not.toHaveBeenCalled();
  });

  it("routes to the secondary channel when the primary signals fallback", async () => {
    const telegram = fakeChannel("telegram", { ok: false, fallback: true });
    const desktop = fakeChannel("desktop", { ok: true });
    const router = new ChannelRouter({
      isTelegramLinked: async () => true,
      telegram,
      desktop,
    });
    const result = await router.deliver(INPUT);
    expect(result).toMatchObject({ ok: true, channel: "desktop" });
    expect(telegram.deliver).toHaveBeenCalledTimes(1);
    expect(desktop.deliver).toHaveBeenCalledTimes(1);
  });

  it("falls back from desktop to telegram when desktop is primary and signals fallback", async () => {
    const telegram = fakeChannel("telegram", { ok: true });
    const desktop = fakeChannel("desktop", { ok: false, fallback: true });
    const router = new ChannelRouter({
      isTelegramLinked: async () => false,
      telegram,
      desktop,
    });
    const result = await router.deliver(INPUT);
    expect(result).toMatchObject({ ok: true, channel: "telegram" });
  });
});
