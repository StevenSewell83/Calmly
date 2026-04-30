import { isDockerAvailable } from "./docker";
import { startServerFixture, type ServerFixture } from "./server";
import {
  launchElectronApp,
  signInAsTestUser,
  type LaunchedElectron,
  type SignedInUser,
} from "../foundations/_helpers";

// Bundles the three things every cross-page e2e needs: a hermetic
// @calmly/server (testcontainers Postgres + email drop dir), a fresh
// Electron instance pointed at it, and a signed-in user. dispose()
// tears them down deterministically.

export interface SeededApp {
  server: ServerFixture;
  app: LaunchedElectron;
  user: SignedInUser;
  dispose: () => Promise<void>;
}

export interface SeedUserOptions {
  email?: string;
}

export async function seedUser(opts: SeedUserOptions = {}): Promise<SeededApp> {
  const server = await startServerFixture();
  let app: LaunchedElectron | null = null;
  try {
    app = await launchElectronApp({ syncUrl: server.url });
    const { user } = await signInAsTestUser({
      app: app.electronApp,
      window: app.window,
      server,
      email: opts.email ?? `core-loop-${Date.now()}@calmly.test`,
    });
    const launched = app;
    return {
      server,
      app: launched,
      user,
      dispose: async () => {
        await launched.dispose();
        await server.stop();
      },
    };
  } catch (err) {
    if (app) await app.dispose().catch(() => {});
    await server.stop().catch(() => {});
    throw err;
  }
}

export { isDockerAvailable };
