import { contextBridge } from "electron";
import { authBridge } from "./auth";
import { calendarBridge } from "./calendar";
import { dbBridge } from "./db";
import { inboxBridge } from "./inbox";
import { logBridge } from "./log";
import { secretsBridge } from "./secrets";
import { syncBridge } from "./sync";
import { focusBridge } from "./focus";
import { planBridge } from "./plan";
import { quickplanBridge } from "./quickplan";
import { replanBridge } from "./replan";
import { reviewBridge } from "./review";
import { eventsBridge, tasksBridge } from "./today";
import { triageBridge } from "./triage";
import { settingsBridge } from "./settings";
import { searchBridge } from "./search";
import { aiSettingsBridge } from "./aiSettings";
import { crashBridge } from "./crash";
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
  replan: replanBridge,
  review: reviewBridge,
  log: logBridge,
  settings: settingsBridge,
  search: searchBridge,
  calendar: calendarBridge,
  ai: aiSettingsBridge,
  crash: crashBridge,
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("calmly", calmlyApi);
} else {
  (globalThis as unknown as { calmly: CalmlyApi }).calmly = calmlyApi;
}
