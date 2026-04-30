import type { CheckCircle2 } from "lucide-react";

interface Props {
  label: string;
  icon: typeof CheckCircle2;
  onClick: () => void;
  disabled?: boolean;
  tone?: "emerald" | "rose";
}

// Themed primary action used for Today/This Week/Later (task), Schedule
// event, and Discard. Tone defaults to emerald; rose flips for the
// destructive Discard branch.
export function PrimaryButton({
  label,
  icon: Icon,
  onClick,
  disabled,
  tone = "emerald",
}: Props): JSX.Element {
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
