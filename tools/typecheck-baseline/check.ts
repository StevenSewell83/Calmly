/**
 * Gated typecheck (calmly-d0s).
 *
 * Runs `pnpm -r typecheck` in the repo root, parses the output, groups
 * errors by (workspace, file, code) → count, then diffs the result
 * against `baseline.json`. New error keys or higher counts fail; matching
 * counts are silenced; lower counts print an "you fixed something"
 * notice but don't fail.
 *
 * Run via:
 *   pnpm typecheck:gated     (root script)
 *   pnpm --filter @calmly/typecheck-baseline check
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { groupErrors, parseTypecheckOutput } from "./lib/parse";
import { diff, isCleanDiff, type BaselineEntry } from "./lib/diff";
import { outputTail, typecheckFailedToRun } from "./lib/guard";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const BASELINE_PATH = path.join(__dirname, "baseline.json");

interface BaselineFile {
  $schema?: string;
  _doc?: string;
  errors: BaselineEntry[];
}

function loadBaseline(): BaselineEntry[] {
  if (!fs.existsSync(BASELINE_PATH)) return [];
  try {
    const raw = JSON.parse(
      fs.readFileSync(BASELINE_PATH, "utf-8"),
    ) as BaselineFile;
    return raw.errors ?? [];
  } catch (e) {
    console.error(
      `[typecheck-baseline] failed to read ${BASELINE_PATH}: ${String(e)}`,
    );
    process.exit(2);
  }
}

function runTypecheck(): {
  stdout: string;
  stderr: string;
  status: number | null;
} {
  // pnpm.cmd on Windows requires shell:true so cmd.exe resolves the .cmd
  // extension; on POSIX `pnpm` is a regular executable. Run via shell on
  // both for behavioural symmetry.
  const res = spawnSync("pnpm -r typecheck", {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    shell: true,
    // Cap output size — 10MB is plenty for typecheck noise.
    maxBuffer: 10 * 1024 * 1024,
    // Inherit env so node-version etc. resolve correctly.
    env: process.env,
  });
  return {
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    status: res.status,
  };
}

function main(): void {
  const baseline = loadBaseline();
  const tc = runTypecheck();
  const combined = `${tc.stdout}\n${tc.stderr}`;
  const errors = parseTypecheckOutput(combined);

  if (typecheckFailedToRun(tc.status, errors.length)) {
    console.error(
      "[typecheck-baseline] FAIL — `pnpm -r typecheck` exited non-zero but produced no parseable TS errors.",
    );
    console.error(
      "The typecheck itself did not run (missing node_modules? tsc/tsx not found?). Raw output tail:",
    );
    console.error(outputTail(combined, 30));
    process.exit(2);
  }

  const buckets = groupErrors(errors);
  const d = diff(buckets, baseline);

  const totalCurrent = errors.length;
  const totalAdded = d.added.reduce((acc, b) => acc + b.count, 0);
  const totalIncreased = d.increased.reduce(
    (acc, b) => acc + (b.current.count - b.baseline),
    0,
  );

  // Always print a summary so the developer sees progress.
  console.log(
    `[typecheck-baseline] ${totalCurrent} error(s); ${d.silenced} silenced by baseline; ${totalAdded + totalIncreased} new.`,
  );

  if (d.fixed.length > 0) {
    console.log("");
    console.log(
      `[typecheck-baseline] ${d.fixed.length} baseline entry/entries no longer report errors — prune from baseline.json:`,
    );
    for (const f of d.fixed) {
      console.log(
        `  • ${f.workspace} ${f.file} ${f.code} (was count=${f.count})`,
      );
    }
  }
  if (d.decreased.length > 0) {
    console.log("");
    console.log(
      `[typecheck-baseline] ${d.decreased.length} baseline entry/entries shrank — lower the count(s):`,
    );
    for (const dec of d.decreased) {
      console.log(
        `  • ${dec.current.workspace} ${dec.current.file} ${dec.current.code}: ${dec.baseline} → ${dec.current.count}`,
      );
    }
  }

  if (isCleanDiff(d)) {
    if (totalCurrent === 0 && baseline.length === 0) {
      console.log(
        "[typecheck-baseline] zero errors. Delete this tool when convenient.",
      );
    }
    process.exit(0);
  }

  console.log("");
  console.error("[typecheck-baseline] FAIL — new typecheck errors detected:");
  for (const a of d.added) {
    console.error(
      `  ✗ NEW   ${a.workspace} ${a.file} ${a.code} (count=${a.count})`,
    );
  }
  for (const inc of d.increased) {
    console.error(
      `  ✗ MORE  ${inc.current.workspace} ${inc.current.file} ${inc.current.code}: ${inc.baseline} → ${inc.current.count}`,
    );
  }
  console.error("");
  console.error(
    "If you intentionally introduced a new error class (e.g. you renamed a file),",
  );
  console.error(
    "regenerate the baseline with: pnpm --filter @calmly/typecheck-baseline snapshot",
  );
  console.error("Otherwise: fix the error before committing.");
  process.exit(1);
}

main();
