import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ClockArrowDown,
  Inbox as InboxIcon,
  Lightbulb,
  ListTree,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { AICleanupPanel } from "./AICleanupPanel";
import { useAiTriage, type TriageCleanupResult } from "../../state/aiTriage";
import { formatRelativePast } from "../../utils/time";
import { MountainClimberIcon } from "../../components/MountainClimberIcon";
import type { InboxItem } from "../../../preload/api-types";
import { useInboxList } from "./useInboxList";
import { BreakdownPanel } from "./BreakdownPanel";
import {
  snoozeNextWeek,
  snoozeOneHour,
  snoozeTomorrowMorning,
} from "../../utils/snooze";
import {
  chipThisWeek,
  chipToday,
  chipTomorrow,
} from "./triageDates";

type TriageType = "task" | "event" | "discard";

type DateChoice =
  | { kind: "today" | "tomorrow" | "thisWeek" | "later" }
  | { kind: "pick"; ms: number };

// Chip keys are only the simple (no-payload) DateChoice variants — the
// "pick" variant carries a timestamp and is selected via the date picker
// instead of a chip.
type SimpleDateKind = Exclude<DateChoice["kind"], "pick">;

interface ChipDef {
  key: SimpleDateKind;
  label: string;
}

const CHIPS: ChipDef[] = [
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "thisWeek", label: "This Week" },
  { key: "later", label: "Later" },
];

