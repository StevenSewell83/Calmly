import { ipcMain } from "electron";
import { getDb } from "../db";
import { secretStore } from "../security/secretStore";
import { EncryptionUnavailableError } from "../security/safeStorage";

export interface AiSettings {
  enabled: boolean;
  mode: "off" | "cloud";
}

export type AiTestResult =
  | { ok: true }
  | {
      ok: false;
      error: "NoKey" | "InvalidKey" | "NetworkError" | "InternalError";
      message?: string;
    };

const ANTHROPIC_KEY = "ai.anthropic.key";

function readAiSettings(): AiSettings {
  try {
    const row = getDb()
      .prepare("SELECT settings_json FROM user_settings LIMIT 1")
      .get() as { settings_json: string } | undefined;
    if (!row) return { enabled: false, mode: "off" };
    const j = JSON.parse(row.settings_json) as Record<string, unknown>;
    return {
      enabled: j["ai.enabled"] === true,
      mode: j["ai.mode"] === "cloud" ? "cloud" : "off",
    };
  } catch {
    return { enabled: false, mode: "off" };
  }
}

function writeAiSettings(patch: Partial<AiSettings>): void {
  const db = getDb();
  const row = db
    .prepare("SELECT settings_json FROM user_settings LIMIT 1")
    .get() as { settings_json: string } | undefined;
  const j: Record<string, unknown> = row ? JSON.parse(row.settings_json) : {};
  if (patch.enabled !== undefined) j["ai.enabled"] = patch.enabled;
  if (patch.mode !== undefined) j["ai.mode"] = patch.mode;
  if (row) {
    db.prepare(
      "UPDATE user_settings SET settings_json = ?, updated_at = unixepoch() * 1000",
    ).run(JSON.stringify(j));
  } else {
    db.prepare(
      "INSERT INTO user_settings (settings_json, updated_at) VALUES (?, unixepoch() * 1000)",
    ).run(JSON.stringify(j));
  }
}

async function testAnthropicKey(key: string): Promise<AiTestResult> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    if (res.ok) return { ok: true };
    if (res.status === 401)
      return {
        ok: false,
        error: "InvalidKey",
        message: "API key is invalid or revoked",
      };
    const body = await res.text().catch(() => "");
    return {
      ok: false,
      error: "InternalError",
      message: `HTTP ${res.status}: ${body.slice(0, 120)}`,
    };
  } catch (err) {
    return {
      ok: false,
      error: "NetworkError",
      message: err instanceof Error ? err.message : "Network error",
    };
  }
}

let registered = false;

export function registerAiSettingsIpc(): void {
  if (registered) return;
  registered = true;

  ipcMain.handle("ai:getSettings", (): AiSettings => readAiSettings());

  ipcMain.handle(
    "ai:setSettings",
    (_e, patch: unknown): { ok: boolean; error?: string } => {
      if (!patch || typeof patch !== "object")
        return { ok: false, error: "BadPayload" };
      try {
        writeAiSettings(patch as Partial<AiSettings>);
        return { ok: true };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "InternalError",
        };
      }
    },
  );

  ipcMain.handle("ai:hasKey", (): boolean => secretStore.has(ANTHROPIC_KEY));

  ipcMain.handle(
    "ai:setKey",
    async (_e, value: unknown): Promise<{ ok: boolean; error?: string }> => {
      if (typeof value !== "string" || value.trim().length === 0) {
        return { ok: false, error: "InvalidValue" };
      }
      try {
        secretStore.set(ANTHROPIC_KEY, value.trim());
        return { ok: true };
      } catch (e) {
        if (e instanceof EncryptionUnavailableError)
          return { ok: false, error: "EncryptionUnavailable" };
        return { ok: false, error: "InternalError" };
      }
    },
  );

  ipcMain.handle("ai:clearKey", (): boolean => {
    try {
      secretStore.delete(ANTHROPIC_KEY);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle("ai:testConnection", async (): Promise<AiTestResult> => {
    if (!secretStore.has(ANTHROPIC_KEY)) return { ok: false, error: "NoKey" };
    const key = secretStore.get(ANTHROPIC_KEY);
    if (!key) return { ok: false, error: "NoKey" };
    return testAnthropicKey(key);
  });
}
