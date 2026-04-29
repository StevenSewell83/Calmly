// electron-log v5 does not declare an "exports" field, so Node's ESM resolver
// requires the explicit ".js" extension on the subpath import. Without it, the
// packaged main bundle fails to load with ERR_MODULE_NOT_FOUND at boot.
import log from "electron-log/main.js";
import type { LogLevel } from "@calmly/shared";
import type { DesktopTransport } from "./index";

// Wires electron-log to disk. Default file path is
// app.getPath('logs')/<appName>/main.log on macOS/Linux/Windows; we override
// the filename so the rotated file is calmly.log.

const FILE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB rotation; old file becomes calmly.old.log

let configured = false;

export function configureElectronLog(): void {
  if (configured) return;
  configured = true;

  // Pull in main-process renderer-error capture + file transport.
  log.initialize();

  log.transports.file.fileName = "calmly.log";
  log.transports.file.maxSize = FILE_MAX_BYTES;
  // JSON-line format: one JSON object per line, easy to grep/diff. The format
  // function returns the data array; electron-log stringifies and joins, so
  // returning a single-element [jsonStr] writes "<json>\n" per line.
  log.transports.file.format = ({ message }) => {
    const [msg, ...rest] = message.data;
    const payload = {
      ts: message.date.toISOString(),
      level: message.level,
      msg,
      fields: rest,
    };
    return [JSON.stringify(payload)];
  };
  // The console transport is fine in dev; in packaged builds it's silenced
  // so we don't double-write to stderr alongside our existing console.log.
  // (Future: remove the prefixed console.log calls once F-13b's logger is the
  // single source of truth.)
}

const LEVEL_MAP: Record<
  LogLevel,
  "silly" | "debug" | "info" | "warn" | "error"
> = {
  trace: "silly",
  debug: "debug",
  info: "info",
  warn: "warn",
  error: "error",
  // electron-log has no 'fatal'; widen to error so the line still hits disk.
  fatal: "error",
};

export const electronLogTransport: DesktopTransport = (
  level,
  message,
  fields,
) => {
  const elLevel = LEVEL_MAP[level];
  if (fields && Object.keys(fields).length > 0) {
    log[elLevel](message, fields);
  } else {
    log[elLevel](message);
  }
};