// /inbox/triage — focused mode for the unsorted queue. Walks the same
// listInbox stream the list view consumes; resolution actions (Task /
// Event / Discard / Snooze / Skip) advance to the next item.
export function Triage() {
  const { state, refresh } = useInboxList();
  const [params] = useSearchParams();
  const startId = params.get("id");
  const navigate = useNavigate();

  // Flat list of unresolved items (newest first matches list view).
  const queue = useMemo(
    () => (state.kind === "ready" ? state.items : []),
    [state],
  );

  // Cursor: the inbox id the user is currently triaging. Reseats
  // whenever the queue changes — if the current id has been resolved,
  // we slide to the next one.
  const [cursorId, setCursorId] = useState<string | null>(null);
  useEffect(() => {
    if (queue.length === 0) {
      if (cursorId !== null) setCursorId(null);
      return;
    }
    if (!cursorId || !queue.some((i) => i.id === cursorId)) {
      // Try to land on the deep-linked id first, otherwise the head.
      if (startId && queue.some((i) => i.id === startId)) {
        setCursorId(startId);
      } else {
        setCursorId(queue[0]!.id);
      }
    }
  }, [queue, cursorId, startId]);

  const current = queue.find((i) => i.id === cursorId) ?? null;

  // Per-item form state: type, title, date choice, event times. Resets
  // whenever we move to a new item.
  const [type, setType] = useState<TriageType>("task");
  const [title, setTitle] = useState("");
  const [dateChoice, setDateChoice] = useState<DateChoice>({ kind: "today" });
  const [eventStart, setEventStart] = useState<string>("");
  const [eventEnd, setEventEnd] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const aiTriage = useAiTriage();
  const [aiEnabled, setAiEnabled] = useState(false);

  // Load AI enabled state once on mount
  useEffect(() => {
    void window.calmly.ai.getSettings().then((s) => {
      setAiEnabled(s.enabled);
    }).catch(() => {});
  }, []);

  // Each new item resets form defaults. Title defaults to raw_text,
  // event times default to next round-hour / +1h. The reset is keyed
  // on cursorId so revisiting the same id (e.g. after an InvalidArgs
  // server reply) preserves the user's edits — that's why `current`
  // itself isn't in the dep list.
  const currentId = current?.id;
  const currentRawText = current?.raw_text;
  useEffect(() => {
    if (!currentId || currentRawText === undefined) return;
    setType("task");
    setTitle(currentRawText);
    setDateChoice({ kind: "today" });
    setErrorMsg(null);
    setSnoozeOpen(false);
    setBreakdownOpen(false);
    setAiPanelOpen(false);
    aiTriage.reset();
    const start = nextRoundHour(Date.now());
    setEventStart(toLocalInputValue(start));
    setEventEnd(toLocalInputValue(start + 60 * 60 * 1000));
    // currentRawText is stable for a given currentId — re-running on
    // a content change would clobber an in-progress edit, so it is
    // intentionally excluded from the dep array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  const dueAt = useMemo<number | null>(() => {
    const now = Date.now();
    switch (dateChoice.kind) {
      case "today":
        return chipToday(now);
      case "tomorrow":
        return chipTomorrow(now);
      case "thisWeek":
        return chipThisWeek(now);
      case "later":
        return null;
      case "pick":
        return dateChoice.ms;
    }
  }, [dateChoice]);

  // Resolution submitters all funnel through this — refresh the list
  // when the IPC succeeds (so the cursor effect can slide forward) and
  // surface a soft error otherwise.
  const submitTask = useCallback(async () => {
    if (!current) return;
    setSubmitting(true);
    setErrorMsg(null);
    const r = await window.calmly.triage.resolveAsTask({
      inboxId: current.id,
      title,
      dueAt,
    });
    setSubmitting(false);
    if (!r.ok) {
      setErrorMsg(humanizeError(r.error));
      return;
    }
    await refresh();
  }, [current, title, dueAt, refresh]);

  const submitEvent = useCallback(async () => {
    if (!current) return;
    const startMs = parseLocalInputValue(eventStart);
    const endMs = parseLocalInputValue(eventEnd);
    if (startMs === null || endMs === null || endMs < startMs) {
      setErrorMsg("Pick a start and end time — end can't be before start.");
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    const r = await window.calmly.triage.resolveAsEvent({
      inboxId: current.id,
      title,
      startAt: startMs,
      endAt: endMs,
    });
    setSubmitting(false);
    if (!r.ok) {
      setErrorMsg(humanizeError(r.error));
      return;
    }
    await refresh();
  }, [current, title, eventStart, eventEnd, refresh]);

  const submitDiscard = useCallback(async () => {
    if (!current) return;
    setSubmitting(true);
    setErrorMsg(null);
    const r = await window.calmly.triage.discard(current.id);
    setSubmitting(false);
    if (!r.ok) {
      setErrorMsg(humanizeError(r.error));
      return;
    }
    await refresh();
  }, [current, refresh]);

  const snooze = useCallback(
    async (untilMs: number) => {
      if (!current) return;
      const r = await window.calmly.inbox.snooze(current.id, untilMs);
      if (r.ok) await refresh();
      setSnoozeOpen(false);
    },
    [current, refresh],
  );

  const skip = useCallback(async () => {
    if (!current) return;
    const r = await window.calmly.inbox.skip(current.id);
    if (r.ok) await refresh();
  }, [current, refresh]);

  const handleAiApplyAll = useCallback(
    async (suggestion: TriageCleanupResult, suggestionId: string) => {
      // Apply title from suggestion, then record outcome
      setTitle(suggestion.title);
      if (suggestion.type === "task") setType("task");
      else if (suggestion.type === "event") setType("event");
      await window.calmly.ai.recordOutcome(suggestionId, "accepted");
      setAiPanelOpen(false);
      aiTriage.reset();
    },
    [aiTriage],
  );

  const handleAiDiscard = useCallback(
    async (suggestionId: string) => {
      await window.calmly.ai.recordOutcome(suggestionId, "rejected");
      setAiPanelOpen(false);
      aiTriage.reset();
    },
    [aiTriage],
  );

  const handleBreakdown = useCallback(
    async (parentTitle: string, subtasks: string[]) => {
      if (!current) return;
      setSubmitting(true);
      const r = await window.calmly.triage.resolveWithBreakdown({
        inboxId: current.id,
        parentTitle,
        dueAt,
        subtasks,
      });
      setSubmitting(false);
      if (r.ok) {
        setBreakdownOpen(false);
        await refresh();
      } else {
        setErrorMsg("Could not create tasks — please try again.");
      }
    },
    [current, dueAt, refresh],
  );

  // Confirm = whichever primary action matches the current type. The
  // 'task' branch additionally honors T/W/L shortcuts via dateChoice.
  const confirmPrimary = useCallback(async () => {
    if (submitting) return;
    if (type === "task") await submitTask();
    else if (type === "event") await submitEvent();
    else await submitDiscard();
  }, [submitting, type, submitTask, submitEvent, submitDiscard]);

  // Keyboard: 1/2/3 type swap, T/W/L date chips (Task only),
  // S = snooze popover, X = skip, Enter = confirm. Skipped while focus
  // is in INPUT/TEXTAREA so the title field is editable, matching the
  // CL-03 inbox list pattern.
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      ) {
        return;
      }
      if (e.key === "1") {
        e.preventDefault();
        setType("task");
        return;
      }
      if (e.key === "2") {
        e.preventDefault();
        setType("event");
        return;
      }
      if (e.key === "3") {
        e.preventDefault();
        setType("discard");
        return;
      }
      if (type === "task") {
        if (e.key === "t" || e.key === "T") {
          e.preventDefault();
          setDateChoice({ kind: "today" });
          return;
        }
        if (e.key === "w" || e.key === "W") {
          e.preventDefault();
          setDateChoice({ kind: "thisWeek" });
          return;
        }
        if (e.key === "l" || e.key === "L") {
          e.preventDefault();
          setDateChoice({ kind: "later" });
          return;
        }
      }
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        setSnoozeOpen((v) => !v);
        return;
      }
      if (e.key === "x" || e.key === "X") {
        e.preventDefault();
        void skip();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        void confirmPrimary();
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, type, skip, confirmPrimary]);

  const queueIndex = current
    ? queue.findIndex((i) => i.id === current.id)
    : -1;

  return (
    <section className="flex-1 px-12 pt-8 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="max-w-2xl mx-auto">
        <Link
          to="/inbox"
          className="inline-flex items-center gap-2 text-xs font-medium tracking-wide text-stone-500 hover:text-stone-800 transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          Back to Inbox
        </Link>

        {state.kind === "loading" ? (
          <LoadingShell />
        ) : state.kind === "signed-out" ? (
          <FailureNotice
            title="You're signed out."
            body="Sign in to start triaging."
          />
        ) : state.kind === "error" ? (
          <FailureNotice title="Something hiccuped." body={state.message} />
        ) : queue.length === 0 ? (
          <InboxClear onHome={() => navigate("/")} />
        ) : current ? (
          <>
            <header className="mb-6 flex items-center justify-between">
              <h1 className="font-serif italic text-4xl tracking-tight text-stone-800">
                Triage.
              </h1>
              <span className="text-[11px] font-bold tracking-[0.22em] uppercase text-stone-400">
                Item {queueIndex + 1} of {queue.length}
              </span>
            </header>

            <article
              key={current.id}
              className="rounded-[2.5rem] bg-white border border-stone-200/60 shadow-sm px-8 py-7 animate-in fade-in slide-in-from-right-4 duration-300"
              aria-live="polite"
            >
              <div className="flex items-center gap-3 text-[10px] font-bold tracking-[0.22em] uppercase text-stone-400">
                <InboxIcon className="w-3.5 h-3.5" aria-hidden="true" />
                <span>From {sourceLabel(current.source)}</span>
                <span aria-hidden="true">·</span>
                <span className="normal-case tracking-wide font-medium">
                  {formatRelativePast(current.created_at, Date.now())}
                </span>
              </div>
              <p className="mt-3 text-2xl text-stone-800 leading-snug font-light">
                {current.raw_text}
              </p>
            </article>

            <TypeClassifier value={type} onChange={setType} />

            <div className="mt-6">
              <label
                htmlFor="triage-title"
                className="block text-[10px] font-bold tracking-[0.22em] uppercase text-stone-500 mb-2"
              >
                Title
              </label>
              <input
                id="triage-title"
                ref={titleInputRef}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-white border border-stone-200 focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 outline-none rounded-2xl px-5 py-3 text-base text-stone-800"
                aria-label="Title"
              />
            </div>

            {type === "task" ? (
              <DueDateChips
                value={dateChoice}
                onChange={setDateChoice}
              />
            ) : null}

            {type === "event" ? (
              <div className="mt-6 grid grid-cols-2 gap-4">
                <TimeInput
                  id="triage-event-start"
                  label="Starts"
                  value={eventStart}
                  onChange={setEventStart}
                />
                <TimeInput
                  id="triage-event-end"
                  label="Ends"
                  value={eventEnd}
                  onChange={setEventEnd}
                />
              </div>
            ) : null}

            {errorMsg ? (
              <p
                role="alert"
                className="mt-5 text-sm text-rose-600 font-medium tracking-wide"
              >
                {errorMsg}
              </p>
            ) : null}

            <div className="mt-8 flex items-center gap-3 flex-wrap">
              {type === "task" ? (
                <>
                  <PrimaryButton
                    label="Today"
                    icon={CheckCircle2}
                    onClick={() => {
                      setDateChoice({ kind: "today" });
                      void submitTask();
                    }}
                    disabled={submitting || title.trim().length === 0}
                  />
                  <PrimaryButton
                    label="This Week"
                    icon={CheckCircle2}
                    onClick={() => {
                      setDateChoice({ kind: "thisWeek" });
                      void submitTask();
                    }}
                    disabled={submitting || title.trim().length === 0}
                  />
                  <PrimaryButton
                    label="Later"
                    icon={CheckCircle2}
                    onClick={() => {
                      setDateChoice({ kind: "later" });
                      void submitTask();
                    }}
                    disabled={submitting || title.trim().length === 0}
                  />
                </>
              ) : null}
              {type === "event" ? (
                <PrimaryButton
                  label="Schedule event"
                  icon={CalendarClock}
                  onClick={submitEvent}
                  disabled={submitting || title.trim().length === 0}
                />
              ) : null}
              {type === "discard" ? (
                <PrimaryButton
                  label="Discard"
                  icon={Trash2}
                  onClick={submitDiscard}
                  disabled={submitting}
                  tone="rose"
                />
              ) : null}

              <span className="ml-auto flex items-center gap-2">
                <SecondaryAction
                  label="Snooze"
                  hint="S"
                  icon={ClockArrowDown}
                  onClick={() => setSnoozeOpen((v) => !v)}
                />
                <SecondaryAction
                  label="Skip"
                  hint="X"
                  icon={X}
                  onClick={skip}
                />
                <SecondaryAction
                  label="Break down"
                  hint=""
                  icon={ListTree}
                  onClick={() => { setBreakdownOpen((v) => !v); setSnoozeOpen(false); }}
                />
                {aiEnabled && (
                  <SecondaryAction
                    label="AI cleanup"
                    hint=""
                    icon={Sparkles}
                    onClick={() => {
                      setAiPanelOpen((v) => !v);
                      setSnoozeOpen(false);
                      setBreakdownOpen(false);
                    }}
                  />
                )}
              </span>
            </div>

            {snoozeOpen ? (
              <SnoozeMenu
                onPick={(untilMs) => void snooze(untilMs)}
                onClose={() => setSnoozeOpen(false)}
              />
            ) : null}

            {aiPanelOpen && current ? (
              <AICleanupPanel
                rawText={current.raw_text}
                state={aiTriage.state}
                onRun={() => void aiTriage.run(current.raw_text)}
                onCancel={aiTriage.cancel}
                onApplyAll={handleAiApplyAll}
                onDiscard={handleAiDiscard}
                onClose={() => { setAiPanelOpen(false); aiTriage.reset(); }}
                aiEnabled={aiEnabled}
              />
            ) : null}

            {breakdownOpen && current ? (
              <BreakdownPanel
                rawText={current.raw_text}
                dueAt={dueAt}
                onConfirm={(parentTitle, subtasks) =>
                  void handleBreakdown(parentTitle, subtasks)
                }
                onCancel={() => setBreakdownOpen(false)}
              />
            ) : null}

            <p className="mt-8 text-[11px] text-stone-400 tracking-wide">
              <span className="font-bold tracking-[0.18em] uppercase">Keys</span>{" "}
              · 1 Task · 2 Event · 3 Discard · T Today · W This Week · L Later
              · S Snooze · X Skip · Enter Confirm
            </p>
          </>
        ) : null}
      </div>
    </section>
  );
}

