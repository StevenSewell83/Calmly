import { ipcRenderer } from "electron";
import type { SecretSetResult, SecretsBridge } from "./api-types";

export const secretsBridge: SecretsBridge = {
  setKey(key: string, value: string): Promise<SecretSetResult> {
    return ipcRenderer.invoke(
      "secrets:set",
      key,
      value,
    ) as Promise<SecretSetResult>;
  },
  hasKey(key: string): Promise<boolean> {
    return ipcRenderer.invoke("secrets:has", key) as Promise<boolean>;
  },
  clearKey(key: string): Promise<boolean> {
    return ipcRenderer.invoke("secrets:clear", key) as Promise<boolean>;
  },
};
