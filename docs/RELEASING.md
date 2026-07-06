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
  → `Calmly-X.Y.Z.dmg` + `Calmly-X.Y.Z-mac.zip`, signed + notarized if the
  secrets below are present in the environment, unsigned otherwise (see
  "Code signing & notarization"). Requires an actual macOS host or CI runner
  — electron-builder's DMG target shells out to macOS-only tooling
  (`hdiutil`, the optional `dmg-license` dependency) and cannot run on
  Linux/Windows.

Windows/macOS artifacts built without the signing secrets below are still
fully functional installers — just unsigned, which means Windows SmartScreen
and macOS Gatekeeper will warn/block on them. Fine for local dev builds; not
fine for anything handed to a real user. CI wiring for these (windows-latest /
macos-latest runners building on tag push, auto-attaching artifacts to a
draft GitHub Release) lands in REL-08. Until then, run the above locally or
via a manual/dispatch workflow run.

## Code signing & notarization (REL-05)

Electron-builder itself decides whether to sign, purely from environment
variables — nothing in `desktop/electron-builder.yml` needs to change between
a signed release build and an unsigned dev/CI build. **No secret VALUES live
in this repo, ever** — only the variable *names* below, which get set as
GitHub Actions repository secrets (REL-08 wires the actual passthrough) or
exported locally when building on your own machine.

### Secret names

