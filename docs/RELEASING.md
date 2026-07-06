# Release checklist for the Calmly desktop app

This covers `@calmly/desktop` (Electron). For the sync server, see
`server/RELEASING.md`.

## Build & runtime configuration (REL-10 audit)

Every `app.isPackaged` / `process.env` / `import.meta.env` read in
`desktop/src` that changes behavior between a dev checkout and a shipped
build, swept as of the REL-10 audit. If you add a new one, add a row here —
that's the whole point of the table.

| Variable / gate | Effect | Dev default | Packaged behavior | Override story |
|---|---|---|---|---|
| `CALMLY_SYNC_URL` (env) | Base URL the desktop app talks to for auth, sync, calendar OAuth, telemetry (`desktop/src/main/sync/serverConfig.ts` `resolveServerUrl`) | Read if set, else falls through | Read if set, else falls through | Highest-priority override in both dev and packaged builds. Used by Playwright E2E fixtures (`desktop/e2e/fixtures/electronApp.ts`) to point at a fake/unreachable server. Not user-facing — for scripted/CI use. |
| Stored `syncServerUrl` (Settings → Sync server → Custom server URL, `SyncServerSection.tsx`) | Same as above; persisted in `user_settings` | Used if no env override | Used if no env override | **This is the self-hoster override** documented in `docs/SELF_HOSTING.md` — no env var or rebuild needed. Settings display (`settings:getSyncServerUrl`) and the real network client resolve through the exact same `resolveServerUrl(db, isPackaged)` call, so they can't disagree. |
| Bundled default (no env, no stored setting) | Fallback base URL | `http://localhost:3001` (`DEV_DEFAULT_SERVER_URL`) — the docker-compose server this repo ships, zero config needed for `pnpm dev` | `https://sync.calmly.app` (`DEFAULT_SERVER_URL` in `@calmly/shared`) — the hosted production service | Packaged builds never fall back to `localhost:3001` — that was a pre-REL-10 bug (packaged apps silently defaulted to a loopback address unless `CALMLY_SYNC_URL` happened to be set). |
| `CALMLY_DEV_AUTH=stub` (env) | Skip real auth, sign in as `dev@calmly.local`, zero server calls (`auth/devStubOrchestrator.ts`) | Enabled when set | **Always dead** — gated on `!app.isPackaged` regardless of the env value (`bootstrap/env-config.ts` `resolveEnvConfig`) | None needed; packaged builds cannot activate this by construction. Unit-tested in `bootstrap/__tests__/env-config.test.ts`; REL-09's packaged boot E2E asserts it end-to-end. |
| `LOG_PII=true` (env) | Bypass log scrubbing (emails, API keys) for local debugging (`logging/index.ts` `allowPii`) | Enabled when set | **Always dead** — same `!app.isPackaged` gate, in `resolveEnvConfig` | None needed. Unit-tested alongside the dev-auth gate. |
| `devTools` window option (`bootstrap/window.ts`) | Whether the BrowserWindow ships with DevTools enabled | On (`isDev = !app.isPackaged`) | Off | None — matches Electron security guidance; nothing else in the codebase re-enables it. |
| `CALMLY_CRASH_INGEST_URL` (env) | `submitURL` electron's `crashReporter` uploads to when the user has opted in (`main/crash/index.ts`) | Placeholder `https://crash-disabled.calmly.invalid/` (a non-routable host — uploads simply fail) unless set | Same placeholder unless set at build/deploy time | **Parked, not built**: there is no crash-ingestion backend yet (out of scope for REL-10 — see follow-up bead below). Set this env var once one exists; no code change required. |
| Crash reporting toggle (Settings → Privacy, POL-03, `crash:setEnabled` IPC) | Gates the *upload*, not just local collection: `crashReporter.start()` always runs at boot with `uploadToServer: false` (crashes are captured to disk either way, per Electron's design); flipping this setting to `true` re-invokes `crashReporter.start()` with `uploadToServer: true` and the real `submitURL` | Off by default | Off by default | Opt-in only, per PRD §18. Persisted in `user_settings`; a restart is required to actually change the running `uploadToServer` flag (surfaced to the user as `restartRequired` in `crash:getStatus`). Unit-tested in `main/crash/__tests__/index.test.ts`. |
| `ELECTRON_RENDERER_URL` (env, electron-vite internal) | Dev-server URL the main window loads from instead of the built `index.html`; also the only origin `will-navigate` allows without externalizing the link | Set automatically by `electron-vite dev` | Unset — packaged builds always `loadFile` the bundled renderer | Not user-configurable; internal to the electron-vite toolchain. |
| `NODE_ENV=test` (env) | Suppresses global-shortcut registration so Playwright/vitest runs don't fight for `CmdOrCtrl+Shift+I`/`F` with a real OS hotkey grab | Set by test runners | N/A — packaged builds never run with `NODE_ENV=test` | None needed. |

Follow-up: the crash-ingestion backend itself (a real endpoint behind
`CALMLY_CRASH_INGEST_URL`) is out of scope for REL-10 — file a bead when
there's a concrete ingestion service to point at.

## Before tagging

1. **Update `desktop/CHANGELOG.md`**
   - Move bullets from `[Unreleased]` into the versioned section for this
     release, dated `YYYY-MM-DD`.
   - Leave an empty `## [Unreleased]` section at the top for the next cycle.
2. **Bump version in `desktop/package.json`**
3. **Commit the release prep**
   ```bash
   git add desktop/package.json desktop/CHANGELOG.md
   git commit -m "chore(release): desktop X.Y.Z"
   ```
4. **Tag the commit**
   ```bash
   git tag desktop-vX.Y.Z
   git push origin desktop-vX.Y.Z
   ```

## Building installers

- Linux: `pnpm --filter @calmly/desktop dist:linux` → AppImage + deb.
- Windows: `pnpm --filter @calmly/desktop dist:win` → `Calmly Setup X.Y.Z.exe`
  (NSIS, one-click, per-user). Requires a Windows build host or CI runner —
  electron-builder cannot cross-build a working NSIS installer with native
  module rebuilds from Linux.
- macOS: `pnpm --filter @calmly/desktop dist:mac` (equivalently `dist -- --mac`)
  → `Calmly-X.Y.Z.dmg` + `Calmly-X.Y.Z-mac.zip` (unsigned; signing/notarization
  is REL-05). Requires an actual macOS host or CI runner — electron-builder's
  DMG target shells out to macOS-only tooling (`hdiutil`, the optional
  `dmg-license` dependency) and cannot run on Linux/Windows.

CI wiring for these (windows-latest / macos-latest runners building on tag
push, auto-attaching artifacts to a draft GitHub Release) lands in REL-08.
Until then, run the above locally or via a manual/dispatch workflow run.

## Windows manual verification checklist (REL-03)

Full OS-level protocol-dispatch automation (actually clicking a link in a
browser and having Windows shell out to the registered handler) isn't
practical in CI — verify this by hand once per Windows-affecting change to
packaging or deep-link code, and always before a tagged release.

Prerequisites: a Windows machine (VM is fine), a built
`Calmly Setup X.Y.Z.exe` from `pnpm --filter @calmly/desktop dist:win`, and a
way to trigger a real magic-link email (or a `calmly://auth/callback?token=...`
URL you can paste into a browser's address bar as a stand-in).

1. **Install is zero-decision**
   - Double-click the installer. Confirm: no UAC elevation prompt (per-user
     install), no install-location page, no extra clicks — it installs and
     launches Calmly automatically.
   - Confirm Calmly appears signed out (or at the sign-in screen), not stuck
     on an error.
2. **Fresh-install protocol registration (cold start already covered it)**
   - With Calmly still running from step 1, open `regedit` and confirm
     `HKEY_CURRENT_USER\Software\Classes\calmly` exists, with `(Default)`
     starting `URL:` and a `URL Protocol` value present, and
     `shell\open\command\(Default)` pointing at the installed
     `Calmly.exe` with `"%1"` appended.
   - Confirm there is **no** matching key under `HKEY_LOCAL_MACHINE` (this is
     a per-user install; nothing should require admin to register or run).
3. **Second-instance deep link (app already running)**
   - With Calmly running, open a magic-link email (or paste a
     `calmly://auth/callback?token=...` URL into a browser and press Enter,
     accepting the "Open Calmly?" browser prompt if shown).
   - Confirm the already-running Calmly window is brought to the foreground
     and signs in — no second Calmly process/window appears.
4. **Cold-start deep link (app not running)**
   - Fully quit Calmly (including checking Task Manager — not just closing
     the window).
   - Click a magic link / paste-and-enter a `calmly://` URL as above.
   - Confirm Calmly launches fresh and signs in directly, with no
     intermediate blank/dev-stub window.
5. **Uninstall preserves data**
   - Uninstall via Settings → Apps (or the Start Menu entry).
   - Reinstall the same version. Confirm existing tasks are still present
     (uninstall must never delete app data — `deleteAppDataOnUninstall:
     false` in `desktop/electron-builder.yml`).

If any step fails, check `desktop/src/main/auth/deeplink-install.ts` (protocol
registration + second-instance wiring) and `desktop/src/main/bootstrap/deeplinks.ts`
(argv buffering/dispatch) before assuming it's an installer config problem —
the NSIS config only gets the app installed and launched once; the app's own
`app.setAsDefaultProtocolClient()` call is what actually claims the
`calmly://` scheme in the registry.

## macOS manual verification checklist (REL-04)

As with Windows, actually clicking a link and having macOS launch/foreground
Calmly isn't practical to automate in CI — verify by hand once per
macOS-affecting change to packaging or deep-link code, and always before a
tagged release. Prerequisites: a macOS machine, a built `Calmly-X.Y.Z.dmg`
from `pnpm --filter @calmly/desktop dist:mac`, and a way to trigger a real
magic-link email (or a `calmly://auth/callback?token=...` URL you can paste
into a browser's address bar as a stand-in).

1. **Built Info.plist declares the `calmly://` scheme**
   - After a `dist:mac` run, inspect the app bundle's `Info.plist` (path looks
     like `release/mac/Calmly.app/Contents/Info.plist`):
     ```bash
     plutil -p "release/mac/Calmly.app/Contents/Info.plist" | grep -A3 CFBundleURLSchemes
     ```
   - Confirm it contains `"calmly"` under `CFBundleURLTypes` →
     `CFBundleURLSchemes`. This is what `electron-builder.yml`'s top-level
     `protocols` stanza (`schemes: [calmly]`) generates — if it's missing,
     the OS never learns to route `calmly://` links to Calmly at all,
     independent of anything `app.setAsDefaultProtocolClient` does at
     runtime.
2. **Install registers the protocol handler**
   - Drag `Calmly.app` from the mounted DMG into `/Applications` and launch
     it once (first launch is what calls
     `app.setAsDefaultProtocolClient("calmly")` in
     `desktop/src/main/auth/deeplink-install.ts`).
   - Confirm registration: `open calmly://auth/callback?token=x` from a
     terminal should bring Calmly to the foreground rather than erroring
     with "no application knows how to open" the URL.
3. **Cold-start deep link (app not running) — the open-url path**
   - Unlike Windows/Linux, macOS never puts the URL in argv; it always
     delivers via the `open-url` app event (see
     `desktop/src/main/auth/deeplink-install.ts`'s `app.on("open-url", ...)`
     registration, which happens before `app.whenReady()` specifically so a
     launch-time URL isn't missed).
   - Fully quit Calmly (Cmd+Q, confirm no process in Activity Monitor).
   - Click a magic link, or run `open calmly://auth/callback?token=...`.
   - Confirm Calmly launches fresh and signs in directly — no blank window,
     no lost URL (if the URL is silently dropped, the buffering in
     `desktop/src/main/bootstrap/deeplinks.ts` — covered by unit tests — is
     the first place to check, then whether `open-url` fired before the
     listener was attached).
4. **Warm dispatch (app already running)**
   - With Calmly running and signed out, run
     `open calmly://auth/callback?token=...` again.
   - Confirm the existing window is brought to the foreground and signs in,
     with no second Calmly process/window.
5. **Calendar OAuth deep link**
   - Start a Google or Microsoft calendar connect from Settings, complete the
     browser consent screen, and confirm the resulting
     `calmly://oauth/<provider>/done?ticket=...` redirect completes the
     connection instead of leaving the browser tab open with no feedback in
     the app.

If any step fails, check `desktop/src/main/auth/deeplink-install.ts` (the
`open-url`/`setAsDefaultProtocolClient` registration) and
`desktop/src/main/bootstrap/deeplinks.ts` (buffering/dispatch) before
assuming it's an `electron-builder.yml` config problem.

## After tagging

Once REL-08 lands CI publishing, this section will describe watching the
release workflow and filling in the draft GitHub Release — mirroring
`server/RELEASING.md`'s "After tagging" section. Until then, attach the
locally-built installers to a manually-created GitHub Release draft, pasting
the relevant `desktop/CHANGELOG.md` section (see `scripts/release-notes.mjs`
— extracts the matching version section by tag).
