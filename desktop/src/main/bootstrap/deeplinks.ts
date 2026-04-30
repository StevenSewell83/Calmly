import type { BrowserWindow } from "electron";
import { findDeepLinkInArgv, parseDeepLink } from "../auth/deeplink";
import { installDeepLink } from "../auth/deeplink-install";
import type { AuthOrchestrator, RedeemResult } from "../auth/session";

const DEEPLINK_RESULT_CHANNEL = "auth:deeplink-redeemed";

export interface DeepLinkBootstrap {
  // Call once: registers the OS protocol handler and buffers incoming URLs.
  install(): void;
  // Call after the orchestrator and window are ready to drain the buffer.
  setReady(orchestrator: AuthOrchestrator, mainWindow: () => BrowserWindow | null): void;
  // Cold-start: push a link from process.argv and flush.
  pushFromArgv(argv: string[]): void;
}

export function createDeepLinkBootstrap(): DeepLinkBootstrap {
  const pending: string[] = [];
  let orch: AuthOrchestrator | null = null;
  let getWin: (() => BrowserWindow | null) | null = null;
  let windowReady = false;

  function dispatch(url: string): void {
    if (!orch) return;
    const parsed = parseDeepLink(url);
    if (!parsed) return;
    void orch.redeem(parsed.token).then((result: RedeemResult) => {
      const win = getWin?.();
      if (win && !win.isDestroyed()) {
        win.webContents.send(DEEPLINK_RESULT_CHANNEL, result);
      }
    });
  }

  function tryFlush(): void {
    if (!orch || !windowReady) return;
    while (pending.length > 0) {
      const url = pending.shift();
      if (url) dispatch(url);
    }
  }

  return {
    install() {
      installDeepLink({
        onUrl: (url) => {
          pending.push(url);
          tryFlush();
        },
      });
    },
    setReady(orchestrator, mainWindow) {
      orch = orchestrator;
      getWin = mainWindow;
      windowReady = true;
      tryFlush();
    },
    pushFromArgv(argv) {
      const url = findDeepLinkInArgv(argv);
      if (url) {
        pending.push(url);
        tryFlush();
      }
    },
  };
}