interface TypeClassifierProps {
  value: TriageType;
  onChange: (next: TriageType) => void;
}

const TYPE_OPTIONS: { value: TriageType; label: string; hint: string; icon: typeof Sparkles }[] = [
  { value: "task", label: "Task", hint: "1", icon: CheckCircle2 },
  { value: "event", label: "Event", hint: "2", icon: CalendarClock },
  { value: "discard", label: "Discard", hint: "3", icon: Trash2 },
];

function TypeClassifier({ value, onChange }: TypeClassifierProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Type"
      className="mt-6 grid grid-cols-3 gap-2"
    >
      {TYPE_OPTIONS.map((opt) => {
        const active = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={[
              "rounded-2xl border px-4 py-4 flex flex-col items-start gap-1 transition-colors",
              active
                ? "border-emerald-300 bg-emerald-50/60 ring-2 ring-emerald-100"
                : "border-stone-200 bg-white hover:border-stone-300",
            ].join(" ")}
          >
            <span
              className={`flex items-center gap-2 text-sm font-medium tracking-wide ${
                active ? "text-emerald-700" : "text-stone-700"
              }`}
            >
              <Icon className="w-4 h-4" aria-hidden="true" />
              {opt.label}
            </span>
            <span className="text-[10px] tracking-[0.22em] uppercase text-stone-400 font-bold">
              {opt.hint}
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface DueDateChipsProps {
  value: DateChoice;
  onChange: (next: DateChoice) => void;
}

function DueDateChips({ value, onChange }: DueDateChipsProps) {
  return (
    <div className="mt-6">
      <div className="text-[10px] font-bold tracking-[0.22em] uppercase text-stone-500 mb-2">
        Due
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {CHIPS.map((chip) => {
          const active = value.kind === chip.key;
          return (
            <button
              key={chip.key}
              type="button"
              onClick={() => onChange({ kind: chip.key })}
              className={[
                "px-4 py-2 rounded-2xl text-xs font-medium tracking-wide transition-colors",
                active
                  ? "bg-emerald-500 text-white"
                  : "bg-stone-100 text-stone-700 hover:bg-stone-200",
              ].join(" ")}
            >
              {chip.label}
            </button>
          );
        })}
        <PickDateButton value={value} onChange={onChange} />
      </div>
    </div>
  );
}

interface PickDateButtonProps {
  value: DateChoice;
  onChange: (next: DateChoice) => void;
}

function PickDateButton({ value, onChange }: PickDateButtonProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const active = value.kind === "pick";
  const display = active
    ? new Date(value.ms).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "Pick date";

  const onPick = (e: ChangeEvent<HTMLInputElement>): void => {
    const v = e.target.value;
    if (!v) return;
    // Native date input is yyyy-mm-dd; anchor at end-of-day local.
    const [y, m, d] = v.split("-").map((s) => parseInt(s, 10));
    if (!y || !m || !d) return;
    const ms = new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
    onChange({ kind: "pick", ms });
  };

  return (
    <span className="relative">
      <button
        type="button"
        onClick={() => inputRef.current?.showPicker?.() ?? inputRef.current?.click()}
        className={[
          "px-4 py-2 rounded-2xl text-xs font-medium tracking-wide transition-colors",
          active
            ? "bg-emerald-500 text-white"
            : "bg-stone-100 text-stone-700 hover:bg-stone-200",
        ].join(" ")}
      >
        {display}
      </button>
      <input
        ref={inputRef}
        type="date"
        onChange={onPick}
        className="absolute opacity-0 pointer-events-none -z-10"
        aria-label="Pick a date"
      />
    </span>
  );
}

interface TimeInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
}

function TimeInput({ id, label, value, onChange }: TimeInputProps) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[10px] font-bold tracking-[0.22em] uppercase text-stone-500 mb-2"
      >
        {label}
      </label>
      <input
        id={id}
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white border border-stone-200 focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 outline-none rounded-2xl px-4 py-3 text-sm text-stone-800"
      />
    </div>
  );
}

interface PrimaryButtonProps {
  label: string;
  icon: typeof CheckCircle2;
  onClick: () => void;
  disabled?: boolean;
  tone?: "emerald" | "rose";
}

function PrimaryButton({
  label,
  icon: Icon,
  onClick,
  disabled,
  tone = "emerald",
}: PrimaryButtonProps) {
  const palette =
    tone === "rose"
      ? "bg-rose-500 hover:bg-rose-600"
      : "bg-emerald-500 hover:bg-emerald-600";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-medium tracking-wide text-white transition-colors",
        disabled ? "bg-stone-300 cursor-not-allowed" : palette,
      ].join(" ")}
    >
      <Icon className="w-4 h-4" aria-hidden="true" />
      {label}
    </button>
  );
}

