import { useEffect, useState } from "react";
import type { UpdateStatus } from "@calmly/shared";
import { idleUpdateStatus } from "@calmly/shared";

// REL-07: shared subscription to the REL-06 update state machine —
// hydrates via getStatus() on mount, then stays live via the
// updates:status-changed push channel. Used by both the Settings → Updates
// card and the sidebar "ready" pill so they never disagree.
export function useUpdateStatus(): UpdateStatus {
  const [status, setStatus] = useState<UpdateStatus>(idleUpdateStatus());

  useEffect(() => {
    let cancelled = false;
    window.calmly.updates
      .getStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        // Non-critical hydration — the push subscription below can still
        // bring the UI current once a status change fires.
      });
    const unsubscribe = window.calmly.updates.onStatusChanged((s) => {
      if (!cancelled) setStatus(s);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return status;
}
