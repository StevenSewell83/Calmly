// Returns the OS-appropriate modifier symbol for keyboard shortcut hints.
// On macOS this is ⌘; on Windows/Linux it is Ctrl.
// Evaluated once at module load — navigator.platform doesn't change at runtime.
export const META_SYMBOL: string =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform)
    ? "⌘"
    : "Ctrl+";
