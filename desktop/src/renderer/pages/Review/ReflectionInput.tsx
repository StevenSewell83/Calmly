import { useEffect, useRef, useState } from "react";

interface Props {
  initialText: string;
  // Fired on every change so the parent can hand the latest text to
  // completeShutdown without a separate save click.
  onChange: (text: string) => void;
}

const MAX_CHARS = 280;

// Calm, low-pressure single-line journal field. Per PRD §11 this is
// optional — empty input is the happy path. The 280-char ceiling is
// the same as the schema's renderer-facing limit; the schema accepts
// up to 4096 server-side so a paste overrun is never a sync problem.
export function ReflectionInput({
  initialText,
  onChange,
}: Props): JSX.Element {
  const [text, setText] = useState<string>(initialText);
  const initialRef = useRef<string>(initialText);

  // Reset internal state when the parent loads a new initial value
  // (e.g. summary refresh after reload). Comparing against the ref
  // prevents an infinite loop when the parent re-renders unrelated.
  useEffect(() => {
    if (initialText !== initialRef.current) {
      setText(initialText);
      initialRef.current = initialText;
    }
  }, [initialText]);

  const remaining = MAX_CHARS - text.length;

  return (
    <section aria-labelledby="review-reflection-heading">
      <header className="mb-3">
        <h2
          id="review-reflection-heading"
          className="text-[10px] font-bold tracking-[0.22em] uppercase text-stone-500 flex items-center gap-2"
        >
          <span className="w-1 h-1 rounded-full bg-stone-400" />
          One word about today
        </h2>
        <p className="mt-1 text-sm text-stone-400 tracking-wide">
          Optional. Skip if nothing comes to mind.
        </p>
      </header>
      <div className="relative">
        <input
          type="text"
          value={text}
          maxLength={MAX_CHARS}
          onChange={(e) => {
            setText(e.target.value);
            onChange(e.target.value);
          }}
          placeholder="Quiet, slow, tender, exhausted, finally…"
          className="w-full px-5 py-4 rounded-[1.4rem] bg-white border border-stone-200/60 text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 transition-colors"
          aria-label="Reflection"
        />
        <span
          className={[
            "absolute right-5 top-1/2 -translate-y-1/2 text-[10px] tracking-[0.18em] uppercase font-bold",
            remaining < 20 ? "text-amber-500" : "text-stone-300",
          ].join(" ")}
          aria-live="polite"
        >
          {remaining}
        </span>
      </div>
    </section>
  );
}
