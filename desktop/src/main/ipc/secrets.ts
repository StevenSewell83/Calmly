import { ipcMain } from "electron";
import { EncryptionUnavailableError } from "../security/safeStorage";
import {
  isValidSecretKey,
  secretStore,
  type SecretKey,
} from "../security/secretStore";

export type SecretSetError =
  | "EncryptionUnavailable"
  | "InvalidKey"
  | "InvalidValue"
  | "InternalError";

export interface SecretSetResult {
  ok: boolean;
  error?: SecretSetError;
}

let registered = false;

export function registerSecretsIpc(): void {
  if (registered) return;
  registered = true;

  ipcMain.handle(
    "secrets:set",
    (_e, key: unknown, value: unknown): SecretSetResult => {
      if (!isValidSecretKey(key)) return { ok: false, error: "InvalidKey" };
      if (typeof value !== "string" || value.length === 0) {
        return { ok: false, error: "InvalidValue" };
      }
      try {
        secretStore.set(key as SecretKey, value);
        return { ok: true };
      } catch (e) {
        if (e instanceof EncryptionUnavailableError) {
          return { ok: false, error: "EncryptionUnavailable" };
        }
        return { ok: false, error: "InternalError" };
      }
    },
  );

  ipcMain.handle("secrets:has", (_e, key: unknown): boolean => {
    if (!isValidSecretKey(key)) return false;
    try {
      return secretStore.has(key as SecretKey);
    } catch {
      return false;
    }
  });

  ipcMain.handle("secrets:clear", (_e, key: unknown): boolean => {
    if (!isValidSecretKey(key)) return false;
    try {
      secretStore.delete(key as SecretKey);
      return true;
    } catch {
      return false;
    }
  });
}
