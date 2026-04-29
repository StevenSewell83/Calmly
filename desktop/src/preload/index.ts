import { contextBridge } from "electron";
import { authBridge } from "./auth";
import { dbBridge } from "./db";
import { secretsBridge } from "./secrets";
import { syncBridge } from "./sync";
import type { CalmlyApi } from "./api-types";

const calmlyApi: CalmlyApi = {
  version: "0.0.0",
  platform: process.platform,
  db: dbBridge,
  secrets: secretsBridge,
  sync: syncBridge,
  auth: authBridge,
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("calmly", calmlyApi);
} else {
  (globalThis as unknown as { calmly: CalmlyApi }).calmly = calmlyApi;
}
