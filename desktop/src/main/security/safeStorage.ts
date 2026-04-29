import { safeStorage } from "electron";

export class EncryptionUnavailableError extends Error {
  constructor(
    message = "OS-level encryption is not available on this platform",
  ) {
    super(message);
    this.name = "EncryptionUnavailable";
  }
}

// Linux's safeStorage will silently fall back to a 'basic_text' backend that
// is NOT actually encrypted. We treat that as unavailable so callers refuse to
// persist secrets rather than persisting unprotected data.
function isLinuxBasicTextFallback(): boolean {
  if (process.platform !== "linux") return false;
  try {
    type WithBackend = typeof safeStorage & {
      getSelectedStorageBackend?: () => string;
    };
    const fn = (safeStorage as WithBackend).getSelectedStorageBackend;
    if (typeof fn !== "function") return false;
    return fn.call(safeStorage) === "basic_text";
  } catch {
    return false;
  }
}

export function isEncryptionAvailable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  if (isLinuxBasicTextFallback()) return false;
  return true;
}

export function encryptString(plain: string): Buffer {
  if (!isEncryptionAvailable()) throw new EncryptionUnavailableError();
  return safeStorage.encryptString(plain);
}

export function decryptString(cipher: Buffer): string {
  if (!isEncryptionAvailable()) throw new EncryptionUnavailableError();
  return safeStorage.decryptString(cipher);
}
