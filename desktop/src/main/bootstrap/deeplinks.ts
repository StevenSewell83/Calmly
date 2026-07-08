import type { BrowserWindow } from "electron";
import {
  findDeepLinkInArgv,
  parseDeepLink,
  type DeepLinkPayload,
} from "../auth/deeplink";
import { installDeepLink } from "../auth/deeplink-install";
import type { AuthOrchestrator, RedeemResult } from "../auth/session";

const DEEPLINK_RESULT_CHANNEL = "auth:deeplink-redeemed";

export type CalendarOAuthDeepLinkHandler = (payload: {
  provider: "google" | "microsoft";
  ticket: string;
}) => void;

export interface DeepLinkBootstrap {
  // Call once: registers the OS protocol handler and buffers incoming URLs.
  install(): void;
  // Call after the orchestrator and window are ready to drain the buffer.
  setReady(
    orchestrator: AuthOrchestrator,
    mainWindow: () => BrowserWindow | null,
  ): void;
  // Cold-start: push a link from process.argv and flush.
  pushFromArgv(argv: string[]): void;
  // Subscribe to calendar OAuth completions so calendar/<provider>OAuth.ts
  // can resolve its in-flight connect() call.
  onCalendarOAuth(handler: CalendarOAuthDeepLinkHandler): () => void;
}

export function createDeepLinkBootstrap(): DeepLinkBootstrap {
  const pending: string[] = [];
  let orch: AuthOrchestrator | null = null;
  let getWin: (() => BrowserWindow | null) | null = null;
  let windowReady = false;
  const calendarHandlers = new Set<CalendarOAuthDeepLinkHandler>();

  function dispatch(url: string): void {
    const parsed = parseDeepLink(url);
    if (!parsed) return;
    if (parsed.kind === "auth") {
      dispatchAuth(parsed);
      return;
    }
    if (parsed.kind === "calendar-oauth") {
      for (const handler of calendarHandlers) {
        try {
          handler({ provider: parsed.provider, ticket: parsed.ticket });
        } catch {
          // handlers are advisory; never let a bad subscriber kill the flow
        }
      }
    }
  }

  function dispatchAuth(
    payload: Extract<DeepLinkPayload, { kind: "auth" }>,
  ): void {
    if (!orch) return;
    void orch.redeem(payload.token).then((result: RedeemResult) => {
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
    onCalendarOAuth(handler) {
      calendarHandlers.add(handler);
      return () => {
        calendarHandlers.delete(handler);
      };
    },
  };
}