interface SecondaryActionProps {
  label: string;
  hint: string;
  icon: typeof CheckCircle2;
  onClick: () => void;
  disabled?: boolean;
}

function SecondaryAction({
  label,
  hint,
  icon: Icon,
  onClick,
  disabled,
}: SecondaryActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint ? `${label} · ${hint}` : label}
      className={[
        "inline-flex items-center gap-1.5 px-3 py-2 rounded-2xl text-xs font-medium tracking-wide transition-colors",
        disabled
          ? "text-stone-300 cursor-not-allowed"
          : "text-stone-600 hover:bg-stone-100",
      ].join(" ")}
    >
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
      {label}
    </button>
  );
}

interface SnoozeMenuProps {
  onPick: (untilMs: number) => void;
  onClose: () => void;
}

function SnoozeMenu({ onPick, onClose }: SnoozeMenuProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const now = Date.now();
  return (
    <div
      role="menu"
      className="mt-3 rounded-2xl bg-white border border-stone-200 shadow-lg p-2 inline-flex gap-2"
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => onPick(snoozeOneHour(now))}
        className="px-3 py-1.5 rounded-xl text-xs font-medium tracking-wide bg-stone-100 hover:bg-stone-200 text-stone-700"
      >
        In 1 hour
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => onPick(snoozeTomorrowMorning(now))}
        className="px-3 py-1.5 rounded-xl text-xs font-medium tracking-wide bg-stone-100 hover:bg-stone-200 text-stone-700"
      >
        Tomorrow morning
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => onPick(snoozeNextWeek(now))}
        className="px-3 py-1.5 rounded-xl text-xs font-medium tracking-wide bg-stone-100 hover:bg-stone-200 text-stone-700"
      >
        Next week
      </button>
    </div>
  );
}