| Secret | Platform | Used for |
|---|---|---|
| `CSC_LINK` | macOS | Base64-encoded Developer ID Application `.p12` certificate |
| `CSC_KEY_PASSWORD` | macOS | Password for that `.p12` |
| `APPLE_ID` | macOS | Apple ID (email) used to notarize |
| `APPLE_APP_SPECIFIC_PASSWORD` | macOS | App-specific password for that Apple ID (not the Apple ID's real password) |
| `APPLE_TEAM_ID` | macOS | 10-character Apple Developer Team ID |
| `WIN_CSC_LINK` | Windows | Base64-encoded Authenticode `.p12` certificate (falls back to `CSC_LINK` if unset — only safe if it's the same cross-platform-capable cert) |
| `WIN_CSC_KEY_PASSWORD` | Windows | Password for the Windows `.p12` (falls back to `CSC_KEY_PASSWORD`) |

Chosen path for Windows: a standard OV/EV Authenticode code-signing
certificate via `CSC_LINK`/`CSC_KEY_PASSWORD` (or the `WIN_`-prefixed
variants, if using a different cert than macOS). **Alternative not wired
here**: Azure Trusted Signing (`win.signtoolOptions` + `@azure/trusted-
signing-cli`) avoids needing a locally-held `.p12`/HSM-backed cert, at the
cost of an Azure subscription and a provisioned Trusted Signing resource. If
a traditional Authenticode cert turns out to be hard for the project to
obtain, switch to that path instead — do not wire both.

### Graceful skip — no secrets is not a build failure

Absent any of the above, `dist`/`dist:mac`/`dist:win` complete successfully
and produce **unsigned** artifacts. `desktop/build/hooks/afterPack.mjs` logs
this clearly for every packaged build:

```
[afterPack] UNSIGNED build — signing secrets not configured (macOS: set CSC_LINK + CSC_KEY_PASSWORD to enable Developer ID signing)
[afterPack] UNSIGNED build — signing secrets not configured (Windows: set WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD, or CSC_LINK + CSC_KEY_PASSWORD, to enable Authenticode signing)
```

If only the codesign secrets are present but not the three notarization ones,
the build is signed but not notarized — also logged explicitly, since a
signed-but-unnotarized `.app` is *still* blocked outright by Gatekeeper on
current macOS (unlike Windows SmartScreen, which merely warns on unsigned).

`desktop/build/hooks/afterSign.mjs` is the opposite case: electron-builder
only invokes it when signing actually happened, and it runs the verification
commands below, **throwing** (failing the build) if verification fails — a
half-signed release can never slip out silently.
`desktop/build/hooks/afterAllArtifactBuild.mjs` logs a final per-artifact
signed/unsigned summary once every target has built.

### Producing / renewing each credential

**Developer ID Application certificate (macOS codesign)**
1. Enroll in the [Apple Developer Program](https://developer.apple.com/programs/)
   (paid, per year) if not already enrolled.
2. In Xcode or the [developer portal](https://developer.apple.com/account/resources/certificates/list),
   create a **Developer ID Application** certificate (not "Apple
   Distribution" — that's for the Mac App Store, which this project doesn't
   use).
3. Export it from Keychain Access as a `.p12`, protected with a password.
4. `base64 -i DeveloperIDApplication.p12 | pbcopy` → paste as the
   `CSC_LINK` repo secret. Set `CSC_KEY_PASSWORD` to the export password.
5. Renew: Developer ID certificates are valid 5 years; the Apple Developer
   Program membership itself renews annually — expiry of either breaks
   signing, watch for `errSecInternalComponent`/expired-cert failures in the
   mac release job.

**App-specific password (macOS notarize)**
1. Sign in at [appleid.apple.com](https://appleid.apple.com) → Sign-In and
   Security → App-Specific Passwords → generate one, label it e.g.
   "calmly-notarize".
2. Set it as `APPLE_APP_SPECIFIC_PASSWORD`. Set `APPLE_ID` to the Apple ID
   email itself, and `APPLE_TEAM_ID` to the 10-character Team ID shown at
   the top of the [developer portal membership page](https://developer.apple.com/account/#/membership).
3. Renew: app-specific passwords don't expire but can be individually
   revoked from the same page — regenerate if notarization starts failing
   with an authentication error.

**Authenticode certificate (Windows codesign)**
1. Buy an OV (Organization Validation) or EV (Extended Validation) code-
   signing certificate from a CA (DigiCert, Sectigo, SSL.com, etc.). EV
   certs build Windows SmartScreen reputation faster but require
   hardware-token / HSM issuance — factor that into CI automation (an EV
   cert usually can't be exported as a plain `.p12` for `WIN_CSC_LINK`;
   Azure Trusted Signing exists partly to solve this — see above).
2. For an OV cert exportable as `.p12`: export with a password, then
   `base64 -w0 cert.p12 | pbcopy` (Linux/macOS) or
   `[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.p12")) | Set-Clipboard`
   (PowerShell) → `WIN_CSC_LINK` secret, password → `WIN_CSC_KEY_PASSWORD`.
3. Renew: OV/EV certs are typically valid 1–3 years; track the expiry date
   and re-issue before it lapses.

### Verifying signatures

Run these after any signed build, before tagging a release:

```bash
# macOS — codesign structure/validity
codesign -dv --verbose=4 "release/mac/Calmly.app"

# macOS — Gatekeeper's actual opinion (must say "accepted", "source=Notarized Developer ID")
spctl -a -t exec -vv "release/mac/Calmly.app"

# macOS — confirm the notarization ticket is stapled (works offline afterward)
xcrun stapler validate "release/mac/Calmly.app"
```

```powershell
# Windows — Authenticode signature status and signer
Get-AuthenticodeSignature -FilePath "release\win-unpacked\Calmly.exe" |
  Format-List Status, SignerCertificate
```

`desktop/build/hooks/afterSign.mjs` runs the macOS trio automatically on
every signed mac build, and the `Get-AuthenticodeSignature` check on every
signed Windows build run on an actual Windows host (it warns rather than
silently passing if it fires on a non-Windows host, since PowerShell/signtool
aren't available there — cross-building a signed Windows installer from
Linux/macOS still needs this manual check run once on Windows before
release).

### Owner follow-up (blocking real signed releases, not this bead)

Obtaining the actual certificates and app-specific password, and adding them
as repository secrets, is an owner/business task — **pending as of this
bead**. Until it's done, `dist`/`dist:mac`/`dist:win` keep working and
produce clearly-logged unsigned artifacts; REL-08's CI pipeline will pass
these env vars through once they exist. Checklist:

- [ ] Enroll/renew Apple Developer Program membership
- [ ] Generate Developer ID Application certificate, export as base64 `.p12`
      → `CSC_LINK` + `CSC_KEY_PASSWORD` repo secrets
- [ ] Generate an app-specific password → `APPLE_APP_SPECIFIC_PASSWORD`,
      plus `APPLE_ID` + `APPLE_TEAM_ID` repo secrets
- [ ] Purchase a Windows Authenticode code-signing certificate (or provision
      Azure Trusted Signing) → `WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD` (or
      the Azure equivalents) repo secrets

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
