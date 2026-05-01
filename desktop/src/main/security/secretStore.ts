import { getDb } from "../db";
import {
  EncryptionUnavailableError,
  decryptString,
  encryptString,
  isEncryptionAvailable,
} from "./safeStorage";

export type StaticSecretKey =
  | "auth.session"
  | "ai.anthropic.key"
  | "ai.openai.key"
  | "telemetry.anonymous_id";

export type ParameterizedSecretKey =
  | `calendar.google.refresh_token:${string}`
  | `calendar.microsoft.refresh_token:${string}`;

export type SecretKey = StaticSecretKey | ParameterizedSecretKey;

const STATIC_KEYS: ReadonlySet<string> = new Set<StaticSecretKey>([
  "auth.session",
  "ai.anthropic.key",
  "ai.openai.key",
  "telemetry.anonymous_id",
]);

// Bounded suffix character set + length keeps the IPC surface tight; the
// renderer cannot smuggle arbitrary strings through the colon.
const PARAM_KEY_RE =
  /^calendar\.(google|microsoft)\.refresh_token:[A-Za-z0-9_-]{1,64}$/;

export function isValidSecretKey(s: unknown): s is SecretKey {
  if (typeof s !== "string") return false;
  if (STATIC_KEYS.has(s)) return true;
  return PARAM_KEY_RE.test(s);
}

interface CipherRow {
  ciphertext: Buffer;
}

export const secretStore = {
  set(key: SecretKey, value: string): void {
    const cipher = encryptString(value);
    getDb()
      .prepare(
        `INSERT INTO secrets (key, ciphertext, updated_at)
         VALUES (?, ?, unixepoch() * 1000)
         ON CONFLICT(key) DO UPDATE SET
           ciphertext = excluded.ciphertext,
           updated_at = excluded.updated_at`,
      )
      .run(key, cipher);
  },

  get(key: SecretKey): string | null {
    const row = getDb()
      .prepare("SELECT ciphertext FROM secrets WHERE key = ?")
      .get(key) as CipherRow | undefined;
    if (!row) return null;
    return decryptString(row.ciphertext);
  },

  has(key: SecretKey): boolean {
    const row = getDb()
      .prepare("SELECT 1 AS x FROM secrets WHERE key = ?")
      .get(key);
    return !!row;
  },

  delete(key: SecretKey): void {
    getDb().prepare("DELETE FROM secrets WHERE key = ?").run(key);
  },
} as const;

export interface SecretStoreSelfTestResult {
  ok: boolean;
  available: boolean;
  ciphertextDifferentFromPlaintext: boolean;
  roundtripMatches: boolean;
  error?: string;
}

const SELF_TEST_KEY = "_calmly_internal_selftest";

// Exercises the full path (encrypt → persist → read raw → decrypt) using an
// internal key that bypasses the public allowlist. Cleans up after itself so
// it does not leak rows into the secrets table.
export function secretStoreSelfTest(): SecretStoreSelfTestResult {
  const result: SecretStoreSelfTestResult = {
    ok: false,
    available: false,
    ciphertextDifferentFromPlaintext: false,
    roundtripMatches: false,
  };
  try {
    result.available = isEncryptionAvailable();
    if (!result.available) {
      result.error = "EncryptionUnavailable";
      return result;
    }

    const plaintext = `calmly-self-test-${Date.now()}`;
    const cipher = encryptString(plaintext);

    const db = getDb();
    db.prepare(
      "INSERT OR REPLACE INTO secrets (key, ciphertext, updated_at) VALUES (?, ?, unixepoch() * 1000)",
    ).run(SELF_TEST_KEY, cipher);

    const row = db
      .prepare("SELECT ciphertext FROM secrets WHERE key = ?")
      .get(SELF_TEST_KEY) as CipherRow | undefined;
    if (!row) throw new Error("self-test row not found after insert");

    const plainBytes = Buffer.from(plaintext, "utf-8");
    result.ciphertextDifferentFromPlaintext =
      !row.ciphertext.equals(plainBytes);

    const decoded = decryptString(row.ciphertext);
    result.roundtripMatches = decoded === plaintext;

    result.ok =
      result.ciphertextDifferentFromPlaintext && result.roundtripMatches;

    db.prepare("DELETE FROM secrets WHERE key = ?").run(SELF_TEST_KEY);
  } catch (e) {
    if (e instanceof EncryptionUnavailableError) {
      result.error = "EncryptionUnavailable";
    } else {
      result.error = e instanceof Error ? e.message : String(e);
    }
  }
  return result;
}
