export interface DbHealth {
  ok: boolean;
  version: number;
  walMode: string;
  fts5: boolean;
}

export interface DbBridge {
  health(): Promise<DbHealth>;
}

export type SecretSetError =
  | "EncryptionUnavailable"
  | "InvalidKey"
  | "InvalidValue"
  | "InternalError";

export interface SecretSetResult {
  ok: boolean;
  error?: SecretSetError;
}

// The renderer only knows secret keys as strings. Validation of the allowlist
// happens in the main process — the renderer cannot bypass it by typing.
export interface SecretsBridge {
  setKey(key: string, value: string): Promise<SecretSetResult>;
  hasKey(key: string): Promise<boolean>;
  clearKey(key: string): Promise<boolean>;
  // Note: there is intentionally no getKey. Plaintext never crosses the IPC
  // boundary. Features that need a secret value perform their action in the
  // main process and only return derived results to the renderer.
}

export interface CalmlyApi {
  version: string;
  platform: string;
  db: DbBridge;
  secrets: SecretsBridge;
}
