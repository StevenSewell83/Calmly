import { describe, expect, it } from "vitest";
import {
  authReducer,
  initialAuthState,
  type AuthState,
} from "../auth/state";

const ALEX = { id: "u-1", email: "alex@example.com" };

describe("initialAuthState", () => {
  it("starts in 'unknown'", () => {
    expect(initialAuthState).toEqual({ status: "unknown" });
  });
});

describe("authReducer / status_resolved", () => {
  it("transitions unknown → signed_in when boot reports a session", () => {
    const next = authReducer(initialAuthState, {
      type: "status_resolved",
      result: { signedIn: true, user: ALEX },
    });
    expect(next).toEqual({ status: "signed_in", user: ALEX });
  });

  it("transitions unknown → signed_out when no session", () => {
    const next = authReducer(initialAuthState, {
      type: "status_resolved",
      result: { signedIn: false },
    });
    expect(next).toEqual({ status: "signed_out" });
  });

  it("is a no-op once we've already moved out of 'unknown'", () => {
    // Real-world race: deep-link redeem fires first and moves us to
    // signed_in, then the boot status() resolves later. The reducer must
    // ignore the late status to avoid clobbering the already-redeemed state.
    const signedIn: AuthState = { status: "signed_in", user: ALEX };
    const next = authReducer(signedIn, {
      type: "status_resolved",
      result: { signedIn: false },
    });
    expect(next).toBe(signedIn);
  });

  it("does not clobber a signed_out + banner state with a duplicate signed_out", () => {
    const banneredOut: AuthState = {
      status: "signed_out",
      banner: { kind: "redeem-failed", reason: "invalid_or_expired" },
    };
    const next = authReducer(banneredOut, {
      type: "status_resolved",
      result: { signedIn: false },
    });
    // status_resolved only acts on 'unknown'; an already-signed-out state
    // (with banner) is preserved.
    expect(next).toBe(banneredOut);
  });
});

describe("authReducer / deeplink_redeem", () => {
  it("moves to signed_in when redeem succeeds", () => {
    const next = authReducer(initialAuthState, {
      type: "deeplink_redeem",
      result: { ok: true, user: ALEX, expiresAt: "2026-05-30T00:00:00.000Z" },
    });
    expect(next).toEqual({ status: "signed_in", user: ALEX });
  });

  it("can succeed even from a signed_out state (re-sign-in via fresh link)", () => {
    const out: AuthState = { status: "signed_out" };
    const next = authReducer(out, {
      type: "deeplink_redeem",
      result: { ok: true, user: ALEX, expiresAt: "2026-05-30T00:00:00.000Z" },
    });
    expect(next).toEqual({ status: "signed_in", user: ALEX });
  });

  it("surfaces invalid_or_expired as a banner on signed_out", () => {
    const next = authReducer(initialAuthState, {
      type: "deeplink_redeem",
      result: { ok: false, error: "invalid_or_expired" },
    });
    expect(next).toEqual({
      status: "signed_out",
      banner: { kind: "redeem-failed", reason: "invalid_or_expired" },
    });
  });

  it("surfaces network errors as a banner on signed_out", () => {
    const next = authReducer(initialAuthState, {
      type: "deeplink_redeem",
      result: { ok: false, error: "network" },
    });
    expect(next).toEqual({
      status: "signed_out",
      banner: { kind: "redeem-failed", reason: "network" },
    });
  });

  it("clears a prior banner when a fresh redeem succeeds", () => {
    const banneredOut: AuthState = {
      status: "signed_out",
      banner: { kind: "redeem-failed", reason: "invalid_or_expired" },
    };
    const next = authReducer(banneredOut, {
      type: "deeplink_redeem",
      result: { ok: true, user: ALEX, expiresAt: "2026-05-30T00:00:00.000Z" },
    });
    expect(next).toEqual({ status: "signed_in", user: ALEX });
  });

  it("replaces an older banner with a newer redeem-failed one", () => {
    const banneredOut: AuthState = {
      status: "signed_out",
      banner: { kind: "redeem-failed", reason: "network" },
    };
    const next = authReducer(banneredOut, {
      type: "deeplink_redeem",
      result: { ok: false, error: "invalid_or_expired" },
    });
    expect(next).toEqual({
      status: "signed_out",
      banner: { kind: "redeem-failed", reason: "invalid_or_expired" },
    });
  });
});

describe("authReducer / manual_sign_out", () => {
  it("transitions signed_in → signed_out with the signed-out banner", () => {
    const signedIn: AuthState = { status: "signed_in", user: ALEX };
    const next = authReducer(signedIn, { type: "manual_sign_out" });
    expect(next).toEqual({
      status: "signed_out",
      banner: { kind: "signed-out" },
    });
  });

  it("from signed_out, replaces any prior banner with the signed-out banner", () => {
    const banneredOut: AuthState = {
      status: "signed_out",
      banner: { kind: "redeem-failed", reason: "invalid_or_expired" },
    };
    const next = authReducer(banneredOut, { type: "manual_sign_out" });
    expect(next).toEqual({
      status: "signed_out",
      banner: { kind: "signed-out" },
    });
  });
});
