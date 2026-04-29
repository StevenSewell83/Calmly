import type pg from "pg";
import { generateToken, hashToken } from "./tokens";

export interface SessionRecord {
  id_hash: string;
  user_id: string;
  expires_at: Date;
  last_used_at: Date;
  user_agent: string | null;
  created_at: Date;
}

export interface CreatedSession {
  rawToken: string;
  expiresAt: Date;
  userId: string;
}

export async function createSession(
  pool: pg.Pool,
  args: { userId: string; ttlMs: number; userAgent: string | null },
): Promise<CreatedSession> {
  const rawToken = generateToken();
  const idHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + args.ttlMs);
  await pool.query(
    `INSERT INTO sessions (id_hash, user_id, expires_at, user_agent)
     VALUES ($1, $2, $3, $4)`,
    [idHash, args.userId, expiresAt, args.userAgent],
  );
  return { rawToken, expiresAt, userId: args.userId };
}

export interface ResolvedSession {
  user: { id: string; email: string };
  session: { idHash: string; expiresAt: Date };
}

export async function resolveSessionByToken(
  pool: pg.Pool,
  rawToken: string,
): Promise<ResolvedSession | null> {
  const idHash = hashToken(rawToken);
  const r = await pool.query<{
    id_hash: string;
    user_id: string;
    expires_at: Date;
    email: string;
  }>(
    `UPDATE sessions
        SET last_used_at = now()
      WHERE id_hash = $1
        AND expires_at > now()
      RETURNING id_hash, user_id, expires_at,
                (SELECT email FROM users WHERE users.id = sessions.user_id) AS email`,
    [idHash],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    user: { id: row.user_id, email: row.email },
    session: { idHash: row.id_hash, expiresAt: row.expires_at },
  };
}

export async function deleteSessionByToken(
  pool: pg.Pool,
  rawToken: string,
): Promise<void> {
  const idHash = hashToken(rawToken);
  await pool.query("DELETE FROM sessions WHERE id_hash = $1", [idHash]);
}
