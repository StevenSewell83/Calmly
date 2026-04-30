import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { PageStateView } from "../../components/PageStateView";
import { useTriageShortcuts } from "../../hooks/useTriageShortcuts";
import { useInboxList } from "./useInboxList";
import {
  chipThisWeek,
  chipToday,
  chipTomorrow,
} from "./triageDates";
import { DueDateChips } from "./triage/DueDateChips";
import {
  humanizeError,
  nextRoundHour,
  parseLocalInputValue,
  toLocalInputValue,
} from "./triage/helpers";
import { InboxClear } from "./triage/InboxClear";
import { ItemCard } from "./triage/ItemCard";
import { SnoozeMenu } from "./triage/SnoozeMenu";
import { TimeInput } from "./triage/TimeInput";
import { TriageActionBar } from "./triage/TriageActionBar";
import { TypeClassifier } from "./triage/TypeClassifier";
import type { DateChoice, TriageType } from "./triage/types";

// /inbox/triage — focused mode for the unsorted queue. Walks the same
// listInbox stream the list view consumes; resolution actions (Task /
// Event / Discard / Snooze / Skip) advance to the next item.
//
// REFACTOR-AUDIT-3: this file is now a thin orchestrator. State,
// IPC submitters, and layout live here; presentational components
// and helpers were extracted into pages/Inbox/triage/* and the
// keyboard handler into hooks/useTriageShortcuts.

export function Triage() {
  const { state, refresh } = useInboxList();
  const [params] = useSearchParams();
  const startId = params.get("id");
  const navigate = useNavigate();

  // Flat list of unresolved items (newest first matches list view).
  const queue = useMemo(
    () => (state.kind === "ready" ? state.data.items : []),
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
  const titleInputRef = useRef<HTMLInputElement | null>(null);

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

  // Confirm = whichever primary action matches the current type. The
  // 'task' branch additionally honors T/W/L shortcuts via dateChoice.
  const confirmPrimary = useCallback(async () => {
    if (submitting) return;
    if (type === "task") await submitTask();
    else if (type === "event") await submitEvent();
    else await submitDiscard();
  }, [submitting, type, submitTask, submitEvent, submitDiscard]);

  useTriageShortcuts({
    active: current !== null,
    type,
    setType,
    setDateChoice,
    toggleSnooze: () => setSnoozeOpen((v) => !v),
    skip: () => void skip(),
    confirmPrimary: () => void confirmPrimary(),
  });

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

        <PageStateView
          state={state}
          loading={<LoadingShell />}
          signedOutBody="Sign in to start triaging."
          ready={() =>
            queue.length === 0 ? (
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

                <ItemCard item={current} now={Date.now()} />

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
                  <DueDateChips value={dateChoice} onChange={setDateChoice} />
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

                <TriageActionBar
                  type={type}
                  submitting={submitting}
                  titleEmpty={title.trim().length === 0}
                  setDateChoice={setDateChoice}
                  submitTask={() => void submitTask()}
                  submitEvent={() => void submitEvent()}
                  submitDiscard={() => void submitDiscard()}
                  toggleSnooze={() => setSnoozeOpen((v) => !v)}
                  skip={() => void skip()}
                  showBreakDownStub={() =>
                    setErrorMsg("Break-down lands in CL-05.")
                  }
                />

                {snoozeOpen ? (
                  <SnoozeMenu
                    onPick={(untilMs) => void snooze(untilMs)}
                    onClose={() => setSnoozeOpen(false)}
                  />
                ) : null}

                <p className="mt-8 text-[11px] text-stone-400 tracking-wide">
                  <span className="font-bold tracking-[0.18em] uppercase">
                    Keys
                  </span>{" "}
                  · 1 Task · 2 Event · 3 Discard · T Today · W This Week · L
                  Later · S Snooze · X Skip · Enter Confirm
                </p>
              </>
            ) : null
          }
        />
      </div>
    </section>
  );
}

// Per-page loading skeleton; signed-out + error shells live in
// PageStateView (REFACTOR-AUDIT-4).
function LoadingShell() {
  return (
    <div
      role="status"
      aria-label="Loading triage"
      className="flex flex-col gap-4"
    >
      <div className="rounded-[2.5rem] bg-stone-100/60 h-32 animate-pulse" />
      <div className="rounded-2xl bg-stone-100/60 h-12 animate-pulse" />
      <div className="rounded-2xl bg-stone-100/60 h-12 animate-pulse" />
    </div>
  );
}
