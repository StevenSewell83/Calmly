import { ipcMain } from "electron";
import type {
  AuthOrchestrator,
  RedeemResult,
  RequestLinkResult,
  StatusResult,
} from "../auth/session";

let registered = false;

export function registerAuthIpc(orchestrator: AuthOrchestrator): void {
  if (registered) return;
  registered = true;

  ipcMain.handle("auth:status", async (): Promise<StatusResult> => {
    return orchestrator.status();
  });

  ipcMain.handle(
    "auth:requestLink",
    async (_e, email: unknown): Promise<RequestLinkResult> => {
      if (typeof email !== "string") {
        return { ok: false, error: "invalid_email" };
      }
      return orchestrator.requestLink(email);
    },
  );

  ipcMain.handle(
    "auth:redeem",
    async (_e, token: unknown): Promise<RedeemResult> => {
      if (typeof token !== "string") {
        return { ok: false, error: "invalid_request" };
      }
      return orchestrator.redeem(token);
    },
  );

  ipcMain.handle("auth:signOut", async (): Promise<{ ok: true }> => {
    return orchestrator.signOut();
  });
}
