import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
// e2e/fixtures/server.ts → repo root
const repoRoot = resolve(__dirname, "..", "..", "..");
const serverDir = join(repoRoot, "server");

export interface ServerFixture {
  url: string;
  devMailDir: string;
  databaseUrl: string;
  stop: () => Promise<void>;
}

export interface StartServerFixtureOptions {
  // Override which postgres image to use. Defaults to postgres:16-alpine.
  postgresImage?: string;
  // Cap the wait for server /health to come up.
  bootTimeoutMs?: number;
}

// Boots a hermetic @calmly/server backed by an ephemeral Postgres
// (testcontainers). Returns the public URL the desktop app should hit, the
// directory where ConsoleEmailSender drops magic-link HTML files, and a stop()
// that tears everything down deterministically.
//
// Prerequisite: Docker daemon must be running. testcontainers will fail with
// a clear error if it isn't.
export async function startServerFixture(
  opts: StartServerFixtureOptions = {},
): Promise<ServerFixture> {
  const image = opts.postgresImage ?? "postgres:16-alpine";
  const bootTimeoutMs = opts.bootTimeoutMs ?? 30_000;

  let pg: StartedPostgreSqlContainer | null = null;
  let serverProc: ChildProcess | null = null;
  let devMailDir: string | null = null;

  const cleanup = async (): Promise<void> => {
    if (serverProc && serverProc.exitCode === null) {
      serverProc.kill("SIGTERM");
      // Give it a beat to flush logs; force-kill if it hangs.
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          serverProc?.kill("SIGKILL");
          resolve();
        }, 3000);
        serverProc?.once("exit", () => {
          clearTimeout(t);
          resolve();
        });
      });
    }
    if (pg) await pg.stop().catch(() => {});
    if (devMailDir)
      await rm(devMailDir, { recursive: true, force: true }).catch(() => {});
  };

  try {
    pg = await new PostgreSqlContainer(image)
      .withDatabase("calmly_test")
      .withUsername("calmly")
      .withPassword("calmly")
      .start();

    const databaseUrl = pg.getConnectionUri();
    devMailDir = await mkdtemp(join(tmpdir(), "calmly-e2e-mail-"));

    // Run server migrations against the ephemeral DB. node-pg-migrate is a
    // server devDep; we invoke it via pnpm exec so it picks up the local copy.
    await runMigrations(databaseUrl);

    // The server's config schema requires PORT > 0, so we can't pass 0 to
    // ask the OS for an ephemeral port. Pre-allocate one ourselves: bind to
    // :0, read the assigned port, close the listener, then start the server
    // on that port. There's a small race window if another process grabs the
    // port between close and server bind; acceptable for tests.
    const chosenPort = await pickFreePort();

    // Bind tsx to run the TypeScript source directly, matching the server's
    // own `pnpm dev` script.
    const url = `http://127.0.0.1:${chosenPort}`;
    const buffered: { value: string } = { value: "" };
    serverProc = spawn(
      process.execPath,
      ["--import=tsx/esm", join(serverDir, "src", "index.ts")],
      {
        cwd: serverDir,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          NODE_ENV: "test",
          DATABASE_URL: databaseUrl,
          PORT: String(chosenPort),
          HOST: "127.0.0.1",
          EMAIL_SENDER: "console",
          DEV_MAIL_DIR: devMailDir!,
          LOG_LEVEL: "warn",
        },
      },
    );
    // Surface boot-time errors in the timeout/exit message.
    serverProc.stdout?.on("data", (d: Buffer) => {
      buffered.value += d.toString();
    });
    serverProc.stderr?.on("data", (d: Buffer) => {
      buffered.value += d.toString();
    });
    let exitedEarly: { code: number | null; signal: string | null } | null =
      null;
    serverProc.once("exit", (code, signal) => {
      exitedEarly = { code, signal };
    });

    // Boot detection by polling the port we just chose. Cheaper and more
    // reliable than parsing pino JSON output.
    await waitForHealth(url, bootTimeoutMs, () => {
      if (exitedEarly) {
        throw new Error(
          `server fixture: process exited before listen (code=${exitedEarly.code}, signal=${exitedEarly.signal})\n${buffered.value}`,
        );
      }
    });

    return {
      url,
      devMailDir: devMailDir!,
      databaseUrl,
      stop: cleanup,
    };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

async function runMigrations(databaseUrl: string): Promise<void> {
  // node-pg-migrate ships a Node bin we invoke directly. Locating it via the
  // server workspace's node_modules avoids depending on `pnpm` being in PATH
  // for the spawned subshell (it isn't, when playwright is launched inside a
  // wrapper script).
  const migrateBin = join(
    serverDir,
    "node_modules",
    "node-pg-migrate",
    "bin",
    "node-pg-migrate.js",
  );
  await new Promise<void>((resolveP, rejectP) => {
    // -j is only valid for the `create` action in node-pg-migrate v7+; the
    // .cjs migrations auto-resolve via require() once the up runner picks
    // them up via `-m migrations`.
    const p = spawn(process.execPath, [migrateBin, "-m", "migrations", "up"], {
      cwd: serverDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    let stderr = "";
    let stdout = "";
    p.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    p.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    p.once("exit", (code) => {
      if (code === 0) resolveP();
      else
        rejectP(
          new Error(
            `migrations failed (exit ${code}):\nstderr:\n${stderr}\nstdout:\n${stdout}`,
          ),
        );
    });
    p.once("error", (e) => rejectP(e));
  });
}

async function pickFreePort(): Promise<number> {
  return await new Promise<number>((resolveP, rejectP) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", rejectP);
    srv.listen({ host: "127.0.0.1", port: 0 }, () => {
      const addr = srv.address();
      if (typeof addr === "object" && addr) {
        const port = addr.port;
        srv.close(() => resolveP(port));
      } else {
        srv.close(() => rejectP(new Error("could not pick free port")));
      }
    });
  });
}

async function waitForHealth(
  url: string,
  timeoutMs: number,
  preCheck?: () => void,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    preCheck?.();
    try {
      const r = await fetch(`${url}/health`);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server fixture: /health never became ready at ${url}`);
}