function InboxClear({ onHome }: { onHome: () => void }) {
  return (
    <div className="rounded-[2.5rem] bg-white border border-stone-200/60 px-12 py-16 flex flex-col items-center text-center animate-in fade-in zoom-in-95 duration-500">
      <div className="w-20 h-20 rounded-[1.6rem] bg-emerald-50 text-emerald-600 flex items-center justify-center mb-6">
        <MountainClimberIcon className="w-12 h-12" />
      </div>
      <h2 className="font-serif italic text-4xl tracking-tight text-stone-800 mb-2">
        Inbox clear.
      </h2>
      <p className="text-sm text-stone-500 max-w-sm mb-8 leading-relaxed">
        Quiet ground. Come back to the day with a clean field.
      </p>
      <button
        type="button"
        onClick={onHome}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-stone-900 text-white text-sm font-medium tracking-wide hover:bg-stone-700 transition-colors"
      >
        <Lightbulb className="w-4 h-4" aria-hidden="true" />
        Back to today
        <ArrowRight className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}

function LoadingShell() {
  return (
    <div role="status" aria-label="Loading triage" className="flex flex-col gap-4">
      <div className="rounded-[2.5rem] bg-stone-100/60 h-32 animate-pulse" />
      <div className="rounded-2xl bg-stone-100/60 h-12 animate-pulse" />
      <div className="rounded-2xl bg-stone-100/60 h-12 animate-pulse" />
    </div>
  );
}

function FailureNotice({ title, body }: { title: string; body: string }) {
  return (
    <div
      role="alert"
      className="rounded-[1.8rem] border border-stone-200 bg-white/60 px-6 py-5 max-w-md"
    >
      <p className="text-sm text-stone-800 font-medium">{title}</p>
      <p className="mt-1 text-xs text-stone-500">{body}</p>
    </div>
  );
}

function sourceLabel(source: InboxItem["source"]): string {
  switch (source) {
    case "desktop":
      return "Desktop";
    case "telegram-text":
      return "Telegram";
    case "telegram-voice":
      return "Voice";
    case "ai-split":
      return "AI split";
  }
}

function humanizeError(error: string): string {
  switch (error) {
    case "NotSignedIn":
      return "You're signed out — sign in to keep triaging.";
    case "NotFound":
      return "That item is gone — moving on.";
    case "AlreadyResolved":
      return "Already triaged — moving on.";
    case "InvalidArgs":
      return "Title can't be empty.";
    default:
      return "Couldn't save — try again.";
  }
}

// Round forward to the next hour boundary local time. Used as the
// default event start so the user only adjusts when needed.
function nextRoundHour(now: number): number {
  const d = new Date(now);
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d.getTime();
}

// datetime-local inputs use 'yyyy-MM-ddTHH:mm' (local zone).
function toLocalInputValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseLocalInputValue(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}
