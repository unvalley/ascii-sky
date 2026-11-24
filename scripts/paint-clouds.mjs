import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const [input, outDir, sheet] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const env = (k, d) => Number(process.env[k] ?? d);

const PERIOD = 2400;
const H = 700;
const smooth = (a, b, t) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

const { data: img, info } = await sharp(input)
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const IW = info.width;
const IH = info.height;
const alpha = new Float32Array(IW * IH);
const shade = new Float32Array(IW * IH);
for (let i = 0; i < IW * IH; i++) {
  const r = img[i * 3] / 255;
  const g = img[i * 3 + 1] / 255;
  const b = img[i * 3 + 2] / 255;
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const ch = Math.max(r, g, b) - Math.min(r, g, b);
  alpha[i] = smooth(env("A_LO", 0.62), env("A_HI", 0.82), L) * (1 - smooth(0.2, 0.42, ch));
  shade[i] = Math.min(1, Math.max(0, (env("S_TOP", 0.96) - L) / env("S_SPAN", 0.26)));
}

function wave(t, seed, step = 38) {
  const u = t / step;
  const i = Math.floor(u);
  const r = (k) => {
    let h = Math.imul(k + seed * 7919, 2_654_435_761) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 2_246_822_519) >>> 0;
    return ((h ^ (h >>> 13)) >>> 0) / 4_294_967_296;
  };
  const f = u - i;
  return r(i) + (r(i + 1) - r(i)) * f * f * (3 - 2 * f);
}

function sprite(name, [x0, y0, x1, y1], fade = [0, 0, 0, 0], flip = false) {
  const w = x1 - x0;
  const h = y1 - y0;
  const a = new Float32Array(w * h);
  const s = new Float32Array(w * h);
  const seed = x0 * 31 + y0;
  const reach = (side, t) => fade[side] * (0.35 + 1.3 * wave(t, seed + side));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y0 + y) * IW + x0 + x;
      let f = 1;
      if (fade[0]) {
        f *= smooth(0, reach(0, y), x);
      }
      if (fade[1]) {
        f *= smooth(0, reach(1, x), y);
      }
      if (fade[2]) {
        f *= smooth(0, reach(2, y), w - 1 - x);
      }
      if (fade[3]) {
        f *= smooth(0, reach(3, x), h - 1 - y);
      }
      const ex = (x - w / 2) / (w * 0.62);
      const ey = (y - h / 2) / (h * 0.62);
      f *= 1 - smooth(0.82, 1, Math.hypot(ex, ey));
      const k = flip ? y * w + (w - 1 - x) : y * w + x;
      a[k] = alpha[i] * f;
      s[k] = shade[i];
    }
  }
  const simpleR = env("SIMPLE_R", 10);
  if (simpleR > 0) {
    const soft = boxBlur(boxBlur(a, w, h, simpleR), w, h, Math.round(simpleR / 2));
    for (let k = 0; k < w * h; k++) {
      a[k] = Math.max(
        a[k] * env("WISP", 0.7),
        smooth(env("SIMPLE_LO", 0.28), env("SIMPLE_HI", 0.55), soft[k]),
      );
    }
  }
  const blur = boxBlur(s, w, h, env("DETAIL_R", 5));
  const detail = new Float32Array(w * h);
  for (let k = 0; k < w * h; k++) {
    detail[k] = Math.min(1, Math.max(0, blur[k] + env("DETAIL", 1.8) * (s[k] - blur[k])));
  }
  const ranked = [];
  for (let k = 0; k < w * h; k++) {
    if (a[k] > 0.4) {
      ranked.push(detail[k]);
    }
  }
  ranked.sort((p, q) => p - q);
  const rank = (v) => {
    let lo = 0;
    let hi = ranked.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ranked[mid] < v) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return ranked.length > 0 ? lo / ranked.length : 0;
  };
  const mixRank = env("RANK", 0.7);
  for (let k = 0; k < w * h; k++) {
    s[k] = detail[k] * (1 - mixRank) + rank(detail[k]) * mixRank;
  }
  return { name, w, h, a, s };
}

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let n = 0;
      for (let d = -r; d <= r; d++) {
        const xx = x + d;
        if (xx < 0 || xx >= w) {
          continue;
        }
        sum += src[y * w + xx];
        n++;
      }
      tmp[y * w + x] = sum / n;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let n = 0;
      for (let d = -r; d <= r; d++) {
        const yy = y + d;
        if (yy < 0 || yy >= h) {
          continue;
        }
        sum += tmp[yy * w + x];
        n++;
      }
      out[y * w + x] = sum / n;
    }
  }
  return out;
}

