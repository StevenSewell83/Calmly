// REL-05: electron-builder `afterPack` hook.
//
// Fires for every platform/arch after the app is packed, regardless of
// whether signing is configured — unlike `afterSign` (see afterSign.mjs),
// which electron-builder skips entirely when no signing occurred. This is
// therefore the right place to log the "will this build be signed or not"
// decision clearly, so an unsigned CI/dev build never fails silently *or*
// looks identical to a signed one in the logs.
import { describeMacSigning, describeWinSigning } from "./signingStatus.mjs";

/** @param {import("electron-builder").AfterPackContext} context */
export default async function afterPack(context) {
  const { electronPlatformName } = context;

  if (electronPlatformName === "darwin") {
    console.log(`[afterPack] ${describeMacSigning().message}`);
  } else if (electronPlatformName === "win32") {
    console.log(`[afterPack] ${describeWinSigning().message}`);
  }
  // Linux artifacts are never signed (out of scope per REL-05 bead notes —
  // checksums from REL-08 cover integrity instead), nothing to log here.
}
