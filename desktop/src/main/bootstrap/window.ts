import { BrowserWindow, shell } from "electron";
import { join } from "node:path";
import windowStateKeeper from "electron-window-state";

export function createMainWindow(
  mainDir: string,
  isDev: boolean,
): BrowserWindow {
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
      preload: join(mainDir, "../preload/index.cjs"),
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
    void win.loadFile(join(mainDir, "../renderer/index.html"));
  }

  return win;
}
