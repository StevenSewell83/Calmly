import { test, expect } from "@playwright/test";
import { isDockerAvailable, seedUser, type SeededApp } from "../fixtures/seedUser";

// window.calmly is typed globally via desktop/e2e/window-globals.d.ts.

// CL-15a happy-path: walk the deterministic core loop end-to-end with
// no AI / Telegram / calendar / reminders involved. Each step uses a
// real UI affordance where it's stable and an IPC where the UI is
// flaky to drive (drag/drop, global hotkey).
//
// Sequence: Capture two items → triage both as Today tasks → schedule
// the first at 14:00 → start focus on it → mark it done → land on
// Review and assert 1 completed + 1 unfinished, save reflection,
// complete shutdown.
//
// Note on omissions vs the original CL-15 description:
//   - Replan-from-Focus is not yet on this branch (CL-12 lives on
//     ralph/sonnet); covered by a follow-up bead once the UI lands.
//   - Drag-from-backlog uses plan.schedule IPC instead of dnd-kit
//     pointer drag. Pointer drag against dnd-kit is too flaky in
//     Electron for a gating spec; the IPC is what the dnd-kit
//     onDragEnd handler ultimately calls anyway.
//   - Global capture hotkey (CmdOrCtrl+Shift+I) registers via
//     Electron's globalShortcut, which Playwright can't synthesize
//     across the OS event bus. The CaptureBar input is always
//     visible in AppShell and accepts the same IPC, so we drive it
//     directly.

const TASK_DONE = "buy birthday card";
const TASK_LEFT = "schedule dentist";

