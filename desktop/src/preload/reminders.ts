import { ipcRenderer } from "electron";
import type {
  ReminderDefaults,
  ReminderOpenTaskPayload,
  RemindersBridge,
  RemindersDeleteResult,
  RemindersGetDefaultsResult,
  RemindersGetResult,
  RemindersSetDefaultsResult,
  RemindersUpsertArgs,
  RemindersUpsertResult,
} from "./api-types";

// Mirrors main/reminders/notifier.ts's OPEN_TASK_CHANNEL constant — kept as
// a literal here (not imported) since preload can't pull in main's module
// graph, same convention as focus.ts's ADHOC_FOCUS_CHANNEL.
const OPEN_TASK_CHANNEL = "reminders:open-task";

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
  onOpenTask(handler: (payload: ReminderOpenTaskPayload) => void): () => void {
    const wrapped = (_event: unknown, payload: ReminderOpenTaskPayload): void => handler(payload);
    ipcRenderer.on(OPEN_TASK_CHANNEL, wrapped);
    return () => { ipcRenderer.off(OPEN_TASK_CHANNEL, wrapped); };
  },
};
