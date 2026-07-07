// TGR-04 — MarkdownV2 escaping helper unit tests.

import { describe, expect, it } from "vitest";
import { escapeMarkdownV2 } from "../markdown";

// Every character Telegram's MarkdownV2 style treats as reserved:
// https://core.telegram.org/bots/api#markdownv2-style
const RESERVED = ["_", "*", "[", "]", "(", ")", "~", "`", ">", "#", "+", "-", "=", "|", "{", "}", ".", "!", "\\"];

describe("escapeMarkdownV2", () => {
  it.each(RESERVED)("escapes reserved char %j with a leading backslash", (ch) => {
    expect(escapeMarkdownV2(ch)).toBe(`\\${ch}`);
  });

  it("leaves plain alphanumeric text untouched", () => {
    expect(escapeMarkdownV2("Buy milk 123")).toBe("Buy milk 123");
  });

  it("leaves non-reserved punctuation untouched (em dash, arrow, comma, colon)", () => {
    expect(escapeMarkdownV2("Now → next, then: done—maybe")).toBe(
      "Now → next, then: done—maybe",
    );
  });

  it("escapes every reserved char in a mixed string, in order", () => {
    expect(escapeMarkdownV2("Call mom (urgent!)")).toBe(
      "Call mom \\(urgent\\!\\)",
    );
  });

  it("escapes a task title containing most reserved chars once each, without doubling", () => {
    const title = "Fix bug #1: a_b*c [d](e)~f`g>h+i-j=k|l{m}n.o!";
    const escaped = escapeMarkdownV2(title);
    // Every reserved char is preceded by exactly one backslash, and no
    // extra backslashes were introduced elsewhere.
    expect(escaped).toBe(
      "Fix bug \\#1: a\\_b\\*c \\[d\\]\\(e\\)\\~f\\`g\\>h\\+i\\-j\\=k\\|l\\{m\\}n\\.o\\!",
    );
  });

  it("handles an empty string", () => {
    expect(escapeMarkdownV2("")).toBe("");
  });
});