test.describe("CL-15a · core-loop happy path", () => {
  test.describe.configure({ timeout: 180_000 });

  let seeded: SeededApp | null = null;
  let dockerAvailable = false;

  test.beforeAll(async () => {
    dockerAvailable = await isDockerAvailable();
    if (!dockerAvailable) return;
    seeded = await seedUser({ email: `core-loop-${Date.now()}@calmly.test` });
  });

  test.afterAll(async () => {
    if (seeded) await seeded.dispose();
    seeded = null;
  });

  test.beforeEach(() => {
    test.skip(
      !dockerAvailable,
      "Docker daemon not reachable — skipping testcontainers fixture",
    );
  });

  test("Capture → Inbox → Triage → Plan → Focus → Review", async () => {
    const { app } = seeded!;
    const page = app.window;

    // 1. CAPTURE — type two items into the always-visible CaptureBar.
    const captureInput = page.getByLabel("Capture a thought");
    await expect(captureInput).toBeVisible();

    await captureInput.fill(TASK_DONE);
    await captureInput.press("Enter");
    await expect(page.getByText("Added to Inbox")).toBeVisible({
      timeout: 5_000,
    });
    // The optimistic clear leaves the input empty before we type the
    // second item; without this wait the next fill() can race against
    // the still-mounted "Added to Inbox" toast and leak text.
    await expect(captureInput).toHaveValue("");

    await captureInput.fill(TASK_LEFT);
    await captureInput.press("Enter");
    await expect(page.getByText("Added to Inbox")).toBeVisible({
      timeout: 5_000,
    });
    await expect(captureInput).toHaveValue("");

    // 2. INBOX — the sidebar nav uses NavLink + the visible label.
    // Scope to aria-label="Primary" so we don't snag a CTA by mistake.
    const sidebar = page.getByRole("navigation", { name: "Primary" });
    await sidebar.getByRole("link", { name: /^Inbox/ }).click();

    await expect(
      page.getByRole("heading", { name: "Inbox.", level: 1 }),
    ).toBeVisible();
    // Both captured items render as InboxRow children of the listbox.
    const inboxList = page.getByRole("listbox", { name: "Inbox items" });
    await expect(inboxList.getByText(TASK_DONE)).toBeVisible();
    await expect(inboxList.getByText(TASK_LEFT)).toBeVisible();

    // 3. TRIAGE — "Triage all" walks the focused-mode queue.
    await page.getByRole("link", { name: /Triage all/ }).click();
    await expect(
      page.getByRole("heading", { name: "Triage.", level: 1 }),
    ).toBeVisible();

    // Triage classifies as task by default and the title input is
    // pre-filled from raw_text; clicking "Today" sets dateChoice and
    // submits in one go (see TriageActionBar.tsx).
    //
    // Two items in the queue: each click advances the cursor.
    for (let i = 0; i < 2; i++) {
      // The Today / This Week / Later buttons live inside the action
      // bar; the icon lives outside the accessible name so the role
      // matcher uses the visible label.
      const todayBtn = page.getByRole("button", { name: "Today" });
      await expect(todayBtn).toBeEnabled();
      await todayBtn.click();
    }

    // Inbox clear celebration confirms the queue drained.
    await expect(
      page.getByRole("heading", { name: "Inbox clear.", level: 2 }),
    ).toBeVisible({ timeout: 10_000 });

    // 4. PLAN — both tasks are now in the backlog (due_at=today,
    // scheduled_start=null). Schedule the first one at 14:00 today.
    await sidebar.getByRole("link", { name: /^Plan/ }).click();
    await expect(
      page.getByRole("heading", { name: /Today\./, level: 1 }),
    ).toBeVisible();

    // Backlog renders both items. Pull the target task id off the
    // PlanForDay snapshot so the schedule IPC has a deterministic
    // handle (the renderer doesn't expose ids on the rendered DOM).
    const targetId = await page.evaluate(async (title) => {
      const r = await window.calmly.plan.listForDay();
      if (!r.ok) return null;
      return r.plan.backlog.find((t) => t.title === title)?.id ?? null;
    }, TASK_DONE);
    expect(targetId).not.toBeNull();

    // Today at 14:00 → 14:30. Use a noon-anchored Date to dodge DST
    // edge cases where the boundary crosses 02:00.
    const today2pm = (() => {
      const d = new Date();
      d.setHours(14, 0, 0, 0);
      return d.getTime();
    })();
    const scheduleResult = await page.evaluate(
      async ({ id, start, end }) =>
        await window.calmly.plan.schedule({
          taskId: id,
          startAt: start,
          endAt: end,
        }),
      { id: targetId!, start: today2pm, end: today2pm + 30 * 60_000 },
    );
    expect(scheduleResult.ok).toBe(true);

    // 5. FOCUS — the scheduled task surfaces in the Chooser. Click it
    // to start the session, then mark done.
    await sidebar.getByRole("link", { name: /^Focus/ }).click();
    await expect(
      page.getByRole("heading", { name: "Pick one thing.", level: 1 }),
    ).toBeVisible();

    await page
      .getByRole("button", { name: new RegExp(`^${TASK_DONE}`, "i") })
      .first()
      .click();

    // ActiveSession renders the task title as the page h1.
    await expect(
      page.getByRole("heading", { name: TASK_DONE, level: 1 }),
    ).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Mark done" }).click();

    // Session ends → Chooser re-renders. The done task drops out of
    // both columns; the Backlog now only has TASK_LEFT.
    await expect(
      page.getByRole("heading", { name: "Pick one thing.", level: 1 }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole("button", { name: new RegExp(`^${TASK_LEFT}`, "i") }),
    ).toBeVisible();

    // 6. REVIEW — assert 1 completed + 1 unfinished, save reflection,
    // complete shutdown.
    await sidebar.getByRole("link", { name: /^Review/ }).click();
    await expect(
      page.getByRole("heading", { name: /Day.s end\./, level: 1 }),
    ).toBeVisible();

    await expect(page.getByText(/You completed 1 thing today\./)).toBeVisible({
      timeout: 10_000,
    });
    const completedList = page.getByRole("list", { name: "Completed tasks" });
    await expect(completedList.getByText(TASK_DONE)).toBeVisible();

    const unfinishedList = page.getByRole("listbox", {
      name: "Unfinished tasks",
    });
    await expect(unfinishedList.getByText(TASK_LEFT)).toBeVisible();

    await page.getByLabel("Reflection").fill("long day");

    await page.getByRole("button", { name: /Complete shutdown/ }).click();

    // CompleteShutdown navigates back to Home on success.
    await expect(page.getByText("Peace, friend.")).toBeVisible({
      timeout: 10_000,
    });

    // 7. PERSISTENCE TAIL — round-trip through review.summary to
    // confirm the reflection committed and last_shutdown_date got
    // stamped. Catches the case where the UI nav fired but the
    // single-tx completeShutdown silently failed.
    const summary = await page.evaluate(
      async () => await window.calmly.review.summary(),
    );
    expect(summary.ok).toBe(true);
    if (summary.ok) {
      expect(summary.summary.reflection?.text).toBe("long day");
      expect(summary.summary.lastShutdownDate).toBe(summary.summary.date);
    }
  });
});
