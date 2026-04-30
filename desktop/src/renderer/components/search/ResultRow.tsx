import type { SearchHit } from "@calmly/shared";
import { FileText, Inbox } from "lucide-react";

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
  return (
    <li
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={[
        "flex items-center gap-3 px-4 py-3 cursor-pointer rounded-2xl transition-colors",
        selected ? "bg-emerald-50 text-emerald-900" : "hover:bg-stone-50 text-stone-700",
      ].join(" ")}
    >
      <Icon
        size={14}
        className={selected ? "text-emerald-600" : "text-stone-400"}
      />
      <span className="flex-1 text-sm truncate">
        {hit.snippet ? (
          <span dangerouslySetInnerHTML={{ __html: hit.snippet }} />
        ) : (
          hit.id
        )}
      </span>
      <span
        className={[
          "text-[10px] font-semibold tracking-wider uppercase shrink-0",
          selected ? "text-emerald-500" : "text-stone-300",
        ].join(" ")}
      >
        {KIND_LABEL[hit.kind]}
      </span>
    </li>
  );
}
