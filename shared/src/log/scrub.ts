// Ordered redaction patterns. Each match becomes [REDACTED:<tag>] so the log
// reader can still see "an OpenAI key was here" without seeing the key itself.
// Patterns are applied in order — the most specific keys come first so we
// don't shadow them with the generic JWT/long-token catch-alls.

export interface ScrubPattern {
  name: string;
  re: RegExp;
}

export const SCRUB_PATTERNS: ScrubPattern[] = [
  {
    name: "api_key_anthropic",
    re: /sk-ant-(?:api03-)?[A-Za-z0-9_-]{20,}/g,
  },
  {
    name: "api_key_openai",
    re: /\bsk-(?!ant-)[A-Za-z0-9]{20,}\b/g,
  },
  {
    name: "api_key_aws",
    re: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    name: "api_key_github",
    re: /\bgh[psour]_[A-Za-z0-9]{36,}\b/g,
  },
  {
    name: "jwt",
    re: /\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g,
  },
  {
    name: "bearer",
    re: /\b[Bb]earer\s+[A-Za-z0-9._-]{16,}\b/g,
  },
  {
    name: "email",
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]{0,253}[A-Za-z0-9])?\.[A-Za-z]{2,}\b/g,
  },
];

export function scrub(input: string): string {
  let out = input;
  for (const { name, re } of SCRUB_PATTERNS) {
    out = out.replace(re, `[REDACTED:${name}]`);
  }
  return out;
}

// Recursively scrubs string leaves. Buffers/typed arrays are stringified to
// "[BINARY]" since their contents are usually credentials or PII.
export function scrubDeep(value: unknown, maxDepth = 6): unknown {
  if (maxDepth <= 0) return "[TRUNCATED]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return scrub(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value !== "object") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (
    typeof Buffer !== "undefined" &&
    typeof (value as { byteLength?: number }).byteLength === "number"
  ) {
    return "[BINARY]";
  }
  if (Array.isArray(value)) {
    return value.map((v) => scrubDeep(v, maxDepth - 1));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = scrubDeep(v, maxDepth - 1);
  }
  return out;
}
