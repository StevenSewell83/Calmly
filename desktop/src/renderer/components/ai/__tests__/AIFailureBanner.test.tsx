// @vitest-environment jsdom
import { vi, describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock react-router-dom
vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

import { AIFailureBanner } from "../AIFailureBanner";
import type { AIError } from "../../../../preload/api-types";

describe("AIFailureBanner", () => {
  it("shows auth message and Settings link", () => {
    const error: AIError = { kind: "auth" };
    render(<AIFailureBanner error={error} />);
    expect(screen.getByText(/key was rejected/i)).toBeTruthy();
    expect(screen.getByText(/settings/i)).toBeTruthy();
  });

  it("shows quota message with external link", () => {
    const error: AIError = { kind: "quota" };
    render(<AIFailureBanner error={error} />);
    expect(screen.getByText(/quota/i)).toBeTruthy();
    expect(screen.getByText(/usage/i)).toBeTruthy();
  });

  it("shows network message with retry", () => {
    const error: AIError = { kind: "network" };
    const onRetry = vi.fn();
    render(<AIFailureBanner error={error} onRetry={onRetry} />);
    expect(screen.getByText(/couldn't reach/i)).toBeTruthy();
    fireEvent.click(screen.getByText(/retry/i));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("shows timeout message with retry", () => {
    const error: AIError = { kind: "timeout" };
    render(<AIFailureBanner error={error} />);
    expect(screen.getByText(/too long/i)).toBeTruthy();
  });

  it("shows invalid_response message", () => {
    const error: AIError = { kind: "invalid_response" };
    render(<AIFailureBanner error={error} />);
    expect(screen.getByText(/unusable/i)).toBeTruthy();
  });

  it("calls onDismiss when dismiss button clicked", () => {
    const error: AIError = { kind: "network" };
    const onDismiss = vi.fn();
    render(<AIFailureBanner error={error} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByLabelText(/dismiss/i));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
