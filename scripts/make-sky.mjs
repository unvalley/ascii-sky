import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { fromOklab, oklab, SKY_RAMP, smooth } from "../src/cells.ts";

const ASSETS = fileURLToPath(new URL("../assets/", import.meta.url));
const INDEX = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const SKY_BLOCK = /export const sky = \{[^}]*\};/u;
const WIDTH = 2400;
const HEIGHT = 700;
const CW = 6;
const CH = 9.75;

const raw = (pixels, width, height, channels = 3) =>
  sharp(pixels, { raw: { width, height, channels } });

async function band(painting) {
  const full = 1920;
  const overlap = 320;
  const p = full - overlap;
  const rows = Math.round(HEIGHT / (full / 1536));
  const img = await sharp(painting)
    .extract({ left: 0, top: 0, width: 1536, height: rows })
    .resize(full, HEIGHT, { kernel: "lanczos3" })
    .removeAlpha()
    .raw()
    .toBuffer();
  const tile = Buffer.alloc(p * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < p; x++) {
      const o = (y * p + x) * 3;
      if (x >= overlap) {
        img.copy(tile, o, (y * full + x) * 3, (y * full + x) * 3 + 3);
        continue;
      }
      const t = smooth(0, 1, x / overlap);
      for (let c = 0; c < 3; c++) {
        tile[o + c] = Math.round(
          img[(y * full + x + p) * 3 + c] * (1 - t) + img[(y * full + x) * 3 + c] * t,
        );
      }
    }
  }
  return { img: tile, width: p, height: HEIGHT };
}

