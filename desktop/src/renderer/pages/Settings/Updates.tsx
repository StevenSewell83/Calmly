// REL-07: Settings → Updates card, driven entirely by the REL-06 IPC surface
// (window.calmly.updates). Anti-nag by design — no dialogs, no auto-restart;
// every state is a quiet row the user can act on (or ignore) at their own
// pace. Error copy follows PRD §13: what happened, what to do, nothing lost.
import { useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import type { UpdateErrorCode } from "@calmly/shared";
import { useUpdateStatus } from "../../hooks/useUpdateStatus";

function errorCopy(code: UpdateErrorCode | null): string {
  switch (code) {
    case "offline":
      return "Couldn't reach the update server. Check your connection and try again — nothing was changed.";
    case "http_4xx":
      return "The update server couldn't find that release. Try again later — nothing was changed.";
    case "http_5xx":
      return "The update server had a problem on its end. Try again later — nothing was changed.";
    case "corrupt_download":
      return "The downloaded update looked damaged, so it was discarded. Try again — nothing was installed.";
    case "unsigned_mac":
      return "This build isn't signed for automatic updates on this Mac. Download the latest release manually — nothing was changed.";
    default:
      return "Something went wrong checking for updates. Try again — nothing was changed.";
  }
}

function Button({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "px-5 py-2.5 rounded-2xl text-sm font-medium tracking-wide transition-colors",
        disabled
          ? "bg-stone-100 text-stone-400 cursor-not-allowed"
          : "bg-stone-900 text-white hover:bg-stone-800",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

export function SettingsUpdates() {
  const status = useUpdateStatus();
  const [version, setVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.calmly.settings
      .getAppVersion()
      .then((v) => {
        if (!cancelled) setVersion(v);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function runAction(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex-1 flex flex-col px-12 py-16 max-w-2xl">
      <h1 className="font-serif italic text-4xl tracking-tight text-stone-800">
        Updates
      </h1>

      <div className="mt-10 bg-white border border-stone-100 rounded-[1.8rem] p-6 shadow-sm">
        <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-stone-400">
          Current version
        </span>
        <p className="mt-2 text-lg text-stone-800 font-medium">
          {version ? `v${version}` : "…"}
        </p>

        <div className="mt-5 pt-5 border-t border-stone-100">
          {status.state === "disabled" && (
            <p className="text-sm text-stone-500">
              Updates are managed by the packaged app. This dev build checks
              for updates only after it's installed from a release.
            </p>
          )}

          {status.state === "idle" && (
            <div className="flex items-center gap-4">
              <span className="text-sm text-stone-600">Up to date.</span>
              <Button onClick={() => void runAction(() => window.calmly.updates.check())} disabled={busy}>
                Check for updates
              </Button>
            </div>
          )}

          {status.state === "checking" && (
            <div className="flex items-center gap-2 text-sm text-stone-500">
              <Loader2 size={14} className="animate-spin" />
              Checking for updates…
            </div>
          )}

          {status.state === "update-available" && (
            <div className="flex items-center gap-4">
              <span className="text-sm text-stone-600">
                Version {status.version ?? "?"} available.
              </span>
              <Button onClick={() => void runAction(() => window.calmly.updates.download())} disabled={busy}>
                Download
              </Button>
            </div>
          )}

          {status.state === "downloading" && (
            <div>
              <p className="text-sm text-stone-500 mb-3">
                Downloading update{status.version ? ` — v${status.version}` : ""}…
              </p>
              <div
                role="progressbar"
                aria-valuenow={status.progressPercent ?? 0}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-2 w-full rounded-full bg-stone-100 overflow-hidden"
              >
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all"
                  style={{ width: `${status.progressPercent ?? 0}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-stone-400">{status.progressPercent ?? 0}%</p>
            </div>
          )}

          {status.state === "ready" && (
            <div className="flex items-center gap-4">
              <span className="text-sm text-stone-600">
                Version {status.version ?? "?"} is ready — restart to finish installing.
              </span>
              <Button onClick={() => void runAction(() => window.calmly.updates.quitAndInstall())} disabled={busy}>
                Restart to update
              </Button>
            </div>
          )}

          {status.state === "error" && (
            <div>
              <p className="text-sm text-red-500">{errorCopy(status.errorCode)}</p>
              <div className="mt-3">
                <Button onClick={() => void runAction(() => window.calmly.updates.check())} disabled={busy}>
                  Retry
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <p className="mt-4 text-xs text-stone-400">
        Calmly checks for updates automatically in the background.
      </p>
    </section>
  );
}
