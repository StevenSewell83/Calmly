import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Plus, Sparkles } from "lucide-react";
import { MAX_RAW_TEXT_CHARS } from "../utils/constants";
import { BrainDumpSplitModal, type SplitItem } from "./ai/BrainDumpSplitModal";

// Hide the inline confirmation after this many ms.
const CONFIRMATION_TIMEOUT_MS = 1800;

// Threshold to show "Split with AI" affordance.
const SPLIT_CHAR_THRESHOLD = 200;

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "captured"; truncated: boolean }
  | { kind: "error"; message: string };

import type { AIError } from "../../preload/api-types";

type SplitModalState =
  | { kind: "loading" }
  | { kind: "done"; suggestionId: string; items: SplitItem[] }
  | { kind: "error"; error: AIError }
  | null;

// Persistent quick-capture input. Renders inside AppShell at the top of
// every page so a thought can be jotted without context-switching out of
// whatever's on screen. Submits via Enter or the implicit form submit;
// optimistically clears the input on submit and surfaces a brief inline
// confirmation. The global hotkey (CmdOrCtrl+Shift+I) calls
// window.calmly.inbox.onFocusRequest which we wire to focus the input.
export function CaptureBar() {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [splitModal, setSplitModal] = useState<SplitModalState>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const confirmationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void window.calmly.ai
      .getSettings()
      .then((s) => setAiEnabled(s.enabled))
      .catch(() => {});
  }, []);

  // Wire the main-process focus event to the input. Each callback returns
  // an unsubscribe so React's strict-mode double-mount doesn't accumulate
  // listeners.
  useEffect(() => {
    const off = window.calmly.inbox.onFocusRequest(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return off;
  }, []);

  // Cancel any pending confirmation timer when the component unmounts so
  // a setState doesn't fire after teardown.
  useEffect(() => {
    return () => {
      if (confirmationTimer.current) clearTimeout(confirmationTimer.current);
    };
  }, []);

  const flashCaptured = useCallback((truncated: boolean) => {
    setStatus({ kind: "captured", truncated });
    if (confirmationTimer.current) clearTimeout(confirmationTimer.current);
    confirmationTimer.current = setTimeout(() => {
      setStatus({ kind: "idle" });
    }, CONFIRMATION_TIMEOUT_MS);
  }, []);

  const onSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (status.kind === "submitting") return;
      const trimmed = text.trim();
      if (trimmed.length === 0) return;

      // Optimistic UI: clear the input immediately so the user can keep
      // typing the next thought. Restore the text only on actual error so
      // the user doesn't lose their words.
      setText("");
      setStatus({ kind: "submitting" });
      const result = await window.calmly.inbox.add(trimmed);
      if (result.ok) {
        flashCaptured(result.truncated);
        return;
      }
      setText(trimmed);
      const message =
        result.error === "InvalidArgs"
          ? "Empty — type something to capture."
          : result.error === "NotSignedIn"
            ? "Sign in first to capture."
            : "Couldn't save — try again.";
      setStatus({ kind: "error", message });
    },
    [text, status.kind, flashCaptured],
  );

  const handleSplit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSplitModal({ kind: "loading" });
    try {
      const r = await window.calmly.ai.run("brain_dump_split", {
        text: trimmed,
      });
      if (!r.ok) {
        setSplitModal({ kind: "error", error: r.error });
        return;
      }
      const result = r.value.result as { tasks: SplitItem[] };
      setSplitModal({
        kind: "done",
        suggestionId: r.value.suggestionId,
        items: result.tasks,
      });
    } catch {
      setSplitModal({ kind: "error", error: { kind: "unknown" } });
    }
  }, [text]);

  const handleSplitConfirm = useCallback(
    async (items: SplitItem[], suggestionId: string) => {
      const texts = items.map((i) => i.title);
      await window.calmly.inbox.bulkAdd(texts);
      await window.calmly.ai.recordOutcome(suggestionId, "accepted");
      setText("");
      setSplitModal(null);
      flashCaptured(false);
    },
    [flashCaptured],
  );

  const showSplitButton =
    aiEnabled && text.trim().length >= SPLIT_CHAR_THRESHOLD;
  const disabled = status.kind === "submitting" || text.trim().length === 0;

  return (
    <>
      <form
        onSubmit={onSubmit}
        className="w-full bg-white/40 backdrop-blur-md border-b border-stone-200/60 px-8 py-5 flex items-center gap-4 z-30"
        aria-label="Quick capture"
      >
        <Plus
          className={`w-5 h-5 transition-colors ${
            text.length > 0 ? "text-emerald-500" : "text-stone-300"
          }`}
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (status.kind === "error") setStatus({ kind: "idle" });
          }}
          placeholder="Capture a thought…"
          aria-label="Capture a thought"
          maxLength={MAX_RAW_TEXT_CHARS}
          className="flex-1 bg-transparent text-base font-light text-stone-800 placeholder:text-stone-400 focus:outline-none"
          // Renderer never needs the cursor in here on initial mount —
          // hotkey + click are the only intentional focus paths.
        />
        <ConfirmationSlot status={status} />
        {showSplitButton && (
          <button
            type="button"
            onClick={() => void handleSplit()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-2xl text-xs font-medium tracking-wide text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors shrink-0"
            title="Split into multiple inbox items with AI"
          >
            <Sparkles size={12} />
            Split with AI
          </button>
        )}
        <button
          type="submit"
          disabled={disabled}
          className={[
            "px-4 py-2 rounded-2xl text-xs font-medium tracking-wide transition-colors",
            disabled
              ? "bg-stone-100 text-stone-400 cursor-not-allowed"
              : "bg-emerald-500 text-white hover:bg-emerald-600",
          ].join(" ")}
        >
          {status.kind === "submitting" ? "Adding…" : "Add"}
        </button>
      </form>

      {splitModal && (
        <BrainDumpSplitModal
          state={splitModal}
          onClose={() => setSplitModal(null)}
          onConfirm={handleSplitConfirm}
        />
      )}
    </>
  );
}

interface ConfirmationSlotProps {
  status: Status;
}

// Pulled out so the parent's render stays scannable. Three visible states:
// captured (with optional truncation note), error message, or empty.
function ConfirmationSlot({ status }: ConfirmationSlotProps) {
  if (status.kind === "captured") {
    return (
      <span
        role="status"
        className="text-xs text-emerald-600 font-medium tracking-wide whitespace-nowrap"
      >
        {status.truncated ? "Added (trimmed at 4000 chars)" : "Added to Inbox"}
      </span>
    );
  }
  if (status.kind === "error") {
    return (
      <span
        role="alert"
        className="text-xs text-rose-600 font-medium tracking-wide whitespace-nowrap"
      >
        {status.message}
      </span>
    );
  }
  return null;
}
