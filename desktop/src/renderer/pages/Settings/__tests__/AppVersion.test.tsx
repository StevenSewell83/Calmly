// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { AppVersion } from "../AppVersion";

function mockCalmly(getAppVersion: () => Promise<string>) {
  (window as any).calmly = {
    settings: { getAppVersion },
  };
}

afterEach(() => {
  cleanup();
  delete (window as any).calmly;
});

describe("AppVersion", () => {
  it("shows a placeholder before the IPC call resolves", () => {
    mockCalmly(() => new Promise(() => {})); // never resolves
    render(<AppVersion />);
    expect(screen.getByText("Calmly …")).toBeTruthy();
  });

  it("shows the resolved version once the IPC call resolves", async () => {
    mockCalmly(() => Promise.resolve("1.4.0"));
    render(<AppVersion />);
    await waitFor(() => expect(screen.getByText("Calmly v1.4.0")).toBeTruthy());
  });

  it("keeps the placeholder if the IPC call rejects", async () => {
    mockCalmly(() => Promise.reject(new Error("no ipc")));
    render(<AppVersion />);
    await waitFor(() => expect(screen.getByText("Calmly …")).toBeTruthy());
  });
});
