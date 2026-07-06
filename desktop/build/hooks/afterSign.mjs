// REL-05: electron-builder `afterSign` verification hook.
//
// electron-builder only invokes `afterSign` when it actually signed the app
// (it logs `skipping "afterSign" hook as no signing occurred` and moves on
// otherwise — see app-builder-lib's platformPackager.js `doSignAfterPack`).
// That means this hook can safely assume signing was attempted, and its job
// is narrow: prove it actually worked, and throw (failing the build) if it
// didn't, so a half-signed release can never slip out silently. The
// "did we even try to sign" / graceful-skip logging lives in afterPack.mjs,
// which always runs.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describeMacSigning } from "./signingStatus.mjs";

/** @param {import("electron-builder").AfterPackContext} context */
export default async function afterSign(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  const productFilename = packager?.appInfo?.productFilename ?? "Calmly";

  if (electronPlatformName === "darwin") {
    await verifyMac(appOutDir, productFilename);
  } else if (electronPlatformName === "win32") {
    await verifyWin(appOutDir, productFilename);
  }
}

async function verifyMac(appOutDir, productFilename) {
  const appPath = path.join(appOutDir, `${productFilename}.app`);
  const { willNotarize } = describeMacSigning();

  console.log(`[afterSign] verifying macOS code signature: ${appPath}`);
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
  run("spctl", ["-a", "-t", "exec", "-vv", appPath]);

  if (willNotarize) {
    console.log(`[afterSign] verifying notarization ticket is stapled: ${appPath}`);
    run("xcrun", ["stapler", "validate", appPath]);
  }
  console.log("[afterSign] macOS signature verification passed");
}

async function verifyWin(appOutDir, productFilename) {
  const exePath = path.join(appOutDir, `${productFilename}.exe`);
  if (process.platform !== "win32") {
    // electron-builder decided signing occurred (that's the only way this
    // hook fires at all), but Authenticode verification needs PowerShell /
    // signtool, which only exist on an actual Windows host. Don't pretend to
    // have verified something we didn't — flag it loudly instead of skipping
    // quietly, so CI's Windows matrix leg (the one place this can run for
    // real) is the one place expected to prove it.
    console.warn(
      `[afterSign] signing reported for win32 but running on ${process.platform} — cannot run ` +
        `Get-AuthenticodeSignature here. This MUST be verified on a Windows host before release ` +
        `(see docs/RELEASING.md "Verifying signatures").`
    );
    return;
  }
  console.log(`[afterSign] verifying Windows Authenticode signature: ${exePath}`);
  const script =
    `$sig = Get-AuthenticodeSignature -FilePath '${exePath}'; ` +
    `if ($sig.Status -ne 'Valid') { Write-Error "Authenticode status: $($sig.Status)"; exit 1 }; ` +
    `Write-Host "Authenticode OK: $($sig.SignerCertificate.Subject)"`;
  run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
  console.log("[afterSign] Windows signature verification passed");
}

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: "inherit" });
}
