// TGR-11 test helper — in-memory ReminderActionStore standing in for
// Postgres, backed by the SAME FakeReminderStore instance a test's
// ReminderScheduler uses. That shared backing is what lets
// actions.test.ts's "snooze rescheduling honored by scheduler" case call
// handleSnooze against this adapter and then tick() the scheduler and see
// the follow-up delivery it created.
import type {
  ActionDelivery,
  ActorSurface,
  ReminderActionStore,
  RescheduleTaskResult,
} from "../actionsStore";
import type { CreateDeliveryInput } from "../store";
import type { FakeReminderStore } from "./fakeStore";

export interface FakeTaskDue {
  id: string;
  userId: string;
  dueAt: number | null;
  deletedAt: number | null;
}

export class FakeReminderActionStore implements ReminderActionStore {
  readonly rescheduledTasks = new Map<string, FakeTaskDue>();

  constructor(private readonly db: FakeReminderStore) {}

  addTask(task: FakeTaskDue): void {
    this.rescheduledTasks.set(task.id, task);
  }

  async findForAction(deliveryId: string, userId: string): Promise<ActionDelivery | null> {
    const d = this.db.deliveries.find((x) => x.id === deliveryId && x.userId === userId);
    if (!d) return null;
    const task = this.db.tasks.get(d.taskId);
    return {
      id: d.id,
      ruleId: d.ruleId,
      userId: d.userId,
      taskId: d.taskId,
      channel: d.channel,
      status: d.status,
      taskTitle: task?.title ?? "Reminder",
    };
  }

  async ackDelivery(deliveryId: string, actorSurface: ActorSurface, now: number): Promise<void> {
    const d = this.db.deliveries.find((x) => x.id === deliveryId);
    if (!d) return;
    d.status = "acked";
    d.actedAt = now;
    d.actedVia = actorSurface;
  }

  async snoozeDelivery(deliveryId: string, actorSurface: ActorSurface, now: number): Promise<void> {
    const d = this.db.deliveries.find((x) => x.id === deliveryId);
    if (!d) return;
    d.status = "snoozed";
    d.actedAt = now;
    d.actedVia = actorSurface;
  }

  async deactivateRule(ruleId: string, _now: number): Promise<void> {
    const rule = this.db.rules.get(ruleId);
    if (rule) rule.active = false;
  }

  createFollowupDelivery(input: CreateDeliveryInput) {
    return this.db.createDelivery(input);
  }

  async rescheduleTaskDueDate(
    taskId: string,
    userId: string,
    dueAt: number,
    _now: number,
  ): Promise<RescheduleTaskResult> {
    const task = this.rescheduledTasks.get(taskId);
    if (!task || task.userId !== userId || task.deletedAt !== null) return { ok: false };
    task.dueAt = dueAt;
    return { ok: true };
  }
}
