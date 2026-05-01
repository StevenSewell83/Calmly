export interface TextSegment {
  text: string;
  highlighted: boolean;
}

export interface SearchHit {
  id: string;
  kind: "task" | "inbox";
  score: number;
  title: string;
  snippet: string | null;
  titleSegments: TextSegment[];
  snippetSegments: TextSegment[];
}
