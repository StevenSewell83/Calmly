import { useEffect } from "react";

// Fires `onClose` when the user presses Escape. Used by modals, pickers,
// and panels that need to close on Escape without wiring a raw addEventListener
// in each component.
//
// Pass a stable reference (useCallback or module-level function) so the
// effect doesn't re-register on every render.
export function useEscapeKey(onClose: () => void, active = true): void {
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, active]);
}
