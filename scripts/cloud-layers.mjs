import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const sharp = require("sharp");
const [input, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const env = (k, d) => Number(process.env[k] ?? d);

const { data: img, info } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const P = info.width;
const H = info.height;
const smooth = (a, b, t) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};
const lum = (i) => (0.2126 * img[i * 3] + 0.7152 * img[i * 3 + 1] + 0.0722 * img[i * 3 + 2]) / 255;
const chroma = (i) => (Math.max(img[i * 3], img[i * 3 + 1], img[i * 3 + 2]) - Math.min(img[i * 3], img[i * 3 + 1], img[i * 3 + 2])) / 255;

const alpha = new Float32Array(P * H);
const shade = new Float32Array(P * H);
for (let i = 0; i < P * H; i++) {
  const L = lum(i);
  const ch = chroma(i);
  alpha[i] = smooth(env("A_LO", 0.62), env("A_HI", 0.8), L) * (1 - smooth(env("C_LO", 0.2), env("C_HI", 0.42), ch));
  shade[i] = Math.min(1, Math.max(0, (0.97 - L) / 0.3));
}
const blurX = (src, r) => {
  const out = new Float32Array(P * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < P; x++) {
      let s = 0;
      for (let d = -r; d <= r; d++) s += src[y * P + ((x + d + P) % P)];
      out[y * P + x] = s / (2 * r + 1);
    }
  return out;
};
const blurY = (src, r) => {
  const out = new Float32Array(P * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < P; x++) {
      let s = 0;
      let n = 0;
      for (let d = -r; d <= r; d++) {
        const yy = y + d;
        if (yy < 0 || yy >= H) continue;
        s += src[yy * P + x];
        n++;
      }
      out[y * P + x] = s / n;
    }
  return out;
};
const softAlpha = blurY(blurX(alpha, 2), 2);

const HW = P / 2;
const HH = Math.round(H / 2);
const layer = Buffer.alloc(HW * HH * 4);
for (let y = 0; y < HH; y++)
  for (let x = 0; x < HW; x++) {
    let a = 0;
    let s = 0;
    let w = 0;
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) {
        const yy = Math.min(H - 1, y * 2 + dy);
        const i = yy * P + x * 2 + dx;
        a += softAlpha[i];
        s += shade[i] * softAlpha[i];
        w += softAlpha[i];
      }
    const o = (y * HW + x) * 4;
    layer[o] = Math.round((w > 0 ? s / w : 0) * 255);
    layer[o + 1] = 0;
    layer[o + 2] = 0;
    layer[o + 3] = Math.round((a / 4) * 255);
  }
await sharp(layer, { raw: { width: HW, height: HH, channels: 4 } }).png().toFile(path.join(outDir, "clouds.png"));

const raw = new Float32Array(P * H);
for (let i = 0; i < P * H; i++) raw[i] = smooth(0.02, 0.2, softAlpha[i]);
const hole = blurY(blurX(raw.map((v) => (v > 0.02 ? 1 : 0)), 6), 6).map((v) => Math.min(1, v * 2.5));
function pushPull(values, weights, w, h) {
  if (w <= 2 || h <= 2) return values;
  const w2 = Math.ceil(w / 2);
  const h2 = Math.ceil(h / 2);
  const v2 = new Float32Array(w2 * h2 * 3);
  const k2 = new Float32Array(w2 * h2);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const j = (y >> 1) * w2 + (x >> 1);
      const k = weights[i];
      k2[j] += k;
      for (let c = 0; c < 3; c++) v2[j * 3 + c] += values[i * 3 + c] * k;
    }
  for (let j = 0; j < w2 * h2; j++) if (k2[j] > 0) for (let c = 0; c < 3; c++) v2[j * 3 + c] /= k2[j];
  const kk = k2.map((v) => Math.min(1, v));
  const coarse = pushPull(v2, kk, w2, h2);
  const out = new Float32Array(w * h * 3);
  const at = (xx, yy, c) => coarse[(Math.min(h2 - 1, Math.max(0, yy)) * w2 + Math.min(w2 - 1, Math.max(0, xx))) * 3 + c];
  for (let y = 0; y < h; y++)
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
        const up = (at(x0, y0, c) * (1 - u) + at(x0 + 1, y0, c) * u) * (1 - v) + (at(x0, y0 + 1, c) * (1 - u) + at(x0 + 1, y0 + 1, c) * u) * v;
        out[i * 3 + c] = values[i * 3 + c] * k + up * (1 - k);
      }
    }
  return out;
}
const P3 = P * 3;
const vals = new Float32Array(P3 * H * 3);
const wts = new Float32Array(P3 * H);
for (let y = 0; y < H; y++)
  for (let x = 0; x < P3; x++) {
    const i = y * P3 + x;
    const j = y * P + (x % P);
    wts[i] = hole[j] > 0.01 ? 0 : 1;
    for (let c = 0; c < 3; c++) vals[i * 3 + c] = img[j * 3 + c];
  }
const filled3 = pushPull(vals, wts, P3, H);
const base = new Float32Array(P * H * 3);
for (let y = 0; y < H; y++)
  for (let x = 0; x < P; x++) for (let c = 0; c < 3; c++) base[(y * P + x) * 3 + c] = filled3[(y * P3 + x + P) * 3 + c];
const blurC = (c, r) => {
  const ch = new Float32Array(P * H);
  for (let i = 0; i < P * H; i++) ch[i] = img[i * 3 + c];
  return blurY(blurX(ch, r), r);
};
const blurred = [0, 1, 2].map((c) => blurC(c, 5));
const DONORS = [523, 811, 1129, 277];
const sky = Buffer.alloc(P * H * 3);
for (let y = 0; y < H; y++)
  for (let x = 0; x < P; x++) {
    const i = y * P + x;
    const h = hole[i];
    let donor = -1;
    for (const d of DONORS) {
      const j = y * P + ((x + d) % P);
      if (hole[j] < 0.05) {
        donor = j;
        break;
      }
    }
    for (let c = 0; c < 3; c++) {
      const detail = donor >= 0 ? img[donor * 3 + c] - blurred[c][donor] : 0;
      const filled = base[i * 3 + c] + detail;
      sky[i * 3 + c] = Math.round(Math.min(255, Math.max(0, img[i * 3 + c] * (1 - h) + filled * h)));
    }
  }
const W = 2400;
const wide = Buffer.alloc(W * H * 3);
const shift = ((P - ((W - P) / 2)) % P + P) % P;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) sky.copy(wide, (y * W + x) * 3, (y * P + ((x + shift) % P)) * 3, (y * P + ((x + shift) % P)) * 3 + 3);
await sharp(wide, { raw: { width: W, height: H, channels: 3 } }).png().toFile(path.join(outDir, "sky-still.png"));
await sharp(wide, { raw: { width: W, height: H, channels: 3 } }).resize(1600).png().toFile(path.join(outDir, "sky-still-preview.png"));
await sharp(layer, { raw: { width: HW, height: HH, channels: 4 } }).extractChannel(3).resize(1600).png().toFile(path.join(outDir, "clouds-alpha-preview.png"));
console.log(`clouds ${HW}x${HH} (period ${P}), still sky ${W}x${H}, shift ${shift}`);
