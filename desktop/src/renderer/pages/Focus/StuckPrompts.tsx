import { useState } from "react";
import { ChevronLeft, ChevronRight, SkipForward, X } from "lucide-react";

export const STUCK_PROMPTS = [
  "What's the smallest next thing you could do — even something tiny?",
  "Is the task unclear? If so, what's the question?",
  "Do you need a person, an answer, or a piece of info?",
  "Could a 5-minute version count as done?",
  "Can you switch to a different task and return later?",
] as const;

export type StuckOutcome = "continue" | "switch" | "break";

interface Props {
  stuckSessionId: string;
  onContinue(): void;
  onSwitch(): void;
  onBreak(): void;
  onClose(): void;
}

interface Answer {
  question: string;
  answer: string;
}

export function StuckPrompts({ stuckSessionId, onContinue, onSwitch, onBreak, onClose }: Props) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  const isLast = step === STUCK_PROMPTS.length - 1;
  const question = STUCK_PROMPTS[step]!;

  const buildAnswers = (): Answer[] =>
    Object.entries(answers)
      .filter(([, v]) => v.trim())
      .map(([i, a]) => ({ question: STUCK_PROMPTS[Number(i)]!, answer: a }));

  const finish = async (outcome: StuckOutcome) => {
    setBusy(true);
    await window.calmly.focus.endStuck({
      stuckSessionId,
      outcome,
      answers: buildAnswers(),
    });
    setBusy(false);
    if (outcome === "continue") onContinue();
    else if (outcome === "switch") onSwitch();
    else onBreak();
  };

  return (
    <div
      role="dialog"
      aria-label="I'm stuck"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-md mx-4 bg-white rounded-[2rem] shadow-2xl p-8 animate-in slide-in-from-bottom-4 duration-300">
        {/* Close */}
        <button
          onClick={onClose}
          aria-label="End rescue"
          className="absolute top-4 right-4 p-1.5 rounded-xl text-stone-400 hover:text-stone-700 hover:bg-stone-100"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Step counter */}
        <p className="text-[10px] font-bold tracking-widest uppercase text-stone-400 mb-4">
          Rescue · {step + 1} of {STUCK_PROMPTS.length}
        </p>

        {/* Progress dots */}
        <div className="flex gap-1.5 mb-6">
          {STUCK_PROMPTS.map((_, i) => (
            <span
              key={i}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${i <= step ? "bg-emerald-500" : "bg-stone-200"}`}
            />
          ))}
        </div>

        <h2 className="text-lg font-medium text-stone-800 leading-snug mb-4">{question}</h2>

        <textarea
          value={answers[step] ?? ""}
          onChange={(e) => setAnswers((prev) => ({ ...prev, [step]: e.target.value }))}
          placeholder="Type something, or skip…"
          rows={3}
          className="w-full text-sm rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-300 mb-4"
        />

        {/* Navigation */}
        {!isLast ? (
          <div className="flex gap-2">
            {step > 0 && (
              <button
                onClick={() => setStep((s) => s - 1)}
                className="p-2 rounded-xl border border-stone-200 text-stone-500 hover:bg-stone-50"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={() => setStep((s) => s + 1)}
              disabled={busy}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-2xl bg-stone-800 hover:bg-stone-900 text-white text-sm font-medium transition-colors"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => setStep((s) => s + 1)}
              className="p-2 rounded-xl border border-stone-200 text-stone-400 hover:bg-stone-50"
              aria-label="Skip"
            >
              <SkipForward className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-stone-500 text-center mb-3">What would you like to do?</p>
            <button
              onClick={() => void finish("continue")}
              disabled={busy}
              className="w-full py-2.5 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50"
            >
              Continue current task
            </button>
            <button
              onClick={() => void finish("switch")}
              disabled={busy}
              className="w-full py-2.5 rounded-2xl border border-stone-200 text-stone-700 hover:bg-stone-50 text-sm disabled:opacity-50"
            >
              Switch task
            </button>
            <button
              onClick={() => void finish("break")}
              disabled={busy}
              className="w-full py-2.5 rounded-2xl border border-stone-200 text-stone-500 hover:bg-stone-50 text-sm disabled:opacity-50"
            >
              Take a break
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
