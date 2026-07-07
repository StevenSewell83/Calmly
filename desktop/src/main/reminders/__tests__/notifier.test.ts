// TGR-10 — notifier.ts unit tests. No "electron" import/mock needed here:
// Notification/BrowserWindow are dependency-injected (see notifier.ts's
// header), so plain fakes exercise display/click/ack/dedupe behavior.
import { describe, expect, it, vi } from "vitest";
import {
  createNotifier,
  createNotifierPollLoop,
  OPEN_TASK_CHANNEL,
  type NotificationLike,
  type NotifierDeps,
  type WindowLike,
} from "../notifier";
import type { DesktopDeliveriesClient, PendingDesktopDelivery } from "../deliveriesClient";

function delivery(overrides: Partial<PendingDesktopDelivery> = {}): PendingDesktopDelivery {
  return {
    id: "delivery-1",
    taskId: "task-1",
    taskTitle: "Buy milk",
    importance: "soft",
    scheduledFor: 1_000,
    ...overrides,
  };
}

function fakeClient(overrides: Partial<DesktopDeliveriesClient> = {}): DesktopDeliveriesClient {
  return {
    fetchPending: vi.fn(async () => []),
    ack: vi.fn(async () => {}),
    ...overrides,
  };
}

function fakeWindow(): WindowLike & {
  show: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
} {
  return {
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: { send: vi.fn() },
  };
}

interface FakeNotification extends NotificationLike {
  clickHandlers: (() => void)[];
  shown: boolean;
}

function makeDeps(overrides: Partial<NotifierDeps> = {}): {
  deps: NotifierDeps;
  notifications: FakeNotification[];
  win: ReturnType<typeof fakeWindow>;
} {
  const notifications: FakeNotification[] = [];
  const win = fakeWindow();
  const deps: NotifierDeps = {
    client: fakeClient(),
    getMainWindow: () => win,
    isPackaged: true,
    isNotificationSupported: () => true,
    createNotification: (options) => {
      const n: FakeNotification = {
        clickHandlers: [],
        shown: false,
        on: (_event, listener) => {
          n.clickHandlers.push(listener);
          return n;
        },
        show: () => {
          n.shown = true;
        },
      };
      notifications.push(n);
      void options;
      return n;
    },
    log: vi.fn(),
    ...overrides,
  };
  return { deps, notifications, win };
}

describe("createNotifier — display", () => {
  it("shows a plain-title notification for a soft reminder", async () => {
    const { deps, notifications } = makeDeps({
      client: fakeClient({ fetchPending: vi.fn(async () => [delivery({ importance: "soft" })]) }),
    });
    const createNotification = vi.fn(deps.createNotification);
    const notifier = createNotifier({ ...deps, createNotification });

    await notifier.pollOnce();

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Buy milk" }),
    );
    expect(notifications[0]?.shown).toBe(true);
  });

  it("bell-prefixes the title for an important reminder", async () => {
    const { deps } = makeDeps({
      client: fakeClient({
        fetchPending: vi.fn(async () => [delivery({ importance: "important" })]),
      }),
    });
    const createNotification = vi.fn(deps.createNotification);
    const notifier = createNotifier({ ...deps, createNotification });

    await notifier.pollOnce();

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: "\u{1F514} Buy milk" }),
    );
  });
});

describe("createNotifier — click routing", () => {
  it("focuses and shows the window, then sends the open-task channel with the taskId", async () => {
    const { deps, notifications, win } = makeDeps({
      client: fakeClient({
        fetchPending: vi.fn(async () => [delivery({ taskId: "task-42" })]),
      }),
    });
    const notifier = createNotifier(deps);

    await notifier.pollOnce();
    notifications[0]?.clickHandlers[0]?.();

    expect(win.show).toHaveBeenCalledTimes(1);
    expect(win.focus).toHaveBeenCalledTimes(1);
    expect(win.webContents.send).toHaveBeenCalledWith(OPEN_TASK_CHANNEL, { taskId: "task-42" });
  });

  it("restores a minimized window before focusing it", async () => {
    const win = fakeWindow();
    win.isMinimized = () => true;
    const { deps, notifications } = makeDeps({
      getMainWindow: () => win,
      client: fakeClient({ fetchPending: vi.fn(async () => [delivery()]) }),
    });
    const notifier = createNotifier(deps);

    await notifier.pollOnce();
    notifications[0]?.clickHandlers[0]?.();

    expect(win.restore).toHaveBeenCalledTimes(1);
  });

  it("does nothing when there is no main window (closed)", async () => {
    const { deps, notifications } = makeDeps({
      getMainWindow: () => null,
      client: fakeClient({ fetchPending: vi.fn(async () => [delivery()]) }),
    });
    const notifier = createNotifier(deps);

    await notifier.pollOnce();
    expect(() => notifications[0]?.clickHandlers[0]?.()).not.toThrow();
  });
});

