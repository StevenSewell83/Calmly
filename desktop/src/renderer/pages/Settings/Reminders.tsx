// RM-02: default reminder profiles. Important/Soft each get a default
// interval that seeds ReminderRuleEditor's "Add a reminder" affordance —
// changing a default here only affects tasks that don't have a rule yet.
// Persists on the shared user_settings blob via reminders:getDefaults/
// setDefaults (no new store — see main/ipc/reminders.ts).
import { useEffect, useState } from "react";
import { Bell, Loader2 } from "lucide-react";
import type { ReminderDefaults } from "../../../preload/api-types";
import { formatInterval, INTERVAL_PRESETS } from "../../components/reminders/intervalPresets";

type LoadState = "loading" | "ready" | "error";

function ProfileCard({
  label,
  hint,
  seconds,
  disabled,
  onPick,
}: {
  label: string;
  hint: string;
  seconds: number;
  disabled: boolean;
  onPick(seconds: number): void;
}) {
  return (
    <div className="bg-white border border-stone-100 rounded-[1.8rem] p-6 shadow-sm mb-4">
      <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-stone-400 block mb-1">
        {label}
      </span>
      <p className="text-xs text-stone-400 mb-4">{hint}</p>
      <div className="flex flex-wrap gap-2">
        {INTERVAL_PRESETS.map((preset) => {
          const selected = seconds === preset.seconds;
          return (
            <button
              key={preset.label}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onPick(preset.seconds)}
              className={[
                "px-3 py-1.5 rounded-xl text-xs font-medium transition-colors disabled:opacity-40",
                selected
                  ? "bg-emerald-500 text-white"
                  : "bg-stone-50 border border-stone-200 text-stone-500 hover:border-emerald-200",
              ].join(" ")}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-stone-400 mt-3">
        Currently {formatInterval(seconds)}.
      </p>
    </div>
  );
}

export function SettingsReminders() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [defaults, setDefaults] = useState<ReminderDefaults | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoadState("loading");
    try {
      const r = await window.calmly.reminders.getDefaults();
      if (r.ok) {
        setDefaults(r.defaults);
        setLoadState("ready");
      } else {
        setLoadState("error");
      }
    } catch {
      setLoadState("error");
    }
  }

  async function handlePick(patch: Partial<ReminderDefaults>) {
    if (!defaults) return;
    const next = { ...defaults, ...patch };
    setDefaults(next);
    setSaving(true);
    try {
      await window.calmly.reminders.setDefaults(patch);
    } finally {
      setSaving(false);
    }
  }

  if (loadState === "error") {
    return (
      <div className="px-10 py-12">
        <p className="text-sm text-red-500">Couldn't load reminder defaults.</p>
      </div>
    );
  }

  return (
    <div className="px-10 py-12 max-w-2xl">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-9 h-9 rounded-2xl bg-emerald-50 flex items-center justify-center">
          <Bell size={18} className="text-emerald-600" />
        </div>
        <div>
          <h1 className="font-serif italic text-2xl text-stone-800 leading-tight">Reminders</h1>
          <p className="text-xs text-stone-400 mt-0.5">
            Default intervals for new Important and Soft reminders.
          </p>
        </div>
        {saving && <Loader2 size={14} className="text-stone-300 animate-spin ml-auto" />}
      </div>

      {loadState === "loading" || !defaults ? (
        <div
          role="status"
          aria-label="Loading reminder defaults"
          className="flex flex-col gap-2"
        >
          <div className="rounded-[1.8rem] bg-stone-100/60 h-32 animate-pulse" />
          <div className="rounded-[1.8rem] bg-stone-100/60 h-32 animate-pulse" />
        </div>
      ) : (
        <>
          <ProfileCard
            label="Important default"
            hint="Bell badge in-app. May escalate later — never off by default."
            seconds={defaults.importantIntervalSeconds}
            disabled={saving}
            onPick={(seconds) => void handlePick({ importantIntervalSeconds: seconds })}
          />
          <ProfileCard
            label="Soft default"
            hint="Muted dot in-app. Never escalates, never nags."
            seconds={defaults.softIntervalSeconds}
            disabled={saving}
            onPick={(seconds) => void handlePick({ softIntervalSeconds: seconds })}
          />
        </>
      )}
    </div>
  );
}