const SPRITES = {
  big: sprite("big", [819, 26, 1536, 610], [0, 0, 110, 40]),
  crown: sprite("crown", [1090, 0, 1430, 300], [70, 0, 60, 90]),
  lobe: sprite("lobe", [1275, 160, 1536, 540], [70, 0, 90, 50]),
  base: sprite("base", [800, 380, 1290, 610], [0, 80, 60, 30]),
  heap: sprite("heap", [0, 490, 320, 790], [80, 0, 70, 30]),
  flat: sprite("flat", [280, 615, 600, 800], [60, 0, 0, 20]),
  left: sprite("left", [0, 493, 572, 815], [90, 0, 0, 30]),
  row: sprite("row", [990, 690, 1400, 875], [0, 0, 50, 30]),
  rowEnd: sprite("rowEnd", [1380, 690, 1536, 820], [50, 0, 70, 20]),
  topLeft: sprite("topLeft", [150, 0, 460, 205], [40, 70, 0, 0]),
  puffs: sprite("puffs", [55, 855, 345, 965], [0, 0, 0, 20]),
  lowMid: sprite("lowMid", [650, 840, 995, 958], [0, 0, 0, 30]),
  wisp1: sprite("wisp1", [425, 220, 650, 330]),
  wisp2: sprite("wisp2", [0, 352, 240, 440], [50, 0, 0, 0]),
  wisp3: sprite("wisp3", [1205, 540, 1360, 615]),
};

