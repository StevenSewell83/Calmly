// TGR-10 — DesktopChannel tests. Unlike TelegramChannel there's no external
// send to mock: this channel's whole job is to say {ok:true} and log ids
// only, since createDelivery already wrote the row (see desktop.ts's
// header) and the desktop client discovers it via its own poll.
import { describe, expect, it, vi } from "vitest";
import { DesktopChannel } from "../desktop";
import { DESKTOP_CHANNEL_NAME } from "../types";
import type { ChannelDeliveryInput } from "../types";

const INPUT: ChannelDeliveryInput = {
  deliveryId: "delivery-1",
  ruleId: "rule-1",
  userId: "user-1",
  taskId: "task-1",
  scheduledFor: 1_000,
};

describe("DesktopChannel.deliver", () => {
  it("reports the desktop channel name", () => {
    const channel = new DesktopChannel();
    expect(channel.name).toBe(DESKTOP_CHANNEL_NAME);
  });

  it("always succeeds — marking pending-for-desktop is all this channel does", async () => {
    const channel = new DesktopChannel({ info: vi.fn() });
    const result = await channel.deliver(INPUT);
    expect(result).toEqual({ ok: true });
  });

  it("logs only ids — no task title/content passed through ChannelDeliveryInput", async () => {
    const info = vi.fn();
    const channel = new DesktopChannel({ info });
    await channel.deliver(INPUT);

    expect(info).toHaveBeenCalledTimes(1);
    const [fields] = info.mock.calls[0] as [Record<string, unknown>, string];
    expect(fields).toEqual({
      channel: DESKTOP_CHANNEL_NAME,
      deliveryId: "delivery-1",
      ruleId: "rule-1",
      taskId: "task-1",
    });
  });
});
