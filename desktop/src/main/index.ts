import { app, BrowserWindow, crashReporter, session, shell } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import windowStateKeeper from "electron-window-state";
import { closeDb, getDb, initDb } from "./db";
import { findDeepLinkInArgv, parseDeepLink } from "./auth/deeplink";
import {
  acquireSingleInstanceLock,
  installDeepLink,
} from "./auth/deeplink-install";
import {
  createAuthOrchestrator,
  type AuthOrchestrator,
  type RedeemResult,
} from "./auth/session";
import { createApiClient } from "./net/client";
import { registerAuthIpc } from "./ipc/auth";
import { registerDbIpc } from "./ipc/db";
import { registerLogIpc } from "./ipc/log";
import { registerSecretsIpc } from "./ipc/secrets";
import { registerSyncIpc } from "./ipc/sync";
import { createDesktopLogger } from "./logging";
import {
  configureElectronLog,
  electronLogTransport,
} from "./logging/electron-log-transport";
import { secretStoreSelfTest } from "./security/secretStore";
import { createSyncClient } from "./sync/client";
import { createSyncLoop, type SyncLoop } from "./sync/loop";

const __dirname = dirname(fileURLToPath(import.meta.url));

const isDev = !app.isPackaged;

const API_BASE_URL = process.env["CALMLY_SYNC_URL"] ?? "http://localhost:3001";

const DEEPLINK_RESULT_CHANNEL = "auth:deeplink-redeemed";

// LOG_PII opens a dev escape hatch that bypasses scrub. Hard-disabled in
// packaged builds regardless of the env value so a leaked .env can't drop
// PII into a user's log file.
const ALLOW_PII = !app.isPackaged && process.env["LOG_PII"] === "true";

// crashReporter must start before any failures we want to catch. Configured
// with uploadToServer:false so dumps stay local; an Epic 9 setting will flip
// this on with explicit user consent.
crashReporter.start({
  productName: "Calmly",
  uploadToServer: false,
  // submitURL is required by Linux/macOS even when uploadToServer is false.
  // Pointing at a clearly-disabled host is fine; nothing is ever sent.
  submitURL: "https://crash-disabled.calmly.invalid/",
  ignoreSystemCrashHandler: false,
});

// Initialize file logging at module scope so even pre-whenReady errors get
// captured. createDesktopLogger wraps the transport with scrub.
configureElectronLog();
const logger = createDesktopLogger({
  transport: electronLogTransport,
  allowPii: ALLOW_PII,
});
logger.info("desktop boot", {
  packaged: app.isPackaged,
  platform: process.platform,
  pid: process.pid,
});

let mainWindow: BrowserWindow | null = null;
const pendingDeepLinks: string[] = [];

function createMainWindow(): BrowserWindow {
  const mainWindowState = windowStateKeeper({
    defaultWidth: 1100,
    defaultHeight: 720,
  });

  const win = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: "#fafaf9",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: isDev,
    },
  });

  mainWindowState.manage(win);

  win.once("ready-to-show", () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev && process.env["ELECTRON_RENDERER_URL"]) {
    void win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return win;
}

const gotInstanceLock = acquireSingleInstanceLock();
if (!gotInstanceLock) {
  // Another instance is already running. The OS will have forwarded our argv
  // (which may include a calmly:// deep link) via the second-instance event.
  app.quit();
} else {
  // Register protocol + handlers BEFORE app.whenReady so open-url events that
  // fire during launch on macOS aren't lost. onUrl just buffers; the actual
  // redeem happens after we've built the orchestrator below.
  installDeepLink({
    onUrl: (url) => {
      pendingDeepLinks.push(url);
      tryFlushDeepLinks();
    },
  });

  let orchestrator: AuthOrchestrator | null = null;
  let windowReadyForDeepLinks = false;

  function dispatchRedeem(url: string): void {
    if (!orchestrator) return;
    const parsed = parseDeepLink(url);
    if (!parsed) return;
    void orchestrator.redeem(parsed.token).then((result: RedeemResult) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(DEEPLINK_RESULT_CHANNEL, result);
      }
    });
  }

  function tryFlushDeepLinks(): void {
    if (!orchestrator || !windowReadyForDeepLinks) return;
    while (pendingDeepLinks.length > 0) {
      const url = pendingDeepLinks.shift();
      if (url) dispatchRedeem(url);
    }
  }

  app.whenReady().then(() => {
    const dbInfo = initDb();
    console.log(
      `[calmly:db] open path=${dbInfo.path} version=${dbInfo.version} appliedNow=[${dbInfo.appliedNow.join(",")}]`,
    );
    registerDbIpc();
    registerSecretsIpc();
    registerLogIpc(logger);

    // Use Electron's session.fetch so Set-Cookie from the API automatically
    // populates the persistent cookie jar; subsequent requests (including the
    // sync client) attach the session cookie without our involvement.
    const apiClient = createApiClient({
      baseUrl: API_BASE_URL,
      // Electron's session.fetch handles the persistent cookie jar, so
      // Set-Cookie from the server is stored automatically and re-attached on
      // subsequent calls (including the sync client).
      fetchImpl: ((input: string | URL, init?: RequestInit) =>
        session.defaultSession.fetch(
          input as Parameters<typeof session.defaultSession.fetch>[0],
          init,
        )) as typeof fetch,
    });
    orchestrator = createAuthOrchestrator({
      client: apiClient,
      log: (msg, fields) => console.log(`[calmly:auth] ${msg}`, fields ?? {}),
    });
    registerAuthIpc(orchestrator);

    const syncLoop: SyncLoop = createSyncLoop({
      getDb,
      client: createSyncClient({
        baseUrl: API_BASE_URL,
        getCookieHeader: async () => {
          try {
            const cookies = await session.defaultSession.cookies.get({
              url: API_BASE_URL,
            });
            if (cookies.length === 0) return null;
            return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
          } catch {
            return null;
          }
        },
      }),
      log: (msg, fields) => console.log(`[calmly:sync] ${msg}`, fields ?? {}),
    });
    registerSyncIpc(syncLoop);
    syncLoop.start();

    if (isDev) {
      const r = secretStoreSelfTest();
      console.log(
        `[calmly:secrets] selftest ok=${r.ok} available=${r.available} ` +
          `cipherDifferent=${r.ciphertextDifferentFromPlaintext} ` +
          `roundtrip=${r.roundtripMatches}` +
          (r.error ? ` error=${r.error}` : ""),
      );
    }

    mainWindow = createMainWindow();
    mainWindow.webContents.once("did-finish-load", () => {
      windowReadyForDeepLinks = true;
      // Cold-start case: the OS launched the app via deep link, so the URL is
      // sitting in process.argv rather than coming through open-url.
      const coldUrl = findDeepLinkInArgv(process.argv);
      if (coldUrl) pendingDeepLinks.push(coldUrl);
      tryFlushDeepLinks();
    });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
        windowReadyForDeepLinks = false;
        mainWindow.webContents.once("did-finish-load", () => {
          windowReadyForDeepLinks = true;
          tryFlushDeepLinks();
        });
      } else {
        mainWindow?.show();
        mainWindow?.focus();
      }
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  closeDb();
});

app.on("web-contents-created", (_event, contents) => {
  contents.on("will-navigate", (event, url) => {
    const allowed = process.env["ELECTRON_RENDERER_URL"];
    if (allowed && url.startsWith(allowed)) return;
    if (url.startsWith("file://")) return;
    event.preventDefault();
    void shell.openExternal(url);
  });
});
