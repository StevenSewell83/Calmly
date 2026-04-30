interface ActionProps {
  label: string;
  onClick(): void;
  variant?: "primary" | "secondary";
}

interface EmptyStateProps {
  title: string;
  body: string;
  primaryAction?: ActionProps;
  secondaryAction?: ActionProps;
  // Unique identifier used as data-empty-state attribute for E2E selectors.
  name: string;
}

export function EmptyState({
  title,
  body,
  primaryAction,
  secondaryAction,
  name,
}: EmptyStateProps) {
  return (
    <div
      data-empty-state={name}
      className="flex flex-col items-start gap-4 rounded-[2rem] border border-dashed border-stone-200 bg-white/30 px-8 py-10 max-w-md"
    >
      <div>
        <p className="text-base font-medium text-stone-700">{title}</p>
        <p className="mt-1 text-sm text-stone-400 font-light leading-relaxed">{body}</p>
      </div>
      {(primaryAction ?? secondaryAction) && (
        <div className="flex items-center gap-3 flex-wrap">
          {primaryAction && (
            <button
              type="button"
              onClick={primaryAction.onClick}
              className="px-4 py-2 rounded-2xl text-xs font-medium tracking-wide bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
            >
              {primaryAction.label}
            </button>
          )}
          {secondaryAction && (
            <button
              type="button"
              onClick={secondaryAction.onClick}
              className="px-4 py-2 rounded-2xl text-xs font-medium tracking-wide text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition-colors"
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
