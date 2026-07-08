import type { SearchHit } from "@calmly/shared";
import { FileText, Inbox } from "lucide-react";
import { Highlight } from "./Highlight";

interface ResultRowProps {
  hit: SearchHit;
  selected: boolean;
  onSelect: () => void;
}

const KIND_ICON = {
  task: FileText,
  inbox: Inbox,
};

const KIND_LABEL = {
  task: "Task",
  inbox: "Inbox",
};

export function ResultRow({ hit, selected, onSelect }: ResultRowProps) {
  const Icon = KIND_ICON[hit.kind];
  const hasSnippet = hit.snippetSegments.length > 0;
  return (
    <li
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={[
        "flex items-start gap-3 px-4 py-3 cursor-pointer rounded-2xl transition-colors",
        selected
          ? "bg-emerald-50 text-emerald-900"
          : "hover:bg-stone-50 text-stone-700",
      ].join(" ")}
    >
      <Icon
        size={14}
        className={[
          "mt-0.5 shrink-0",
          selected ? "text-emerald-600" : "text-stone-400",
        ].join(" ")}
      />
      <div className="flex-1 min-w-0">
        <Highlight
          segments={
            hit.titleSegments.length > 0
              ? hit.titleSegments
              : [{ text: hit.title, highlighted: false }]
          }
          className="block text-sm truncate"
        />
        {hasSnippet && (
          <Highlight
            segments={hit.snippetSegments}
            className={[
              "block text-xs mt-0.5 truncate",
              selected ? "text-emerald-700" : "text-stone-400",
            ].join(" ")}
          />
        )}
      </div>
      <span
        className={[
          "text-[10px] font-semibold tracking-wider uppercase shrink-0 mt-0.5",
          selected ? "text-emerald-500" : "text-stone-300",
        ].join(" ")}
      >
        {KIND_LABEL[hit.kind]}
      </span>
    </li>
  );
}
