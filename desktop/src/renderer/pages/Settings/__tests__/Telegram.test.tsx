// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, act } from "@testing-library/react";
import type {
  TelegramCreateCodeResult,
  TelegramLinkingStatusResult,
} from "../../../../preload/api-types";
import { SettingsTelegram } from "../Telegram";

function mockCalmly(opts: {
  getStatus: () => Promise<TelegramLinkingStatusResult>;
  createLinkingCode?: () => Promise<TelegramCreateCodeResult>;
  unlink?: () => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  (window as any).calmly = {
    telegram: {
      getStatus: opts.getStatus,
      createLinkingCode:
        opts.createLinkingCode ??
        (() =>
          Promise.resolve({
            ok: true,
            code: "ABCD1234",
            expiresAt: Date.now() + 15 * 60 * 1000,
            botUsername: "CalmlyBot",
          } as TelegramCreateCodeResult)),
      unlink: opts.unlink ?? (() => Promise.resolve({ ok: true })),
    },
  };
}

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (window as any).calmly;
});

describe("SettingsTelegram", () => {
  it("unlinked: shows the empty state and a Get code button", async () => {
    mockCalmly({ getStatus: () => Promise.resolve({ ok: true, linked: false }) });
    render(<SettingsTelegram />);
    await waitFor(() => expect(screen.getByText("Not linked yet")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Get code" })).toBeTruthy();
  });

  it("linked: shows connected status + linkedAt + unlink control", async () => {
    const linkedAt = new Date("2026-01-15T10:00:00Z").getTime();
    mockCalmly({
      getStatus: () => Promise.resolve({ ok: true, linked: true, chatId: "chat-1", linkedAt }),
    });
    render(<SettingsTelegram />);
    await waitFor(() => expect(screen.getByText("Telegram connected")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Unlink Telegram" })).toBeTruthy();
  });

  it("error: shows PRD-13 style copy and a retry button that re-fetches", async () => {
    const getStatus = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "NetworkError" })
      .mockResolvedValueOnce({ ok: true, linked: false });
    mockCalmly({ getStatus });
    render(<SettingsTelegram />);
    await waitFor(() =>
      expect(screen.getByText(/Couldn't reach Calmly's server/)).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("Not linked yet")).toBeTruthy());
    expect(getStatus).toHaveBeenCalledTimes(2);
  });

  it("Get code: shows the code, deep link (with bot username), and copy affordance", async () => {
    mockCalmly({ getStatus: () => Promise.resolve({ ok: true, linked: false }) });
    render(<SettingsTelegram />);
    await waitFor(() => expect(screen.getByText("Not linked yet")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Get code" }));
    await waitFor(() => expect(screen.getByText("ABCD1234")).toBeTruthy());

    const link = screen.getByRole("link", { name: "Open in Telegram" });
    expect(link.getAttribute("href")).toBe("https://t.me/CalmlyBot?start=ABCD1234");

    fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "https://t.me/CalmlyBot?start=ABCD1234",
      ),
    );
    await waitFor(() => expect(screen.getByText("Copied")).toBeTruthy());
  });

  it("Get code without a bot username falls back to manual /start instructions", async () => {
    mockCalmly({
      getStatus: () => Promise.resolve({ ok: true, linked: false }),
      createLinkingCode: () =>
        Promise.resolve({
          ok: true,
          code: "ZZZZ9999",
          expiresAt: Date.now() + 15 * 60 * 1000,
          botUsername: null,
        }),
    });
    render(<SettingsTelegram />);
    await waitFor(() => expect(screen.getByText("Not linked yet")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Get code" }));
    await waitFor(() => expect(screen.getByText("ZZZZ9999")).toBeTruthy());
    expect(screen.queryByRole("link", { name: "Open in Telegram" })).toBeNull();
    expect(screen.getByText(/Send/).textContent).toContain("/start ZZZZ9999");
  });

  it("polling picks up the Unlinked -> Linked transition", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let linked = false;
    const getStatus = vi.fn(() =>
      Promise.resolve(
        linked
          ? ({ ok: true, linked: true, chatId: "chat-9", linkedAt: Date.now() } as const)
          : ({ ok: true, linked: false } as const),
      ),
    );
    mockCalmly({ getStatus });
    render(<SettingsTelegram />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("Not linked yet")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Get code" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("ABCD1234")).toBeTruthy();

    linked = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    await waitFor(() => expect(screen.getByText("Telegram connected")).toBeTruthy());
  });

  it("stops polling on unmount", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const getStatus = vi.fn(() => Promise.resolve({ ok: true, linked: false } as const));
    mockCalmly({ getStatus });
    const { unmount } = render(<SettingsTelegram />);
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: "Get code" }));
    await act(async () => {
      await Promise.resolve();
    });

    const callsBeforeUnmount = getStatus.mock.calls.length;
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(getStatus.mock.calls.length).toBe(callsBeforeUnmount);
  });

  it("confirm-dialog unlink calls telegram.unlink and returns to the unlinked state", async () => {
    const linkedAt = Date.now();
    const unlink = vi.fn(() => Promise.resolve({ ok: true } as const));
    mockCalmly({
      getStatus: () => Promise.resolve({ ok: true, linked: true, chatId: "chat-1", linkedAt }),
      unlink,
    });
    render(<SettingsTelegram />);
    await waitFor(() => expect(screen.getByText("Telegram connected")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Unlink Telegram" }));
    expect(screen.getByText(/Unlink Telegram\?/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
    await waitFor(() => expect(unlink).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("Not linked yet")).toBeTruthy());
  });

  it("confirm-dialog cancel dismisses without calling unlink", async () => {
    const linkedAt = Date.now();
    const unlink = vi.fn(() => Promise.resolve({ ok: true } as const));
    mockCalmly({
      getStatus: () => Promise.resolve({ ok: true, linked: true, chatId: "chat-1", linkedAt }),
      unlink,
    });
    render(<SettingsTelegram />);
    await waitFor(() => expect(screen.getByText("Telegram connected")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Unlink Telegram" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/Unlink Telegram\?/)).toBeNull();
    expect(unlink).not.toHaveBeenCalled();
  });
});