function clearSky({ img, width: P, height: H }) {
  const lum = (i) =>
    (0.2126 * img[i * 3] + 0.7152 * img[i * 3 + 1] + 0.0722 * img[i * 3 + 2]) / 255;
  const chroma = (i) =>
    (Math.max(img[i * 3], img[i * 3 + 1], img[i * 3 + 2]) -
      Math.min(img[i * 3], img[i * 3 + 1], img[i * 3 + 2])) /
    255;
  const alpha = new Float32Array(P * H);
  for (let i = 0; i < P * H; i++) {
    alpha[i] = smooth(0.62, 0.8, lum(i)) * (1 - smooth(0.2, 0.42, chroma(i)));
  }
  const blurX = (src, r) => {
    const out = new Float32Array(P * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < P; x++) {
        let s = 0;
        for (let d = -r; d <= r; d++) {
          s += src[y * P + ((x + d + P) % P)];
        }
        out[y * P + x] = s / (2 * r + 1);
      }
    }
    return out;
  };
  const blurY = (src, r) => {
    const out = new Float32Array(P * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < P; x++) {
        let s = 0;
        let n = 0;
        for (let d = -r; d <= r; d++) {
          const yy = y + d;
          if (yy < 0 || yy >= H) {
            continue;
          }
          s += src[yy * P + x];
          n++;
        }
        out[y * P + x] = s / n;
      }
    }
    return out;
  };
  const softAlpha = blurY(blurX(alpha, 2), 2);
  const cloudy = new Float32Array(P * H);
  for (let i = 0; i < P * H; i++) {
    cloudy[i] = smooth(0.02, 0.2, softAlpha[i]);
  }
  const hole = blurY(
    blurX(
      cloudy.map((v) => (v > 0.02 ? 1 : 0)),
      6,
    ),
    6,
  ).map((v) => Math.min(1, v * 2.5));
  function pushPull(values, weights, w, h) {
    if (w <= 2 || h <= 2) {
      return values;
    }
    const w2 = Math.ceil(w / 2);
    const h2 = Math.ceil(h / 2);
    const v2 = new Float32Array(w2 * h2 * 3);
    const k2 = new Float32Array(w2 * h2);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const j = (y >> 1) * w2 + (x >> 1);
        const k = weights[i];
        k2[j] += k;
        for (let c = 0; c < 3; c++) {
          v2[j * 3 + c] += values[i * 3 + c] * k;
        }
      }
    }
    for (let j = 0; j < w2 * h2; j++) {
      if (k2[j] > 0) {
        for (let c = 0; c < 3; c++) {
          v2[j * 3 + c] /= k2[j];
        }
      }
    }
    const coarse = pushPull(
      v2,
      k2.map((v) => Math.min(1, v)),
      w2,
      h2,
    );
    const out = new Float32Array(w * h * 3);
    const at = (xx, yy, c) =>
      coarse[(Math.min(h2 - 1, Math.max(0, yy)) * w2 + Math.min(w2 - 1, Math.max(0, xx))) * 3 + c];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const k = Math.min(1, weights[i]);
        const fx = (x + 0.5) / 2 - 0.5;
        const fy = (y + 0.5) / 2 - 0.5;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const u = fx - x0;
        const v = fy - y0;
        for (let c = 0; c < 3; c++) {
          const up =
            (at(x0, y0, c) * (1 - u) + at(x0 + 1, y0, c) * u) * (1 - v) +
            (at(x0, y0 + 1, c) * (1 - u) + at(x0 + 1, y0 + 1, c) * u) * v;
          out[i * 3 + c] = values[i * 3 + c] * k + up * (1 - k);
        }
      }
    }
    return out;
  }
  const P3 = P * 3;
  const vals = new Float32Array(P3 * H * 3);
  const wts = new Float32Array(P3 * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < P3; x++) {
      const i = y * P3 + x;
      const j = y * P + (x % P);
      wts[i] = hole[j] > 0.01 ? 0 : 1;
      for (let c = 0; c < 3; c++) {
        vals[i * 3 + c] = img[j * 3 + c];
      }
    }
  }
  const filled3 = pushPull(vals, wts, P3, H);
  const base = new Float32Array(P * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < P; x++) {
      for (let c = 0; c < 3; c++) {
        base[(y * P + x) * 3 + c] = filled3[(y * P3 + x + P) * 3 + c];
      }
    }
  }
  const blurred = [0, 1, 2].map((c) => {
    const channel = new Float32Array(P * H);
    for (let i = 0; i < P * H; i++) {
      channel[i] = img[i * 3 + c];
    }
    return blurY(blurX(channel, 5), 5);
  });
  const donors = [523, 811, 1129, 277];
  const sky = Buffer.alloc(P * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < P; x++) {
      const i = y * P + x;
      const h = hole[i];
      let donor = -1;
      for (const d of donors) {
        const j = y * P + ((x + d) % P);
        if (hole[j] < 0.05) {
          donor = j;
          break;
        }
      }
      for (let c = 0; c < 3; c++) {
        const detail = donor >= 0 ? img[donor * 3 + c] - blurred[c][donor] : 0;
        const filled = base[i * 3 + c] + detail;
        sky[i * 3 + c] = Math.round(
          Math.min(255, Math.max(0, img[i * 3 + c] * (1 - h) + filled * h)),
        );
      }
    }
  }
  const wide = Buffer.alloc(WIDTH * H * 3);
  const shift = (((P - (WIDTH - P) / 2) % P) + P) % P;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const from = (y * P + ((x + shift) % P)) * 3;
      sky.copy(wide, (y * WIDTH + x) * 3, from, from + 3);
    }
  }
  return wide;
}

const turn = (a, b, degrees) => {
  const t = (degrees * Math.PI) / 180;
  return [a * Math.cos(t) - b * Math.sin(t), a * Math.sin(t) + b * Math.cos(t)];
};

function toNight(pixels, columns, rows, text) {
  const light = 0.41;
  const dense = 0.29;
  text.split("\n").forEach((line, r) => {
    if (r >= rows) {
      return;
    }
    for (let c = 0; c < columns; c++) {
      const i = (r * columns + c) * 3;
      const d = Math.max(0, SKY_RAMP.indexOf(line[c] ?? ".")) / (SKY_RAMP.length - 1);
      const [, a0, b0] = oklab(pixels[i], pixels[i + 1], pixels[i + 2]);
      const [a, b] = turn(a0, b0, 14);
      pixels.set(fromOklab(light + (dense - light) * d, a * 0.75, b * 0.75), i);
    }
  });
}

