import type { TextSegment } from "@calmly/shared";

interface HighlightProps {
  segments: TextSegment[];
  className?: string;
}

export function Highlight({ segments, className }: HighlightProps) {
  if (segments.length === 0) return null;
  return (
    <span className={className}>
      {segments.map((seg, i) =>
        seg.highlighted ? (
          <strong key={i} className="font-semibold underline underline-offset-2">
            {seg.text}
          </strong>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </span>
  );
}
