import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const [input, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const env = (k, d) => Number(process.env[k] ?? d);
const CW = env("CW", 4);
const CH = env("CH", 6.5);
const SX = 4;
const SY = 6;
const meta = await sharp(input).metadata();
const W = meta.width;
const COLS = W / CW;
const ROWS = Math.floor(meta.height / CH);
const RAMP = process.env.RAMP ?? ".:+*ox%#@";
const SW = COLS * SX;
const SH = ROWS * SY;
const { data } = await sharp(input)
  .extract({ left: 0, top: 0, width: W, height: Math.floor(ROWS * CH) })
  .resize(SW, SH, { fit: "fill", kernel: "lanczos3" })
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const px = (x, y) => {
  const i = (Math.min(SH - 1, Math.max(0, y)) * SW + Math.min(SW - 1, Math.max(0, x))) * 3;
  return [data[i], data[i + 1], data[i + 2]];
};
const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
function rgbToHsl([r, g, b]) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) {
    return [0, 0, l];
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) {
    h = (g - b) / d + (g < b ? 6 : 0);
  } else if (max === g) {
    h = (b - r) / d + 2;
  } else {
    h = (r - g) / d + 4;
  }
  return [h * 60, s, l];
}
const chromaOf = (c) => Math.max(...c) - Math.min(...c);
const isInk = (c) => lum(c) < env("INK_L", 0.94) || chromaOf(c) >= env("INK_CHROMA", 14);

const cells = [];
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    let n = 0;
    const sum = [0, 0, 0];
    for (let sy = 0; sy < SY; sy++) {
      for (let sx = 0; sx < SX; sx++) {
        const p = px(c * SX + sx, r * SY + sy);
        if (!isInk(p)) {
          continue;
        }
        n++;
        sum[0] += p[0];
        sum[1] += p[1];
        sum[2] += p[2];
      }
    }
    const coverage = n / (SX * SY);
    if (coverage < env("COVER", 0.2)) {
      cells.push(null);
      continue;
    }
    const mean = sum.map((v) => v / n);
    let jxx = 0;
    let jyy = 0;
    let jxy = 0;
    const Lp = (x, y) => lum(px(x, y));
    for (let sy = -1; sy <= SY; sy++) {
      for (let sx = -1; sx <= SX; sx++) {
        const x = c * SX + sx;
        const y = r * SY + sy;
        const gx = Lp(x + 1, y) - Lp(x - 1, y);
        const gy = Lp(x, y + 1) - Lp(x, y - 1);
        jxx += gx * gx;
        jyy += gy * gy;
        jxy += gx * gy;
      }
    }
    const trace = jxx + jyy;
    const coherence = trace > 1e-9 ? Math.sqrt((jxx - jyy) ** 2 + 4 * jxy * jxy) / trace : 0;
    const along = (0.5 * Math.atan2(2 * jxy, jxx - jyy) * 180) / Math.PI + 90;
    cells.push({ r, c, coverage, mean, coherence, along, trace });
  }
}

