import { useEffect } from "react";
import { X } from "lucide-react";

interface Props {
  open: boolean;
  title: string;
  body: string;
  beadId: string;
  onClose: () => void;
}

// Minimal placeholder modal for Replan + Quick Plan until CL-12 / CL-08
// ship. Acceptable per the bead's "stub modal acceptable" guidance.
// Esc closes; backdrop click closes; visible focus management is
// kept light because this gets replaced wholesale soon.
export function StubModal({ open, title, body, beadId, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="stub-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md mx-6 bg-white rounded-[2rem] border border-stone-200 shadow-2xl px-8 py-7"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-5 right-5 w-8 h-8 rounded-full text-stone-400 hover:text-stone-700 hover:bg-stone-100 flex items-center justify-center transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
        <h2
          id="stub-modal-title"
          className="font-serif italic text-2xl text-stone-800 tracking-tight"
        >
          {title}
        </h2>
        <p className="mt-3 text-sm text-stone-500 leading-relaxed">{body}</p>
        <p className="mt-5 text-[10px] font-bold tracking-[0.22em] uppercase text-stone-400">
          Ships in {beadId}
        </p>
      </div>
    </div>
  );
}
