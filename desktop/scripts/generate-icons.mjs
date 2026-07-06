// Regenerates the packaged app's icon set from the single hand-authored
// master: build/icon.svg. Run after editing icon.svg:
//
//   node desktop/scripts/generate-icons.mjs
//
// Produces (all under desktop/build/, all committed):
//   icon.png   1024x1024 PNG — the "master" electron-builder/other tooling
//              can reference directly (also used as the Linux app icon).
//   icon.icns  macOS icon bundle (multi-resolution).
//   icon.ico   Windows icon bundle (256/128/64/48/32/16 + a few extra sizes
//              png2icons includes by default).
//
// Do not hand-edit icon.png/.icns/.ico — edit icon.svg and re-run this
// script instead, so the three binaries never drift from one another.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import sharp from "sharp";
import png2icons from "png2icons";

const __dirname = dirname(fileURLToPath(import.meta.url));
const buildDir = resolve(__dirname, "../build");
const svgPath = resolve(buildDir, "icon.svg");
const pngPath = resolve(buildDir, "icon.png");
const icnsPath = resolve(buildDir, "icon.icns");
const icoPath = resolve(buildDir, "icon.ico");

const MASTER_SIZE = 1024;

async function main() {
  const svg = readFileSync(svgPath);

  const pngBuffer = await sharp(svg, { density: 384 })
    .resize(MASTER_SIZE, MASTER_SIZE)
    .png()
    .toBuffer();
  writeFileSync(pngPath, pngBuffer);
  console.log(`wrote ${pngPath}`);

  // png2icons reads the master PNG buffer and derives every embedded
  // resolution itself (BICUBIC scaling) — we don't hand-produce sizes.
  const icns = png2icons.createICNS(pngBuffer, png2icons.BICUBIC, 0);
  if (!icns) throw new Error("png2icons failed to produce icon.icns");
  writeFileSync(icnsPath, icns);
  console.log(`wrote ${icnsPath}`);

  // PNG-compressed ICO entries (not BMP) so 256px stays reasonably sized;
  // includes 256/128/64/48/32/16 among the sizes it embeds.
  const ico = png2icons.createICO(pngBuffer, png2icons.BICUBIC, 0, true, false);
  if (!ico) throw new Error("png2icons failed to produce icon.ico");
  writeFileSync(icoPath, ico);
  console.log(`wrote ${icoPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
