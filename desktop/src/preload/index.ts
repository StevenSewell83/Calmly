import { contextBridge } from "electron";
import { dbBridge } from "./db";
import type { CalmlyApi } from "./api-types";

const calmlyApi: CalmlyApi = {
  version: "0.0.0",
  platform: process.platform,
  db: dbBridge,
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("calmly", calmlyApi);
} else {
  (globalThis as unknown as { calmly: CalmlyApi }).calmly = calmlyApi;
}
