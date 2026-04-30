/**
 * Comparator: take a single table's columns from each of the three sources
 * and return the set of drifts (with allow-list filtering applied).
 */
import type {
  AllowList,
  ColumnInfo,
  ColumnTypeBucket,
  SourceTables,
} from "./types";

export type SourceName = "shared" | "desktop" | "server";

export interface DriftRecord {
  column: string;
  cells: { shared?: ColumnInfo; desktop?: ColumnInfo; server?: ColumnInfo };
  kind: "missing" | "type-mismatch";
  /** Bucket per source — populated for `type-mismatch` kind. */
  types: ColumnTypeBucket[];
}

export interface CompareResult {
  drifts: DriftRecord[];
  silenced: string[];
}

function presentSources(cells: DriftRecord["cells"]): SourceName[] {
  const out: SourceName[] = [];
  if (cells.shared) out.push("shared");
  if (cells.desktop) out.push("desktop");
  if (cells.server) out.push("server");
  return out;
}

function absentSources(cells: DriftRecord["cells"]): SourceName[] {
  const out: SourceName[] = [];
  if (!cells.shared) out.push("shared");
  if (!cells.desktop) out.push("desktop");
  if (!cells.server) out.push("server");
  return out;
}

function setsEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  const aSet = new Set(a);
  for (const x of b) if (!aSet.has(x)) return false;
  return true;
}

/** Type-bucket equivalence: `unknown` is wildcard so noisy buckets (e.g.
 * `z.union` falling back to unknown) don't trigger false positives. */
function bucketsCompatible(buckets: ColumnTypeBucket[]): boolean {
  const concrete = buckets.filter((b) => b !== "unknown");
  if (concrete.length === 0) return true;
  const first = concrete[0] as ColumnTypeBucket;
  return concrete.every((b) => b === first);
}

export function compare(
  table: string,
  cells: {
    shared?: Record<string, ColumnInfo>;
    desktop?: Record<string, ColumnInfo>;
    server?: Record<string, ColumnInfo>;
  },
  allowList: AllowList,
): CompareResult {
  const allowed = allowList.divergences.filter((d) => d.table === table);
  const tableLevel = (allowList.tables ?? []).filter((t) => t.table === table);

  const allCols = new Set<string>();
  for (const src of ["shared", "desktop", "server"] as const) {
    for (const c of Object.keys(cells[src] ?? {})) allCols.add(c);
  }

  // Whole-table allow-list: if a `tables` entry says this table is absent
  // from {sources}, suppress every "missing from those sources" drift.
  const tableAbsentFromAll = new Set<SourceName>();
  for (const t of tableLevel) {
    for (const a of t.absentIn) tableAbsentFromAll.add(a);
  }

  const drifts: DriftRecord[] = [];
  const silenced: string[] = [];

  for (const col of Array.from(allCols).sort()) {
    const colCells = {
      shared: cells.shared?.[col],
      desktop: cells.desktop?.[col],
      server: cells.server?.[col],
    };
    const present = presentSources(colCells);
    const absent = absentSources(colCells);

    if (absent.length > 0) {
      // Missing-from-some-source drift. Check column-level allow-list.
      const match = allowed.find(
        (d) =>
          d.column === col &&
          setsEqual(d.presentIn, present) &&
          setsEqual(d.absentIn, absent),
      );
      if (match) {
        silenced.push(col);
        continue;
      }
      // Whole-table allow-list: if every "absent" source is a source that
      // doesn't carry this table at all, the missing column is expected.
      const allAbsentExplained = absent.every((a) => tableAbsentFromAll.has(a));
      if (allAbsentExplained && tableAbsentFromAll.size > 0) {
        silenced.push(col);
        continue;
      }
      drifts.push({ column: col, cells: colCells, kind: "missing", types: [] });
      continue;
    }

    // All three present — type bucket check.
    const buckets: ColumnTypeBucket[] = [
      colCells.shared!.bucket,
      colCells.desktop!.bucket,
      colCells.server!.bucket,
    ];
    if (!bucketsCompatible(buckets)) {
      // Type mismatch is a softer drift — only flag if no allow-list entry
      // for this column allows divergence between the two sources at all.
      const match = allowed.find((d) => d.column === col);
      if (match) {
        silenced.push(col);
        continue;
      }
      drifts.push({
        column: col,
        cells: colCells,
        kind: "type-mismatch",
        types: buckets,
      });
    }
  }

  return { drifts, silenced };
}

export type { ColumnInfo, ColumnTypeBucket, SourceTables };