function partOf({ mean }) {
  const [h, s] = rgbToHsl(mean);
  if (env("SUN", 0) && h >= 25 && h <= 70 && s > 0.35) {
    return "sun";
  }
  if (chromaOf(mean) < env("CLOUD_CHROMA", 70)) {
    return "shade";
  }
  return "sky";
}
const PARTS = {
  sky: [RAMP, env("SKY_LO", 0), env("SKY_HI", 8)],
  shade: [RAMP, env("SHADE_LO", 0), env("SHADE_HI", 5)],
  sun: [".:+*o", 0, 4],
};
const live = cells.filter(Boolean);
for (const cell of live) {
  cell.part = partOf(cell);
}
const LOCAL = env("LOCAL", 0);
if (LOCAL) {
  const RX = env("LOCAL_RX", 7);
  const RY = env("LOCAL_RY", 4);
  for (const cell of live) {
    let s = 0;
    let w = 0;
    for (let dr = -RY; dr <= RY; dr++) {
      for (let dc = -RX; dc <= RX; dc++) {
        const o = cells[(cell.r + dr) * COLS + cell.c + dc];
        if (
          !o ||
          o.part !== cell.part ||
          cell.r + dr < 0 ||
          cell.r + dr >= ROWS ||
          cell.c + dc < 0 ||
          cell.c + dc >= COLS
        ) {
          continue;
        }
        const k = Math.exp(-(dr * dr) / (2 * (RY / 2) ** 2) - (dc * dc) / (2 * (RX / 2) ** 2));
        s += k * lum(o.mean);
        w += k;
      }
    }
    const around = w ? s / w : lum(cell.mean);
    cell.local = around - lum(cell.mean);
    cell.broad = 1 - around;
  }
}
const darkOf = (c) => (LOCAL ? c.local * LOCAL + c.broad * env("BROAD", 0.25) : 1 - lum(c.mean));
for (const [name, [ramp, lo, hi]] of Object.entries(PARTS)) {
  const group = live.filter((c) => c.part === name);
  if (group.length === 0) {
    continue;
  }
  const darks = group.map(darkOf).sort((a, b) => a - b);
  const q = (p) => darks[Math.floor(p * (darks.length - 1))];
  const d0 = q(0.04);
  const d1 = q(0.97);
  for (const cell of group) {
    const t = Math.max(0, Math.min(1, (darkOf(cell) - d0) / (d1 - d0 || 1)));
    cell.t = t;
    cell.shadow = Math.max(0, Math.min(1, (1 - lum(cell.mean) - 0.06) / 0.3));
    let i = Math.round(lo + t ** env("GAMMA", 1) * (hi - lo));
    if (cell.coverage < 0.45) {
      i = Math.min(i, lo + 1);
    }
    cell.glyph = ramp[i];
    if (
      name === "sky" &&
      env("STROKES", 0) &&
      cell.coherence > env("COHERENT", 0.55) &&
      cell.trace > env("TRACE", 0.004)
    ) {
      let a = cell.along % 180;
      if (a < 0) {
        a += 180;
      }
      cell.glyph = strokeGlyph(a);
    }
  }
}

