import { z } from "zod";
import { unixMs, uuid } from "../model/common";

// Tables that participate in sync. Auth tables (users, sessions,
// magic_link_tokens) are intentionally NOT here — those are server-private.
export const syncTables = [
  "inbox_items",
  "tasks",
  "events",
  "reminder_rules",
  "recurrence_rules",
  "calendar_event_imports",
  "ai_suggestions",
  "telegram_links",
  "user_settings",
] as const;
export const SyncTableSchema = z.enum(syncTables);
export type SyncTable = z.infer<typeof SyncTableSchema>;

// Every synced record carries this metadata in addition to its domain fields.
// version is server-assigned (monotonic from a single sequence), so the
// client's pull cursor is a single number across all tables.
export const SyncMetaSchema = z.object({
  id: uuid,
  updated_at: unixMs,
  deleted_at: unixMs.nullable(),
  version: z.number().int().nonnegative(),
});
export type SyncMeta = z.infer<typeof SyncMetaSchema>;

// A SyncOp is what the client pushes. The server validates the op against the
// table's domain schema before applying.
export const SyncOpSchema = z.object({
  table: SyncTableSchema,
  op: z.enum(["upsert", "delete"]),
  payload: z.record(z.unknown()),
});
export type SyncOp = z.infer<typeof SyncOpSchema>;

export const PushRequestSchema = z.object({
  ops: z.array(SyncOpSchema).max(500),
});
export type PushRequest = z.infer<typeof PushRequestSchema>;

export const PushOpResultSchema = z.object({
  index: z.number().int().nonnegative(),
  status: z.enum(["accepted", "stale", "gone", "invalid"]),
  table: SyncTableSchema,
  id: uuid.nullable(),
  version: z.number().int().nonnegative().nullable(),
  reason: z.string().nullable(),
});
export type PushOpResult = z.infer<typeof PushOpResultSchema>;

export const PushResponseSchema = z.object({
  results: z.array(PushOpResultSchema),
  version: z.number().int().nonnegative(),
});
export type PushResponse = z.infer<typeof PushResponseSchema>;

// The three fields every synced row carries in addition to domain fields.
// Extracted so model files can produce *RecordSchema = DomainSchema.extend(SyncTrioSchema.shape).
export const SyncTrioSchema = z.object({
  version: z.number().int().nonnegative(),
  updated_at: unixMs,
  deleted_at: unixMs.nullable(),
});
export type SyncTrio = z.infer<typeof SyncTrioSchema>;

export const PullRequestSchema = z.object({
  since: z.number().int().nonnegative().default(0),
});
export type PullRequest = z.infer<typeof PullRequestSchema>;

// Flat client-side pull response — the client aggregates paginated wire
// responses before returning this to callers.
export const PullResponseSchema = z.object({
  records: z.record(SyncTableSchema, z.array(z.record(z.unknown()))),
  version: z.number().int().nonnegative(),
});
export type PullResponse = z.infer<typeof PullResponseSchema>;

// Wire-level pull response: each table entry includes a hasMore flag so
// the client can paginate (LIMIT 1000 per table per round-trip).
export const WirePullTableSchema = z.object({
  rows: z.array(z.record(z.unknown())),
  hasMore: z.boolean(),
});
export const WirePullResponseSchema = z.object({
  records: z.record(SyncTableSchema, WirePullTableSchema),
  version: z.number().int().nonnegative(),
});
export type WirePullResponse = z.infer<typeof WirePullResponseSchema>;
