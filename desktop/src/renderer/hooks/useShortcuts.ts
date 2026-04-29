import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export interface ShortcutHandlers {
  openSearch: () => void;
  closeOverlay: () => void;
}

const ROUTE_BY_DIGIT: Record<string, string> = {
  "1": "/",
  "2": "/inbox",
  "3": "/plan",
  "4": "/focus",
  "5": "/review",
  "6": "/settings/account",
};

function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable === true;
}

export function useShortcuts(handlers: ShortcutHandlers): void {
  const navigate = useNavigate();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey;

      if (e.key === "Escape" && !mod) {
        handlers.closeOverlay();
        return;
      }

      if (!mod) return;

      if (e.key.toLowerCase() === "k") {
        if (isTextField(e.target) && !e.altKey) {
          // Cmd/Ctrl+K from inside an input still opens search — capture
          // ergonomics > losing the keystroke. The capture flow can later
          // claim K with a stopPropagation.
        }
        e.preventDefault();
        handlers.openSearch();
        return;
      }

      const route = ROUTE_BY_DIGIT[e.key];
      if (route) {
        if (isTextField(e.target)) return;
        e.preventDefault();
        navigate(route);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [navigate, handlers]);
}
