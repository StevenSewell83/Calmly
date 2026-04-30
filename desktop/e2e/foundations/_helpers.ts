import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pollForMagicLink } from "../fixtures/devMail";
import type { ServerFixture } from "../fixtures/server";

// window.calmly is typed globally via desktop/e2e/window-globals.d.ts.

const __dirname = fileURLToPath(new URL(".", import.meta.url));
// e2e/foundations/_helpers.ts → desktop/
const desktopRoot = resolve(__dirname, "..", "..");
const mainEntry = join(desktopRoot, "out", "main", "index.js");

export interface LaunchedElectron {
  electronApp: ElectronApplication;
  window: Page;
  userDataDir: string;
  dispose: () => Promise<void>;
}

export interface LaunchElectronAppOptions {
  // Override CALMLY_SYNC_URL so the renderer's /auth/me probe and sync client
  // hit the test server fixture rather than the default unreachable host.
  syncUrl: string;
  // Reuse a profile dir across launches when testing persistence; defaults
  // to a fresh tmpdir.
  userDataDir?: string;
  // Extra env to merge into the spawned process — leave empty unless a
  // specific spec needs it.
  extraEnv?: NodeJS.ProcessEnv;
}

// Wraps electron.launch with the per-spec env wiring needed by the F-14
// foundations suite. Equivalent to the base electronApp fixture in
// desktop/e2e/fixtures/electronApp.ts but parameterized so each spec can
// point at its own server fixture.
export async function launchElectronApp(
  opts: LaunchElectronAppOptions,
): Promise<LaunchedElectron> {
  const userDataDir =
    opts.userDataDir ?? (await mkdtemp(join(tmpdir(), "calmly-e2e-")));

  const launchArgs = [
    mainEntry,
    `--user-data-dir=${userDataDir}`,
    ...(process.platform === "linux" ? ["--no-sandbox"] : []),
  ];

  const app = await electron.launch({
    args: launchArgs,
    env: {
      ...process.env,
      NODE_ENV: "test",
      CALMLY_SYNC_URL: opts.syncUrl,
      CALMLY_DISABLE_DEVTOOLS: "1",
      ...(opts.extraEnv ?? {}),
    },
  });

  app.process().stdout?.on("data", (d: Buffer) => {
    process.stdout.write(`[electron-main] ${d.toString()}`);
  });
  app.process().stderr?.on("data", (d: Buffer) => {
    process.stderr.write(`[electron-main] ${d.toString()}`);
  });

  const window = await app.firstWindow();
  window.on("pageerror", (e) =>
    process.stderr.write(`[renderer-pageerror] ${e.message}\n`),
  );
  window.on("console", (m) =>
    process.stdout.write(`[renderer-${m.type()}] ${m.text()}\n`),
  );
  await window.waitForLoadState("domcontentloaded");

  let disposed = false;
  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    await app.close().catch(() => {});
    // Only delete the dir we created; if the caller passed one, leave it
    // alone so they can chain another launch (persistence spec needs this).
    if (!opts.userDataDir) {
      await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    }
  };

  return { electronApp: app, window, userDataDir, dispose };
}

export interface SignInOptions {
  app: ElectronApplication;
  window: Page;
  server: ServerFixture;
  email?: string;
}

export interface SignedInUser {
  id: string;
  email: string;
}

// Drives the full magic-link flow against the test server fixture and
// resolves once the renderer is in the signed-in state. Encapsulates the
// brittle bits (waiting for SignIn render → submitting → polling dev-mail →
// emitting open-url → waiting for AuthGate to flip) so nav/persistence/sync
// specs can call this and immediately work against signed-in app shell.
export async function signInAsTestUser(opts: SignInOptions): Promise<{
  user: SignedInUser;
  token: string;
}> {
  const email = opts.email ?? `e2e-${Date.now()}@calmly.test`;

  // 1. Wait for the SignIn screen to render. AuthProvider boots → asks
  // /auth/me → server returns { signedIn: false } → AuthGate renders SignIn.
  await expect(opts.window.getByText("Welcome to Calmly.")).toBeVisible({
    timeout: 15_000,
  });

  // 2. Submit the email form. Note the dev-mail timestamp BEFORE submitting
  // so pollForMagicLink filters out any stale emails left by a previous test.
  const since = new Date();
  await opts.window.fill("#email", email);
  await opts.window.getByRole("button", { name: "Send sign-in link" }).click();

  // 3. SignIn flips to the "Check your email." confirmation when the request
  // succeeds. Asserting on it guarantees the requestLink IPC round-tripped
  // before we go looking for the email.
  await expect(opts.window.getByText("Check your email.")).toBeVisible({
    timeout: 10_000,
  });

  // 4. Poll the ConsoleEmailSender drop dir for the rendered magic-link HTML
  // and parse out the token.
  const mail = await pollForMagicLink(opts.server.devMailDir, {
    since,
    timeoutMs: 10_000,
  });

  // 5. Synthesize the calmly:// deep-link URL from the parsed token (the
  // email's link points at the server's redeem endpoint; we want the URL the
  // OS would deliver to the desktop client).
  const deepLinkUrl = `calmly://auth/callback?token=${mail.token}`;

  // 6. Emit the open-url event in the main process. This is what the OS
  // does when it hands a calmly:// URL to the running app on macOS;
  // installDeepLink registered the handler that funnels into onUrl →
  // pendingDeepLinks → orchestrator.redeem → DEEPLINK_RESULT_CHANNEL.
  // Doing it via app.emit() exercises the production code path end-to-end
  // without depending on OS-level protocol registration.
  await opts.app.evaluate(({ app }, url) => {
    // Electron.Event has preventDefault on it; main's openUrlHandler calls
    // it. A bare object that satisfies that one method is enough for the
    // emit because we're not going through the OS event-bus dispatch.
    const event = { preventDefault() {} } as Electron.Event;
    app.emit("open-url", event, url);
  }, deepLinkUrl);

  // 7. AuthGate flips to children when the reducer sees deeplink_redeem
  // with ok:true; the routed app's home page renders "Peace, friend."
  await expect(opts.window.getByText("Peace, friend.")).toBeVisible({
    timeout: 10_000,
  });

  // 8. Confirm via the same surface the renderer uses (status IPC →
  // /auth/me → cookie-backed session). This catches the case where the
  // reducer happened to flip without the cookie actually being set.
  const status = await opts.window.evaluate(() => window.calmly.auth.status());
  if (!status.signedIn) {
    throw new Error(
      `signInAsTestUser: AuthGate showed signed-in UI but auth.status() returned signedOut`,
    );
  }
  return { user: status.user, token: mail.token };
}
