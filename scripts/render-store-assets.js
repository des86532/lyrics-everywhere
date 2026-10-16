import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import {
  generateSmallPromoTileHtml,
  generateMarqueePromoTileHtml
} from "./build-store-assets.js";

const outDir = path.resolve("store-assets");
fs.mkdirSync(outDir, { recursive: true });

const targets = [
  { name: "promo-tile-small-440x280.png", w: 440, h: 280, html: generateSmallPromoTileHtml() },
  { name: "promo-tile-marquee-1400x560.png", w: 1400, h: 560, html: generateMarqueePromoTileHtml() }
];

const edgeBinary = "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";

for (const target of targets) {
  const tempHtmlPath = path.join(outDir, `temp-${target.name}.html`);
  const finalPngPath = path.join(outDir, target.name);

  fs.writeFileSync(tempHtmlPath, target.html, "utf-8");

  const cmd = `"${edgeBinary}" --headless=new --screenshot="${finalPngPath}" --window-size=${target.w},${target.h} --hide-scrollbars --force-device-scale-factor=1 "file://${tempHtmlPath}" 2>/dev/null`;
  
  execSync(cmd);
  fs.unlinkSync(tempHtmlPath);

  // Verify size with sips
  const info = execSync(`sips -g pixelWidth -g pixelHeight "${finalPngPath}"`).toString();
  console.log(`Generated ${target.name}:`);
  console.log(info.trim());
}

// Copy icon to store-assets for developer convenience
fs.copyFileSync("browser-extension/icons/128x128.png", path.join(outDir, "store-icon-128x128.png"));
console.log("Copied store-icon-128x128.png to store-assets");
