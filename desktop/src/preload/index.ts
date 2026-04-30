import { contextBridge } from "electron";
import { authBridge } from "./auth";
import { dbBridge } from "./db";
import { inboxBridge } from "./inbox";
import { logBridge } from "./log";
import { secretsBridge } from "./secrets";
import { syncBridge } from "./sync";
import { focusBridge } from "./focus";
import { planBridge } from "./plan";
import { quickplanBridge } from "./quickplan";
import { eventsBridge, tasksBridge } from "./today";
import { triageBridge } from "./triage";
import type { CalmlyApi } from "./api-types";

const calmlyApi: CalmlyApi = {
  version: "0.0.0",
  platform: process.platform,
  db: dbBridge,
  secrets: secretsBridge,
  sync: syncBridge,
  auth: authBridge,
  inbox: inboxBridge,
  tasks: tasksBridge,
  events: eventsBridge,
  triage: triageBridge,
  plan: planBridge,
  focus: focusBridge,
  quickplan: quickplanBridge,
  log: logBridge,
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("calmly", calmlyApi);
} else {
  (globalThis as unknown as { calmly: CalmlyApi }).calmly = calmlyApi;
}
