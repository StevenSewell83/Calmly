import { describe, expect, it } from "vitest";
import { renderMagicLinkEmail } from "../template";

describe("renderMagicLinkEmail", () => {
  it("renders subject + html + text", () => {
    const r = renderMagicLinkEmail({
      link: "http://localhost:3001/auth/magic-link/redeem?token=abc",
      expiresAt: new Date(Date.now() + 15 * 60_000),
    });
    expect(r.subject).toContain("Calmly");
    expect(r.html).toContain("<!doctype html>");
    expect(r.text).toContain("http://localhost:3001/auth/magic-link/redeem");
  });

  it("plain text contains the full URL as a fallback", () => {
    const link = "https://app.calmly/auth/magic-link/redeem?token=abc123";
    const r = renderMagicLinkEmail({
      link,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(r.text).toContain(link);
  });

  it("escapes HTML-special characters in the link", () => {
    const dirty = "https://example.test/?token=a&b=<script>";
    const r = renderMagicLinkEmail({
      link: dirty,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;");
    // Text version is allowed to contain raw chars; it's not interpreted.
    expect(r.text).toContain(dirty);
  });

  it("never claims fewer than 1 minute even if expiry is in the past", () => {
    const r = renderMagicLinkEmail({
      link: "https://x.test",
      expiresAt: new Date(Date.now() - 60_000),
    });
    expect(r.text).toContain("about 1 minute");
  });
});