async function convert(clear) {
  const sx = 4;
  const sy = 6;
  const columns = WIDTH / CW;
  const rows = Math.floor(HEIGHT / CH);
  const sw = columns * sx;
  const sh = rows * sy;
  const data = await raw(clear, WIDTH, HEIGHT)
    .extract({ left: 0, top: 0, width: WIDTH, height: Math.floor(rows * CH) })
    .resize(sw, sh, { fit: "fill", kernel: "lanczos3" })
    .removeAlpha()
    .raw()
    .toBuffer();
  const px = (x, y) => {
    const i = (Math.min(sh - 1, Math.max(0, y)) * sw + Math.min(sw - 1, Math.max(0, x))) * 3;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const chromaOf = (c) => Math.max(...c) - Math.min(...c);

  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      let n = 0;
      const sum = [0, 0, 0];
      for (let y = 0; y < sy; y++) {
        for (let x = 0; x < sx; x++) {
          const p = px(c * sx + x, r * sy + y);
          if (lum(p) < 0.9 || chromaOf(p) >= 40) {
            n++;
            sum[0] += p[0];
            sum[1] += p[1];
            sum[2] += p[2];
          }
        }
      }
      const coverage = n / (sx * sy);
      if (coverage < 0.2) {
        cells.push(null);
        continue;
      }
      const mean = sum.map((v) => v / n);
      cells.push({ r, c, coverage, mean, part: chromaOf(mean) < 70 ? "shade" : "sky" });
    }
  }

  const live = cells.filter(Boolean);
  const reachX = 5;
  const reachY = 3;
  for (const cell of live) {
    let s = 0;
    let w = 0;
    for (let dr = -reachY; dr <= reachY; dr++) {
      for (let dc = -reachX; dc <= reachX; dc++) {
        const o = cells[(cell.r + dr) * columns + cell.c + dc];
        if (
          !o ||
          o.part !== cell.part ||
          cell.r + dr < 0 ||
          cell.r + dr >= rows ||
          cell.c + dc < 0 ||
          cell.c + dc >= columns
        ) {
          continue;
        }
        const k = Math.exp(
          -(dr * dr) / (2 * (reachY / 2) ** 2) - (dc * dc) / (2 * (reachX / 2) ** 2),
        );
        s += k * lum(o.mean);
        w += k;
      }
    }
    const around = w ? s / w : lum(cell.mean);
    cell.dark = around - lum(cell.mean) + (1 - around) * 0.15;
  }
  for (const [part, most] of [
    ["sky", 7],
    ["shade", 5],
  ]) {
    const group = live.filter((c) => c.part === part);
    const darks = group.map((c) => c.dark).sort((a, b) => a - b);
    const q = (p) => darks[Math.floor(p * (darks.length - 1))];
    const d0 = q(0.04);
    const d1 = q(0.97);
    for (const cell of group) {
      const t = Math.max(0, Math.min(1, (cell.dark - d0) / (d1 - d0 || 1)));
      cell.shadow = Math.max(0, Math.min(1, (1 - lum(cell.mean) - 0.06) / 0.3));
      const i = Math.round(t * most);
      cell.glyph = SKY_RAMP[cell.coverage < 0.45 ? Math.min(i, 1) : i];
    }
  }

  const Sky = {
    light: { hue: -13, chroma: 0.9, lightness: (L) => Math.min(L, 0.73) },
    dark: { hue: -8, chroma: 1.05, lightness: (L) => Math.max(L, 0.66) },
  };
  const Cloud = {
    light: ["#c3d2e8", "#9db3d6", "#7690c2", "#5a76ae"],
    dark: ["#ffffff", "#e6eefa", "#c2d1ea", "#93a8cf"],
  };
  const Page = { light: [250, 250, 250], dark: [23, 23, 23] };
  const hexRgb = (h) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
  const colourOf = (cell, mode) => {
    if (!cell) {
      return Page[mode];
    }
    if (cell.part === "sky") {
      const [L, a0, b0] = oklab(...cell.mean);
      const { hue, chroma, lightness } = Sky[mode];
      const [a, b] = turn(a0, b0, hue);
      return fromOklab(lightness(L), a * chroma, b * chroma);
    }
    const stops = Cloud[mode];
    const p = Math.min(stops.length - 1.0001, Math.max(0, cell.shadow * (stops.length - 1)));
    const i = Math.floor(p);
    const a = hexRgb(stops[i]);
    const b = hexRgb(stops[i + 1]);
    return a.map((v, k) => v + (b[k] - v) * (p - i));
  };

  const maps = { light: Buffer.alloc(columns * rows * 3), dark: Buffer.alloc(columns * rows * 3) };
  const lines = [];
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < columns; c++) {
      const cell = cells[r * columns + c];
      line += cell ? cell.glyph : " ";
      for (const mode of ["light", "dark"]) {
        const colour = colourOf(cell, mode);
        for (let k = 0; k < 3; k++) {
          maps[mode][(r * columns + c) * 3 + k] = Math.round(colour[k]);
        }
      }
    }
    lines.push(line.trimEnd());
  }
  const text = lines.join("\n");
  toNight(maps.dark, columns, rows, text);
  return { text, columns, rows, maps };
}

