import { bucketKey, type ErrorBucket } from "./parse";

export interface BaselineEntry {
  workspace: string;
  file: string;
  code: string;
  count: number;
  // Optional human note — never load-bearing for the diff. Helpful when
  // pruning entries one-by-one in Phase 2.
  reason?: string;
}

export interface DiffResult {
  // Keys present in current but absent in baseline. New errors — hard fail.
  added: ErrorBucket[];
  // Keys whose count grew vs the baseline. Hard fail — even if the file
  // already had errors of this code, adding more isn't allowed.
  increased: { current: ErrorBucket; baseline: number }[];
  // Keys whose count shrank — informational, the developer is making
  // progress and should prune the baseline. Not a fail.
  decreased: { current: ErrorBucket; baseline: number }[];
  // Keys present in baseline but absent in current. The baseline entry
  // can be deleted now.
  fixed: BaselineEntry[];
  // Total silenced errors (sum of counts of buckets that match baseline
  // exactly). Surfaces in the summary so we know what's still owed.
  silenced: number;
}

export function diff(
  current: readonly ErrorBucket[],
  baseline: readonly BaselineEntry[],
): DiffResult {
  const baselineMap = new Map<string, BaselineEntry>();
  for (const b of baseline) {
    baselineMap.set(bucketKey(b.workspace, b.file, b.code), b);
  }
  const currentMap = new Map<string, ErrorBucket>();
  for (const c of current) {
    currentMap.set(bucketKey(c.workspace, c.file, c.code), c);
  }

  const added: ErrorBucket[] = [];
  const increased: { current: ErrorBucket; baseline: number }[] = [];
  const decreased: { current: ErrorBucket; baseline: number }[] = [];
  const fixed: BaselineEntry[] = [];
  let silenced = 0;

  for (const [key, cur] of currentMap) {
    const base = baselineMap.get(key);
    if (!base) {
      added.push(cur);
      continue;
    }
    if (cur.count > base.count) {
      increased.push({ current: cur, baseline: base.count });
    } else if (cur.count < base.count) {
      decreased.push({ current: cur, baseline: base.count });
      silenced += cur.count;
    } else {
      silenced += cur.count;
    }
  }

  for (const [key, base] of baselineMap) {
    if (!currentMap.has(key)) fixed.push(base);
  }

  return { added, increased, decreased, fixed, silenced };
}

export function isCleanDiff(d: DiffResult): boolean {
  return d.added.length === 0 && d.increased.length === 0;
}
