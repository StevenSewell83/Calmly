// Strict event-prop value types. `event()` only writes values that pass
// isValidEventValue; anything that fails (full sentences, emails, base64
// blobs, nested objects) is dropped at runtime and the key surfaces in
// `rejected_props` so the developer notices instead of leaking PII silently.

const ENUM_STRING_RE = /^[A-Za-z0-9_.\-:]{1,64}$/;

export type EventValue = boolean | number | string;
export type EventProps = Record<string, EventValue>;

export function isValidEventValue(v: unknown): v is EventValue {
  if (typeof v === "boolean") return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "string") return ENUM_STRING_RE.test(v);
  return false;
}

export interface SanitizedEvent {
  sanitized: EventProps;
  rejected: string[];
}

export function sanitizeEventProps(
  props: Record<string, unknown> | undefined,
): SanitizedEvent {
  const sanitized: EventProps = {};
  const rejected: string[] = [];
  if (!props) return { sanitized, rejected };
  for (const [k, v] of Object.entries(props)) {
    if (isValidEventValue(v)) sanitized[k] = v;
    else rejected.push(k);
  }
  return { sanitized, rejected };
}

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface Logger {
  trace(msg: string, fields?: Record<string, unknown>): void;
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  fatal(msg: string, fields?: Record<string, unknown>): void;
  event(name: string, props?: Record<string, unknown>): void;
}

export interface EventRecord {
  event: string;
  rejected_props?: string[];
  // Sanitized props are spread alongside event/rejected_props.
  [k: string]: EventValue | string[] | undefined;
}

// Build the structured record that an event emitter should write. The actual
// write is up to the platform-specific adapter (pino on the server,
// electron-log on desktop main).
export function buildEventRecord(
  name: string,
  props: Record<string, unknown> | undefined,
): EventRecord {
  const { sanitized, rejected } = sanitizeEventProps(props);
  const record: EventRecord = { event: name, ...sanitized };
  if (rejected.length > 0) record.rejected_props = rejected;
  return record;
}
