// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import type { UpdateStatus } from "@calmly/shared";
import { AppShell } from "../AppShell";

function readyStatus(): UpdateStatus {
  return {
    state: "ready",
    version: "2.0.0",
    progressPercent: 100,
    errorCode: null,
    errorMessage: null,
  };
}

interface Options {
  updateStatus: UpdateStatus;
  focusSession: { ok: true; session: unknown } | { ok: false };
  initialPath: string;
}

function mockCalmly({ updateStatus, focusSession }: Options) {
  (window as any).calmly = {
    inbox: { onFocusRequest: () => () => {} },
    ai: { getSettings: () => Promise.resolve({ enabled: false, mode: "off" }) },
    updates: {
      getStatus: () => Promise.resolve(updateStatus),
      onStatusChanged: () => () => {},
    },
    focus: { current: () => Promise.resolve(focusSession) },
  };
}

function renderShellAt(path: string) {
  const router = createMemoryRouter(
    [{ path: "/*", element: <AppShell /> }],
    { initialEntries: [path] },
  );
  return render(<RouterProvider router={router} />);
}

afterEach(() => {
  cleanup();
  delete (window as any).calmly;
});

describe("AppShell — update-ready sidebar affordance", () => {
  it("shows the ready pill on the Settings nav item when an update is ready", async () => {
    mockCalmly({
      updateStatus: readyStatus(),
      focusSession: { ok: true, session: null },
      initialPath: "/",
    });
    renderShellAt("/");
    await waitFor(() => expect(screen.getByLabelText("Update ready")).toBeTruthy());
  });

  it("does not show the pill when there is no update ready", async () => {
    mockCalmly({
      updateStatus: { state: "idle", version: null, progressPercent: null, errorCode: null, errorMessage: null },
      focusSession: { ok: true, session: null },
      initialPath: "/",
    });
    renderShellAt("/");
    await screen.findByText("Calmly");
    expect(screen.queryByLabelText("Update ready")).toBeNull();
  });

  it("suppresses the pill during an active Focus session view", async () => {
    mockCalmly({
      updateStatus: readyStatus(),
      focusSession: { ok: true, session: { id: "s1" } },
      initialPath: "/focus",
    });
    renderShellAt("/focus");
    // Give the Focus-route poll a tick to resolve focus.current().
    await waitFor(() => expect(screen.queryByLabelText("Update ready")).toBeNull());
  });

  it("shows the pill again once the Focus session ends (no session, still on /focus)", async () => {
    mockCalmly({
      updateStatus: readyStatus(),
      focusSession: { ok: true, session: null },
      initialPath: "/focus",
    });
    renderShellAt("/focus");
    await waitFor(() => expect(screen.getByLabelText("Update ready")).toBeTruthy());
  });
});
