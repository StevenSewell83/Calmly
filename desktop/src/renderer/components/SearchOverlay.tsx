import { Search } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SearchOverlay({ open, onClose }: Props) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      className="fixed inset-0 z-50 flex items-start justify-center bg-stone-900/30 backdrop-blur-sm pt-32 px-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-white border border-stone-100 rounded-[2rem] shadow-2xl p-6"
      >
        <div className="flex items-center gap-3 border-b border-stone-100 pb-4">
          <Search className="w-5 h-5 text-stone-300" />
          <input
            autoFocus
            type="text"
            placeholder="Search anything…"
            className="flex-1 bg-transparent outline-none text-lg text-stone-800 placeholder:text-stone-300"
            aria-label="Search query"
          />
          <span className="text-[10px] font-bold tracking-widest text-stone-300 uppercase">
            esc
          </span>
        </div>
        <div className="pt-4 px-1 text-sm text-stone-400 italic">
          Search will arrive with Epic 6 — for now this overlay is a placeholder
          so the keyboard surface is wired.
        </div>
      </div>
    </div>
  );
}