describe("createNotifier — ack", () => {
  it("acks the delivery after displaying it", async () => {
    const ack = vi.fn(async () => {});
    const { deps } = makeDeps({
      client: fakeClient({ fetchPending: vi.fn(async () => [delivery({ id: "d-9" })]), ack }),
    });
    const notifier = createNotifier(deps);

    const result = await notifier.pollOnce();

    expect(ack).toHaveBeenCalledWith("d-9");
    expect(result).toEqual({ notified: 1, errored: 0 });
  });

  it("counts an ack failure without throwing, and without blocking other deliveries", async () => {
    const ack = vi.fn(async (id: string) => {
      if (id === "d-1") throw new Error("network down");
    });
    const { deps } = makeDeps({
      client: fakeClient({
        fetchPending: vi.fn(async () => [delivery({ id: "d-1" }), delivery({ id: "d-2" })]),
        ack,
      }),
    });
    const notifier = createNotifier(deps);

    const result = await notifier.pollOnce();

    expect(result).toEqual({ notified: 2, errored: 1 });
    expect(ack).toHaveBeenCalledTimes(2);
  });
});

describe("createNotifier — dedupe on refetch", () => {
  it("does not re-notify a delivery already seen, but still retries its ack", async () => {
    const ack = vi.fn(async () => {});
    const fetchPending = vi.fn(async () => [delivery({ id: "d-1" })]);
    const { deps, notifications } = makeDeps({ client: fakeClient({ fetchPending, ack }) });
    const notifier = createNotifier(deps);

    const first = await notifier.pollOnce();
    const second = await notifier.pollOnce();

    expect(notifications).toHaveLength(1);
    expect(first.notified).toBe(1);
    expect(second.notified).toBe(0);
    expect(ack).toHaveBeenCalledTimes(2);
  });
});

describe("createNotifier — dev/unsupported fallback", () => {
  it("logs instead of creating a Notification when not packaged", async () => {
    const createNotification = vi.fn();
    const log = vi.fn();
    const { deps } = makeDeps({
      isPackaged: false,
      createNotification,
      log,
      client: fakeClient({ fetchPending: vi.fn(async () => [delivery()]) }),
    });
    const notifier = createNotifier(deps);

    await notifier.pollOnce();

    expect(createNotification).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      "desktop notification (dev/unsupported fallback)",
      expect.objectContaining({ taskId: "task-1" }),
    );
  });

  it("logs instead of creating a Notification when Notification.isSupported() is false, even if packaged", async () => {
    const createNotification = vi.fn();
    const { deps } = makeDeps({
      isPackaged: true,
      isNotificationSupported: () => false,
      createNotification,
      client: fakeClient({ fetchPending: vi.fn(async () => [delivery()]) }),
    });
    const notifier = createNotifier(deps);

    await notifier.pollOnce();

    expect(createNotification).not.toHaveBeenCalled();
  });
});

describe("createNotifier — poll failure", () => {
  it("does not throw when fetchPending rejects; reports errored:1 and notified:0", async () => {
    const { deps } = makeDeps({
      client: fakeClient({ fetchPending: vi.fn(async () => { throw new Error("offline"); }) }),
    });
    const notifier = createNotifier(deps);

    const result = await notifier.pollOnce();

    expect(result).toEqual({ notified: 0, errored: 1 });
  });
});

describe("createNotifierPollLoop — start/stop", () => {
  it("polls on the configured interval and stops cleanly", async () => {
    vi.useFakeTimers();
    const pollOnce = vi.fn(async () => ({ notified: 0, errored: 0 }));
    const loop = createNotifierPollLoop({ pollOnce }, { intervalMs: 1_000 });

    loop.start();
    await vi.advanceTimersByTimeAsync(2_500);
    expect(pollOnce.mock.calls.length).toBeGreaterThanOrEqual(2);

    loop.stop();
    const callsAfterStop = pollOnce.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(pollOnce.mock.calls.length).toBe(callsAfterStop);

    vi.useRealTimers();
  });

  it("start() is idempotent — calling twice does not double the timer", async () => {
    vi.useFakeTimers();
    const pollOnce = vi.fn(async () => ({ notified: 0, errored: 0 }));
    const loop = createNotifierPollLoop({ pollOnce }, { intervalMs: 1_000 });

    loop.start();
    loop.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(pollOnce.mock.calls.length).toBe(1);

    loop.stop();
    vi.useRealTimers();
  });
});
