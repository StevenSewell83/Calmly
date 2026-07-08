import { randomUUID } from "crypto";
import { getDb } from "../db";
import type { AIAction } from "./types";

// Conservative char/4 fallback — acceptable for v1 estimation.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface UsageRecord {
  promptClass: AIAction;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export function recordUsage(userId: string, record: UsageRecord): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO ai_usage (id, user_id, ts, prompt_class, input_tokens, output_tokens, model)
         VALUES (?, ?, unixepoch() * 1000, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        userId,
        record.promptClass,
        record.inputTokens,
        record.outputTokens,
        record.model,
      );
  } catch {
    // Never crash the caller over telemetry
  }
}

export interface DailyUsageSummary {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byPromptClass: Record<
    string,
    { requests: number; inputTokens: number; outputTokens: number }
  >;
}

export function readTodayUsage(userId: string): DailyUsageSummary {
  const db = getDb();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startMs = startOfDay.getTime();

  const rows = db
    .prepare(
      `SELECT prompt_class, SUM(input_tokens) as input, SUM(output_tokens) as output, COUNT(*) as count
       FROM ai_usage
       WHERE user_id = ? AND ts >= ?
       GROUP BY prompt_class`,
    )
    .all(userId, startMs) as {
    prompt_class: string;
    input: number;
    output: number;
    count: number;
  }[];

  const byPromptClass: DailyUsageSummary["byPromptClass"] = {};
  let totalRequests = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const row of rows) {
    byPromptClass[row.prompt_class] = {
      requests: row.count,
      inputTokens: row.input,
      outputTokens: row.output,
    };
    totalRequests += row.count;
    totalInputTokens += row.input;
    totalOutputTokens += row.output;
  }

  return { totalRequests, totalInputTokens, totalOutputTokens, byPromptClass };
}
