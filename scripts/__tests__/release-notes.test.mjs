import { describe, expect, it } from "vitest";
import {
  ReleaseNotesError,
  extractReleaseNotes,
} from "../release-notes.mjs";

const FIXTURE = `# Changelog

## [Unreleased]

## [1.1.0] - 2026-08-15

### Added
- Something new in the middle section.

## [1.0.0] - 2026-08-01

### Added
- Home, Capture, Triage, Plan, Focus, Review, Reminders, Search, AI, Settings.

### Fixed
- Nothing yet.

## [0.9.0] - Unreleased

### Added
- Pre-release scaffolding, not yet shipped.
`;

describe("extractReleaseNotes", () => {
  it("extracts the body of a section found in the middle of the file", () => {
    const notes = extractReleaseNotes(FIXTURE, "1.1.0");
    expect(notes).toContain("### Added");
    expect(notes).toContain("Something new in the middle section.");
    // Must not bleed into the neighboring section.
    expect(notes).not.toContain("Home, Capture, Triage");
  });

  it("extracts multiple subsections within one version", () => {
    const notes = extractReleaseNotes(FIXTURE, "1.0.0");
    expect(notes).toContain("### Added");
    expect(notes).toContain("### Fixed");
    expect(notes).toContain("Nothing yet.");
  });

  it("throws an actionable error when the version is missing", () => {
    expect(() => extractReleaseNotes(FIXTURE, "9.9.9")).toThrow(
      ReleaseNotesError,
    );
    expect(() => extractReleaseNotes(FIXTURE, "9.9.9")).toThrow(/9\.9\.9/);
  });

  it("throws when the section is still marked Unreleased", () => {
    expect(() => extractReleaseNotes(FIXTURE, "0.9.0")).toThrow(
      /still marked "Unreleased"/,
    );
  });

  it("extracts through end-of-file when the section is the last one", () => {
    const lastSectionFixture = `## [Unreleased]

## [1.0.0] - 2026-08-01

### Added
- Last section in the file, no trailing header to bound it.
`;
    const notes = extractReleaseNotes(lastSectionFixture, "1.0.0");
    expect(notes).toBe(
      "### Added\n- Last section in the file, no trailing header to bound it.",
    );
  });

  it("throws when the matched section has no body", () => {
    const emptyFixture = `## [1.0.0] - 2026-08-01

## [0.9.0] - 2026-07-01

### Added
- Older release.
`;
    expect(() => extractReleaseNotes(emptyFixture, "1.0.0")).toThrow(
      /empty/,
    );
  });
});
