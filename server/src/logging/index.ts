import type { FastifyBaseLogger } from "fastify";
import {
  buildEventRecord,
  scrub,
  type EventRecord,
  type Logger,
} from "@calmly/shared";

// Adapt Fastify's pino instance to the shared Logger contract. Every string
// message is run through scrub before pino sees it; pino's own redact paths
// catch nested credential keys we forgot to spell out.

function scrubFields(
  fields: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!fields) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === "string") out[k] = scrub(v);
    else out[k] = v;
  }
  return out;
}

export function createServerLogger(pino: FastifyBaseLogger): Logger {
  const at =
    (level: "trace" | "debug" | "info" | "warn" | "error" | "fatal") =>
    (msg: string, fields?: Record<string, unknown>) => {
      const safe = scrubFields(fields);
      const safeMsg = scrub(msg);
      if (safe) pino[level](safe, safeMsg);
      else pino[level](safeMsg);
    };

  return {
    trace: at("trace"),
    debug: at("debug"),
    info: at("info"),
    warn: at("warn"),
    error: at("error"),
    fatal: at("fatal"),
    event(name, props) {
      const record: EventRecord = buildEventRecord(name, props);
      // Defense in depth: even shape-validated string values get scrubbed in
      // case a token slipped through the enum-string regex (e.g. an
      // alphanumeric API key with no separators).
      for (const [k, v] of Object.entries(record)) {
        if (typeof v === "string") {
          (record as Record<string, unknown>)[k] = scrub(v);
        }
      }
      pino.info(record, "event");
    },
  };
}
