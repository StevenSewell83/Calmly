import { useEffect, useState } from "react";
import { Bell, Trash2 } from "lucide-react";
import {
  DEFAULT_SOFT_REMINDER_INTERVAL_SECONDS,
  MIN_REMINDER_INTERVAL_SECONDS,
  type ReminderImportance,
} from "@calmly/shared";
import type { ReminderDefaults, ReminderRuleItem } from "../../../preload/api-types";
import { useReminderRule } from "../../hooks/useReminderRule";
import { formatInterval, INTERVAL_PRESETS } from "./intervalPresets";

export interface ReminderRuleEditorProps {
  taskId: string;
}

// RM-07 intent: Important rules may repeat/escalate their in-app visual
// treatment later (bell → something louder surfacing in Today); Soft
// rules are terminal — a muted dot, never escalates, never nags. Both
// importances share the same delivery substrate and interval floor; only
// the visual posture differs. ReminderBadge renders these same tokens at
// the row level.
const IMPORTANCE_TOKENS: Record<ReminderImportance, { label: string; hint: string }> = {
  important: { label: "Important", hint: "Bell badge — may escalate later" },
  soft: { label: "Soft", hint: "Muted dot — never escalates" },
};

type UpsertPatch = Partial<{
  importance: ReminderImportance;
  intervalSeconds: number;
  active: boolean;
}>;

