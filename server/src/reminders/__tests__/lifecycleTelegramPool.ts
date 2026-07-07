// TGR-12 — in-memory pg.Pool stand-in for lifecycle.integration.test.ts.
// Docker isn't available in this container (see agent-common.md), so this
// suite drives the *real* TelegramChannel / outbound.ts / handleCallbackQuery
// code paths against a hand-rolled fake instead of Postgres — same idea as
// fakeStore.ts (ReminderStore) and fakeActionStore.ts (ReminderActionStore),
// just covering the handful of raw-SQL queries those two fakes don't own:
// telegram_links (linking) and outbound_messages (TGR-03's button substrate),
// plus TelegramChannel's own reminder_rules/tasks reads for message content.
//
// Query dispatch is regex-on-SQL-text, same pattern as outbound.test.ts's
// and channels/__tests__/telegram.test.ts's makeMockPool — kept as a real
// class here (rather than a one-off per test) because this suite reuses the
// same pool across a rule's whole lifecycle (send -> button press -> edit).

export interface FakeRuleContent {
  importance: "important" | "soft";
}

export interface FakeSubtask {
  title: string;
  status: string;
  deletedAt: number | null;
  createdAt: number;
}

interface OutboundRow {
  id: string;
  userId: string;
  chatId: string;
  intent: string;
  payload: { buttons?: { actionId: string; payload?: unknown }[] };
  telegramMessageId: string | null;
  status: "sent" | "blocked" | "failed";
  sentAt: number | null;
  createdAt: number;
}

interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

export class LifecycleTelegramPool {
  readonly linkedUsers = new Map<string, string>(); // userId -> chatId
  readonly rules = new Map<string, FakeRuleContent>();
  readonly tasks = new Map<string, { title: string }>();
  readonly subtasks = new Map<string, FakeSubtask[]>(); // parentTaskId -> subtasks
  readonly outbound = new Map<string, OutboundRow>();

  linkUser(userId: string, chatId: string): void {
    this.linkedUsers.set(userId, chatId);
  }

  setRule(ruleId: string, importance: "important" | "soft"): void {
    this.rules.set(ruleId, { importance });
  }

  setTask(taskId: string, title: string): void {
    this.tasks.set(taskId, { title });
  }

  setNextStep(parentTaskId: string, title: string): void {
    const list = this.subtasks.get(parentTaskId) ?? [];
    list.push({
      title,
      status: "open",
      deletedAt: null,
      createdAt: list.length,
    });
    this.subtasks.set(parentTaskId, list);
  }

  async query(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<QueryResult> {
    if (/FROM telegram_links/.test(sql)) {
      const userId = params[0] as string;
      const chatId = this.linkedUsers.get(userId);
      return chatId
        ? { rows: [{ chat_id: chatId, linked_at: "0" }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }

    if (/INSERT INTO outbound_messages/.test(sql)) {
      const [id, userId, chatId, intent, payloadJson, createdAt] = params as [
        string,
        string,
        string,
        string,
        string,
        number,
      ];
      this.outbound.set(id, {
        id,
        userId,
        chatId,
        intent,
        payload: JSON.parse(payloadJson) as OutboundRow["payload"],
        telegramMessageId: null,
        status: "sent",
        sentAt: null,
        createdAt,
      });
      return { rows: [], rowCount: 1 };
    }

    if (/UPDATE outbound_messages SET telegram_message_id/.test(sql)) {
      const [id, messageId, sentAt] = params as [string, number, number];
      const row = this.outbound.get(id);
      if (row) {
        row.telegramMessageId = String(messageId);
        row.sentAt = sentAt;
        row.status = "sent";
      }
      return { rows: [], rowCount: row ? 1 : 0 };
    }

    if (/UPDATE outbound_messages SET status/.test(sql)) {
      const statusMatch = /status = '(\w+)'/.exec(sql);
      const id = params[0] as string;
      const row = this.outbound.get(id);
      if (row && statusMatch)
        row.status = statusMatch[1] as OutboundRow["status"];
      return { rows: [], rowCount: row ? 1 : 0 };
    }

    if (/SELECT user_id, chat_id, telegram_message_id/.test(sql)) {
      const id = params[0] as string;
      const row = this.outbound.get(id);
      return row
        ? {
            rows: [
              {
                user_id: row.userId,
                chat_id: row.chatId,
                telegram_message_id: row.telegramMessageId,
                intent: row.intent,
              },
            ],
            rowCount: 1,
          }
        : { rows: [], rowCount: 0 };
    }

    if (/UPDATE outbound_messages SET payload/.test(sql)) {
      const [id, payloadJson] = params as [string, string];
      const row = this.outbound.get(id);
      if (row) row.payload = JSON.parse(payloadJson) as OutboundRow["payload"];
      return { rows: [], rowCount: row ? 1 : 0 };
    }

    if (
      /SELECT id, user_id, chat_id, payload FROM outbound_messages/.test(sql)
    ) {
      const id = params[0] as string;
      const row = this.outbound.get(id);
      return row
        ? {
            rows: [
              {
                id: row.id,
                user_id: row.userId,
                chat_id: row.chatId,
                payload: row.payload,
              },
            ],
            rowCount: 1,
          }
        : { rows: [], rowCount: 0 };
    }

    // Checked before the generic `FROM tasks` branch below — same ordering
    // as channels/__tests__/telegram.test.ts's makeMockPool, since this
    // query's FROM clause also matches /FROM tasks/.
    if (/parent_task_id/.test(sql)) {
      const parentId = params[0] as string;
      const subs = (this.subtasks.get(parentId) ?? [])
        .filter(
          (s) =>
            s.deletedAt === null &&
            s.status !== "done" &&
            s.status !== "dropped",
        )
        .sort((a, b) => a.createdAt - b.createdAt);
      return subs.length
        ? { rows: [{ title: subs[0]!.title }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }

    if (/FROM reminder_rules/.test(sql)) {
      const ruleId = params[0] as string;
      const rule = this.rules.get(ruleId);
      return rule
        ? { rows: [{ importance: rule.importance }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }

    if (/FROM tasks/.test(sql)) {
      const taskId = params[0] as string;
      const task = this.tasks.get(taskId);
      return task
        ? { rows: [{ title: task.title }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }

    throw new Error(`LifecycleTelegramPool: no handler for query: ${sql}`);
  }
}
