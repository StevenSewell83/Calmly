import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Inbox as InboxIcon } from "lucide-react";
import { PageStateView } from "../../components/PageStateView";
import { InboxRow } from "./InboxRow";
import {
  sortInboxItems,
  useInboxList,
  type InboxSortMode,
} from "./useInboxList";

const SORT_OPTIONS: { value: InboxSortMode; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "source", label: "Source" },
];

export function Inbox() {
  const { state, refresh } = useInboxList();
  const [sortMode, setSortMode] = useState<InboxSortMode>("newest");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snoozeOpenId, setSnoozeOpenId] = useState<string | null>(null);
  const navigate = useNavigate();

  const rowRefs = useRef<Map<string, HTMLLIElement>>(new Map());

  const items = useMemo(
    () =>
      state.kind === "ready"
        ? sortInboxItems(state.data.items, sortMode)
        : [],
    [state, sortMode],
  );

  // Keep selection valid as the underlying list changes (snooze / skip
  // remove rows). Default to first row on initial load.
  useEffect(() => {
    if (items.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!selectedId || !items.some((i) => i.id === selectedId)) {
      setSelectedId(items[0]!.id);
    }
  }, [items, selectedId]);

  const triage = useCallback(
    (id: string) => {
      navigate(`/inbox/triage?id=${encodeURIComponent(id)}`);
    },
    [navigate],
  );

  const snooze = useCallback(
    async (id: string, untilMs: number) => {
      const r = await window.calmly.inbox.snooze(id, untilMs);
      if (r.ok) await refresh();
    },
    [refresh],
  );

  const skip = useCallback(
    async (id: string) => {
      const r = await window.calmly.inbox.skip(id);
      if (r.ok) await refresh();
    },
    [refresh],
  );

  // Global keyboard handler: ↑/↓ moves selection, Enter triages, S
  // toggles the snooze popover, X skips. Skipped when focus is in an
  // input or the snooze popover (which has its own escape handler).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }
      if (items.length === 0 || !selectedId) return;
      const idx = items.findIndex((i) => i.id === selectedId);
      if (idx === -1) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = items[Math.min(idx + 1, items.length - 1)]!;
        setSelectedId(next.id);
        rowRefs.current.get(next.id)?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = items[Math.max(idx - 1, 0)]!;
        setSelectedId(prev.id);
        rowRefs.current.get(prev.id)?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        triage(selectedId);
        return;
      }
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        setSnoozeOpenId((cur) => (cur === selectedId ? null : selectedId));
        return;
      }
      if (e.key === "x" || e.key === "X") {
        e.preventDefault();
        void skip(selectedId);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, selectedId, triage, skip]);

  return (
    <section className="flex-1 px-12 pt-10 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-8 flex items-end justify-between gap-6 max-w-3xl">
        <div>
          <h1 className="font-serif italic text-5xl tracking-tight text-stone-800">
            Inbox.
          </h1>
          <p className="mt-3 text-sm text-stone-400 tracking-wide">
            Sort the day at your own pace. No pressure to clear.
          </p>
        </div>
        <Link
          to="/inbox/triage"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-stone-900 text-white text-sm font-medium tracking-wide hover:bg-stone-700 transition-colors shrink-0"
        >
          Triage all
          <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </Link>
      </header>

      <div className="max-w-3xl">
        <SortToggle value={sortMode} onChange={setSortMode} />

        <div className="mt-5">
          <PageStateView
            state={state}
            loading={<LoadingShell />}
            signedOutBody="Sign in to see your inbox."
            ready={() =>
              items.length === 0 ? (
                <EmptyInbox />
              ) : (
                <ul
                  role="listbox"
                  aria-label="Inbox items"
                  className="flex flex-col gap-2"
                >
                  {items.map((it) => (
                    <InboxRow
                      key={it.id}
                      ref={(el) => {
                        if (el) rowRefs.current.set(it.id, el);
                        else rowRefs.current.delete(it.id);
                      }}
                      item={it}
                      selected={it.id === selectedId}
                      snoozePopoverOpen={snoozeOpenId === it.id}
                      onSelect={() => setSelectedId(it.id)}
                      onTriage={() => triage(it.id)}
                      onSnooze={(untilMs) => {
                        setSnoozeOpenId(null);
                        void snooze(it.id, untilMs);
                      }}
                      onSnoozePopoverChange={(open) =>
                        setSnoozeOpenId(open ? it.id : null)
                      }
                      onSkip={() => void skip(it.id)}
                    />
                  ))}
                </ul>
              )
            }
          />
        </div>

        {state.kind === "ready" && items.length > 0 ? (
          <p className="mt-6 text-[11px] text-stone-400 tracking-wide">
            <span className="font-bold tracking-[0.18em] uppercase">
              Keys
            </span>{" "}
            · ↑/↓ to navigate · Enter to triage · S to snooze · X to skip
          </p>
        ) : null}
      </div>
    </section>
  );
}

interface SortToggleProps {
  value: InboxSortMode;
  onChange: (next: InboxSortMode) => void;
}

function SortToggle({ value, onChange }: SortToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Sort"
      className="inline-flex items-center gap-1 rounded-2xl bg-stone-100/60 border border-stone-200/60 p-1"
    >
      {SORT_OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={[
              "px-3.5 py-1.5 rounded-xl text-xs font-medium tracking-wide transition-colors",
              active
                ? "bg-white text-stone-800 shadow-sm"
                : "text-stone-500 hover:text-stone-800",
            ].join(" ")}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function LoadingShell() {
  return (
    <div role="status" aria-label="Loading inbox" className="flex flex-col gap-2">
      <div className="rounded-[1.8rem] bg-stone-100/60 h-20 animate-pulse" />
      <div className="rounded-[1.8rem] bg-stone-100/60 h-20 animate-pulse" />
      <div className="rounded-[1.8rem] bg-stone-100/60 h-20 animate-pulse" />
    </div>
  );
}

function EmptyInbox() {
  return (
    <div className="rounded-[1.8rem] border border-dashed border-stone-200 bg-white/30 px-8 py-12 flex flex-col items-center text-center">
      <div className="w-12 h-12 rounded-2xl bg-stone-100 text-stone-400 flex items-center justify-center mb-4">
        <InboxIcon className="w-5 h-5" aria-hidden="true" />
      </div>
      <p className="text-sm text-stone-500 font-light max-w-xs">
        Inbox is empty. Use the capture bar above to drop a thought.
      </p>
    </div>
  );
}
