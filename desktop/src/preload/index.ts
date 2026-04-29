import { contextBridge } from "electron";

const calmlyApi = {
  version: "0.0.0",
  platform: process.platform,
} as const;

export type CalmlyApi = typeof calmlyApi;

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("calmly", calmlyApi);
} else {
  (globalThis as unknown as { calmly: CalmlyApi }).calmly = calmlyApi;
}
