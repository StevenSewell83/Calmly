import type pg from "pg";
import type { PushOpResult, SyncOp, SyncTable } from "@calmly/shared";
import { SyncMetaSchema, SyncTableSchema } from "@calmly/shared";
import { z } from "zod";
import { decideDelete, decideUpsert, type ExistingRecord } from "./lww";
import { TABLES, type TableSpec } from "./tables";
import { TABLE_SCHEMAS } from "./tableSchemas";

interface ApplyContext {
  client: pg.PoolClient;
  userId: string;
}

async function fetchExisting(
  ctx: ApplyContext,
  spec: TableSpec,
  id: string,
): Promise<ExistingRecord | null> {
  const r = await ctx.client.query<ExistingRecord>(
    `SELECT updated_at, deleted_at
       FROM ${spec.name}
      WHERE user_id = $1 AND id = $2`,
    [ctx.userId, id],
  );
  return r.rows[0] ?? null;
}

async function nextVersion(ctx: ApplyContext): Promise<number> {
  const r = await ctx.client.query<{ v: string }>(
    "SELECT nextval('sync_version') AS v",
  );
  return Number(r.rows[0]?.v ?? 0);
}

async function applyUpsert(
  ctx: ApplyContext,
  index: number,
  spec: TableSpec,
  payload: Record<string, unknown>,
): Promise<PushOpResult> {
  // Step 1: meta fields (id + updated_at required for LWW decision).
  const metaParsed = SyncMetaSchema.safeParse(payload);
  if (!metaParsed.success) {
    return {
      index,
      status: "invalid",
      table: spec.name,
      id: null,
      version: null,
      reason: "payload_failed_meta_validation",
    };
  }
  // Step 2: per-table domain schema (catches bad enums, types, etc.).
  const domainSchema = TABLE_SCHEMAS[spec.name];
  if (domainSchema) {
    const domainParsed = domainSchema.safeParse(payload);
    if (!domainParsed.success) {
      const firstIssue = domainParsed.error.issues[0];
      const reason = firstIssue
        ? `${firstIssue.path.join(".")}: ${firstIssue.message}`
        : "payload_failed_domain_validation";
      return {
        index,
        status: "invalid",
        table: spec.name,
        id: metaParsed.data.id,
        version: null,
        reason,
      };
    }
  }
  const { id, updated_at } = metaParsed.data;
  const existing = await fetchExisting(ctx, spec, id);
  const decision = decideUpsert(existing, updated_at);
  if (!decision.accept) {
    return {
      index,
      status: decision.reason,
      table: spec.name,
      id,
      version: null,
      reason:
        decision.reason === "stale" ? "older_than_stored" : "missing_target",
    };
  }

  const version = await nextVersion(ctx);
  const cols = [
    "user_id",
    ...spec.columns,
    "updated_at",
    "deleted_at",
    "version",
  ];
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  const jsonSet = new Set(spec.jsonColumns ?? []);

  const values: unknown[] = [ctx.userId];
  for (const c of spec.columns) {
    const raw = (payload as Record<string, unknown>)[c];
    if (raw === undefined) {
      values.push(null);
    } else if (jsonSet.has(c)) {
      values.push(typeof raw === "string" ? raw : JSON.stringify(raw));
    } else {
      values.push(raw);
    }
  }
  values.push(updated_at);
  values.push(null); // deleted_at — upsert always clears the tombstone
  values.push(version);

  const updateSet = cols
    .filter((c) => c !== "user_id" && c !== "id")
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(", ");

  await ctx.client.query(
    `INSERT INTO ${spec.name} (${cols.join(", ")})
     VALUES (${placeholders.join(", ")})
     ON CONFLICT (id) DO UPDATE SET ${updateSet}`,
    values,
  );

  return {
    index,
    status: "accepted",
    table: spec.name,
    id,
    version,
    reason: null,
  };
}

const DeletePayloadSchema = z.object({
  id: z.string().uuid(),
  updated_at: z.number().int().nonnegative(),
});

async function applyDelete(
  ctx: ApplyContext,
  index: number,
  spec: TableSpec,
  payload: Record<string, unknown>,
): Promise<PushOpResult> {
  const parsed = DeletePayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      index,
      status: "invalid",
      table: spec.name,
      id: null,
      version: null,
      reason: "payload_missing_id_or_updated_at",
    };
  }
  const { id, updated_at } = parsed.data;
  const existing = await fetchExisting(ctx, spec, id);
  const decision = decideDelete(existing, updated_at);
  if (!decision.accept) {
    return {
      index,
      status: decision.reason,
      table: spec.name,
      id,
      version: null,
      reason:
        decision.reason === "gone"
          ? "already_deleted_or_missing"
          : "older_than_stored",
    };
  }

  const version = await nextVersion(ctx);
  await ctx.client.query(
    `UPDATE ${spec.name}
        SET deleted_at = $1,
            updated_at = $2,
            version = $3
      WHERE user_id = $4 AND id = $5`,
    [updated_at, updated_at, version, ctx.userId, id],
  );

  return {
    index,
    status: "accepted",
    table: spec.name,
    id,
    version,
    reason: null,
  };
}

export async function applyOp(
  ctx: ApplyContext,
  index: number,
  op: SyncOp,
): Promise<PushOpResult> {
  const tableParse = SyncTableSchema.safeParse(op.table);
  if (!tableParse.success) {
    return {
      index,
      status: "invalid",
      table: op.table as SyncTable,
      id: null,
      version: null,
      reason: "unknown_table",
    };
  }
  const spec = TABLES[tableParse.data];
  if (!spec) {
    return {
      index,
      status: "invalid",
      table: tableParse.data,
      id: null,
      version: null,
      reason: "unknown_table",
    };
  }
  if (op.op === "upsert") return applyUpsert(ctx, index, spec, op.payload);
  return applyDelete(ctx, index, spec, op.payload);
}
