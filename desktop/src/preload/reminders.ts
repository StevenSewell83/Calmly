import { ipcRenderer } from "electron";
import type {
  ReminderDefaults,
  RemindersBridge,
  RemindersDeleteResult,
  RemindersGetDefaultsResult,
  RemindersGetResult,
  RemindersSetDefaultsResult,
  RemindersUpsertArgs,
  RemindersUpsertResult,
} from "./api-types";

export const remindersBridge: RemindersBridge = {
  get(taskId: string): Promise<RemindersGetResult> {
    return ipcRenderer.invoke("reminders:get", { taskId }) as Promise<RemindersGetResult>;
  },
  upsert(args: RemindersUpsertArgs): Promise<RemindersUpsertResult> {
    return ipcRenderer.invoke("reminders:upsert", args) as Promise<RemindersUpsertResult>;
  },
  delete(taskId: string): Promise<RemindersDeleteResult> {
    return ipcRenderer.invoke("reminders:delete", { taskId }) as Promise<RemindersDeleteResult>;
  },
  getDefaults(): Promise<RemindersGetDefaultsResult> {
    return ipcRenderer.invoke("reminders:getDefaults") as Promise<RemindersGetDefaultsResult>;
  },
  setDefaults(patch: Partial<ReminderDefaults>): Promise<RemindersSetDefaultsResult> {
    return ipcRenderer.invoke("reminders:setDefaults", patch) as Promise<RemindersSetDefaultsResult>;
  },
};
