import { useEffect, useState } from "react";

// REL-07: tells the sidebar whether an active Focus session is currently on
// screen, so the update-ready pill (and anything else anti-nag) can suppress
// itself there — the app must never call attention to itself over a Focus
// session. Re-checks on route change (covers entering/leaving /focus) and,
// while parked on /focus, on a light poll (covers a session starting or
// ending without a navigation, e.g. "Start ad-hoc focus").
const POLL_MS = 3_000;

export function useActiveFocusSession(pathname: string): boolean {
  const [active, setActive] = useState(false);
  const onFocusRoute = pathname.startsWith("/focus");

  useEffect(() => {
    if (!onFocusRoute) {
      // Off the Focus route entirely — there is no Focus session view on
      // screen to protect, regardless of whether a session is open.
      setActive(false);
      return;
    }

    let cancelled = false;

    async function check(): Promise<void> {
      try {
        const res = await window.calmly.focus.current();
        if (!cancelled) setActive(res.ok && res.session !== null);
      } catch {
        if (!cancelled) setActive(false);
      }
    }

    void check();
    const interval = setInterval(() => void check(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [onFocusRoute]);

  return active;
}
