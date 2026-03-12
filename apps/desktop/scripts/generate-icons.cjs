#!/usr/bin/env node
/**
 * Generate all app icon assets from app-icon.svg.
 *
 * Prerequisites:
 *   cd /tmp && mkdir -p icon-gen && cd icon-gen && npm init -y && npm install sharp
 *
 * Usage (from repo root):
 *   node apps/desktop/scripts/generate-icons.cjs
 *
 * After running, convert the iconset to icns on macOS:
 *   iconutil -c icns apps/desktop/resources/icon.iconset -o apps/desktop/resources/icon.icns
 *   rm -rf apps/desktop/resources/icon.iconset
 */

const fs = require("fs");
const path = require("path");

let sharp;
try {
  sharp = require("sharp");
} catch {
  try {
    sharp = require("/tmp/icon-gen/node_modules/sharp");
  } catch {
    console.error(
      "sharp not found. Install it first:\n  cd /tmp && mkdir -p icon-gen && cd icon-gen && npm init -y && npm install sharp"
    );
    process.exit(1);
  }
}

const desktopDir = path.resolve(__dirname, "..");
const colorSvg = fs.readFileSync(path.join(desktopDir, "app-icon.svg"), "utf8");
const traySvg = fs.readFileSync(path.join(desktopDir, "resources/trayIconTemplate.svg"), "utf8");

// The source SVG viewBox is non-square (112x121). Center it on a square canvas with padding.
const ICON_SIZE = 1024;
const ICON_PADDING = 80;
const available = ICON_SIZE - 2 * ICON_PADDING;
const scale = Math.min(available / 112, available / 121);
const scaledW = 112 * scale;
const scaledH = 121 * scale;
const offsetX = (ICON_SIZE - scaledW) / 2;
const offsetY = (ICON_SIZE - scaledH) / 2;

const colorPaths = colorSvg.match(/<path[\s\S]*?\/>/g).join("\n    ");
const squareColorSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}">
  <g transform="translate(${offsetX}, ${offsetY}) scale(${scale})">
    ${colorPaths}
  </g>
</svg>`;

const trayPaths = traySvg.match(/<path[\s\S]*?\/>/g).join("\n    ");
function makeSquareTray(size) {
  const s = size / 121;
  const tw = 112 * s;
  const tx = (size - tw) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <g transform="translate(${tx}, 0) scale(${s})">
    ${trayPaths}
  </g>
</svg>`;
}

async function main() {
  const resDir = path.join(desktopDir, "resources");

  // App icon 1024x1024
  await sharp(Buffer.from(squareColorSvg))
    .resize(1024, 1024)
    .png()
    .toFile(path.join(resDir, "icon-1024.png"));
  console.log("  icon-1024.png");

  // Tray icons (black silhouette template images)
  await sharp(Buffer.from(makeSquareTray(72)))
    .resize(18, 18)
    .png()
    .toFile(path.join(resDir, "trayIconTemplate.png"));
  console.log("  trayIconTemplate.png (18x18)");

  await sharp(Buffer.from(makeSquareTray(144)))
    .resize(36, 36)
    .png()
    .toFile(path.join(resDir, "trayIconTemplate@2x.png"));
  console.log("  trayIconTemplate@2x.png (36x36)");

  // Iconset for macOS icns
  const iconsetDir = path.join(resDir, "icon.iconset");
  fs.mkdirSync(iconsetDir, { recursive: true });

  for (const s of [16, 32, 128, 256, 512]) {
    await sharp(Buffer.from(squareColorSvg))
      .resize(s, s)
      .png()
      .toFile(path.join(iconsetDir, `icon_${s}x${s}.png`));
    await sharp(Buffer.from(squareColorSvg))
      .resize(s * 2, s * 2)
      .png()
      .toFile(path.join(iconsetDir, `icon_${s}x${s}@2x.png`));
  }
  console.log("  icon.iconset/ (run iconutil to convert to .icns)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
