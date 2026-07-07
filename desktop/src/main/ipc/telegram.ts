// TGR-06: Telegram linking IPC — thin pass-through to the TG-02b server
// routes (server/src/telegram/linkingRoutes.ts) via the shared ApiClient.
// No local DB state: the server is the source of truth for the link.
import { ipcMain } from "electron";
import { getCurrentUser } from "../auth/currentUser";
import type { ApiClient } from "../net/client";
import { ApiHttpError, ApiNetworkError } from "../net/client";
import type {
  TelegramCreateCodeResult,
  TelegramLinkingStatusResult,
  TelegramUnlinkResult,
} from "../../preload/api-types";

export interface TelegramIpcDeps {
  apiClient: ApiClient;
}

type ServerLinkingStatus =
  | { linked: false }
  | { linked: true; chatId: string; linkedAt: number };

// Shared across the three handlers: NotSignedIn wins locally (no round trip
// needed), a 401 from the server means the cached user is stale, anything
// else network-shaped is NetworkError, everything else is InternalError.
function mapNetError(err: unknown): "NotSignedIn" | "NetworkError" | "InternalError" {
  if (err instanceof ApiHttpError && err.status === 401) return "NotSignedIn";
  if (err instanceof ApiNetworkError) return "NetworkError";
  return "InternalError";
}

let registered = false;

export function registerTelegramIpc(deps: TelegramIpcDeps): void {
  if (registered) return;
  registered = true;

  ipcMain.handle(
    "telegram:getStatus",
    async (): Promise<TelegramLinkingStatusResult> => {
      const user = getCurrentUser();
      if (!user) return { ok: false, error: "NotSignedIn" };
      try {
        const res = await deps.apiClient.request<ServerLinkingStatus>(
          "GET",
          "/telegram/linking/status",
        );
        return { ok: true, ...res.body };
      } catch (err) {
        return { ok: false, error: mapNetError(err) };
      }
    },
  );

  ipcMain.handle(
    "telegram:createLinkingCode",
    async (): Promise<TelegramCreateCodeResult> => {
      const user = getCurrentUser();
      if (!user) return { ok: false, error: "NotSignedIn" };

      let code: string;
      let expiresAt: number;
      try {
        const res = await deps.apiClient.request<{ code: string; expiresAt: number }>(
          "POST",
          "/telegram/linking/code",
        );
        code = res.body.code;
        expiresAt = res.body.expiresAt;
      } catch (err) {
        if (err instanceof ApiHttpError && err.status === 429) {
          return { ok: false, error: "RateLimited" };
        }
        return { ok: false, error: mapNetError(err) };
      }

      // Bot username is cosmetic (renders the t.me deep link + copy button
      // label). Best-effort only — if /telegram/health is unreachable the
      // code itself is still usable, so we don't fail the whole request.
      let botUsername: string | null = null;
      try {
        const health = await deps.apiClient.request<{ botUsername?: string }>(
          "GET",
          "/telegram/health",
        );
        botUsername = health.body.botUsername ?? null;
      } catch {
        botUsername = null;
      }

      return { ok: true, code, expiresAt, botUsername };
    },
  );

  ipcMain.handle(
    "telegram:unlink",
    async (): Promise<TelegramUnlinkResult> => {
      const user = getCurrentUser();
      if (!user) return { ok: false, error: "NotSignedIn" };
      try {
        await deps.apiClient.request("POST", "/telegram/linking/unlink");
        return { ok: true };
      } catch (err) {
        return { ok: false, error: mapNetError(err) };
      }
    },
  );
}

// Test helper — the IPC singleton resets cleanly between specs.
export function __resetTelegramIpcForTests(): void {
  registered = false;
}
