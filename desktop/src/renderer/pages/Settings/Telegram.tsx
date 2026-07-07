// TGR-06: Settings → Telegram page. Link (one-time code + t.me deep link +
// live polling), linked status, unlink. Rebuilds the lost TG-08 spec against
// the real server surface (server/src/telegram/linkingRoutes.ts, TG-02b):
// note the server only stores chatId, never a username, so "Linked" shows
// chatId + linkedAt rather than the "@username" the original spec assumed.
//
// Error copy follows PRD §13: what happened, what the user can do, whether
// anything is lost. View-state types/copy live in ./telegramView, the active
// code card in ./TelegramActiveCode — split out to stay under max-lines.
import { useEffect, useRef, useState } from "react";
import { Send, Loader2, AlertTriangle, Unlink } from "lucide-react";
import { ActiveCode } from "./TelegramActiveCode";
import { applyStatus, codeErrorCopy, formatLinkedAt, type ViewState } from "./telegramView";

const POLL_INTERVAL_MS = 3000;

export function SettingsTelegram() {
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  function stopPolling() {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function refreshStatus() {
    const status = await window.calmly.telegram.getStatus();
    if (!mountedRef.current) return;
    setView((prev) => {
      // Preserve in-flight code UI (don't clobber an active code with a
      // fresh "unlinked/idle" on every poll tick) unless the poll itself is
      // what's driving the transition to linked.
      if (status.ok && !status.linked && prev.kind === "unlinked") {
        return prev;
      }
      return applyStatus(status);
    });
    if (status.ok && status.linked) stopPolling();
  }

  useEffect(() => {
    mountedRef.current = true;
    void refreshStatus();
    return () => {
      mountedRef.current = false;
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startPolling(expiresAt: number) {
    stopPolling();
    pollRef.current = setInterval(() => {
      // Plain (non-React-state) time check first — side effects like
      // clearInterval must not live inside a setState updater function.
      if (Date.now() >= expiresAt) {
        stopPolling();
        setView({ kind: "unlinked", code: { kind: "expired" } });
        return;
      }
      void refreshStatus();
    }, POLL_INTERVAL_MS);
  }

  async function handleGetCode() {
    setView({ kind: "unlinked", code: { kind: "generating" } });
    const result = await window.calmly.telegram.createLinkingCode();
    if (!mountedRef.current) return;
    if (!result.ok) {
      setView({ kind: "unlinked", code: { kind: "error", message: codeErrorCopy(result) } });
      return;
    }
    setView({
      kind: "unlinked",
      code: {
        kind: "active",
        code: result.code,
        expiresAt: result.expiresAt,
        botUsername: result.botUsername,
        copied: false,
      },
    });
    startPolling(result.expiresAt);
  }

  async function handleCopy(deepLinkOrCode: string) {
    try {
      await navigator.clipboard.writeText(deepLinkOrCode);
      setView((prev) => {
        if (prev.kind === "unlinked" && prev.code.kind === "active") {
          return { kind: "unlinked", code: { ...prev.code, copied: true } };
        }
        return prev;
      });
      setTimeout(() => {
        setView((prev) => {
          if (prev.kind === "unlinked" && prev.code.kind === "active") {
            return { kind: "unlinked", code: { ...prev.code, copied: false } };
          }
          return prev;
        });
      }, 2000);
    } catch {
      // Clipboard unavailable (permissions, headless env) — the code is
      // still visible on screen for manual copy, nothing to surface.
    }
  }

  function handleUnlinkRequest() {
    setView((prev) => (prev.kind === "linked" ? { ...prev, confirming: true } : prev));
  }

  function handleUnlinkCancel() {
    setView((prev) => (prev.kind === "linked" ? { ...prev, confirming: false } : prev));
  }

  async function handleUnlinkConfirm() {
    setView((prev) => (prev.kind === "linked" ? { ...prev, unlinking: true, error: null } : prev));
    const result = await window.calmly.telegram.unlink();
    if (!mountedRef.current) return;
    if (!result.ok) {
      setView((prev) =>
        prev.kind === "linked"
          ? {
              ...prev,
              unlinking: false,
              confirming: false,
              error:
                "Couldn't unlink your Telegram account. Try again — your link is still active.",
            }
          : prev,
      );
      return;
    }
    setView({ kind: "unlinked", code: { kind: "idle" } });
  }

  return (
    <div className="px-10 py-12 max-w-2xl">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-9 h-9 rounded-2xl bg-stone-100 flex items-center justify-center">
          <Send size={16} className="text-stone-600" />
        </div>
        <div>
          <h1 className="font-serif italic text-2xl text-stone-800 leading-tight">Telegram</h1>
          <p className="text-xs text-stone-400 mt-0.5">
            Link your Telegram so capture works on the go.
          </p>
        </div>
      </div>

      {view.kind === "loading" && (
        <div className="flex items-center gap-2 text-stone-400 text-sm">
          <Loader2 size={14} className="animate-spin" />
          Loading…
        </div>
      )}

      {view.kind === "error" && (
        <div className="bg-white border border-stone-100 rounded-[1.8rem] p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-500">{view.message}</p>
          </div>
          <button
            type="button"
            onClick={() => void refreshStatus()}
            className="mt-4 px-4 py-2 rounded-xl bg-stone-900 text-white text-sm font-medium hover:bg-stone-800 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {view.kind === "unlinked" && (
        <div className="bg-white border border-stone-100 rounded-[1.8rem] p-6 shadow-sm">
          {view.code.kind === "idle" && (
            <div className="text-center py-4">
              <Send size={28} className="mx-auto text-stone-300 mb-4" />
              <p className="text-sm font-medium text-stone-700 mb-1">Not linked yet</p>
              <p className="text-xs text-stone-400 mb-6">
                Get a one-time code and send it to the Calmly bot to capture tasks from Telegram.
              </p>
              <button
                type="button"
                onClick={() => void handleGetCode()}
                className="px-5 py-2.5 rounded-2xl bg-stone-900 text-white text-sm font-medium hover:bg-stone-800 transition-colors"
              >
                Get code
              </button>
            </div>
          )}

          {view.code.kind === "generating" && (
            <div className="flex items-center justify-center gap-2 text-stone-400 text-sm py-8">
              <Loader2 size={14} className="animate-spin" />
              Generating code…
            </div>
          )}

          {view.code.kind === "active" && <ActiveCode code={view.code} onCopy={handleCopy} />}

          {view.code.kind === "expired" && (
            <div className="text-center py-4">
              <p className="text-sm text-stone-600 mb-4">
                That code expired. Nothing was lost — get a new one to keep going.
              </p>
              <button
                type="button"
                onClick={() => void handleGetCode()}
                className="px-5 py-2.5 rounded-2xl bg-stone-900 text-white text-sm font-medium hover:bg-stone-800 transition-colors"
              >
                Get a new code
              </button>
            </div>
          )}

          {view.code.kind === "error" && (
            <div className="text-center py-4">
              <div className="flex items-start gap-3 text-left mb-4">
                <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
                <p className="text-sm text-red-500">{view.code.message}</p>
              </div>
              <button
                type="button"
                onClick={() => void handleGetCode()}
                className="px-5 py-2.5 rounded-2xl bg-stone-900 text-white text-sm font-medium hover:bg-stone-800 transition-colors"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      )}

      {view.kind === "linked" && (
        <div className="bg-white border border-stone-100 rounded-[1.8rem] p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="inline-block text-[10px] font-medium px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200 mb-2">
                Linked
              </span>
              <p className="text-sm font-medium text-stone-800">Telegram connected</p>
              <p className="text-xs text-stone-400 mt-0.5">
                Linked {formatLinkedAt(view.linkedAt)}
              </p>
            </div>
            <button
              type="button"
              aria-label="Unlink Telegram"
              disabled={view.unlinking}
              onClick={handleUnlinkRequest}
              className="p-1.5 rounded-xl text-stone-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40 shrink-0"
            >
              {view.unlinking ? <Loader2 size={14} className="animate-spin" /> : <Unlink size={14} />}
            </button>
          </div>

          {view.error && <p className="mt-4 text-sm text-red-500">{view.error}</p>}

          {view.confirming && (
            <div className="mt-4 flex items-center gap-3 pt-4 border-t border-stone-200">
              <AlertTriangle size={12} className="text-red-400 shrink-0" />
              <p className="text-xs text-stone-500 flex-1">
                Unlink Telegram? You'll stop receiving reminders there until you link again.
              </p>
              <button
                type="button"
                onClick={() => void handleUnlinkConfirm()}
                className="text-xs px-2.5 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors font-medium"
              >
                Unlink
              </button>
              <button
                type="button"
                onClick={handleUnlinkCancel}
                className="text-xs px-2.5 py-1 rounded-lg text-stone-500 hover:bg-stone-100 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
