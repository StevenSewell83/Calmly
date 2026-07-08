// Detects the false-green failure mode: `pnpm -r typecheck` exiting non-zero
// while producing no parseable TS error lines. That combination means the
// typecheck itself failed to run (missing node_modules, tsc/tsx not found,
// pnpm crash) — NOT that the code is clean — so the gate must fail instead
// of reporting "0 error(s)".

export function typecheckFailedToRun(
  status: number | null,
  parsedErrorCount: number,
): boolean {
  return status !== 0 && parsedErrorCount === 0;
}

// Last `maxLines` non-empty lines of the raw runner output, for diagnostics.
export function outputTail(text: string, maxLines: number): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lines.slice(-maxLines).join("\n");
}
