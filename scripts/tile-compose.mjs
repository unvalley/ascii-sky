// A sky that tiles: the top of the painting at 1920 page pixels
// wide, its last stretch cross-faded into its start, so a period of
// 1920 − OVERLAP pixels repeats without a seam. Written at page pixels.
//   node tile-compose.mjs <painting.png> <out.png> [height=700]
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const sharp = require("sharp");
const [src, out, hArg = "700"] = process.argv.slice(2);
mkdirSync(path.dirname(out), { recursive: true });
const H = Number(hArg);
const FULL = 1920;
const OVERLAP = Number(process.env.OVERLAP ?? 320);
const P = FULL - OVERLAP;
const k = FULL / 1536;
const rows = Math.round(H / k);
const img = await sharp(src).extract({ left: 0, top: 0, width: 1536, height: rows }).resize(FULL, H, { kernel: "lanczos3" }).removeAlpha().raw().toBuffer();
const tile = Buffer.alloc(P * H * 3);
const smooth = (t) => t * t * (3 - 2 * t);
for (let y = 0; y < H; y++)
  for (let x = 0; x < P; x++) {
    const o = (y * P + x) * 3;
    if (x >= OVERLAP) {
      img.copy(tile, o, (y * FULL + x) * 3, (y * FULL + x) * 3 + 3);
      continue;
    }
    // Start of the tile: the painting's end fading into its start.
    const t = smooth(x / OVERLAP);
    for (let c = 0; c < 3; c++) tile[o + c] = Math.round(img[(y * FULL + x + P) * 3 + c] * (1 - t) + img[(y * FULL + x) * 3 + c] * t);
  }
await sharp(tile, { raw: { width: P, height: H, channels: 3 } }).png().toFile(out);
// Two periods side by side, to check the seam.
const two = Buffer.alloc(P * 2 * H * 3);
for (let y = 0; y < H; y++) for (let r = 0; r < 2; r++) tile.copy(two, (y * P * 2 + r * P) * 3, y * P * 3, (y + 1) * P * 3);
await sharp(two, { raw: { width: P * 2, height: H, channels: 3 } }).resize(1600).png().toFile(out.replace(/\.png$/, "-twice.png"));
console.log(`tile ${P}x${H}`);
