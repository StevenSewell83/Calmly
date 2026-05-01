import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createOAuthState, createPkcePair } from "../pkce";

describe("createPkcePair", () => {
  it("generates a base64url verifier of length 43", () => {
    const p = createPkcePair();
    expect(p.verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(p.verifier.length).toBe(43);
  });

  it("computes challenge as base64url(SHA256(verifier))", () => {
    const p = createPkcePair();
    const expected = createHash("sha256").update(p.verifier).digest("base64url");
    expect(p.challenge).toBe(expected);
    expect(p.method).toBe("S256");
  });

  it("never repeats", () => {
    const a = createPkcePair();
    const b = createPkcePair();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).not.toBe(b.challenge);
  });
});

describe("createOAuthState", () => {
  it("returns a base64url string", () => {
    expect(createOAuthState()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("never repeats", () => {
    expect(createOAuthState()).not.toBe(createOAuthState());
  });
});
