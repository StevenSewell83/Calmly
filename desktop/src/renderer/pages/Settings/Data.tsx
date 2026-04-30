import { useState } from "react";

type ReindexState = "idle" | "running" | "done" | "error";

export function SettingsData() {
  const [reindex, setReindex] = useState<ReindexState>("idle");

  async function handleReindex() {
    if (reindex === "running") return;
    setReindex("running");
    try {
      await window.calmly.settings.reindexSearch();
      setReindex("done");
    } catch {
      setReindex("error");
    }
  }

  return (
    <section className="flex-1 flex flex-col px-12 py-16 max-w-2xl">
      <h1 className="font-serif italic text-4xl tracking-tight text-stone-800">
        Data
      </h1>

      <div className="mt-10 bg-white border border-stone-100 rounded-[1.8rem] p-6 shadow-sm">
        <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-stone-400">
          Search index
        </span>
        <p className="mt-2 text-sm text-stone-600">
          If search results seem incomplete, re-index to rebuild the full-text index from scratch.
        </p>
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handleReindex()}
            disabled={reindex === "running"}
            className={[
              "px-5 py-2.5 rounded-2xl text-sm font-medium tracking-wide transition-colors",
              reindex === "running"
                ? "bg-stone-100 text-stone-400 cursor-not-allowed"
                : "bg-stone-900 text-white hover:bg-stone-800",
            ].join(" ")}
          >
            {reindex === "running" ? "Re-indexing…" : "Reindex search"}
          </button>
          {reindex === "done" && (
            <span className="text-xs text-emerald-600">Re-index started</span>
          )}
          {reindex === "error" && (
            <span className="text-xs text-red-500">Re-index failed — check logs</span>
          )}
        </div>
      </div>
    </section>
  );
}
