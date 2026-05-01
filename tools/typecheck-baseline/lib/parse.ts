// Parses pnpm-recursive typecheck output into structured error records.
//
// The expected line shape (one error per line) is:
//   <workspace> typecheck: <file>(<line>,<col>): error TS<code>: <message>
//
// pnpm prefixes every workspace-script line with `<workspace> <script>:`.
// We anchor on ` typecheck: ` then extract the TS error tail. Anything that
// doesn't match is ignored (Done banners, build progress, etc).

export interface TypecheckError {
  workspace: string;
  file: string;
  line: number;
  column: number;
  code: string; // e.g. "TS2345"
  message: string;
}

const ERROR_RE =
  /^([^\s]+(?:\/[^\s]+)?)\s+typecheck:\s+(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.*)$/;

export function parseTypecheckOutput(text: string): TypecheckError[] {
  const out: TypecheckError[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const m = ERROR_RE.exec(line);
    if (!m) continue;
    const [, workspace, file, lineStr, colStr, code, message] = m as unknown as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    out.push({
      workspace,
      file,
      line: parseInt(lineStr, 10),
      column: parseInt(colStr, 10),
      code,
      message,
    });
  }
  return out;
}

// Groups errors by (workspace, file, code) → count. The grouping is
// intentionally line-agnostic so editing a file doesn't shift all of its
// baseline entries every time.
export interface ErrorBucket {
  workspace: string;
  file: string;
  code: string;
  count: number;
}

export function groupErrors(errors: readonly TypecheckError[]): ErrorBucket[] {
  const buckets = new Map<string, ErrorBucket>();
  for (const e of errors) {
    const key = bucketKey(e.workspace, e.file, e.code);
    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      buckets.set(key, {
        workspace: e.workspace,
        file: e.file,
        code: e.code,
        count: 1,
      });
    }
  }
  return Array.from(buckets.values()).sort(compareBuckets);
}

function compareBuckets(a: ErrorBucket, b: ErrorBucket): number {
  if (a.workspace !== b.workspace) return a.workspace < b.workspace ? -1 : 1;
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
}

export function bucketKey(workspace: string, file: string, code: string): string {
  return `${workspace}\t${file}\t${code}`;
}
