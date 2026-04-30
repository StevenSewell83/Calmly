import { BrowserWindow, globalShortcut } from "electron";

// Default global shortcut for quick capture, per the CL-02 spec. The "I"
// reads as "Inbox" / "Idea" and matches the capture mental model. Note
// that on Windows/Linux this overlaps the renderer's devtools shortcut
// when the app is focused; that's a known dev-mode quirk and packaged
// builds don't expose devtools at all. Settings UI to remap is Epic 9.
export const CAPTURE_HOTKEY_DEFAULT = "CmdOrCtrl+Shift+I";
export const ADHOC_FOCUS_HOTKEY_DEFAULT = "CmdOrCtrl+Shift+F";

const FOCUS_CHANNEL = "capture:focus";
const ADHOC_FOCUS_CHANNEL = "focus:adhoc-open";

export interface CaptureHotkeyHandle {
  registered: boolean;
  unregister(): void;
}

// Registers the global hotkey that focuses the app and pulls focus to the
// CaptureBar. Returns whether registration succeeded so the caller can log.
// On registration failure (another app owns the combo, OS denied access)
// the in-app input still works — we don't crash, just lose the global path.
export function registerCaptureHotkey(
  getMainWindow: () => BrowserWindow | null,
  accelerator: string = CAPTURE_HOTKEY_DEFAULT,
): CaptureHotkeyHandle {
  const ok = globalShortcut.register(accelerator, () => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send(FOCUS_CHANNEL);
  });
  return {
    registered: ok,
    unregister() {
      if (ok) globalShortcut.unregister(accelerator);
    },
  };
}

// Convenience: tear down every registered shortcut. Call from app.before-quit
// or when the app is shutting down so we don't leave OS-level handlers
// pointing at a dead process.
export function unregisterAllShortcuts(): void {
  globalShortcut.unregisterAll();
}

export function registerAdHocFocusHotkey(
  getMainWindow: () => BrowserWindow | null,
  accelerator: string = ADHOC_FOCUS_HOTKEY_DEFAULT,
): CaptureHotkeyHandle {
  const ok = globalShortcut.register(accelerator, () => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send(ADHOC_FOCUS_CHANNEL);
  });
  return {
    registered: ok,
    unregister() {
      if (ok) globalShortcut.unregister(accelerator);
    },
  };
}

