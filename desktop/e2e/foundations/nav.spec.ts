import { test, expect } from "@playwright/test";
import { startServerFixture, type ServerFixture } from "../fixtures/server";
import { isDockerAvailable } from "../fixtures/docker";
import { launchElectronApp, signInAsTestUser } from "./_helpers";

// F-14b: smoke test that every top-level route in the AppShell sidebar
// renders its destination page. Intentionally a tripwire — adding a new
// top-level route requires updating ROUTES below, which forces the author
// to also pick a stable heading-level identifier for it.
//
// Mechanism: click the sidebar NavLink rather than poking the URL hash
// directly so we exercise the real router wiring (AppShell, NavLink,
// hash-router) and not just the route-to-element mapping.

interface RouteAssertion {
  // The accessible name of the sidebar link to click.
  navLinkName: string;
  // The H1 heading text rendered by the destination page. For Home this is
  // a greeting ("Peace, friend.") rather than "Home"; for /settings the
  // first sub-route (account) renders an "Account" heading.
  pageHeading: string;
}

const ROUTES: RouteAssertion[] = [
  { navLinkName: "Inbox", pageHeading: "Inbox" },
  { navLinkName: "Plan", pageHeading: "Plan" },
  { navLinkName: "Focus", pageHeading: "Focus" },
  { navLinkName: "Review", pageHeading: "Review" },
  // Sidebar entry is "Settings" but the destination is /settings/account
  // (the index route inside SettingsLayout redirects there); the page H1
  // is the section title, "Account".
  { navLinkName: "Settings", pageHeading: "Account" },
  // Loop back to Home last so post-test state is the default landing page.
  { navLinkName: "Home", pageHeading: "Peace, friend." },
];

test.describe("F-14b · top-level navigation", () => {
  test.describe.configure({ timeout: 120_000 });

  let server: ServerFixture | null = null;
  let dockerAvailable = false;

  test.beforeAll(async () => {
    dockerAvailable = await isDockerAvailable();
    if (!dockerAvailable) return;
    server = await startServerFixture();
  });

  test.afterAll(async () => {
    if (server) await server.stop();
    server = null;
  });

  test.beforeEach(() => {
    test.skip(
      !dockerAvailable,
      "Docker daemon not reachable — skipping testcontainers fixture",
    );
  });

  test("signed-in app cycles through every top-level route", async () => {
    const launched = await launchElectronApp({ syncUrl: server!.url });
    try {
      await signInAsTestUser({
        app: launched.electronApp,
        window: launched.window,
        server: server!,
        email: `nav-${Date.now()}@calmly.test`,
      });

      // signInAsTestUser already asserted the Home greeting is visible, so
      // we start from a known-good state at "/". From there, walk each
      // sidebar NavLink in turn.
      for (const { navLinkName, pageHeading } of ROUTES) {
        await launched.window
          .getByRole("link", { name: navLinkName })
          .click();
        await expect(
          launched.window.getByRole("heading", {
            name: pageHeading,
            level: 1,
          }),
        ).toBeVisible({ timeout: 5_000 });
      }
    } finally {
      await launched.dispose();
    }
  });
});
