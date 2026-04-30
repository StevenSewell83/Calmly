export interface SearchHit {
  id: string;
  kind: "task" | "inbox";
  score: number;
  snippet: string | null;
}
