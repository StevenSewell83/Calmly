// POL-03: Privacy settings — crash reporting toggle (separate from telemetry).
import { useEffect, useState } from "react";
import type { CrashStatus } from "../../../preload/api-types";

type LoadState = "loading" | "ready" | "error";

export function SettingsPrivacy() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [status, setStatus] = useState<CrashStatus | null>(null);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    window.calmly.crash
      .getStatus()
      .then((s) => {
        setStatus(s);
        setLoadState("ready");
      })
      .catch(() => setLoadState("error"));
  }, []);

  async function handleToggle() {
    if (!status || toggling) return;
    setToggling(true);
    const next = !status.enabled;
    await window.calmly.crash.setEnabled(next);
    const updated = await window.calmly.crash.getStatus();
    setStatus(updated);
    setToggling(false);
  }

  return (
    <section className="flex-1 flex flex-col px-12 py-16 max-w-2xl">
      <h1 className="font-serif italic text-4xl tracking-tight text-stone-800">
        Privacy
      </h1>

      {loadState === "loading" && (
        <div className="mt-10 text-sm text-stone-400">Loading…</div>
      )}

      {loadState === "error" && (
        <div className="mt-10 text-sm text-red-500">
          Could not load privacy settings. Restart Calmly and try again.
        </div>
      )}

      {loadState === "ready" && status && (
        <>
          <div className="mt-10 bg-white border border-stone-100 rounded-[1.8rem] p-6 shadow-sm">
            <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-stone-400">
              Crash Reports
            </span>
            <p className="mt-2 text-sm text-stone-600 leading-relaxed">
              When enabled, native crash dumps are uploaded to Calmly so the
              team can identify and fix crashes. Crash reports contain only the
              crash stack, app version, OS, and process type — no task content,
              no email address, and no account identifiers.
            </p>
            <div className="mt-5 flex items-center gap-4">
              <button
                type="button"
                role="switch"
                aria-checked={status.enabled}
                onClick={() => void handleToggle()}
                disabled={toggling}
                className={[
                  "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
                  status.enabled ? "bg-emerald-500" : "bg-stone-300",
                  toggling ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
                ].join(" ")}
              >
                <span
                  className={[
                    "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
                    status.enabled ? "translate-x-6" : "translate-x-1",
                  ].join(" ")}
                />
              </button>
              <span className="text-sm text-stone-700">
                {status.enabled
                  ? "Crash reports enabled"
                  : "Crash reports disabled"}
              </span>
            </div>

            {status.restartRequired && (
              <div className="mt-4 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-800">
                Restart Calmly to apply this change.
              </div>
            )}
          </div>

          {status.lastReportMeta && (
            <div className="mt-6 bg-white border border-stone-100 rounded-[1.8rem] p-6 shadow-sm">
              <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-stone-400">
                Last Crash Report
              </span>
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <dt className="text-stone-400">Saved</dt>
                <dd className="text-stone-700">
                  {new Date(status.lastReportMeta.modifiedAt).toLocaleString()}
                </dd>
                <dt className="text-stone-400">Size</dt>
                <dd className="text-stone-700">
                  {(status.lastReportMeta.sizeBytes / 1024).toFixed(1)} KB
                </dd>
              </dl>
            </div>
          )}
        </>
      )}
    </section>
  );
}
