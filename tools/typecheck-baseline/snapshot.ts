/**
 * Regenerate `baseline.json` from the current typecheck output. Run when:
 *   - first installing the tool (initial snapshot)
 *   - intentionally renaming files / restructuring (so the baseline lines up)
 *   - the developer wants to "absorb" their fixes into a clean baseline
 *
 * Refuses to run when the working tree has uncommitted changes that affect
 * .ts files — too easy to capture half-finished refactor noise as the new
 * baseline. Override with `--force`.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { groupErrors, parseTypecheckOutput } from "./lib/parse";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const BASELINE_PATH = path.join(__dirname, "baseline.json");

const args = process.argv.slice(2);
const force = args.includes("--force");

function gitDirtyTs(): string[] {
  const r = spawnSync("git status --porcelain", {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    shell: true,
  });
  if (r.status !== 0) return [];
  return r.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.slice(3))
    .filter((p) => /\.tsx?$/.test(p));
}

function runTypecheck(): string {
  const r = spawnSync("pnpm -r typecheck", {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    shell: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  return `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
}

function main(): void {
  if (!force) {
    const dirty = gitDirtyTs();
    if (dirty.length > 0) {
      console.error(
        `[typecheck-baseline:snapshot] working tree has uncommitted .ts changes:`,
      );
      for (const f of dirty.slice(0, 10)) console.error(`  • ${f}`);
      if (dirty.length > 10) console.error(`  … and ${dirty.length - 10} more`);
      console.error(
        `Commit or stash first, or pass --force to capture them in the baseline.`,
      );
      process.exit(2);
    }
  }

  const errors = parseTypecheckOutput(runTypecheck());
  const buckets = groupErrors(errors);
  const out = {
    $schema: "./baseline.schema.json",
    _doc:
      "Snapshot of pre-existing typecheck errors that are silenced by the gated typecheck (calmly-d0s). " +
      "Each entry: { workspace, file, code, count, reason? }. Goal: drive `errors` to []. " +
      "Regenerate with: pnpm --filter @calmly/typecheck-baseline snapshot",
    errors: buckets,
  };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `[typecheck-baseline:snapshot] wrote ${BASELINE_PATH} with ${buckets.length} bucket(s) covering ${errors.length} error(s).`,
  );
}

main();
