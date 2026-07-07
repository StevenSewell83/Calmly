// TGR-06: the "code + t.me deep link + copy button" card shown while a
// linking code is active. Split out of Telegram.tsx to keep that file under
// the repo's max-lines gate.
import { Check, Copy, Loader2 } from "lucide-react";
import type { CodeState } from "./telegramView";

export function ActiveCode({
  code,
  onCopy,
}: {
  code: Extract<CodeState, { kind: "active" }>;
  onCopy: (value: string) => void;
}) {
  const deepLink = code.botUsername
    ? `https://t.me/${code.botUsername}?start=${code.code}`
    : null;
  const copyValue = deepLink ?? code.code;
  const minutesLeft = Math.max(0, Math.ceil((code.expiresAt - Date.now()) / 60_000));

  return (
    <div className="text-center py-2">
      <p className="text-xs text-stone-400 mb-3">Your one-time code</p>
      <p className="text-3xl font-mono tracking-[0.3em] text-stone-800 mb-4">{code.code}</p>

      {deepLink ? (
        <a
          href={deepLink}
          className="text-sm text-emerald-600 hover:text-emerald-700 underline break-all"
        >
          Open in Telegram
        </a>
      ) : (
        <p className="text-xs text-stone-400">
          Send <span className="font-mono">/start {code.code}</span> to the Calmly bot on Telegram.
        </p>
      )}

      <div className="mt-4 flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => onCopy(copyValue)}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-stone-100 text-stone-600 hover:bg-stone-200 transition-colors font-medium"
        >
          {code.copied ? <Check size={12} /> : <Copy size={12} />}
          {code.copied ? "Copied" : "Copy"}
        </button>
      </div>

      <div className="mt-5 flex items-center justify-center gap-2 text-stone-400 text-xs">
        <Loader2 size={12} className="animate-spin" />
        Waiting for you to message the bot… expires in {minutesLeft} min
      </div>
    </div>
  );
}
