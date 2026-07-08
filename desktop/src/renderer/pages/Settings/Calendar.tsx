// CAL-07: Settings → Calendar page.
// Displays connected Google and Microsoft calendar accounts with connect,
// disconnect, and refresh controls.
import { useState, useEffect, useCallback } from "react";
import {
  CalendarDays,
  Loader2,
  RefreshCw,
  Unlink,
  AlertTriangle,
} from "lucide-react";
import type { CalendarAccount } from "@calmly/shared";

type DisconnectState =
  | { kind: "idle" }
  | { kind: "confirm"; accountId: string }
  | { kind: "removing"; accountId: string };

type RefreshState = { [accountId: string]: "loading" | "done" | "error" };

const STATUS_LABELS: Record<CalendarAccount["status"], string> = {
  connected: "Connected",
  disconnected: "Disconnected",
  error: "Error",
  reauth_required: "Needs reauth",
};

const STATUS_CLASSES: Record<CalendarAccount["status"], string> = {
  connected: "bg-emerald-50 text-emerald-700 border-emerald-200",
  disconnected: "bg-stone-100 text-stone-500 border-stone-200",
  error: "bg-red-50 text-red-600 border-red-200",
  reauth_required: "bg-amber-50 text-amber-700 border-amber-200",
};

interface AccountRowProps {
  account: CalendarAccount;
  refreshState: "loading" | "done" | "error" | undefined;
  disconnectState: DisconnectState;
  onRefresh: (id: string) => void;
  onDisconnectRequest: (id: string) => void;
  onDisconnectConfirm: (id: string) => void;
  onDisconnectCancel: () => void;
  onReconnect: (provider: CalendarAccount["provider"]) => void;
}