const toLinear = (v) => {
  const c = v / 255;
  return c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v) => {
  const c = v <= 0.003_130_8 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
};
function oklab([r, g, b]) {
  const [R, G, B] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.412_221_470_8 * R + 0.536_332_536_3 * G + 0.051_445_992_9 * B);
  const m = Math.cbrt(0.211_903_498_2 * R + 0.680_699_545_1 * G + 0.107_396_956_6 * B);
  const s2 = Math.cbrt(0.088_302_461_9 * R + 0.281_718_837_6 * G + 0.629_978_700_5 * B);
  return [
    0.210_454_255_3 * l + 0.793_617_785 * m - 0.004_072_046_8 * s2,
    1.977_998_495_1 * l - 2.428_592_205 * m + 0.450_593_709_9 * s2,
    0.025_904_037_1 * l + 0.782_771_766_2 * m - 0.808_675_766 * s2,
  ];
}
function fromLab([L, a, b]) {
  const l = (L + 0.396_337_777_4 * a + 0.215_803_757_3 * b) ** 3;
  const m = (L - 0.105_561_345_8 * a - 0.063_854_172_8 * b) ** 3;
  const s2 = (L - 0.089_484_177_5 * a - 1.291_485_548 * b) ** 3;
  return [
    fromLinear(4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s2),
    fromLinear(-1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_326_3 * s2),
    fromLinear(-0.004_196_086_3 * l - 0.703_418_680_7 * m + 1.707_614_701 * s2),
  ];
}
const turn = (a, b, degrees) => {
  const t = (degrees * Math.PI) / 180;
  return [a * Math.cos(t) - b * Math.sin(t), a * Math.sin(t) + b * Math.cos(t)];
};
const grade = (rgb, part, mode) => {
  const [L, a0, b0] = oklab(rgb);
  if (part !== "sky") {
    return null;
  }
  if (mode === "light") {
    const [a, b] = turn(a0, b0, env("LIGHT_SKY_HUE", 0));
    return fromLab([
      Math.min(L, env("LIGHT_SKY_L", 0.52)) - env("LIGHT_SKY_DROP", 0.04),
      a * env("LIGHT_SKY_C", 1.45),
      b * env("LIGHT_SKY_C", 1.45),
    ]);
  }
  const [a, b] = turn(a0, b0, env("DARK_SKY_HUE", 0));
  return fromLab([
    Math.max(L, env("DARK_SKY_L", 0.6)),
    a * env("DARK_SKY_C", 1.25),
    b * env("DARK_SKY_C", 1.25),
  ]);
};
const CLOUD = {
  light: ["#c3d2e8", "#9db3d6", "#7690c2", "#5a76ae"],
  dark: ["#ffffff", "#e6eefa", "#c2d1ea", "#93a8cf"],
};
const hexRgb = (h) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
const along = (stops, t) => {
  const p = Math.min(stops.length - 1.0001, Math.max(0, t * (stops.length - 1)));
  const i = Math.floor(p);
  const a = hexRgb(stops[i]);
  const b = hexRgb(stops[i + 1]);
  return a.map((v, k) => v + (b[k] - v) * (p - i));
};
const lightVariant = (rgb, part) => grade(rgb, part, "light");
const darkVariant = (rgb, part) => grade(rgb, part, "dark");
const PAGE = { light: [250, 250, 250], dark: [23, 23, 23] };
function cellColour(cell, mode, variant) {
  if (!cell) {
    return PAGE[mode];
  }
  if (cell.part === "sky") {
    return variant(cell.mean, cell.part);
  }
  return along(CLOUD[mode], cell.shadow);
}
function strokeGlyph(angle) {
  if (angle < 20 || angle >= 160) {
    return "-";
  }
  if (angle < 70) {
    return "\\";
  }
  if (angle < 110) {
    return "|";
  }
  return "/";
}
const maps = { light: Buffer.alloc(COLS * ROWS * 3), dark: Buffer.alloc(COLS * ROWS * 3) };
const COLUMN = 336;
const HEADER = 96;
const smooth = (a, b, t) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};
let seed = 5;
const rand = () => {
  seed = (seed + 0x6d_2b_79_f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
};
const art = [];
let shown = 0;
for (let r = 0; r < ROWS; r++) {
  let line = "";
  for (let c = 0; c < COLS; c++) {
    const cell = cells[r * COLS + c];
    const x = (c + 0.5) * CW - W / 2;
    const y = (r + 0.5) * CH;
    const side = smooth(COLUMN - env("EDGE_IN", 10), COLUMN + env("EDGE_OUT", 110), Math.abs(x));
    const wander =
      (Math.sin(x / 47) * 0.5 + Math.sin(x / 113 + 1.3) * 0.35 + Math.sin(x / 23 + 0.4) * 0.15) *
      env("WANDER", 12);
    const header = 1 - smooth(HEADER - 34 + wander, HEADER + 4 + wander, y);
    const behind = env("BEHIND", 0.1) + (env("HEADER_KEEP", 0.4) - env("BEHIND", 0.1)) * header;
    const away = side;
    const fade =
      (1 - smooth(env("FADE_FROM", 0.5) * ROWS * CH, ROWS * CH, y)) *
      (1 - smooth(env("SIDE", 960) - 140, env("SIDE", 960), Math.abs(x)));
    const keep = env("NOFADE", 0) ? 1 : fade * (behind + (1 - behind) * away);
    let glyph = cell ? cell.glyph : " ";
    if (cell && keep < 1) {
      const i = RAMP.indexOf(glyph);
      if (i >= 0) {
        glyph = RAMP[Math.max(0, Math.round(i * (0.35 + 0.65 * keep)))];
      }
      if (rand() > keep * 1.3) {
        glyph = " ";
      }
    }
    line += glyph;
    if (glyph !== " ") {
      shown++;
    }
    const ci = (r * COLS + c) * 3;
    for (const [m, variant] of [
      ["light", lightVariant],
      ["dark", darkVariant],
    ]) {
      const col = cellColour(cell, m, variant);
      const page = PAGE[m];
      const strength = Math.min(1, keep * 1.15);
      for (let k = 0; k < 3; k++) {
        maps[m][ci + k] = Math.round(page[k] + (col[k] - page[k]) * strength);
      }
    }
  }
  art.push(line.trimEnd());
}
writeFileSync(path.join(outDir, "sky.txt"), art.join("\n"));
const { toNight } = await import(new URL("../src/grade.ts", import.meta.url).href);
toNight(maps.dark, 3, COLS, ROWS, art.join("\n"));
for (const m of ["light", "dark"]) {
  await sharp(maps[m], { raw: { width: COLS, height: ROWS, channels: 3 } })
    .png()
    .toFile(path.join(outDir, `sky-${m}.png`));
}
writeFileSync(
  path.join(outDir, "sky.json"),
  JSON.stringify({ columns: COLS, rows: ROWS, cellWidth: CW, cellHeight: CH }),
);
const counts = {};
for (const cell of live) {
  counts[cell.part] = (counts[cell.part] ?? 0) + 1;
}
console.log(
  `${COLS}x${ROWS}, ${shown} glyphs shown (${Math.round((shown / (COLS * ROWS)) * 100)}%)`,
  counts,
);
