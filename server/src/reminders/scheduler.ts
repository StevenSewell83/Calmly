// TGR-08 — interval-tick reminder scheduler.
//
// Single-process assumption: there is no distributed lock here. If more
// than one server instance runs this scheduler concurrently, the
// UNIQUE(rule_id, scheduled_for) constraint (see 0013_reminder_deliveries)
// plus the `created` check in store.createDelivery prevent duplicate
// delivery rows, but two instances *can* both attempt-dispatch the same
// already-created pending retry in the same window — channel-level
// idempotency (e.g. dedupe by outbound message content) is out of scope
// for v1. Horizontal scaling of this scheduler needs a lock (advisory
// lock or leader election) added in a follow-up bead.
import { randomUUID } from "node:crypto";
import type { TaskStatus } from "@calmly/shared";
import type { ChannelRouter } from "./router";
import type { ReminderStore } from "./store";
import {
  computeNextFire,
  isDue,
  isDuplicateFire,
  isExhausted,
  isRetryDue,
  isTaskActionable,
  type RuleForScheduling,
} from "./state";

export interface MinimalSchedulerLogger {
  error(obj: unknown, msg?: string): void;
}

export interface SchedulerDeps {
  store: ReminderStore;
  router: ChannelRouter;
  now?: () => number;
  logger?: MinimalSchedulerLogger;
}

export interface TickSummary {
  created: number;
  sent: number;
  failed: number;
  retried: number;
  skippedTaskDone: number;
  skippedNotDue: number;
  skippedDuplicate: number;
}

function emptySummary(): TickSummary {
  return {
    created: 0,
    sent: 0,
    failed: 0,
    retried: 0,
    skippedTaskDone: 0,
    skippedNotDue: 0,
    skippedDuplicate: 0,
  };
}

export class ReminderScheduler {
  private readonly store: ReminderStore;
  private readonly router: ChannelRouter;
  private readonly now: () => number;
  private readonly logger: MinimalSchedulerLogger;
  private currentTick: Promise<TickSummary> | null = null;
  private stopped = false;

  constructor(deps: SchedulerDeps) {
    this.store = deps.store;
    this.router = deps.router;
    this.now = deps.now ?? Date.now;
    this.logger = deps.logger ?? { error: () => {} };
  }

  /** Runs one scheduling pass. A tick already in flight is returned as-is
   * rather than overlapped — see the single-process note above. */
  async tick(): Promise<TickSummary> {
    if (this.stopped) return emptySummary();
    if (this.currentTick) return this.currentTick;
    const run = this.runTick();
    this.currentTick = run;
    try {
      return await run;
    } finally {
      this.currentTick = null;
    }
  }

  /** Stops accepting new ticks and waits for any in-flight tick to finish
   * cleanly — called from the Fastify onClose hook on SIGTERM so a
   * shutdown never leaves a delivery half-attempted. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.currentTick) await this.currentTick.catch(() => {});
  }

  private async runTick(): Promise<TickSummary> {
    const summary = emptySummary();
    const now = this.now();
    await this.processDueRules(now, summary);
    await this.processPendingRetries(now, summary);
    return summary;
  }

  private async processDueRules(
    now: number,
    summary: TickSummary,
  ): Promise<void> {
    const candidates = await this.store.findActiveRuleCandidates();
    for (const c of candidates) {
      const taskStatus = c.taskStatus as TaskStatus;
      if (!isTaskActionable({ status: taskStatus, deletedAt: c.taskDeletedAt })) {
        summary.skippedTaskDone++;
        continue;
      }

      const rule: RuleForScheduling = {
        id: c.ruleId,
        taskId: c.taskId,
        userId: c.userId,
        intervalSeconds: c.intervalSeconds,
        active: true,
        updatedAt: c.ruleUpdatedAt,
      };
      const nextFire = computeNextFire(rule, c.lastDelivery);
      if (!isDue(nextFire, now)) {
        summary.skippedNotDue++;
        continue;
      }
      if (isDuplicateFire(nextFire as number, c.lastDelivery, c.intervalSeconds)) {
        summary.skippedDuplicate++;
        continue;
      }

      const channel = await this.router.pickChannel(c.userId);
      const deliveryId = randomUUID();
      const { created } = await this.store.createDelivery({
        id: deliveryId,
        ruleId: c.ruleId,
        userId: c.userId,
        taskId: c.taskId,
        scheduledFor: nextFire as number,
        channel: channel.name,
        createdAt: now,
      });
      if (!created) {
        summary.skippedDuplicate++;
        continue;
      }
      summary.created++;
      await this.attemptDispatch(
        { id: deliveryId, ruleId: c.ruleId, userId: c.userId, taskId: c.taskId, scheduledFor: nextFire as number },
        0,
        now,
        summary,
      );
    }
  }

  private async processPendingRetries(
    now: number,
    summary: TickSummary,
  ): Promise<void> {
    const retries = await this.store.findPendingRetryCandidates();
    for (const r of retries) {
      if (!isRetryDue(r.attemptCount, r.lastAttemptAt, now)) continue;
      summary.retried++;
      await this.attemptDispatch(r, r.attemptCount, now, summary);
    }
  }

  private async attemptDispatch(
    delivery: {
      id: string;
      ruleId: string;
      userId: string;
      taskId: string;
      scheduledFor: number;
    },
    priorAttempts: number,
    now: number,
    summary: TickSummary,
  ): Promise<void> {
    const attemptCount = priorAttempts + 1;
    let ok: boolean;
    let channel: string;
    let outboundMessageId: string | undefined;
    let error: string | undefined;
    try {
      const result = await this.router.deliver({
        deliveryId: delivery.id,
        ruleId: delivery.ruleId,
        userId: delivery.userId,
        taskId: delivery.taskId,
        scheduledFor: delivery.scheduledFor,
      });
      ok = result.ok;
      channel = result.channel;
      outboundMessageId = result.outboundMessageId;
      error = result.error;
    } catch (err) {
      ok = false;
      channel = "unknown";
      error = err instanceof Error ? err.message : String(err);
    }

    const exhausted = !ok && isExhausted(attemptCount);
    await this.store.recordAttempt(delivery.id, {
      now,
      channel,
      ok,
      attemptCount,
      exhausted,
      error: ok ? null : (error ?? "delivery failed"),
      outboundMessageId: outboundMessageId ?? null,
    });

    if (ok) {
      summary.sent++;
    } else if (exhausted) {
      summary.failed++;
      this.logger.error(
        { deliveryId: delivery.id, ruleId: delivery.ruleId, attemptCount },
        "reminder delivery failed after max attempts",
      );
    }
  }
}
