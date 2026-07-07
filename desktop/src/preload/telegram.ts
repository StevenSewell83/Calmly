import { ipcRenderer } from "electron";
import type {
  TelegramBridge,
  TelegramCreateCodeResult,
  TelegramLinkingStatusResult,
  TelegramUnlinkResult,
} from "./api-types";

export const telegramBridge: TelegramBridge = {
  getStatus(): Promise<TelegramLinkingStatusResult> {
    return ipcRenderer.invoke("telegram:getStatus") as Promise<TelegramLinkingStatusResult>;
  },
  createLinkingCode(): Promise<TelegramCreateCodeResult> {
    return ipcRenderer.invoke(
      "telegram:createLinkingCode",
    ) as Promise<TelegramCreateCodeResult>;
  },
  unlink(): Promise<TelegramUnlinkResult> {
    return ipcRenderer.invoke("telegram:unlink") as Promise<TelegramUnlinkResult>;
  },
};