if (sheet) {
  const COL = 520;
  const parts = [];
  let top = 0;
  let rowH = 0;
  let col = 0;
  for (const sp of Object.values(SPRITES)) {
    const buf = Buffer.alloc(sp.w * sp.h * 3);
    for (let k = 0; k < sp.w * sp.h; k++) {
      const cloud = [255 - sp.s[k] * 140, 255 - sp.s[k] * 115, 255 - sp.s[k] * 70];
      const sky = [64, 150, 230];
      for (let c = 0; c < 3; c++) {
        buf[k * 3 + c] = Math.round(sky[c] * (1 - sp.a[k]) + cloud[c] * sp.a[k]);
      }
    }
    const scale = Math.min(1, (COL - 10) / sp.w);
    const w = Math.round(sp.w * scale);
    const h = Math.round(sp.h * scale);
    const cutout = await sharp(buf, { raw: { width: sp.w, height: sp.h, channels: 3 } })
      .resize(w, h)
      .png()
      .toBuffer();
    const label = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="18"><text x="2" y="14" font-family="Menlo" font-size="13">${sp.name} ${sp.w}x${sp.h}</text></svg>`,
    );
    parts.push(
      { input: cutout, top: top + 18, left: col * COL },
      { input: label, top, left: col * COL },
    );
    rowH = Math.max(rowH, h + 26);
    if (++col === 2) {
      col = 0;
      top += rowH;
      rowH = 0;
    }
  }
  top += rowH;
  await sharp({ create: { width: COL * 2, height: top, channels: 3, background: "#fff" } })
    .composite(parts)
    .png()
    .toFile(path.join(outDir, "sprites.png"));
  console.log("sheet", top);
  process.exit(0);
}

function place(layer, sp, x, base, scale, { wide = 1, flip = false } = {}) {
  const w = Math.round(sp.w * scale * wide);
  const h = Math.round(sp.h * scale);
  const left = Math.round(x - w / 2);
  const top = Math.round(base - h);
  for (let y = 0; y < h; y++) {
    for (let xx = 0; xx < w; xx++) {
      const sx0 = (xx / w) * sp.w;
      const sx1 = ((xx + 1) / w) * sp.w;
      const sy0 = (y / h) * sp.h;
      const sy1 = ((y + 1) / h) * sp.h;
      let a = 0;
      let as = 0;
      let n = 0;
      for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy++) {
        for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx++) {
          const k = sy * sp.w + (flip ? sp.w - 1 - sx : sx);
          a += sp.a[k];
          as += sp.a[k] * sp.s[k];
          n++;
        }
      }
      a /= n;
      const s = a > 0 ? as / n / a : 0;
      const py = top + y;
      if (py < 0 || py >= H || a <= 0) {
        continue;
      }
      const px = (((left + xx) % PERIOD) + PERIOD) % PERIOD;
      const k = py * PERIOD + px;
      const under = layer.a[k];
      const total = a + under * (1 - a);
      layer.s[k] = total > 0 ? (s * a + layer.s[k] * under * (1 - a)) / total : 0;
      layer.a[k] = total;
    }
  }
}

const layers = {
  near: { a: new Float32Array(PERIOD * H), s: new Float32Array(PERIOD * H) },
  far: { a: new Float32Array(PERIOD * H), s: new Float32Array(PERIOD * H) },
};
const S = SPRITES;
place(layers.near, S.big, 330, 330, 0.42);
place(layers.near, S.wisp1, 760, 95, 0.9, { wide: 1.3 });
place(layers.near, S.flat, 820, 255, 0.6);
place(layers.near, S.row, 1180, 335, 0.62, { flip: true });
place(layers.near, S.crown, 1540, 215, 0.55, { wide: 1.3 });
place(layers.near, S.left, 1960, 320, 0.5, { wide: 1.15 });
place(layers.near, S.wisp2, 2290, 140, 0.75, { wide: 1.4 });
place(layers.near, S.heap, 160, 640, 0.42, { wide: 1.35 });
place(layers.near, S.lowMid, 1000, 560, 0.7);
place(layers.near, S.row, 1760, 660, 0.5);
place(layers.far, S.topLeft, 110, 115, 0.3);
place(layers.far, S.puffs, 540, 175, 0.42, { wide: 1.2 });
place(layers.far, S.rowEnd, 900, 80, 0.45);
place(layers.far, S.base, 1270, 150, 0.32, { flip: true });
place(layers.far, S.lowMid, 1660, 60, 0.36, { flip: true, wide: 0.85 });
place(layers.far, S.heap, 2010, 160, 0.26, { flip: true, wide: 1.35 });
place(layers.far, S.wisp3, 2310, 105, 0.7, { wide: 1.5 });
place(layers.far, S.flat, 620, 470, 0.36, { flip: true });
place(layers.far, S.puffs, 1500, 520, 0.45, { flip: true });
place(layers.far, S.rowEnd, 2200, 430, 0.5, { flip: true });

const LW = PERIOD / 2;
const LH = H / 2;
for (const [name, layer] of Object.entries(layers)) {
  const out = Buffer.alloc(LW * LH * 3);
  const half = new Float32Array(LW * LH);
  for (let j = 0; j < LH; j++) {
    for (let i = 0; i < LW; i++) {
      let a = 0;
      let as = 0;
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]) {
        const k = (j * 2 + dy) * PERIOD + i * 2 + dx;
        a += layer.a[k];
        as += layer.a[k] * layer.s[k];
      }
      a /= 4;
      const s = a > 0 ? as / 4 / a : 0;
      const ac = smooth(0.04, 1, a);
      half[j * LW + i] = ac;
      const o = (j * LW + i) * 3;
      const q = (v) => Math.min(255, Math.round(v * 63) * 4.05) | 0;
      out[o] = ac > 0 ? q(s) : 0;
      out[o + 1] = q(ac);
    }
  }
  await sharp(out, { raw: { width: LW, height: LH, channels: 3 } })
    .png()
    .toFile(path.join(outDir, `clouds-${name}.png`));
  const view = Buffer.alloc(LW * LH * 3);
  for (let k = 0; k < LW * LH; k++) {
    const a = out[k * 3 + 1] / 255;
    const s = out[k * 3] / 255;
    const cloud = [255 - s * 140, 255 - s * 115, 255 - s * 70];
    const sky = [64, 150, 230];
    for (let c = 0; c < 3; c++) {
      view[k * 3 + c] = Math.round(sky[c] * (1 - a) + cloud[c] * a);
    }
  }
  await sharp(view, { raw: { width: LW, height: LH, channels: 3 } })
    .png()
    .toFile(path.join(outDir, `clouds-${name}-view.png`));
}
console.log("layers written");
