// CAL-06: Banner shown when one or more calendar accounts need re-authentication.
// Renders at the top of pages that display calendar data (Plan, Settings).
// Non-punishing per PRD voice — calm, action-forward copy.
import { useState, useEffect, useCallback } from "react";
import { RefreshCw, X } from "lucide-react";
import type { CalendarAccount } from "@calmly/shared";

export function CalendarReauthBanner() {
  const [staleAccounts, setStaleAccounts] = useState<CalendarAccount[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [reconnecting, setReconnecting] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    const r = await window.calmly.calendar.listAccounts();
    if (r.ok) {
      setStaleAccounts(r.accounts.filter((a) => a.status === "reauth_required"));
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
    const unsub = window.calmly.calendar.onAccountStatusChanged(() => {
      setDismissed(false);
      void loadAccounts();
    });
    return unsub;
  }, [loadAccounts]);

  async function handleReconnect(account: CalendarAccount) {
    setReconnecting(account.id);
    try {
      if (account.provider === "google") {
        await window.calmly.calendar.connectGoogle();
      } else {
        await window.calmly.calendar.connectMicrosoft();
      }
      await loadAccounts();
    } finally {
      setReconnecting(null);
    }
  }

  if (dismissed || staleAccounts.length === 0) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3"
    >
      <RefreshCw size={14} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-amber-800">
          {staleAccounts.length === 1
            ? "Your calendar needs to reconnect. Nothing is lost — just sign back in."
            : `${staleAccounts.length} calendar accounts need to reconnect.`}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {staleAccounts.map((account) => (
            <button
              key={account.id}
              type="button"
              disabled={reconnecting === account.id}
              onClick={() => void handleReconnect(account)}
              className="text-[11px] px-3 py-1 rounded-xl bg-amber-100 text-amber-800 hover:bg-amber-200 disabled:opacity-50 transition-colors font-medium"
            >
              {reconnecting === account.id ? "Connecting…" : `Reconnect ${account.email}`}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
        className="p-1 rounded-xl text-amber-400 hover:text-amber-600 hover:bg-amber-100 transition-colors"
      >
        <X size={12} />
      </button>
    </div>
  );
}
