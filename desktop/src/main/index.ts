import { app, BrowserWindow, crashReporter, session, shell } from "electron";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { closeDb, getDb, initDb } from "./db";
import { acquireSingleInstanceLock } from "./auth/deeplink-install";
import { createAuthOrchestrator } from "./auth/session";
import { wrapOrchestrator } from "./auth/orchestrator";
import { createApiClient } from "./net/client";
import { createConnectGoogle } from "./calendar/googleOAuth";
import { createConnectMicrosoft } from "./calendar/microsoftOAuth";
import { createDesktopLogger } from "./logging";
import {
  configureElectronLog,
  electronLogTransport,
} from "./logging/electron-log-transport";
import { secretStoreSelfTest } from "./security/secretStore";
import { registerCaptureHotkey, registerAdHocFocusHotkey, unregisterAllShortcuts } from "./shortcuts";
import { createMainWindow } from "./bootstrap/window";
import { createDeepLinkBootstrap } from "./bootstrap/deeplinks";
import { registerAllIpc } from "./bootstrap/ipc-register";
import { createSyncBootstrap } from "./bootstrap/sync-bootstrap";
import { runSearchBackfill } from "./search/backfill";

const __dirname = dirname(fileURLToPath(import.meta.url));

const isDev = !app.isPackaged;
const API_BASE_URL = process.env["CALMLY_SYNC_URL"] ?? "http://localhost:3001";
const ALLOW_PII = !app.isPackaged && process.env["LOG_PII"] === "true";

crashReporter.start({
  productName: "Calmly",
  uploadToServer: false,
  submitURL: "https://crash-disabled.calmly.invalid/",
  ignoreSystemCrashHandler: false,
});

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

const deepLinks = createDeepLinkBootstrap();
let mainWindow: BrowserWindow | null = null;
let activeSyncLoop: ReturnType<typeof createSyncBootstrap> | null = null;

const gotInstanceLock = acquireSingleInstanceLock();
if (!gotInstanceLock) {
  app.quit();
} else {
  deepLinks.install();

  app.whenReady().then(() => {
    const dbInfo = initDb();
    console.log(
      `[calmly:db] open path=${dbInfo.path} version=${dbInfo.version} appliedNow=[${dbInfo.appliedNow.join(",")}]`,
    );

    const apiClient = createApiClient({
      baseUrl: API_BASE_URL,
      fetchImpl: ((input: string | URL, init?: RequestInit) =>
        session.defaultSession.fetch(
          input as Parameters<typeof session.defaultSession.fetch>[0],
          init,
        )) as typeof fetch,
    });

    const orchestrator = wrapOrchestrator(
      createAuthOrchestrator({
        client: apiClient,
        log: (msg, fields) => console.log(`[calmly:auth] ${msg}`, fields ?? {}),
      }),
      getDb,
    );

    activeSyncLoop = createSyncBootstrap({ getDb, apiBaseUrl: API_BASE_URL });
    const connectGoogle = createConnectGoogle({
      apiBaseUrl: API_BASE_URL,
      apiClient,
      openExternal: (url: string) => shell.openExternal(url),
      subscribeDeepLink: deepLinks.onCalendarOAuth,
      log: (msg, fields) => logger.info(`[calmly:calendar:google] ${msg}`, fields ?? {}),
    });
    const connectMicrosoft = createConnectMicrosoft({
      apiBaseUrl: API_BASE_URL,
      apiClient,
      openExternal: (url: string) => shell.openExternal(url),
      subscribeDeepLink: deepLinks.onCalendarOAuth,
      log: (msg, fields) => logger.info(`[calmly:calendar:microsoft] ${msg}`, fields ?? {}),
    });
    registerAllIpc(orchestrator, activeSyncLoop, logger, {
      apiClient,
      connectGoogle,
      connectMicrosoft,
    });
    activeSyncLoop.start();

    // Kick off FTS backfill asynchronously after boot — no-op if already done.
    runSearchBackfill(getDb(), logger);

    if (isDev) {
      const r = secretStoreSelfTest();
      console.log(
        `[calmly:secrets] selftest ok=${r.ok} available=${r.available} ` +
          `cipherDifferent=${r.ciphertextDifferentFromPlaintext} ` +
          `roundtrip=${r.roundtripMatches}` +
          (r.error ? ` error=${r.error}` : ""),
      );
    }

    mainWindow = createMainWindow(__dirname, isDev);
    mainWindow.webContents.once("did-finish-load", () => {
      deepLinks.setReady(orchestrator, () => mainWindow);
      deepLinks.pushFromArgv(process.argv);
    });

    if (process.env["NODE_ENV"] !== "test") {
      const hotkey = registerCaptureHotkey(() => mainWindow);
      if (!hotkey.registered) {
        logger.warn("capture hotkey registration failed", {
          accelerator: "CmdOrCtrl+Shift+I",
        });
      }
      const focusHotkey = registerAdHocFocusHotkey(() => mainWindow);
      if (!focusHotkey.registered) {
        logger.warn("ad-hoc focus hotkey registration failed", {
          accelerator: "CmdOrCtrl+Shift+F",
        });
      }
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow(__dirname, isDev);
        mainWindow.webContents.once("did-finish-load", () => {
          deepLinks.setReady(orchestrator, () => mainWindow);
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
  activeSyncLoop?.stop();
  unregisterAllShortcuts();
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
