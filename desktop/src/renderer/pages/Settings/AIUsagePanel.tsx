import { useState, useEffect } from "react";
import { BarChart3, AlertTriangle, Loader2 } from "lucide-react";

const ACTION_LABELS: Record<string, string> = {
  triage_cleanup: "Triage cleanup",
  make_startable: "Make Startable",
  brain_dump_split: "Brain-dump split",
};

export function AIUsagePanel() {
  const [usage, setUsage] = useState<{
    totalRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    byPromptClass: Record<
      string,
      { requests: number; inputTokens: number; outputTokens: number }
    >;
  } | null>(null);
  const [suspended, setSuspended] = useState(false);
  const [suspendedUntilMs, setSuspendedUntilMs] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void window.calmly.ai
      .getUsage()
      .then((r) => {
        if (r.ok && r.usage) setUsage(r.usage);
        if (r.rateLimiter) {
          setSuspended(r.rateLimiter.suspended);
          setSuspendedUntilMs(r.rateLimiter.suspendedUntilMs);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-stone-400">
        <Loader2 size={14} className="animate-spin" />
        <span className="text-xs">Loading usage…</span>
      </div>
    );
  }

  return (
    <div className="bg-white border border-stone-100 rounded-[1.8rem] p-6 shadow-sm mb-4">
      <div className="flex items-center gap-2 mb-4">
        <BarChart3 size={14} className="text-stone-400" />
        <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-stone-400">
          Today's AI usage
        </span>
      </div>

      {suspended && (
        <div className="flex items-center gap-2 mb-4 px-3 py-2.5 rounded-2xl bg-amber-50 border border-amber-200">
          <AlertTriangle size={13} className="text-amber-500 shrink-0" />
          <p className="text-xs text-amber-700">
            Quota limit hit — AI calls suspended until{" "}
            {new Date(suspendedUntilMs).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
            .
          </p>
        </div>
      )}

      {!usage || usage.totalRequests === 0 ? (
        <p className="text-xs text-stone-400">No AI calls today.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Summary row */}
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Requests" value={usage.totalRequests.toString()} />
            <Stat
              label="Input tokens"
              value={usage.totalInputTokens.toLocaleString()}
            />
            <Stat
              label="Output tokens"
              value={usage.totalOutputTokens.toLocaleString()}
            />
          </div>

          {/* Per-action breakdown */}
          {Object.keys(usage.byPromptClass).length > 0 && (
            <div className="border-t border-stone-100 pt-3 flex flex-col gap-1.5">
              {Object.entries(usage.byPromptClass).map(([cls, data]) => (
                <div
                  key={cls}
                  className="flex items-center gap-3 text-xs text-stone-600"
                >
                  <span className="flex-1 truncate">
                    {ACTION_LABELS[cls] ?? cls}
                  </span>
                  <span className="text-stone-400 tabular-nums">
                    {data.requests}×
                  </span>
                  <span className="text-stone-400 tabular-nums">
                    {(data.inputTokens + data.outputTokens).toLocaleString()}{" "}
                    tok
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] font-bold tracking-[0.18em] uppercase text-stone-400 mb-0.5">
        {label}
      </span>
      <span className="text-lg font-medium text-stone-800 tabular-nums">
        {value}
      </span>
    </div>
  );
}
