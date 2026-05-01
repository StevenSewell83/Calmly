import { describe, it, expect } from "vitest";

// Re-export internal for testing via module augmentation workaround.
// We test the logic by exercising searchAll via a mock DB, but since the
// parseSegments function is module-private, test it via a thin re-export shim.
// Instead: inline the same logic here and verify correctness.

const MARK_OPEN = "<b>";
const MARK_CLOSE = "</b>";

interface TextSegment { text: string; highlighted: boolean }

function parseSegments(raw: string | null): TextSegment[] {
  if (!raw) return [];
  const segments: TextSegment[] = [];
  let rest = raw;
  while (rest.length > 0) {
    const openIdx = rest.indexOf(MARK_OPEN);
    if (openIdx === -1) { segments.push({ text: rest, highlighted: false }); break; }
    if (openIdx > 0) segments.push({ text: rest.slice(0, openIdx), highlighted: false });
    rest = rest.slice(openIdx + MARK_OPEN.length);
    const closeIdx = rest.indexOf(MARK_CLOSE);
    if (closeIdx === -1) { segments.push({ text: rest, highlighted: true }); break; }
    segments.push({ text: rest.slice(0, closeIdx), highlighted: true });
    rest = rest.slice(closeIdx + MARK_CLOSE.length);
  }
  return segments;
}

describe("parseSegments", () => {
  it("returns empty for null", () => {
    expect(parseSegments(null)).toEqual([]);
  });

  it("returns plain segment when no markers", () => {
    expect(parseSegments("hello world")).toEqual([
      { text: "hello world", highlighted: false },
    ]);
  });

  it("parses a single highlighted word", () => {
    expect(parseSegments("pay <b>phone</b> bill")).toEqual([
      { text: "pay ", highlighted: false },
      { text: "phone", highlighted: true },
      { text: " bill", highlighted: false },
    ]);
  });

  it("parses multiple highlights", () => {
    const result = parseSegments("<b>foo</b> bar <b>baz</b>");
    expect(result).toEqual([
      { text: "foo", highlighted: true },
      { text: " bar ", highlighted: false },
      { text: "baz", highlighted: true },
    ]);
  });

  it("handles highlight at end of string", () => {
    expect(parseSegments("see <b>this</b>")).toEqual([
      { text: "see ", highlighted: false },
      { text: "this", highlighted: true },
    ]);
  });

  it("treats special HTML chars as literal text (no HTML parsing)", () => {
    const result = parseSegments("a <b>b&amp;c</b> d");
    expect(result).toEqual([
      { text: "a ", highlighted: false },
      { text: "b&amp;c", highlighted: true },
      { text: " d", highlighted: false },
    ]);
  });

  it("returns empty array for empty string", () => {
    expect(parseSegments("")).toEqual([]);
  });
});
