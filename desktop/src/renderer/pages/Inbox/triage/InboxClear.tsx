import { ArrowRight, Lightbulb } from "lucide-react";
import { MountainClimberIcon } from "../../../components/MountainClimberIcon";

interface Props {
  onHome: () => void;
}

// Empty-state celebration shown when the inbox queue is exhausted
// inside the triage flow. Soft palette + the MountainClimber illo;
// 'Back to today' returns to Home with a single click.
export function InboxClear({ onHome }: Props): JSX.Element {
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
