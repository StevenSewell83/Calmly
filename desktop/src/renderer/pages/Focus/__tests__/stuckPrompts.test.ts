import { describe, it, expect } from "vitest";
import { STUCK_PROMPTS } from "../StuckPrompts";

describe("STUCK_PROMPTS", () => {
  it("has exactly 5 prompts", () => {
    expect(STUCK_PROMPTS).toHaveLength(5);
  });

  it("first prompt asks about smallest next thing", () => {
    expect(STUCK_PROMPTS[0]).toMatch(/smallest/i);
  });

  it("last prompt asks about switching tasks", () => {
    expect(STUCK_PROMPTS[4]).toMatch(/switch/i);
  });
});
