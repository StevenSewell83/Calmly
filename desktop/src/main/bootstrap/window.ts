import { BrowserWindow, shell } from "electron";
import { join } from "node:path";
import windowStateKeeper from "electron-window-state";
// electron-vite `?asset` import: resolved to a real file on disk at build
// time (dev and packaged alike), so `icon` below is always a valid path —
// see desktop/build/icon.svg for the editable source.
import icon from "../../../build/icon.png?asset";

export function createMainWindow(mainDir: string, isDev: boolean): BrowserWindow {
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
    // macOS/Windows use the icon embedded in the packaged app bundle/exe
    // (electron-builder mac.icon/win.icon); Linux windows don't inherit that
    // automatically, especially for AppImage/linux-unpacked runs with no
    // installed .desktop entry, so set it explicitly here.
    icon: process.platform === "linux" ? icon : undefined,
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
