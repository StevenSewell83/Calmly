import { test, expect } from "@playwright/test";
import { isDockerAvailable, seedUser, type SeededApp } from "../fixtures/seedUser";

// window.calmly is typed globally via desktop/e2e/window-globals.d.ts.

// CL-15b · negative-path mini-specs that pin down what the loop does
// when the user *doesn't* follow the happy path. Sibling to loop.spec.ts;
// reuses the same seedUser fixture so per-test boot cost stays low.
//
// Tests are written to be order-independent: each one acts on a unique
// title and asserts only on rows it created itself. State that leaks
// between tests is benign (the assertions don't depend on table-wide
// counts).
//
// Note on Replan-drop: the original CL-15 description tests dropping
// a task via the Replan modal, but that UI (CL-12) lives on
// ralph/sonnet and has not yet landed on opus. review.drop is the
// existing IPC that performs the same DB mutation (status='dropped'),
// so the third test exercises it directly. A follow-up bead widens
// to the Replan modal once the merge loop brings it across.

const SKIP_TITLE = "skip-this-thought";
const DROP_TITLE = "drop-this-task";

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

    // Bypass the UI's empty-string guard and exercise the IPC directly.
    // The trim should reject before any insert, so the count stays put.
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

    // Snapshot the day's plan before — skip should not change it.
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

    // Capture an item via the always-visible CaptureBar so the user-
    // facing path is exercised, then drive triage skip through the UI.
    const captureInput = page.getByLabel("Capture a thought");
    await captureInput.fill(SKIP_TITLE);
    await captureInput.press("Enter");
    await expect(page.getByText("Added to Inbox")).toBeVisible({
      timeout: 5_000,
    });

    // Wait for the IPC commit (inbox.list reflects the new row) before
    // navigating; the optimistic toast can flash before the row lands.
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

    // Find the row for our specific item (the queue may have other
    // unresolved items from prior tests' fixtures); click Skip.
    // Triage's cursor seats on the newest item by default — ours is
    // newest, so the visible Skip button will skip it.
    await page.getByRole("button", { name: /^Skip/ }).click();

    // The inbox row should be resolved (not in inbox.list). And no
    // task or event should have appeared in plan.listForDay.
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
      expect(
        planAfter.plan.backlog.some((t) => t.title === SKIP_TITLE),
      ).toBe(false);
      expect(
        planAfter.plan.scheduled.some((t) => t.title === SKIP_TITLE),
      ).toBe(false);
    }
  });

  test("review drop: status flips to dropped (not done, not requeued)", async () => {
    const page = seeded!.app.window;

    // Capture + triage a task as Today via IPC. The UI path is covered
    // by loop.spec.ts; here we want the test focused on the drop
    // semantics, so seed via the IPC (still through contextBridge,
    // still validated end-to-end).
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

    // Sanity: task is in today's backlog before the drop.
    const planBefore = await page.evaluate(() =>
      window.calmly.plan.listForDay(),
    );
    expect(planBefore.ok).toBe(true);
    if (planBefore.ok) {
      expect(planBefore.plan.backlog.some((t) => t.id === taskId)).toBe(true);
    }

    // Drop. review.drop sets status='dropped' (NOT 'done', NOT
    // re-scheduled, NOT due_at-cleared). This is the same DB mutation
    // the Replan modal's drop button will fire once CL-12 lands on
    // opus — that's the substitute the bead notes cover.
    const dropResult = await page.evaluate(
      (id) => window.calmly.review.drop({ taskIds: [id] }),
      taskId,
    );
    expect(dropResult.ok).toBe(true);
    if (dropResult.ok) expect(dropResult.updated).toBe(1);

    // Verify the three properties the bead calls out:
    //   1. status='dropped' — falls out of plan.backlog (open|in_progress only)
    //   2. NOT 'done' — must not appear in review.summary completedTasks
    //   3. NOT requeued — must not appear in review.summary unfinishedTasks
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
      expect(
        summary.summary.completedTasks.some((t) => t.id === taskId),
      ).toBe(false);
      expect(
        summary.summary.unfinishedTasks.some((t) => t.id === taskId),
      ).toBe(false);
    }
  });
});
