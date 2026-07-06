import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
// e2e/packaged/paths.ts → desktop/
export const desktopRoot = resolve(__dirname, "..", "..");

// The binary electron-builder produces for the Linux `--dir`/AppImage
// pipeline — the same executable the AppImage wraps (see bead calmly-y5z.8).
// electron-builder names it after productName (Calmly → "calmly" lowercase,
// no spaces) since desktop/electron-builder.yml sets no explicit
// `linux.executableName` override.
export const packagedExecutablePath = resolve(
  desktopRoot,
  "release",
  "linux-unpacked",
  "calmly",
);

// Both playwright.packaged.config.ts (fail fast before any test runs) and
// the per-test launcher (fail fast with the same message even if a spec is
// invoked with the wrong config) call this.
export function assertPackagedBuildExists(): void {
  if (!existsSync(packagedExecutablePath)) {
    throw new Error(
      `Packaged Linux build not found at ${packagedExecutablePath}.\n\n` +
        "This suite exercises the PACKAGED artifact users actually download " +
        "(asar paths, native-module ABI, isPackaged gates) — not the " +
        "electron-vite dev build the default `test:e2e` suite launches.\n\n" +
        "Run `pnpm --filter @calmly/desktop dist:linux` first, then re-run " +
        "`pnpm --filter @calmly/desktop test:e2e:packaged`.",
    );
  }
}