async function cutClouds(painting) {
  const { data: img, info } = await sharp(painting)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const Iw = info.width;
  const alpha = new Float32Array(Iw * info.height);
  const shade = new Float32Array(Iw * info.height);
  for (let i = 0; i < alpha.length; i++) {
    const r = img[i * 3] / 255;
    const g = img[i * 3 + 1] / 255;
    const b = img[i * 3 + 2] / 255;
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const ch = Math.max(r, g, b) - Math.min(r, g, b);
    alpha[i] = smooth(0.62, 0.82, L) * (1 - smooth(0.2, 0.42, ch));
    shade[i] = Math.min(1, Math.max(0, (0.96 - L) / 0.26));
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

  function wave(t, seed) {
    const u = t / 38;
    const i = Math.floor(u);
    const r = (k) => {
      let h = Math.imul(k + seed * 7919, 2_654_435_761) >>> 0;
      h = Math.imul(h ^ (h >>> 15), 2_246_822_519) >>> 0;
      return ((h ^ (h >>> 13)) >>> 0) / 4_294_967_296;
    };
    const f = u - i;
    return r(i) + (r(i + 1) - r(i)) * f * f * (3 - 2 * f);
  }

  function sprite(name, [x0, y0, x1, y1], fade = [0, 0, 0, 0]) {
    const w = x1 - x0;
    const h = y1 - y0;
    const a = new Float32Array(w * h);
    const s = new Float32Array(w * h);
    const seed = x0 * 31 + y0;
    const reach = (side, t) => fade[side] * (0.35 + 1.3 * wave(t, seed + side));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y0 + y) * Iw + x0 + x;
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
        const k = y * w + x;
        a[k] = alpha[i] * f;
        s[k] = shade[i];
      }
    }
    const soft = boxBlur(boxBlur(a, w, h, 10), w, h, 5);
    for (let k = 0; k < w * h; k++) {
      a[k] = Math.max(a[k] * 0.7, smooth(0.28, 0.55, soft[k]));
    }
    const blur = boxBlur(s, w, h, 5);
    const detail = new Float32Array(w * h);
    for (let k = 0; k < w * h; k++) {
      detail[k] = Math.min(1, Math.max(0, blur[k] + 1.8 * (s[k] - blur[k])));
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
    const mix = 0.7;
    for (let k = 0; k < w * h; k++) {
      s[k] = detail[k] * (1 - mix) + rank(detail[k]) * mix;
    }
    return { name, w, h, a, s };
  }

  return {
    big: sprite("big", [819, 26, 1536, 610], [0, 0, 110, 40]),
    crown: sprite("crown", [1090, 0, 1430, 300], [70, 0, 60, 90]),
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
}

const cloudColour = (a, s) => {
  const cloud = [255 - s * 140, 255 - s * 115, 255 - s * 70];
  return [64, 150, 230].map((sky, c) => Math.round(sky * (1 - a) + cloud[c] * a));
};

