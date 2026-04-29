import { test, expect } from "./fixtures/electronApp";

test("app launches and renders the sign-in screen", async ({
  electronApp,
  window,
}) => {
  // The app boots through AuthGate. With CALMLY_SYNC_URL pointed at an
  // unreachable host, /auth/me fails and the gate settles on SignIn.
  await expect(window.getByText("Welcome to Calmly.")).toBeVisible({
    timeout: 15_000,
  });

  // Sanity: the contextBridge surface (window.calmly) is live, which catches
  // preload regressions before they become subtle runtime bugs in feature E2Es.
  const apiShape = await window.evaluate(() => {
    const api = (window as unknown as { calmly?: Record<string, unknown> })
      .calmly;
    return api
      ? { present: true, keys: Object.keys(api).sort() }
      : { present: false, keys: [] };
  });
  expect(apiShape.present).toBe(true);
  expect(apiShape.keys).toEqual(
    expect.arrayContaining(["auth", "db", "log", "secrets", "sync"]),
  );

  // The main process should be alive and reporting an Electron version.
  const electronVersion = await electronApp.evaluate(({ app }) =>
    app.getVersion(),
  );
  expect(typeof electronVersion).toBe("string");
  expect(electronVersion.length).toBeGreaterThan(0);
});
