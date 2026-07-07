// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ReminderBadge } from "../ReminderBadge";

afterEach(() => cleanup());

describe("ReminderBadge", () => {
  it("renders a bell for an active Important rule", () => {
    render(<ReminderBadge rule={{ importance: "important", active: 1 }} />);
    expect(screen.getByLabelText("Important reminder active")).toBeTruthy();
  });

  it("renders a muted dot for an active Soft rule", () => {
    render(<ReminderBadge rule={{ importance: "soft", active: 1 }} />);
    expect(screen.getByLabelText("Soft reminder active")).toBeTruthy();
  });

  it("renders nothing for an inactive rule", () => {
    const { container } = render(
      <ReminderBadge rule={{ importance: "important", active: 0 }} />,
    );
    expect(container.textContent).toBe("");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders nothing when there is no rule", () => {
    const { container } = render(<ReminderBadge rule={null} />);
    expect(container.firstChild).toBeNull();
  });
});
