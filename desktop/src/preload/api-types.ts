export interface DbHealth {
  ok: boolean;
  version: number;
  walMode: string;
  fts5: boolean;
}

export interface DbBridge {
  health(): Promise<DbHealth>;
}

export interface CalmlyApi {
  version: string;
  platform: string;
  db: DbBridge;
}
