// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import type { ReminderDefaults } from "../../../../preload/api-types";
import { SettingsReminders } from "../Reminders";

function mockCalmly(initial: ReminderDefaults) {
  let defaults = initial;
  const getDefaults = vi.fn(async () => ({ ok: true as const, defaults }));
  const setDefaults = vi.fn(async (patch: Partial<ReminderDefaults>) => {
    defaults = { ...defaults, ...patch };
    return { ok: true as const };
  });
  (window as any).calmly = { reminders: { getDefaults, setDefaults } };
  return { getDefaults, setDefaults };
}

afterEach(() => {
  cleanup();
  delete (window as any).calmly;
});

describe("SettingsReminders", () => {
  it("loads and shows the current Important/Soft defaults", async () => {
    mockCalmly({ importantIntervalSeconds: 1800, softIntervalSeconds: 10800 });
    render(<SettingsReminders />);
    await waitFor(() => expect(screen.getByText("Important default")).toBeTruthy());
    expect(screen.getByText("Currently 30m.")).toBeTruthy();
    expect(screen.getByText("Currently 3h.")).toBeTruthy();
  });

  it("picking a new Important preset persists via setDefaults and updates the display", async () => {
    const bridge = mockCalmly({ importantIntervalSeconds: 1800, softIntervalSeconds: 10800 });
    render(<SettingsReminders />);
    await waitFor(() => expect(screen.getByText("Important default")).toBeTruthy());

    const importantCard = screen.getByText("Important default").closest("div")!;
    fireEvent.click(
      Array.from(importantCard.querySelectorAll("button")).find((b) => b.textContent === "1h")!,
    );

    await waitFor(() =>
      expect(bridge.setDefaults).toHaveBeenCalledWith({ importantIntervalSeconds: 3600 }),
    );
    await waitFor(() => expect(screen.getByText("Currently 1h.")).toBeTruthy());
  });

  it("shows an error state when defaults fail to load", async () => {
    (window as any).calmly = {
      reminders: { getDefaults: vi.fn(async () => ({ ok: false as const, error: "NotSignedIn" as const })) },
    };
    render(<SettingsReminders />);
    await waitFor(() =>
      expect(screen.getByText("Couldn't load reminder defaults.")).toBeTruthy(),
    );
  });
});
