import { randomUUID } from "crypto";
import { getDb } from "../db";

export type SuggestionOutcome = "accepted" | "rejected" | "edited";
export type OwnerType = "inbox_item" | "task" | "event";

export interface RecordPendingOptions {
  ownerType?: OwnerType;
  ownerId?: string;
  model: string;
  promptClass: string;
  suggestionJson: unknown;
}

export function recordPending(opts: RecordPendingOptions): string {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO ai_suggestions (id, owner_type, owner_id, model, prompt_class, suggestion_json, outcome)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    )
    .run(
      id,
      opts.ownerType ?? null,
      opts.ownerId ?? null,
      opts.model,
      opts.promptClass,
      JSON.stringify(opts.suggestionJson),
    );
  return id;
}

export function recordOutcome(
  suggestionId: string,
  outcome: SuggestionOutcome,
  editedJson?: unknown,
): void {
  const db = getDb();
  if (outcome === "edited" && editedJson !== undefined) {
    db.prepare(
      `UPDATE ai_suggestions
       SET outcome = ?, accepted_at = unixepoch() * 1000, edited_json = ?
       WHERE id = ?`,
    ).run(outcome, JSON.stringify(editedJson), suggestionId);
  } else {
    db.prepare(
      `UPDATE ai_suggestions
       SET outcome = ?, accepted_at = unixepoch() * 1000
       WHERE id = ?`,
    ).run(outcome, suggestionId);
  }
}
