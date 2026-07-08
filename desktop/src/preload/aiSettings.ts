import { ipcRenderer } from "electron";
import type { AiBridge } from "./api-types";

export const aiSettingsBridge: AiBridge = {
  getSettings() {
    return ipcRenderer.invoke("ai:getSettings") as ReturnType<
      AiBridge["getSettings"]
    >;
  },
  setSettings(patch) {
    return ipcRenderer.invoke("ai:setSettings", patch) as ReturnType<
      AiBridge["setSettings"]
    >;
  },
  hasKey() {
    return ipcRenderer.invoke("ai:hasKey") as ReturnType<AiBridge["hasKey"]>;
  },
  setKey(value) {
    return ipcRenderer.invoke("ai:setKey", value) as ReturnType<
      AiBridge["setKey"]
    >;
  },
  clearKey() {
    return ipcRenderer.invoke("ai:clearKey") as ReturnType<
      AiBridge["clearKey"]
    >;
  },
  testConnection() {
    return ipcRenderer.invoke("ai:testConnection") as ReturnType<
      AiBridge["testConnection"]
    >;
  },
  run(action, payload, ownerType?, ownerId?) {
    return ipcRenderer.invoke(
      "ai:run",
      action,
      payload,
      ownerType,
      ownerId,
    ) as ReturnType<AiBridge["run"]>;
  },
  recordOutcome(suggestionId, outcome, editedJson?) {
    return ipcRenderer.invoke(
      "ai:recordOutcome",
      suggestionId,
      outcome,
      editedJson,
    ) as ReturnType<AiBridge["recordOutcome"]>;
  },
  getUsage() {
    return ipcRenderer.invoke("ai:getUsage") as ReturnType<
      AiBridge["getUsage"]
    >;
  },
};
