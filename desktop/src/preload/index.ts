import { contextBridge } from "electron";
import { dbBridge } from "./db";
import { secretsBridge } from "./secrets";
import type { CalmlyApi } from "./api-types";

const calmlyApi: CalmlyApi = {
  version: "0.0.0",
  platform: process.platform,
  db: dbBridge,
  secrets: secretsBridge,
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("calmly", calmlyApi);
} else {
  (globalThis as unknown as { calmly: CalmlyApi }).calmly = calmlyApi;
}
