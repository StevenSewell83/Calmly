#!/usr/bin/env node
/**
 * release-notes.mjs — extract one version's section from
 * desktop/CHANGELOG.md for use as a GitHub Release body (REL-08).
 *
 * Usage:
 *   node scripts/release-notes.mjs <version>
 *   node scripts/release-notes.mjs 1.0.0
 *
 * Exits non-zero with an actionable message if the version's section is
 * missing, or is still marked "Unreleased" (the guard that stops REL-08
 * from tagging a release before the changelog has real notes).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CHANGELOG_PATH = path.join(
  __dirname,
  "..",
  "desktop",
  "CHANGELOG.md",
);

// Matches "## [1.0.0]" or "## [1.0.0] - 2026-08-01" / "## [1.0.0] — Unreleased".
const HEADER_RE = /^## \[([^\]]+)\](?:\s*[-—]\s*(.*))?\s*$/;

export class ReleaseNotesError extends Error {}

/**
 * Extract the body text for `version` from `changelogText`.
 * Throws ReleaseNotesError with an actionable message if the section is
 * missing, still marked Unreleased, or empty.
 */
export function extractReleaseNotes(changelogText, version) {
  const lines = changelogText.split(/\r?\n/);

  let startIdx = -1;
  let dateField = "";
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(HEADER_RE);
    if (match && match[1] === version) {
      startIdx = i;
      dateField = (match[2] ?? "").trim();
      break;
    }
  }

  if (startIdx === -1) {
    throw new ReleaseNotesError(
      `No changelog section found for version ${version}. ` +
        `Add a "## [${version}] - YYYY-MM-DD" section to desktop/CHANGELOG.md before tagging desktop-v${version}.`,
    );
  }

  if (/^unreleased$/i.test(dateField)) {
    throw new ReleaseNotesError(
      `Version ${version} is still marked "Unreleased" in desktop/CHANGELOG.md. ` +
        `Set a real release date on the "## [${version}]" heading before tagging desktop-v${version}.`,
    );
  }

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## [")) {
      endIdx = i;
      break;
    }
  }

  const body = lines.slice(startIdx + 1, endIdx).join("\n").trim();

  if (!body) {
    throw new ReleaseNotesError(
      `Changelog section for version ${version} is empty. ` +
        `Add release notes to desktop/CHANGELOG.md before tagging desktop-v${version}.`,
    );
  }

  return body;
}

function main() {
  const version = process.argv[2];
  if (!version) {
    console.error(
      "Usage: node scripts/release-notes.mjs <version>\n" +
        "  e.g. node scripts/release-notes.mjs 1.0.0",
    );
    process.exit(1);
  }

  let changelogText;
  try {
    changelogText = readFileSync(CHANGELOG_PATH, "utf8");
  } catch (err) {
    console.error(
      `Could not read ${CHANGELOG_PATH}: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  try {
    const notes = extractReleaseNotes(changelogText, version);
    process.stdout.write(notes + "\n");
  } catch (err) {
    if (err instanceof ReleaseNotesError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

const isMain =
  process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main();
}
