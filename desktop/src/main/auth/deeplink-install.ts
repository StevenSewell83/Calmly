import { app } from "electron";
import { findDeepLinkInArgv, PROTOCOL } from "./deeplink";

export interface DeepLinkInstall {
  unregister(): void;
}

export interface InstallDeepLinkArgs {
  onUrl: (url: string) => void;
}

// Registers calmly:// as a protocol client and routes every observed deep-link
// URL into onUrl. Side-effecting; call exactly once at startup. The
// single-instance lock that guarantees second-instance fires must be acquired
// separately (see acquireSingleInstanceLock).
export function installDeepLink(args: InstallDeepLinkArgs): DeepLinkInstall {
  app.setAsDefaultProtocolClient(PROTOCOL);

  const openUrlHandler = (event: Electron.Event, url: string) => {
    event.preventDefault();
    args.onUrl(url);
  };
  const secondInstanceHandler = (
    _event: Electron.Event,
    argv: string[],
  ) => {
    const url = findDeepLinkInArgv(argv);
    if (url) args.onUrl(url);
  };

  app.on("open-url", openUrlHandler);
  app.on("second-instance", secondInstanceHandler);

  return {
    unregister() {
      app.off("open-url", openUrlHandler);
      app.off("second-instance", secondInstanceHandler);
    },
  };
}

// Returns true if this process owns the single-instance lock. When false, the
// caller should app.quit() — the URL has already been forwarded to the
// instance that owns the lock via the second-instance event.
export function acquireSingleInstanceLock(): boolean {
  return app.requestSingleInstanceLock();
}
