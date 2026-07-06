// REL-05: pure env-var → signing-decision logic, shared by the electron-builder
// lifecycle hooks in this directory (afterPack.mjs / afterSign.mjs /
// afterAllArtifactBuild.mjs).
//
// Kept dependency-free and side-effect-free (no fs/child_process) so it can be
// unit-tested without invoking electron-builder or an OS-specific signing tool
// — see desktop/test/release/signingStatus.spec.ts.
//
// Env var contract (full lifecycle documented in docs/RELEASING.md):
//   macOS codesign   CSC_LINK (base64-encoded .p12) + CSC_KEY_PASSWORD
//   macOS notarize   APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID
//   Windows codesign WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD (electron-builder
//                    falls back to CSC_LINK/CSC_KEY_PASSWORD if the WIN_-
//                    prefixed vars are unset — same cert would sign both
//                    platforms, which only works if it's a cross-platform-
//                    capable code-signing cert; separate mac/Windows certs
//                    from different CAs is the common case, hence separate
//                    WIN_ names so one env doesn't silently feed both).
//
// This module never throws and never reads real secret values into a return
// value — only booleans/messages — so it's safe to log its output as-is.

const UNSIGNED_PREFIX = "UNSIGNED build — signing secrets not configured";

/** @param {NodeJS.ProcessEnv} env */
export function describeMacSigning(env = process.env) {
  const willSign = Boolean(env.CSC_LINK && env.CSC_KEY_PASSWORD);
  const notarizeCredsPresent = Boolean(env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID);
  const willNotarize = willSign && notarizeCredsPresent;

  let message;
  if (!willSign) {
    message = `${UNSIGNED_PREFIX} (macOS: set CSC_LINK + CSC_KEY_PASSWORD to enable Developer ID signing)`;
  } else if (!willNotarize) {
    message =
      "macOS: Developer ID signing configured, but notarization secrets are missing " +
      "(APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID) — build will be SIGNED but NOT NOTARIZED, " +
      "Gatekeeper will still block it on current macOS";
  } else {
    message = "macOS: Developer ID signing + notarization configured";
  }

  return { willSign, willNotarize, message };
}

/** @param {NodeJS.ProcessEnv} env */
export function describeWinSigning(env = process.env) {
  const link = env.WIN_CSC_LINK || env.CSC_LINK;
  const password = env.WIN_CSC_KEY_PASSWORD || env.CSC_KEY_PASSWORD;
  const willSign = Boolean(link && password);

  const message = willSign
    ? "Windows: Authenticode signing configured (WIN_CSC_LINK/CSC_LINK)"
    : `${UNSIGNED_PREFIX} (Windows: set WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD, or CSC_LINK + CSC_KEY_PASSWORD, to enable Authenticode signing)`;

  return { willSign, message };
}
