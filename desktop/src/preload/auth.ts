import { ipcRenderer } from "electron";
import type {
  AuthBridge,
  RedeemResult,
  RequestLinkResult,
  StatusResult,
} from "./api-types";

const DEEPLINK_CHANNEL = "auth:deeplink-redeemed";

export const authBridge: AuthBridge = {
  status(): Promise<StatusResult> {
    return ipcRenderer.invoke("auth:status") as Promise<StatusResult>;
  },
  requestLink(email: string): Promise<RequestLinkResult> {
    return ipcRenderer.invoke("auth:requestLink", email) as Promise<
      RequestLinkResult
    >;
  },
  redeem(token: string): Promise<RedeemResult> {
    return ipcRenderer.invoke("auth:redeem", token) as Promise<RedeemResult>;
  },
  signOut(): Promise<{ ok: true }> {
    return ipcRenderer.invoke("auth:signOut") as Promise<{ ok: true }>;
  },
  onDeepLinkRedeemed(handler: (payload: RedeemResult) => void): () => void {
    const wrapped = (_e: unknown, payload: RedeemResult) => handler(payload);
    ipcRenderer.on(DEEPLINK_CHANNEL, wrapped);
    return () => {
      ipcRenderer.off(DEEPLINK_CHANNEL, wrapped);
    };
  },
};
