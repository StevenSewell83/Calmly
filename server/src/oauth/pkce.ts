import { createHash, randomBytes } from "node:crypto";

// PKCE per RFC 7636 — S256 method. We always use the strongest method even if
// the provider also accepts plain.
//
// verifier: 43–128 chars from [A-Z / a-z / 0-9 / -._~]
// challenge: BASE64URL(SHA256(verifier))

const VERIFIER_BYTES = 32; // → 43 base64url chars

export interface PkcePair {
  verifier: string;
  challenge: string;
  method: "S256";
}

export function createPkcePair(): PkcePair {
  const verifier = randomBytes(VERIFIER_BYTES).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge, method: "S256" };
}

const STATE_BYTES = 32;
export function createOAuthState(): string {
  return randomBytes(STATE_BYTES).toString("base64url");
}
