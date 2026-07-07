// TGR-08 test helper — in-memory ReminderStore standing in for Postgres.
// Docker isn't available in this container (see agent-common.md), so
// scheduler.test.ts exercises the orchestration logic against this fake
// instead of a real pg.Pool; the real pgReminderStore is only exercised
// by the docker-gated integration test.
import type {
  CancelResult,
  CreateDeliveryInput,
  DueRuleCandidate,
  PendingRetryCandidate,
  RecordAttemptInput,
  ReminderStore,
} from "../store";
import type { DeliveryStatus } from "../state";

export interface FakeRule {
  id: string;
  taskId: string;
  userId: string;
  intervalSeconds: number;
  active: boolean;
  updatedAt: number;
  deletedAt: number | null;
}

export interface FakeTask {
  id: string;
  status: string;
  deletedAt: number | null;
}

export interface FakeDelivery {
  id: string;
  ruleId: string;
  userId: string;
  taskId: string;
  scheduledFor: number;
  channel: string;
  status: DeliveryStatus;
  attemptCount: number;
  firedAt: number | null;
  lastError: string | null;
  outboundMessageId: string | null;
  createdAt: number;
}

export class FakeReminderStore implements ReminderStore {
  readonly rules = new Map<string, FakeRule>();
  readonly tasks = new Map<string, FakeTask>();
  readonly deliveries: FakeDelivery[] = [];

  addRule(rule: FakeRule): void {
    this.rules.set(rule.id, rule);
  }

  addTask(task: FakeTask): void {
    this.tasks.set(task.id, task);
  }

  async findActiveRuleCandidates(): Promise<DueRuleCandidate[]> {
    const out: DueRuleCandidate[] = [];
    for (const rule of this.rules.values()) {
      if (!rule.active || rule.deletedAt !== null) continue;
      const task = this.tasks.get(rule.taskId);
      if (!task) continue;
      const last = this.lastDeliveryFor(rule.id);
      out.push({
        ruleId: rule.id,
        taskId: rule.taskId,
        userId: rule.userId,
        intervalSeconds: rule.intervalSeconds,
        ruleUpdatedAt: rule.updatedAt,
        taskStatus: task.status,
        taskDeletedAt: task.deletedAt,
        lastDelivery: last ? { scheduledFor: last.scheduledFor, status: last.status } : null,
      });
    }
    return out;
  }

  async findPendingRetryCandidates(): Promise<PendingRetryCandidate[]> {
    return this.deliveries
      .filter((d) => d.status === "pending" && d.attemptCount > 0)
      .map((d) => ({
        id: d.id,
        ruleId: d.ruleId,
        userId: d.userId,
        taskId: d.taskId,
        scheduledFor: d.scheduledFor,
        attemptCount: d.attemptCount,
        lastAttemptAt: d.firedAt ?? 0,
      }));
  }

  async createDelivery(input: CreateDeliveryInput): Promise<{ created: boolean }> {
    // Mirrors the real store's ON CONFLICT(rule_id, scheduled_for) DO
    // NOTHING: the check-and-insert is atomic here, same guarantee the
    // real unique index gives under Postgres.
    const exists = this.deliveries.some(
      (d) => d.ruleId === input.ruleId && d.scheduledFor === input.scheduledFor,
    );
    if (exists) return { created: false };
    this.deliveries.push({
      id: input.id,
      ruleId: input.ruleId,
      userId: input.userId,
      taskId: input.taskId,
      scheduledFor: input.scheduledFor,
      channel: input.channel,
      status: "pending",
      attemptCount: 0,
      firedAt: null,
      lastError: null,
      outboundMessageId: null,
      createdAt: input.createdAt,
    });
    return { created: true };
  }

  async recordAttempt(deliveryId: string, input: RecordAttemptInput): Promise<void> {
    const d = this.deliveries.find((x) => x.id === deliveryId);
    if (!d) return;
    d.status = input.ok ? "sent" : input.exhausted ? "failed" : "pending";
    d.attemptCount = input.attemptCount;
    d.firedAt = input.now;
    d.channel = input.channel;
    d.lastError = input.error ?? null;
    d.outboundMessageId = input.outboundMessageId ?? null;
  }

  async cancel(deliveryId: string, userId: string): Promise<CancelResult> {
    const d = this.deliveries.find((x) => x.id === deliveryId && x.userId === userId);
    if (!d) return { ok: false, reason: "not_found" };
    if (d.status !== "pending") return { ok: false, reason: "already_terminal" };
    d.status = "skipped";
    return { ok: true };
  }

  private lastDeliveryFor(ruleId: string): FakeDelivery | undefined {
    return this.deliveries
      .filter((d) => d.ruleId === ruleId)
      .sort((a, b) => b.scheduledFor - a.scheduledFor)[0];
  }
}
