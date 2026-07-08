import { randomUUID } from "node:crypto";
import {
  currentFocus,
  endFocus,
  markDoneFromFocus,
  startFocus,
  switchFocus,
  searchOpenTasks,
  startAdHocFocus,
  type EndFocusResult,
  type FocusSessionRow,
  type MarkDoneResult,
  type StartFocusResult,
  type SwitchFocusResult,
  type StartAdHocResult,
  type OpenTaskItem,
} from "../focus/store";
import { authedHandler, isObject, isStringId } from "./handler";

export type FocusCurrentResult =
  | { ok: true; session: FocusSessionRow | null }
  | { ok: false; error: "NotSignedIn" };

export type FocusStartResult =
  | StartFocusResult
  | { ok: false; error: "NotSignedIn" };

export type FocusEndResult =
  | EndFocusResult
  | { ok: false; error: "NotSignedIn" };

export type FocusMarkDoneResult =
  | MarkDoneResult
  | { ok: false; error: "NotSignedIn" };

export type FocusSwitchResult =
  | SwitchFocusResult
  | { ok: false; error: "NotSignedIn" };

export type FocusSearchResult =
  | { ok: true; tasks: OpenTaskItem[] }
  | { ok: false; error: "NotSignedIn" };

export type FocusStartAdHocResult =
  | StartAdHocResult
  | { ok: false; error: "NotSignedIn" };

function isFocusSource(v: unknown): v is "scheduled" | "ad-hoc" {
  return v === "scheduled" || v === "ad-hoc";
}

export function registerFocusIpc(): void {
  authedHandler<FocusCurrentResult>("focus:current", (ctx) => ({
    ok: true,
    session: currentFocus(ctx.db, ctx.userId),
  }));

  authedHandler<FocusStartResult>("focus:start", (ctx, raw) => {
    if (
      !isObject(raw) ||
      !isStringId(raw.taskId) ||
      !isFocusSource(raw.source)
    ) {
      return { ok: false, error: "InvalidArgs" };
    }
    return startFocus(ctx.db, ctx.userId, raw.taskId, raw.source, ctx.now);
  });

  authedHandler<FocusEndResult>("focus:end", (ctx) =>
    endFocus(ctx.db, ctx.userId, ctx.now),
  );

  authedHandler<FocusMarkDoneResult>("focus:markDone", (ctx) =>
    markDoneFromFocus(ctx.db, ctx.userId, ctx.now),
  );

  authedHandler<FocusSwitchResult>("focus:switch", (ctx, raw) => {
    if (
      !isObject(raw) ||
      !isStringId(raw.taskId) ||
      !isFocusSource(raw.source)
    ) {
      return { ok: false, error: "InvalidArgs" };
    }
    return switchFocus(ctx.db, ctx.userId, raw.taskId, raw.source, ctx.now);
  });

  authedHandler<FocusSearchResult>("focus:searchOpenTasks", (ctx, raw) => {
    const query = typeof raw === "string" ? raw : "";
    return { ok: true, tasks: searchOpenTasks(ctx.db, ctx.userId, query) };
  });

  authedHandler<FocusStartAdHocResult>("focus:startAdHoc", (ctx, raw) => {
    if (typeof raw !== "string" || raw.trim().length === 0) {
      return { ok: false, error: "InvalidArgs" };
    }
    return startAdHocFocus(ctx.db, ctx.userId, raw, ctx.now);
  });

  authedHandler<
    { ok: true; stuckSessionId: string } | { ok: false; error: string }
  >("focus:startStuck", (ctx) => {
    const session = currentFocus(ctx.db, ctx.userId);
    if (!session) return { ok: false, error: "NoActiveSession" };
    const id = randomUUID();
    ctx.db
      .prepare(
        `INSERT INTO stuck_sessions (id, focus_session_id, started_at, answers_json) VALUES (?, ?, ?, '[]')`,
      )
      .run(id, session.id, ctx.now);
    return { ok: true, stuckSessionId: id };
  });

  authedHandler<{ ok: true } | { ok: false; error: string }>(
    "focus:endStuck",
    (ctx, raw) => {
      if (!isObject(raw) || typeof raw.stuckSessionId !== "string") {
        return { ok: false, error: "InvalidArgs" };
      }
      const { stuckSessionId, outcome, answers } = raw as {
        stuckSessionId: string;
        outcome: string;
        answers: { question: string; answer: string }[];
      };
      ctx.db
        .prepare(
          `UPDATE stuck_sessions SET ended_at=?, outcome=?, answers_json=? WHERE id=?`,
        )
        .run(ctx.now, outcome, JSON.stringify(answers ?? []), stuckSessionId);
      // Append answers to task notes if any were given.
      if (answers && answers.length > 0) {
        const session = currentFocus(ctx.db, ctx.userId);
        if (session) {
          const ts = new Date(ctx.now).toISOString();
          const block = `\n\n--- Stuck rescue (${ts}) ---\n${answers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join("\n")}`;
          ctx.db
            .prepare(
              `UPDATE tasks SET notes = COALESCE(notes, '') || ? WHERE id = ? AND user_id = ?`,
            )
            .run(block, session.task_id, ctx.userId);
        }
      }
      return { ok: true };
    },
  );
}
