import { useEffect, useRef, type KeyboardEvent } from "react";
import { Search, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { SearchHit } from "@calmly/shared";
import { ResultRow } from "./search/ResultRow";
import { useSearchStore } from "../state/searchStore";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SearchOverlay({ open, onClose }: Props) {
  const {
    query,
    hits,
    loading,
    selectedIndex,
    openOverlay,
    closeOverlay,
    setQuery,
    moveSelection,
  } = useSearchStore();

  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (open) {
      openOverlay();
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, openOverlay]);

  function handleClose() {
    closeOverlay();
    onClose();
  }

  function jumpToHit(hit: SearchHit) {
    handleClose();
    if (hit.kind === "task") {
      void navigate(`/plan?focus=${hit.id}`);
    } else {
      void navigate(`/inbox?focus=${hit.id}`);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      handleClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      moveSelection(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveSelection(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (hits[selectedIndex]) jumpToHit(hits[selectedIndex]);
    }
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      className="fixed inset-0 z-50 flex items-start justify-center bg-stone-900/30 backdrop-blur-sm pt-28 px-6"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-xl bg-white rounded-[2rem] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-stone-100">
          {loading ? (
            <Loader2
              size={16}
              className="text-stone-400 animate-spin shrink-0"
            />
          ) : (
            <Search size={16} className="text-stone-400 shrink-0" />
          )}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search tasks and inbox…"
            aria-autocomplete="list"
            aria-controls="search-results"
            className="flex-1 text-sm text-stone-800 bg-transparent outline-none placeholder:text-stone-300"
          />
          <kbd className="text-[10px] text-stone-300 font-mono">esc</kbd>
        </div>

        <ul
          id="search-results"
          role="listbox"
          aria-label="Search results"
          className="max-h-80 overflow-y-auto p-2"
        >
          {!query.trim() && (
            <li className="px-4 py-8 text-center text-sm text-stone-400">
              Type to search your tasks, inbox, and notes.
            </li>
          )}
          {query.trim() && !loading && hits.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-stone-400">
              No matches for &ldquo;{query}&rdquo;.
            </li>
          )}
          {hits.map((hit, i) => (
            <ResultRow
              key={`${hit.kind}-${hit.id}`}
              hit={hit}
              selected={i === selectedIndex}
              onSelect={() => jumpToHit(hit)}
            />
          ))}
        </ul>

        {hits.length > 0 && (
          <div className="px-5 py-2.5 border-t border-stone-50 flex items-center gap-4 text-[10px] text-stone-300">
            <span>↑↓ navigate</span>
            <span>↵ open</span>
            <span>esc close</span>
          </div>
        )}
      </div>
    </div>
  );
}