function AccountRow({
  account,
  refreshState,
  disconnectState,
  onRefresh,
  onDisconnectRequest,
  onDisconnectConfirm,
  onDisconnectCancel,
  onReconnect,
}: AccountRowProps) {
  const isRemoving =
    disconnectState.kind === "removing" &&
    disconnectState.accountId === account.id;
  const isConfirming =
    disconnectState.kind === "confirm" &&
    disconnectState.accountId === account.id;

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-stone-200 bg-stone-50/60 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-stone-800 truncate">
            {account.email}
          </p>
          <span
            className={[
              "mt-0.5 inline-block text-[10px] font-medium px-2 py-0.5 rounded-full border",
              STATUS_CLASSES[account.status],
            ].join(" ")}
          >
            {STATUS_LABELS[account.status]}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {account.status === "reauth_required" && (
            <button
              type="button"
              onClick={() => onReconnect(account.provider)}
              className="text-xs px-3 py-1.5 rounded-xl bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors font-medium"
            >
              Reconnect
            </button>
          )}
          <button
            type="button"
            aria-label={`Refresh ${account.email}`}
            disabled={refreshState === "loading"}
            onClick={() => onRefresh(account.id)}
            className="p-1.5 rounded-xl text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors disabled:opacity-40"
          >
            {refreshState === "loading" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
          </button>
          <button
            type="button"
            aria-label={`Disconnect ${account.email}`}
            disabled={isRemoving}
            onClick={() => onDisconnectRequest(account.id)}
            className="p-1.5 rounded-xl text-stone-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
          >
            {isRemoving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Unlink size={14} />
            )}
          </button>
        </div>
      </div>

      {isConfirming && (
        <div className="flex items-center gap-3 pt-1 border-t border-stone-200">
          <AlertTriangle size={12} className="text-red-400 shrink-0" />
          <p className="text-xs text-stone-500 flex-1">
            Disconnect <span className="font-medium">{account.email}</span>?
            Imported events will be removed.
          </p>
          <button
            type="button"
            onClick={() => onDisconnectConfirm(account.id)}
            className="text-xs px-2.5 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors font-medium"
          >
            Disconnect
          </button>
          <button
            type="button"
            onClick={onDisconnectCancel}
            className="text-xs px-2.5 py-1 rounded-lg text-stone-500 hover:bg-stone-100 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

type ProviderAccounts = {
  google: CalendarAccount[];
  microsoft: CalendarAccount[];
};

function groupByProvider(accounts: CalendarAccount[]): ProviderAccounts {
  return {
    google: accounts.filter((a) => a.provider === "google"),
    microsoft: accounts.filter((a) => a.provider === "microsoft"),
  };
}

interface ConnectButtonProps {
  provider: "Google" | "Microsoft";
  loading: boolean;
  onClick: () => void;
}

function ConnectButton({ provider, loading, onClick }: ConnectButtonProps) {
  return (
    <button
      type="button"
      disabled={loading}
      onClick={onClick}
      className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-stone-100 text-stone-700 text-sm font-medium hover:bg-stone-200 disabled:opacity-40 transition-colors"
    >
      {loading && <Loader2 size={13} className="animate-spin" />}
      {loading ? "Connecting…" : `Connect ${provider}`}
    </button>
  );
}

export function SettingsCalendar() {
  const [accounts, setAccounts] = useState<CalendarAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectingGoogle, setConnectingGoogle] = useState(false);
  const [connectingMicrosoft, setConnectingMicrosoft] = useState(false);
  const [disconnectState, setDisconnectState] = useState<DisconnectState>({
    kind: "idle",
  });
  const [refreshStates, setRefreshStates] = useState<RefreshState>({});
  const [error, setError] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    const r = await window.calmly.calendar.listAccounts();
    if (r.ok) setAccounts(r.accounts);
  }, []);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        await loadAccounts();
      } finally {
        setLoading(false);
      }
    })();

    const unsub = window.calmly.calendar.onAccountStatusChanged(() => {
      void loadAccounts();
    });
    return unsub;
  }, [loadAccounts]);

  async function handleConnectGoogle() {
    setConnectingGoogle(true);
    setError(null);
    try {
      const r = await window.calmly.calendar.connectGoogle();
      if (!r.ok)
        setError(
          r.error === "not_signed_in" ? "Sign in first." : "Connection failed.",
        );
      else await loadAccounts();
    } finally {
      setConnectingGoogle(false);
    }
  }

  async function handleConnectMicrosoft() {
    setConnectingMicrosoft(true);
    setError(null);
    try {
      const r = await window.calmly.calendar.connectMicrosoft();
      if (!r.ok)
        setError(
          r.error === "not_signed_in" ? "Sign in first." : "Connection failed.",
        );
      else await loadAccounts();
    } finally {
      setConnectingMicrosoft(false);
    }
  }

  function handleDisconnectRequest(accountId: string) {
    setDisconnectState({ kind: "confirm", accountId });
  }

  async function handleDisconnectConfirm(accountId: string) {
    setDisconnectState({ kind: "removing", accountId });
    try {
      const r = await window.calmly.calendar.disconnect(accountId);
      if (!r.ok) setError("Failed to disconnect account.");
      else await loadAccounts();
    } finally {
      setDisconnectState({ kind: "idle" });
    }
  }

  async function handleRefresh(accountId: string) {
    setRefreshStates((s) => ({ ...s, [accountId]: "loading" }));
    try {
      await window.calmly.calendar.refresh(accountId);
      setRefreshStates((s) => ({ ...s, [accountId]: "done" }));
      setTimeout(
        () =>
          setRefreshStates((s) => {
            const n = { ...s };
            delete n[accountId];
            return n;
          }),
        2000,
      );
    } catch {
      setRefreshStates((s) => ({ ...s, [accountId]: "error" }));
    }
  }

  function handleReconnect(provider: CalendarAccount["provider"]) {
    if (provider === "google") void handleConnectGoogle();
    else void handleConnectMicrosoft();
  }

  const grouped = groupByProvider(accounts);
  const isEmpty = accounts.length === 0;

  return (
    <div className="px-10 py-12 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-9 h-9 rounded-2xl bg-stone-100 flex items-center justify-center">
          <CalendarDays size={18} className="text-stone-600" />
        </div>
        <div>
          <h1 className="font-serif italic text-2xl text-stone-800 leading-tight">
            Calendar
          </h1>
          <p className="text-xs text-stone-400 mt-0.5">
            See your existing commitments alongside your tasks in Plan.
          </p>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-500">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 text-stone-400 text-sm">
          <Loader2 size={14} className="animate-spin" />
          Loading…
        </div>
      ) : isEmpty ? (
        <div className="bg-white border border-stone-100 rounded-[1.8rem] p-8 shadow-sm text-center">
          <CalendarDays size={32} className="mx-auto text-stone-300 mb-4" />
          <p className="text-sm font-medium text-stone-700 mb-1">
            No calendar connected
          </p>
          <p className="text-xs text-stone-400 mb-6">
            Connect Google or Microsoft to see your existing commitments in
            Plan.
          </p>
          <div className="flex justify-center gap-3">
            <ConnectButton
              provider="Google"
              loading={connectingGoogle}
              onClick={() => void handleConnectGoogle()}
            />
            <ConnectButton
              provider="Microsoft"
              loading={connectingMicrosoft}
              onClick={() => void handleConnectMicrosoft()}
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {(["google", "microsoft"] as const).map((provider) => {
            const providerAccounts = grouped[provider];
            const label =
              provider === "google" ? "Google Calendar" : "Microsoft 365";
            const isConnecting =
              provider === "google" ? connectingGoogle : connectingMicrosoft;

            return (
              <div
                key={provider}
                className="bg-white border border-stone-100 rounded-[1.8rem] p-6 shadow-sm"
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-stone-400">
                    {label}
                  </span>
                  <ConnectButton
                    provider={provider === "google" ? "Google" : "Microsoft"}
                    loading={isConnecting}
                    onClick={
                      provider === "google"
                        ? () => void handleConnectGoogle()
                        : () => void handleConnectMicrosoft()
                    }
                  />
                </div>

                {providerAccounts.length === 0 ? (
                  <p className="text-xs text-stone-400 py-1">
                    No accounts connected.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {providerAccounts.map((account) => (
                      <AccountRow
                        key={account.id}
                        account={account}
                        refreshState={refreshStates[account.id]}
                        disconnectState={disconnectState}
                        onRefresh={(id) => void handleRefresh(id)}
                        onDisconnectRequest={handleDisconnectRequest}
                        onDisconnectConfirm={(id) =>
                          void handleDisconnectConfirm(id)
                        }
                        onDisconnectCancel={() =>
                          setDisconnectState({ kind: "idle" })
                        }
                        onReconnect={handleReconnect}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
