// REL-05: electron-builder `afterAllArtifactBuild` hook.
//
// Runs once, after every artifact for the whole `dist` invocation has been
// built (dmg+zip, nsis exe, AppImage+deb — whichever targets were requested).
// Purely a summary log: per-artifact signature/notarization verification
// already happened in afterSign.mjs (which throws on failure, before any
// artifact gets this far). This hook exists so a build's final log output —
// and CI's job summary — states plainly, for every artifact produced,
// whether it shipped signed or unsigned. Never throws: if something here
// were wrong the build would already have failed earlier.
import { describeMacSigning, describeWinSigning } from "./signingStatus.mjs";

/** @param {import("electron-builder").BuildResult} buildResult */
export default async function afterAllArtifactBuild(buildResult) {
  const artifactPaths = buildResult?.artifactPaths ?? [];
  const mac = describeMacSigning();
  const win = describeWinSigning();

  console.log("[afterAllArtifactBuild] release artifacts:");
  for (const artifactPath of artifactPaths) {
    console.log(`  - ${artifactPath}`);
  }
  console.log(
    `[afterAllArtifactBuild] macOS: ${mac.willSign ? (mac.willNotarize ? "signed + notarized" : "signed, NOT notarized") : "UNSIGNED"}`
  );
  console.log(`[afterAllArtifactBuild] Windows: ${win.willSign ? "signed" : "UNSIGNED"}`);

  // No additional artifacts produced by this hook.
  return [];
}
