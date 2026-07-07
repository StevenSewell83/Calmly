// TGR-08 — pure next-fire / retry math for the reminder scheduler. No I/O:
// scheduler.ts (impure — queries pg, dispatches channels) is the only
// caller, kept separate so the tricky edge cases (dedupe, task-done skip,
// backoff) are unit-testable without a database or fake timers.
//
// PREVENT-2 note: this file's TaskStatus literals ("done"/"dropped") are a
// typed-surface exception, same as desktop/src/main/*/store.ts — see the
// eslint.config.mjs override list.

import type { TaskStatus } from "@calmly/shared";

export type DeliveryStatus =
  | "pending"
  | "sent"
  | "failed"
  | "skipped"
  | "acked"
  | "snoozed";

// A task in either of these statuses (or soft-deleted) no longer gets
// reminders — "stops when the task is done" from the TGR-08 spec.
const DONE_STATUS: TaskStatus = "done";
const DROPPED_STATUS: TaskStatus = "dropped";
const TERMINAL_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set([
  DONE_STATUS,
  DROPPED_STATUS,
]);

export interface TaskGate {
  status: TaskStatus;
  deletedAt: number | null;
}

export function isTaskActionable(task: TaskGate): boolean {
  if (task.deletedAt !== null) return false;
  return !TERMINAL_TASK_STATUSES.has(task.status);
}

export interface RuleForScheduling {
  id: string;
  taskId: string;
  userId: string;
  intervalSeconds: number;
  active: boolean;
  // reminder_rules has no start_at/last_fired_at (see desktop/src/main/
  // reminders/store.ts) — the sync trio's `updated_at` is the best proxy
  // for "when this rule was (re)activated" that the synced schema offers.
  updatedAt: number;
}

export interface LastDeliverySnapshot {
  scheduledFor: number;
  status: DeliveryStatus;
}

/** Next scheduled fire time (epoch ms), or null if the rule shouldn't fire. */
export function computeNextFire(
  rule: RuleForScheduling,
  lastDelivery: LastDeliverySnapshot | null,
): number | null {
  if (!rule.active) return null;
  const intervalMs = rule.intervalSeconds * 1000;
  if (!lastDelivery) return rule.updatedAt + intervalMs;
  return lastDelivery.scheduledFor + intervalMs;
}

export function isDue(nextFire: number | null, now: number): boolean {
  return nextFire !== null && nextFire <= now;
}

const DEDUPE_DIVISOR = 2;

export function dedupeWindowMs(intervalSeconds: number): number {
  return Math.floor((intervalSeconds * 1000) / DEDUPE_DIVISOR);
}

// Extra guard alongside the DB's UNIQUE(rule_id, scheduled_for): true when
// `candidate` falls within the dedupe window of a delivery already on
// record for this rule, i.e. a second (overlapping) tick computed against
// stale state shouldn't create another row for (approximately) the same
// slot.
export function isDuplicateFire(
  candidate: number,
  lastDelivery: LastDeliverySnapshot | null,
  intervalSeconds: number,
): boolean {
  if (!lastDelivery) return false;
  return (
    Math.abs(candidate - lastDelivery.scheduledFor) <
    dedupeWindowMs(intervalSeconds)
  );
}

// 1m / 5m / 15m backoff, then give up — matches the TGR-08 spec's "retry
// ≤3 with 1m/5m/15m backoff then failed".
export const RETRY_BACKOFF_MS: readonly number[] = [
  60_000,
  5 * 60_000,
  15 * 60_000,
];
export const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length;

export function isExhausted(attemptCount: number): boolean {
  return attemptCount >= MAX_ATTEMPTS;
}

// True when a pending delivery that has already been attempted at least
// once (attemptCount > 0, not yet exhausted) is due for its next retry.
// `lastAttemptAt` is the delivery's fired_at (see 0013_reminder_deliveries
// header — it records the most recent attempt, success or failure).
export function isRetryDue(
  attemptCount: number,
  lastAttemptAt: number,
  now: number,
): boolean {
  if (attemptCount <= 0 || isExhausted(attemptCount)) return false;
  const delay = RETRY_BACKOFF_MS[attemptCount - 1] ?? 0;
  return now >= lastAttemptAt + delay;
}
