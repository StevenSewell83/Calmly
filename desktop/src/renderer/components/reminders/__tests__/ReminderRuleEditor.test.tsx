// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import type {
  ReminderDefaults,
  ReminderRuleItem,
  RemindersUpsertArgs,
} from "../../../../preload/api-types";
import { ReminderRuleEditor } from "../ReminderRuleEditor";

const DEFAULTS: ReminderDefaults = {
  importantIntervalSeconds: 1800,
  softIntervalSeconds: 10800,
};

// Minimal in-memory fake of the reminders bridge — upsert/delete mutate a
// local `rule` so refresh() (called after every mutation) sees the latest
// state, same as the real IPC round trip would produce.
function mockRemindersBridge(initialRule: ReminderRuleItem | null) {
  let rule = initialRule;
  const get = vi.fn(async () => ({ ok: true as const, rule }));
  const upsert = vi.fn(async (args: RemindersUpsertArgs) => {
    rule = {
      id: rule?.id ?? "r-1",
      task_id: args.taskId,
      importance: args.importance,
      interval_seconds: args.intervalSeconds,
      escalation_json: args.escalationJson,
      active: args.active ? 1 : 0,
      version: (rule?.version ?? -1) + 1,
    };
    return { ok: true as const, id: rule.id };
  });
  const del = vi.fn(async () => {
    rule = null;
    return { ok: true as const };
  });
  const getDefaults = vi.fn(async () => ({ ok: true as const, defaults: DEFAULTS }));
  (window as any).calmly = {
    reminders: { get, upsert, delete: del, getDefaults },
  };
  return { get, upsert, delete: del, getDefaults };
}

afterEach(() => {
  cleanup();
  delete (window as any).calmly;
});

describe("ReminderRuleEditor", () => {
  it("shows a loading skeleton before the rule resolves", () => {
    const bridge = mockRemindersBridge(null);
    bridge.get.mockImplementationOnce(() => new Promise(() => {})); // never resolves
    render(<ReminderRuleEditor taskId="t1" />);
    expect(screen.getByRole("status", { name: "Loading reminder" })).toBeTruthy();
  });

  it("create: shows 'Add a reminder' with no rule, and creates one from profile defaults", async () => {
    const bridge = mockRemindersBridge(null);
    render(<ReminderRuleEditor taskId="t1" />);
    await waitFor(() => expect(screen.getByRole("button", { name: /add a reminder/i })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /add a reminder/i }));

    await waitFor(() =>
      expect(bridge.upsert).toHaveBeenCalledWith({
        taskId: "t1",
        importance: "soft",
        intervalSeconds: DEFAULTS.softIntervalSeconds,
        escalationJson: "{}",
        active: true,
      }),
    );
    await waitFor(() => expect(screen.getByText(/repeats every/i)).toBeTruthy());
  });

  it("edit: switching importance persists via upsert and keeps the interval", async () => {
    const rule: ReminderRuleItem = {
      id: "r-1",
      task_id: "t1",
      importance: "soft",
      interval_seconds: 3600,
      escalation_json: "{}",
      active: 1,
      version: 0,
    };
    const bridge = mockRemindersBridge(rule);
    render(<ReminderRuleEditor taskId="t1" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Important" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Important" }));

    await waitFor(() =>
      expect(bridge.upsert).toHaveBeenCalledWith({
        taskId: "t1",
        importance: "important",
        intervalSeconds: 3600,
        escalationJson: "{}",
        active: true,
      }),
    );
  });

  it("edit: clicking an interval preset persists the new interval", async () => {
    const rule: ReminderRuleItem = {
      id: "r-1",
      task_id: "t1",
      importance: "important",
      interval_seconds: 1800,
      escalation_json: "{}",
      active: 1,
      version: 0,
    };
    const bridge = mockRemindersBridge(rule);
    render(<ReminderRuleEditor taskId="t1" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "1h" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "1h" }));

    await waitFor(() =>
      expect(bridge.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ intervalSeconds: 3600 }),
      ),
    );
  });

  it("deactivate: toggling the switch off persists active=false and shows the off copy", async () => {
    const rule: ReminderRuleItem = {
      id: "r-1",
      task_id: "t1",
      importance: "soft",
      interval_seconds: 3600,
      escalation_json: "{}",
      active: 1,
      version: 0,
    };
    const bridge = mockRemindersBridge(rule);
    render(<ReminderRuleEditor taskId="t1" />);
    await waitFor(() => expect(screen.getByRole("switch")).toBeTruthy());
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByRole("switch"));

    await waitFor(() =>
      expect(bridge.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ active: false }),
      ),
    );
    await waitFor(() => expect(screen.getByText(/— off/)).toBeTruthy());
  });

  it("remove: deletes the rule and returns to the 'Add a reminder' state", async () => {
    const rule: ReminderRuleItem = {
      id: "r-1",
      task_id: "t1",
      importance: "soft",
      interval_seconds: 3600,
      escalation_json: "{}",
      active: 1,
      version: 0,
    };
    const bridge = mockRemindersBridge(rule);
    render(<ReminderRuleEditor taskId="t1" />);
    await waitFor(() => expect(screen.getByRole("button", { name: /remove reminder/i })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /remove reminder/i }));

    await waitFor(() => expect(bridge.delete).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: /add a reminder/i })).toBeTruthy());
  });

  it("interval floor: a custom value under 5 minutes shows friendly copy and does not persist", async () => {
    const rule: ReminderRuleItem = {
      id: "r-1",
      task_id: "t1",
      importance: "soft",
      interval_seconds: 3600,
      escalation_json: "{}",
      active: 1,
      version: 0,
    };
    const bridge = mockRemindersBridge(rule);
    render(<ReminderRuleEditor taskId="t1" />);
    await waitFor(() => expect(screen.getByPlaceholderText("Custom (min)")).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText("Custom (min)"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Set" }));

    expect(
      await screen.findByText("Reminders can't repeat more often than 5 minutes."),
    ).toBeTruthy();
    expect(bridge.upsert).not.toHaveBeenCalled();
  });

  it("interval floor: a valid custom value (in minutes) persists as seconds", async () => {
    const rule: ReminderRuleItem = {
      id: "r-1",
      task_id: "t1",
      importance: "soft",
      interval_seconds: 3600,
      escalation_json: "{}",
      active: 1,
      version: 0,
    };
    const bridge = mockRemindersBridge(rule);
    render(<ReminderRuleEditor taskId="t1" />);
    await waitFor(() => expect(screen.getByPlaceholderText("Custom (min)")).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText("Custom (min)"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Set" }));

    await waitFor(() =>
      expect(bridge.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ intervalSeconds: 600 }),
      ),
    );
  });
});