// Per-task reminder rule editor (RM-01b). Every control persists
// immediately — no separate Save ritual — matching the app's anti-nag,
// low-cognitive-load posture. Built directly on RM-01a's reminders:*
// IPC; nothing in main changed for this component.
export function ReminderRuleEditor({ taskId }: ReminderRuleEditorProps) {
  const { state, refresh } = useReminderRule(taskId);
  const [defaults, setDefaults] = useState<ReminderDefaults | null>(null);
  const [saving, setSaving] = useState(false);
  const [customMinutes, setCustomMinutes] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.calmly.reminders.getDefaults().then((r) => {
      if (!cancelled && r.ok) setDefaults(r.defaults);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function persist(rule: ReminderRuleItem, patch: UpsertPatch) {
    setSaving(true);
    try {
      await window.calmly.reminders.upsert({
        taskId,
        importance: patch.importance ?? rule.importance,
        intervalSeconds: patch.intervalSeconds ?? rule.interval_seconds,
        escalationJson: rule.escalation_json,
        active: patch.active ?? rule.active === 1,
      });
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleAdd() {
    setSaving(true);
    try {
      await window.calmly.reminders.upsert({
        taskId,
        importance: "soft",
        intervalSeconds:
          defaults?.softIntervalSeconds ?? DEFAULT_SOFT_REMINDER_INTERVAL_SECONDS,
        escalationJson: "{}",
        active: true,
      });
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setSaving(true);
    try {
      await window.calmly.reminders.delete(taskId);
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  function handleCustomSubmit(e: React.FormEvent, rule: ReminderRuleItem) {
    e.preventDefault();
    const minutes = Number(customMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      setCustomError("Enter a number of minutes.");
      return;
    }
    const seconds = Math.round(minutes * 60);
    if (seconds < MIN_REMINDER_INTERVAL_SECONDS) {
      setCustomError("Reminders can't repeat more often than 5 minutes.");
      return;
    }
    setCustomError(null);
    setCustomMinutes("");
    void persist(rule, { intervalSeconds: seconds });
  }

  if (state.kind === "loading") {
    return (
      <div
        role="status"
        aria-label="Loading reminder"
        className="h-14 rounded-2xl bg-stone-100/60 animate-pulse"
      />
    );
  }

  // Signed-out/error: the panel around this component already surfaces
  // sign-in/error chrome elsewhere; a reminder widget failing silently
  // here isn't worth a second error banner.
  if (state.kind === "signed-out" || state.kind === "error") return null;

  const rule = state.data;

  if (!rule) {
    return (
      <button
        type="button"
        onClick={() => void handleAdd()}
        disabled={saving}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl border border-dashed border-stone-200 text-stone-400 hover:border-emerald-300 hover:text-emerald-600 disabled:opacity-50 text-xs font-medium tracking-wide transition-colors"
      >
        <Bell className="w-3.5 h-3.5" aria-hidden="true" />
        Add a reminder
      </button>
    );
  }

  const isActive = rule.active === 1;

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-stone-50/70 border border-stone-100 p-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold tracking-[0.15em] uppercase text-stone-500">
          Reminder
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={isActive}
          aria-label={isActive ? "Turn reminder off" : "Turn reminder on"}
          onClick={() => void persist(rule, { active: !isActive })}
          disabled={saving}
          className={[
            "relative w-9 h-5 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
            isActive ? "bg-emerald-500" : "bg-stone-200",
          ].join(" ")}
        >
          <span
            className={[
              "absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform",
              isActive ? "translate-x-4" : "translate-x-0",
            ].join(" ")}
          />
        </button>
      </div>

      {/* Importance toggle */}
      <div className="flex gap-1.5" role="group" aria-label="Reminder importance">
        {(Object.keys(IMPORTANCE_TOKENS) as ReminderImportance[]).map((importance) => {
          const selected = rule.importance === importance;
          return (
            <button
              key={importance}
              type="button"
              aria-pressed={selected}
              onClick={() => void persist(rule, { importance })}
              disabled={saving}
              title={IMPORTANCE_TOKENS[importance].hint}
              className={[
                "flex-1 py-1.5 rounded-xl text-xs font-medium transition-colors",
                selected
                  ? "bg-emerald-500 text-white"
                  : "bg-white border border-stone-200 text-stone-500 hover:border-emerald-200",
              ].join(" ")}
            >
              {IMPORTANCE_TOKENS[importance].label}
            </button>
          );
        })}
      </div>

      {/* Interval presets */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Reminder interval">
        {INTERVAL_PRESETS.map((preset) => {
          const selected = rule.interval_seconds === preset.seconds;
          return (
            <button
              key={preset.label}
              type="button"
              aria-pressed={selected}
              onClick={() => void persist(rule, { intervalSeconds: preset.seconds })}
              disabled={saving}
              className={[
                "px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors",
                selected
                  ? "bg-stone-800 text-white"
                  : "bg-white border border-stone-200 text-stone-500 hover:border-stone-300",
              ].join(" ")}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      <p className="text-[10px] text-stone-400">
        Repeats every {formatInterval(rule.interval_seconds)}
        {!isActive ? " — off" : ""}
      </p>

      {/* Custom interval */}
      <form onSubmit={(e) => handleCustomSubmit(e, rule)} className="flex items-center gap-2">
        <label htmlFor="reminder-custom-minutes" className="sr-only">
          Custom interval in minutes
        </label>
        <input
          id="reminder-custom-minutes"
          type="number"
          min={1}
          inputMode="numeric"
          placeholder="Custom (min)"
          value={customMinutes}
          onChange={(e) => {
            setCustomMinutes(e.target.value);
            setCustomError(null);
          }}
          className="w-28 rounded-xl border border-stone-200 bg-white/80 px-2.5 py-1.5 text-xs text-stone-700 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition"
        />
        <button
          type="submit"
          disabled={saving || !customMinutes}
          className="px-2.5 py-1.5 rounded-xl bg-white border border-stone-200 text-xs font-medium text-stone-500 hover:border-emerald-200 disabled:opacity-50 transition-colors"
        >
          Set
        </button>
      </form>
      {customError ? (
        <p role="alert" className="text-[10px] text-amber-600">
          {customError}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => void handleRemove()}
        disabled={saving}
        className="self-start flex items-center gap-1.5 text-[10px] font-medium text-stone-400 hover:text-red-500 disabled:opacity-50 transition-colors"
      >
        <Trash2 className="w-3 h-3" aria-hidden="true" />
        Remove reminder
      </button>
    </div>
  );
}
