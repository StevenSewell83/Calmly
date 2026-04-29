// Last-Write-Wins comparator. The server treats the client's clock as
// authoritative for ordering — the server's role is to assign a strictly
// increasing version on accept and to refuse stale upserts so a slow replay
// can't overwrite a newer record.

export type LwwDecision =
  | { accept: true }
  | { accept: false; reason: "stale" | "gone" };

export interface ExistingRecord {
  updated_at: number | string | null;
  deleted_at: number | string | null;
}

function toMillis(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function decideUpsert(
  existing: ExistingRecord | null,
  incomingUpdatedAt: number,
): LwwDecision {
  if (!existing) return { accept: true };
  const stored = toMillis(existing.updated_at);
  if (stored === null) return { accept: true };
  if (incomingUpdatedAt > stored) return { accept: true };
  return { accept: false, reason: "stale" };
}

export function decideDelete(
  existing: ExistingRecord | null,
  incomingUpdatedAt: number,
): LwwDecision {
  if (!existing) return { accept: false, reason: "gone" };
  const deletedAt = toMillis(existing.deleted_at);
  if (deletedAt !== null) return { accept: false, reason: "gone" };
  const stored = toMillis(existing.updated_at);
  if (stored === null) return { accept: true };
  if (incomingUpdatedAt > stored) return { accept: true };
  return { accept: false, reason: "stale" };
}
