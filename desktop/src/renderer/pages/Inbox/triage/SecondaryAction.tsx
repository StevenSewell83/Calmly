import type { CheckCircle2 } from "lucide-react";

interface Props {
  label: string;
  hint: string;
  icon: typeof CheckCircle2;
  onClick: () => void;
  disabled?: boolean;
}

// Quiet text-button row at the right side of the action bar. Empty
// hint = no keyboard shortcut shown in the title attribute.
export function SecondaryAction({
  label,
  hint,
  icon: Icon,
  onClick,
  disabled,
}: Props): JSX.Element {
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
