import { describe, expect, it } from "vitest";
import type pg from "pg";
import {
  issueOauthTicket,
  redeemOauthTicket,
} from "../tickets";

// Tiny in-memory pool stub. Only the calls our helpers actually make are
// modelled — INSERT INTO oauth_tickets and DELETE … RETURNING.
function makePool(): {
  pool: pg.Pool;
  rows: Map<string, OauthTicketRow>;
} {
  const rows = new Map<string, OauthTicketRow>();
  const pool: pg.Pool = {
    async query(text: string, params: unknown[]) {
      if (text.startsWith("INSERT INTO oauth_tickets")) {
        const [
          jti,
          user_id,
          account_id,
          provider,
          refresh_token,
          access_token,
          expires_in,
          expires_at,
        ] = params as [
          string,
          string,
          string,
          string,
          string,
          string,
          number,
          Date,
        ];
        rows.set(jti, {
          jti,
          user_id,
          account_id,
          provider,
          refresh_token,
          access_token,
          expires_in,
          expires_at,
        });
        return { rows: [] };
      }
      if (text.startsWith("DELETE FROM oauth_tickets")) {
        const [jti, provider] = params as [string, string];
        const row = rows.get(jti);
        if (!row || row.provider !== provider) return { rows: [] };
        rows.delete(jti);
        return { rows: [row] };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  } as unknown as pg.Pool;
  return { pool, rows };
}

interface OauthTicketRow {
  jti: string;
  user_id: string;
  account_id: string;
  provider: string;
  refresh_token: string;
  access_token: string;
  expires_in: number;
  expires_at: Date;
}

const SECRET = "x".repeat(48);

describe("issueOauthTicket + redeemOauthTicket round trip", () => {
  it("happy path returns the same tokens we issued", async () => {
    const { pool } = makePool();
    const issued = await issueOauthTicket({
      pool,
      secret: SECRET,
      userId: "user-1",
      accountId: "acct-1",
      provider: "google",
      refreshToken: "rt-original",
      accessToken: "at-original",
      expiresInSec: 3600,
      ticketTtlSec: 60,
    });
    expect(issued.ticket).toMatch(/^[A-Za-z0-9_-]+\.[0-9a-f]{64}$/);

    const r = await redeemOauthTicket({
      pool,
      secret: SECRET,
      userId: "user-1",
      provider: "google",
      ticket: issued.ticket,
    });
    expect(r).toEqual({
      ok: true,
      data: {
        accountId: "acct-1",
        refreshToken: "rt-original",
        accessToken: "at-original",
        expiresInSec: 3600,
      },
    });
  });

  it("rejects a ticket with the wrong signature", async () => {
    const { pool } = makePool();
    const issued = await issueOauthTicket({
      pool,
      secret: SECRET,
      userId: "user-1",
      accountId: "acct-1",
      provider: "google",
      refreshToken: "rt",
      accessToken: "at",
      expiresInSec: 3600,
      ticketTtlSec: 60,
    });
    const badSig = "0".repeat(64);
    const tampered = `${issued.ticket.split(".")[0]}.${badSig}`;
    const r = await redeemOauthTicket({
      pool,
      secret: SECRET,
      userId: "user-1",
      provider: "google",
      ticket: tampered,
    });
    expect(r).toEqual({ ok: false, error: "invalid_ticket" });
  });

  it("rejects a redeem from the wrong user", async () => {
    const { pool } = makePool();
    const issued = await issueOauthTicket({
      pool,
      secret: SECRET,
      userId: "user-1",
      accountId: "acct-1",
      provider: "google",
      refreshToken: "rt",
      accessToken: "at",
      expiresInSec: 3600,
      ticketTtlSec: 60,
    });
    const r = await redeemOauthTicket({
      pool,
      secret: SECRET,
      userId: "user-OTHER",
      provider: "google",
      ticket: issued.ticket,
    });
    expect(r).toEqual({ ok: false, error: "ticket_user_mismatch" });
  });

  it("rejects a second redeem (one-shot semantics)", async () => {
    const { pool } = makePool();
    const issued = await issueOauthTicket({
      pool,
      secret: SECRET,
      userId: "user-1",
      accountId: "acct-1",
      provider: "google",
      refreshToken: "rt",
      accessToken: "at",
      expiresInSec: 3600,
      ticketTtlSec: 60,
    });
    const first = await redeemOauthTicket({
      pool,
      secret: SECRET,
      userId: "user-1",
      provider: "google",
      ticket: issued.ticket,
    });
    expect(first.ok).toBe(true);
    const second = await redeemOauthTicket({
      pool,
      secret: SECRET,
      userId: "user-1",
      provider: "google",
      ticket: issued.ticket,
    });
    expect(second).toEqual({ ok: false, error: "ticket_already_redeemed" });
  });

  it("rejects a malformed ticket", async () => {
    const { pool } = makePool();
    for (const t of ["", "no-dot", "a.b", "abc.123", "x.y.z"]) {
      const r = await redeemOauthTicket({
        pool,
        secret: SECRET,
        userId: "user-1",
        provider: "google",
        ticket: t,
      });
      expect(r).toEqual({ ok: false, error: "invalid_ticket" });
    }
  });

  it("rejects a ticket whose provider doesn't match the row", async () => {
    const { pool } = makePool();
    const issued = await issueOauthTicket({
      pool,
      secret: SECRET,
      userId: "user-1",
      accountId: "acct-1",
      provider: "google",
      refreshToken: "rt",
      accessToken: "at",
      expiresInSec: 3600,
      ticketTtlSec: 60,
    });
    const r = await redeemOauthTicket({
      pool,
      secret: SECRET,
      userId: "user-1",
      provider: "microsoft",
      ticket: issued.ticket,
    });
    expect(r).toEqual({ ok: false, error: "ticket_already_redeemed" });
  });

  it("rejects a redeem for an expired ticket", async () => {
    const { pool, rows } = makePool();
    const issued = await issueOauthTicket({
      pool,
      secret: SECRET,
      userId: "user-1",
      accountId: "acct-1",
      provider: "google",
      refreshToken: "rt",
      accessToken: "at",
      expiresInSec: 3600,
      ticketTtlSec: 60,
    });
    // Forcibly set the row's expires_at into the past to simulate clock drift.
    const row = rows.get(issued.jti);
    if (!row) throw new Error("missing row");
    row.expires_at = new Date(Date.now() - 1000);

    const r = await redeemOauthTicket({
      pool,
      secret: SECRET,
      userId: "user-1",
      provider: "google",
      ticket: issued.ticket,
    });
    expect(r).toEqual({ ok: false, error: "ticket_expired" });
  });
});
