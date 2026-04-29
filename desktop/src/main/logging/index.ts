import {
  buildEventRecord,
  scrub,
  type EventRecord,
  type Logger,
  type LogLevel,
} from "@calmly/shared";

// Adapts the shared Logger contract to a desktop transport (electron-log in
// production, a vi.fn in tests). Mirrors server/logging/createServerLogger:
// every message, every string field, and every event prop value is scrubbed
// before the transport sees it — defense in depth against tokens that slipped
// past the EventProps shape regex.

export type DesktopTransport = (
  level: LogLevel,
  message: string,
  fields?: Record<string, unknown>,
) => void;

export interface DesktopLoggerArgs {
  transport: DesktopTransport;
  // When true, scrub is bypassed. Production callers always pass false (or
  // omit it). Only the dev-only LOG_PII=true escape hatch flips this on, and
  // the main bootstrap hard-disables it for packaged builds.
  allowPii?: boolean;
}

export function createDesktopLogger(args: DesktopLoggerArgs): Logger {
  const allowPii = args.allowPii ?? false;
  const sanitize = (s: string) => (allowPii ? s : scrub(s));

  function sanitizeFields(
    fields: Record<string, unknown> | undefined,
  ): Record<string, unknown> | undefined {
    if (!fields) return undefined;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = typeof v === "string" ? sanitize(v) : v;
    }
    return out;
  }

  const at =
    (level: LogLevel) =>
    (msg: string, fields?: Record<string, unknown>) => {
      args.transport(level, sanitize(msg), sanitizeFields(fields));
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
      // Defense-in-depth: shape validation in buildEventRecord doesn't catch
      // alphanumeric tokens that fit the enum-string regex (e.g. some opaque
      // session IDs). Scrub the resulting string values before write.
      for (const [k, v] of Object.entries(record)) {
        if (typeof v === "string") {
          (record as Record<string, unknown>)[k] = sanitize(v);
        }
      }
      args.transport("info", "event", record as Record<string, unknown>);
    },
  };
}
