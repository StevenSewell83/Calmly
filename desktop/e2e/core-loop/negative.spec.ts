import { test, expect } from "@playwright/test";
import {
  isDockerAvailable,
  seedUser,
  type SeededApp,
} from "../fixtures/seedUser";

// window.calmly is typed globally via desktop/e2e/window-globals.d.ts.

// CL-15b · negative-path mini-specs that pin down what the loop does
// when the user *doesn't* follow the happy path. Sibling to loop.spec.ts;
// reuses the same seedUser fixture so per-test boot cost stays low.

const SKIP_TITLE = "skip-this-thought";
const DROP_TITLE = "drop-this-task";
const REPLAN_DROP_TITLE = "replan-modal-drop-task";

test.describe("CL-15b · core-loop negative paths", () => {
  test.describe.configure({ timeout: 180_000 });

  let seeded: SeededApp | null = null;
  let dockerAvailable = false;

  test.beforeAll(async () => {
    dockerAvailable = await isDockerAvailable();
    if (!dockerAvailable) return;
    seeded = await seedUser({ email: `negative-${Date.now()}@calmly.test` });
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

  test("capture: whitespace-only IPC call returns EmptyInput and creates no row", async () => {
    const page = seeded!.app.window;

    const before = await page.evaluate(() => window.calmly.inbox.list());
    expect(before.ok).toBe(true);
    const beforeCount = before.ok ? before.items.length : -1;

    const r = await page.evaluate(() => window.calmly.inbox.add("   \t  "));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("EmptyInput");

    const after = await page.evaluate(() => window.calmly.inbox.list());
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.items.length).toBe(beforeCount);
    }
  });

  test("triage skip: item resolves without creating a task or event", async () => {
    const page = seeded!.app.window;

    const planBefore = await page.evaluate(() =>
      window.calmly.plan.listForDay(),
    );
    expect(planBefore.ok).toBe(true);
    const beforeBacklogCount = planBefore.ok
      ? planBefore.plan.backlog.length
      : -1;
    const beforeScheduledCount = planBefore.ok
      ? planBefore.plan.scheduled.length
      : -1;

    const captureInput = page.getByLabel("Capture a thought");
    await captureInput.fill(SKIP_TITLE);
    await captureInput.press("Enter");
    await expect(page.getByText("Added to Inbox")).toBeVisible({
      timeout: 5_000,
    });

    await expect
      .poll(
        async () => {
          const r = await page.evaluate(() => window.calmly.inbox.list());
          return r.ok ? r.items.some((i) => i.raw_text === SKIP_TITLE) : false;
        },
        { timeout: 5_000 },
      )
      .toBe(true);

    const sidebar = page.getByRole("navigation", { name: "Primary" });
    await sidebar.getByRole("link", { name: /^Inbox/ }).click();
    await page.getByRole("link", { name: /Triage all/ }).click();

    await expect(
      page.getByRole("heading", { name: "Triage.", level: 1 }),
    ).toBeVisible();

    await page.getByRole("button", { name: /^Skip/ }).click();

    await expect
      .poll(
        async () => {
          const r = await page.evaluate(() => window.calmly.inbox.list());
          return r.ok ? r.items.some((i) => i.raw_text === SKIP_TITLE) : true;
        },
        { timeout: 5_000 },
      )
      .toBe(false);

    const planAfter = await page.evaluate(() =>
      window.calmly.plan.listForDay(),
    );
    expect(planAfter.ok).toBe(true);
    if (planAfter.ok) {
      expect(planAfter.plan.backlog.length).toBe(beforeBacklogCount);
      expect(planAfter.plan.scheduled.length).toBe(beforeScheduledCount);
    }
  });

  test("review drop: status flips to dropped (not done, not requeued)", async () => {
    const page = seeded!.app.window;

    const inboxId = await page.evaluate(async (text) => {
      const r = await window.calmly.inbox.add(text);
      if (!r.ok) throw new Error(`inbox.add failed: ${r.error}`);
      return r.id;
    }, DROP_TITLE);

    const endOfDay = (() => {
      const d = new Date();
      d.setHours(23, 59, 59, 999);
      return d.getTime();
    })();
    const taskId = await page.evaluate(
      async ({ id, title, dueAt }) => {
        const r = await window.calmly.triage.resolveAsTask({
          inboxId: id,
          title,
          dueAt,
        });
        if (!r.ok) throw new Error(`triage failed: ${r.error}`);
        return r.id;
      },
      { id: inboxId, title: DROP_TITLE, dueAt: endOfDay },
    );

    const dropResult = await page.evaluate(
      (id) => window.calmly.review.drop([id]),
      taskId,
    );
    expect(dropResult.ok).toBe(true);
    if (dropResult.ok) expect(dropResult.count).toBe(1);

    const planAfter = await page.evaluate(() =>
      window.calmly.plan.listForDay(),
    );
    expect(planAfter.ok).toBe(true);
    if (planAfter.ok) {
      expect(planAfter.plan.backlog.some((t) => t.id === taskId)).toBe(false);
      expect(planAfter.plan.scheduled.some((t) => t.id === taskId)).toBe(false);
    }

    const summary = await page.evaluate(() => window.calmly.review.summary());
    expect(summary.ok).toBe(true);
    if (summary.ok) {
      expect(summary.summary.completed.some((t) => t.id === taskId)).toBe(
        false,
      );
      expect(summary.summary.unfinished.some((t) => t.id === taskId)).toBe(
        false,
      );
    }
  });

  test("Replan modal drop: selected scheduled task moves to Backlog (status dropped)", async () => {
    const page = seeded!.app.window;

    // Seed a task via IPC: inbox → triage → schedule so it shows in Replan.
    const inboxId = await page.evaluate(async (text) => {
      const r = await window.calmly.inbox.add(text);
      if (!r.ok) throw new Error(`inbox.add failed: ${r.error}`);
      return r.id;
    }, REPLAN_DROP_TITLE);

    const todayMidnight = (() => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    })();
    const startAt = todayMidnight + 14 * 60 * 60_000; // 2pm
    const endAt = startAt + 60 * 60_000; // 3pm

    const taskId = await page.evaluate(
      async ({ id, title, dueAt }) => {
        const r = await window.calmly.triage.resolveAsTask({
          inboxId: id,
          title,
          dueAt,
        });
        if (!r.ok) throw new Error(`triage failed: ${r.error}`);
        return r.id;
      },
      { id: inboxId, title: REPLAN_DROP_TITLE, dueAt: startAt },
    );

    // Schedule the task so it appears in the Replan modal's scheduled list.
    const schedResult = await page.evaluate(
      ([id, s, e]) =>
        window.calmly.plan.schedule({ taskId: id, startAt: s, endAt: e }),
      [taskId, startAt, endAt] as [string, number, number],
    );
    expect(schedResult.ok).toBe(true);

    // Verify the task appears in plan.scheduled before opening Replan.
    const planBefore = await page.evaluate(() =>
      window.calmly.plan.listForDay(),
    );
    expect(planBefore.ok).toBe(true);
    if (planBefore.ok) {
      expect(planBefore.plan.scheduled.some((t) => t.id === taskId)).toBe(true);
    }

    // Navigate to Home and open the Replan modal.
    await page.getByRole("link", { name: /Home/i }).click();
    await expect(page.getByText(/Peace,/)).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Replan" }).click();

    const modal = page.getByRole("dialog", { name: "Replan" });
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Select the task via its checkbox.
    await modal
      .getByRole("checkbox", { name: `Select ${REPLAN_DROP_TITLE}` })
      .click();
    await expect(modal.getByText("1 selected")).toBeVisible({ timeout: 3_000 });

    // Click "→ Backlog" (the multi-select drop button).
    await modal.getByRole("button", { name: "→ Backlog" }).click();

    // Modal should close the selection bar (0 selected); task leaves scheduled.
    await expect(modal.getByText("1 selected")).not.toBeVisible({
      timeout: 5_000,
    });

    // Verify via IPC: task is no longer in plan.scheduled.
    const planAfter = await page.evaluate(() =>
      window.calmly.plan.listForDay(),
    );
    expect(planAfter.ok).toBe(true);
    if (planAfter.ok) {
      expect(planAfter.plan.scheduled.some((t) => t.id === taskId)).toBe(false);
    }

    // Verify via review.summary: not done, not requeued as unfinished.
    const summary = await page.evaluate(() => window.calmly.review.summary());
    expect(summary.ok).toBe(true);
    if (summary.ok) {
      expect(summary.summary.completed.some((t) => t.id === taskId)).toBe(
        false,
      );
      expect(summary.summary.unfinished.some((t) => t.id === taskId)).toBe(
        false,
      );
    }

    // Close the modal.
    await modal.getByRole("button", { name: "Done — replanned" }).click();
    await expect(modal).not.toBeVisible({ timeout: 3_000 });
  });
});