async function writeSheet(cutOuts, file) {
  const column = 520;
  const parts = [];
  let top = 0;
  let rowH = 0;
  let col = 0;
  for (const sp of Object.values(cutOuts)) {
    const buf = Buffer.alloc(sp.w * sp.h * 3);
    for (let k = 0; k < sp.w * sp.h; k++) {
      buf.set(cloudColour(sp.a[k], sp.s[k]), k * 3);
    }
    const scale = Math.min(1, (column - 10) / sp.w);
    const w = Math.round(sp.w * scale);
    const h = Math.round(sp.h * scale);
    const cutout = await raw(buf, sp.w, sp.h).resize(w, h).png().toBuffer();
    const label = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="18"><text x="2" y="14" font-family="Menlo" font-size="13">${sp.name} ${sp.w}x${sp.h}</text></svg>`,
    );
    parts.push(
      { input: cutout, top: top + 18, left: col * column },
      { input: label, top, left: col * column },
    );
    rowH = Math.max(rowH, h + 26);
    col++;
    if (col === 2) {
      col = 0;
      top += rowH;
      rowH = 0;
    }
  }
  top += rowH;
  await sharp({ create: { width: column * 2, height: top, channels: 3, background: "#fff" } })
    .composite(parts)
    .png()
    .toFile(file);
}

function placeClouds(S) {
  const layers = {
    near: { a: new Float32Array(WIDTH * HEIGHT), s: new Float32Array(WIDTH * HEIGHT) },
    far: { a: new Float32Array(WIDTH * HEIGHT), s: new Float32Array(WIDTH * HEIGHT) },
  };
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
        if (py < 0 || py >= HEIGHT || a <= 0) {
          continue;
        }
        const k = py * WIDTH + ((((left + xx) % WIDTH) + WIDTH) % WIDTH);
        const under = layer.a[k];
        const total = a + under * (1 - a);
        layer.s[k] = total > 0 ? (s * a + layer.s[k] * under * (1 - a)) / total : 0;
        layer.a[k] = total;
      }
    }
  }
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

  const lw = WIDTH / 2;
  const lh = HEIGHT / 2;
  const q = (v) => Math.min(255, Math.round(v * 63) * 4.05) | 0;
  const halve = (layer) => {
    const out = Buffer.alloc(lw * lh * 3);
    for (let j = 0; j < lh; j++) {
      for (let i = 0; i < lw; i++) {
        let a = 0;
        let as = 0;
        for (const [dx, dy] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ]) {
          const k = (j * 2 + dy) * WIDTH + i * 2 + dx;
          a += layer.a[k];
          as += layer.a[k] * layer.s[k];
        }
        a /= 4;
        const s = a > 0 ? as / 4 / a : 0;
        const ac = smooth(0.04, 1, a);
        const o = (j * lw + i) * 3;
        out[o] = ac > 0 ? q(s) : 0;
        out[o + 1] = q(ac);
      }
    }
    return out;
  };
  return { width: lw, height: lh, near: halve(layers.near), far: halve(layers.far) };
}

const [input, sheet] = process.argv.slice(2);
if (!input) {
  console.error("usage: node scripts/make-sky.mjs sky.png [sprites.png]");
  process.exit(1);
}
const sprites = await cutClouds(input);
if (sheet) {
  await writeSheet(sprites, sheet);
  console.log(`cut-outs in ${sheet}`);
  process.exit(0);
}
const still = await convert(clearSky(await band(input)));
const clouds = placeClouds(sprites);

writeFileSync(`${ASSETS}sky.txt`, still.text);
for (const mode of ["light", "dark"]) {
  await raw(still.maps[mode], still.columns, still.rows)
    .webp({ quality: 90, smartSubsample: true })
    .toFile(`${ASSETS}sky-${mode}.webp`);
}
for (const layer of ["near", "far"]) {
  await raw(clouds[layer], clouds.width, clouds.height)
    .webp({ lossless: true, effort: 6 })
    .toFile(`${ASSETS}clouds-${layer}.webp`);
}
const hash = createHash("sha256");
for (const file of [
  "sky.txt",
  "sky-light.webp",
  "sky-dark.webp",
  "clouds-near.webp",
  "clouds-far.webp",
]) {
  hash.update(readFileSync(`${ASSETS}${file}`));
}
const version = hash.digest("hex").slice(0, 10);
const block = `export const sky = {
  columns: ${still.columns},
  rows: ${still.rows},
  cellWidth: ${CW},
  cellHeight: ${CH},
  version: "${version}",
};`;
writeFileSync(INDEX, readFileSync(INDEX, "utf8").replace(SKY_BLOCK, block));
console.log(`assets/ and src/index.ts written, version ${version}`);
