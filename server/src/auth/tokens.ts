import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_BYTES = 32;

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf-8").digest("hex");
}

export function tokensMatch(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "hex");
  const bBuf = Buffer.from(b, "hex");
  if (aBuf.length !== bBuf.length || aBuf.length === 0) return false;
  return timingSafeEqual(aBuf, bBuf);
}

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

export function isWellFormedToken(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length < 32 || value.length > 128) return false;
  return BASE64URL_RE.test(value);
}
