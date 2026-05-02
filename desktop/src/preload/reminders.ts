import { ipcRenderer } from "electron";
import type {
  RemindersBridge,
  RemindersDeleteResult,
  RemindersGetResult,
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
};
