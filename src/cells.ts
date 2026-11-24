import { hash } from "./hash.ts";
import { wrap } from "./wrap.ts";

export const SKY_RAMP = ".:+*ox%#@";
export const GLYPHS = [...new Set([...SKY_RAMP, ..."-_'`,;~()8|/\\"])];
const EDGE = [...".,'`-_~():;"].map((g) => GLYPHS.indexOf(g));
const COSTLY = [..."~()"].map((g) => GLYPHS.indexOf(g));
const EDGE_COST = EDGE.map((g) => (COSTLY.includes(g) ? 0.06 : 0));

export const REGIONS = [
  [0.27, 0.2],
  [0.73, 0.2],
  [0.27, 0.5],
  [0.73, 0.5],
  [0.27, 0.8],
  [0.73, 0.8],
] as const;
export const REGION_RADIUS = 0.24;
const REACH = 6;
const KEEP_SHADE = 0.8;
const KEEP_SHAPE = 0.1;

const toByte = (x: number) => {
  if (x < 0) {
    return 0;
  }
  if (x > 255) {
    return 255;
  }
  return x | 0;
};

export function measureGlyph(
  alpha: ArrayLike<number>,
  w: number,
  h: number,
  stride: number,
  offset: number,
) {
  const out = new Float32Array(6);
  const radius = REGION_RADIUS * w;
  for (let k = 0; k < 6; k++) {
    const cx = REGIONS[k][0] * w;
    const cy = REGIONS[k][1] * h;
    let sum = 0;
    let n = 0;
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
      for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > radius * radius) {
          continue;
        }
        n++;
        if (x >= 0 && y >= 0 && x < w && y < h) {
          sum += alpha[(y * w + x) * stride + offset] / 255;
        }
      }
    }
    out[k] = n ? sum / n : 0;
  }
  return out;
}

export function normaliseShapes(measured: Float32Array[]) {
  const shapes = new Float32Array(GLYPHS.length * 6);
  const most = new Float32Array(6);
  for (const m of measured) {
    for (let k = 0; k < 6; k++) {
      most[k] = Math.max(most[k], m[k]);
    }
  }
  measured.forEach((m, g) => {
    for (let k = 0; k < 6; k++) {
      shapes[g * 6 + k] = most[k] ? m[k] / most[k] : 0;
    }
  });
  return shapes;
}

export type CloudLayer = {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
};

type Rgb = readonly [number, number, number];
export type SkyTheme = "light" | "dark" | "vice";
export type Theme = {
  inside: string;
  tile: readonly Rgb[];
  glyph: readonly Rgb[];
  edge: readonly Rgb[];
  wash: readonly [number, number];
  smallest: number;
  clouds: boolean;
  far: boolean;
};

const smooth = (a: number, b: number, t: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};
const hex = (h: string): Rgb => [
  Number.parseInt(h.slice(1, 3), 16),
  Number.parseInt(h.slice(3, 5), 16),
  Number.parseInt(h.slice(5, 7), 16),
];
const palette = (...colours: string[]) => colours.map(hex);

export const THEMES: Record<SkyTheme, Theme> = {
  light: {
    inside: " .:;o8%@",
    tile: palette("#ffffff", "#f5f8fc", "#ebf1f8", "#dfe8f2"),
    glyph: palette("#b8cee0", "#a0bbd3", "#8aa8c6", "#7496b9"),
    edge: palette("#b8cee0", "#a0bbd3", "#8aa8c6", "#7496b9"),
    wash: [0.2, 0.5],
    smallest: 0,
    clouds: true,
    far: true,
  },
  dark: {
    inside: " .:;o8%#@",
    tile: palette("#ffffff", "#e6edf8", "#bccbe4", "#8a9fc6"),
    glyph: palette("#c6d4ea", "#aebfdc", "#8ea3c8", "#6d83ad"),
    edge: palette("#ffffff", "#e6edf8", "#bccbe4", "#8a9fc6"),
    wash: [0.18, 0.42],
    smallest: 0,
    clouds: false,
    far: false,
  },
  vice: {
    inside: " .:;o8%@",
    tile: palette("#ffeedd", "#ffd8c8", "#f9bfd2", "#e3a6d6"),
    glyph: palette("#ff9a68", "#f87a96", "#d064b0", "#985cc4"),
    edge: palette("#ff9a68", "#f87a96", "#d064b0", "#985cc4"),
    wash: [0.3, 0.6],
    smallest: 6000,
    clouds: true,
    far: false,
  },
};

export function bigClouds(layer: CloudLayer, smallest: number): CloudLayer {
  const { pixels, width: w, height: h } = layer;
  const out = new Uint8ClampedArray(pixels);
  if (smallest <= 0) {
    return { pixels: out, width: w, height: h };
  }
  const least = smallest / 4;
  const seen = new Uint8Array(w * h);
  const cloud = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || pixels[start * 4 + 1] === 0) {
      continue;
    }
    let size = 0;
    let todo = 0;
    cloud[todo++] = start;
    seen[start] = 1;
    while (size < todo) {
      const i = cloud[size++];
      const x = i % w;
      const y = (i - x) / w;
      const next = [
        y * w + (x + 1 === w ? 0 : x + 1),
        y * w + (x === 0 ? w - 1 : x - 1),
        y > 0 ? i - w : -1,
        y + 1 < h ? i + w : -1,
      ];
      for (const j of next) {
        if (j >= 0 && !seen[j] && pixels[j * 4 + 1] > 0) {
          seen[j] = 1;
          cloud[todo++] = j;
        }
      }
    }
    if (size < least) {
      for (let k = 0; k < size; k++) {
        out[cloud[k] * 4] = 0;
        out[cloud[k] * 4 + 1] = 0;
      }
    }
  }
  return { pixels: out, width: w, height: h };
}

const EDGE_INK = 0.7;

export const WIND = { near: 18, far: 8 };
const GUSTS = [
  [0.45, 23, 0],
  [0.25, 8.7, 1.1],
] as const;
export function drift(seconds: number, mean: number, lag = 0) {
  let d = seconds;
  for (const [share, period, phase] of GUSTS) {
    const w = (2 * Math.PI) / period;
    d += (share / w) * (Math.sin(w * (seconds - lag) + phase) - Math.sin(phase));
  }
  return d * mean;
}

const BILLOW = { across: 240, down: 120, x: 28, y: 12, drift: [14, -3] };
const CURL = { across: 90, down: 30, x: 8, y: 5, drift: [-16, 4] };
const FRAY = 0.55;
const SHADE_SHIFT = 0.14;
const FAR_SCALE = 0.6;

const NOISE_SIZE = 128;
const NOISE_CELL = 16;
function makeNoise() {
  const lattice = NOISE_SIZE / NOISE_CELL;
  let seed = 7;
  const rand = () => {
    seed = (seed + 0x6d_2b_79_f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const out = new Float32Array(NOISE_SIZE * NOISE_SIZE * 4);
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const lo = new Int32Array(NOISE_SIZE);
  const hi = new Int32Array(NOISE_SIZE);
  const along = new Float64Array(NOISE_SIZE);
  for (const [n, weight] of [
    [lattice, 1],
    [lattice * 2, 0.5],
  ]) {
    const values = new Float64Array(n * n * 4);
    for (let i = 0; i < values.length; i++) {
      values[i] = rand() * 2 - 1;
    }
    const step = NOISE_SIZE / n;
    for (let x = 0; x < NOISE_SIZE; x++) {
      const g = x / step;
      lo[x] = Math.floor(g);
      hi[x] = (lo[x] + 1) % n;
      along[x] = fade(g - lo[x]);
    }
    for (let y = 0; y < NOISE_SIZE; y++) {
      const top = lo[y] * n;
      const bottom = hi[y] * n;
      const v = along[y];
      for (let x = 0; x < NOISE_SIZE; x++) {
        const u = along[x];
        const ia = (top + lo[x]) * 4;
        const ib = (top + hi[x]) * 4;
        const ic = (bottom + lo[x]) * 4;
        const id = (bottom + hi[x]) * 4;
        const o = (y * NOISE_SIZE + x) * 4;
        for (let k = 0; k < 4; k++) {
          const a = values[ia + k];
          const b = values[ib + k];
          const c = values[ic + k];
          const d = values[id + k];
          out[o + k] += weight * (a + (b - a) * u + (c - a + (d - c - b + a) * u) * v);
        }
      }
    }
  }
  let most = 0;
  for (const v of out) {
    most = Math.max(most, Math.abs(v));
  }
  for (let i = 0; i < out.length; i++) {
    out[i] /= most;
  }
  return out;
}

function slideMost(
  line: Uint8Array,
  n: number,
  r: number,
  fore: Uint8Array,
  back: Uint8Array,
  most: Uint8Array,
  at: number,
) {
  const w = 2 * r + 1;
  for (let b = 0; b < n; b += w) {
    const e = Math.min(b + w, n);
    let m = line[b];
    fore[b] = m;
    for (let p = b + 1; p < e; p++) {
      const v = line[p];
      if (v > m) {
        m = v;
      }
      fore[p] = m;
    }
    m = line[e - 1];
    back[e - 1] = m;
    for (let p = e - 2; p >= b; p--) {
      const v = line[p];
      if (v > m) {
        m = v;
      }
      back[p] = m;
    }
  }
  for (let k = 0, length = n - 2 * r; k < length; k++) {
    const a = back[k];
    const c = fore[k + w - 1];
    most[at + k] = Math.max(a, c);
  }
}

const BAND_BITS = 7;
const BAND = 1 << BAND_BITS;

function reachBand(
  pixels: ArrayLike<number>,
  lw: number,
  lh: number,
  rx: number,
  ry: number,
  x0: number,
  x1: number,
  out: Uint8Array,
) {
  const bw = x1 - x0;
  const across = new Uint8Array(bw * lh);
  {
    const n = bw + 2 * rx;
    const line = new Uint8Array(n);
    const fore = new Uint8Array(n);
    const back = new Uint8Array(n);
    for (let j = 0; j < lh; j++) {
      const row = j * lw;
      for (let p = 0; p < n; p++) {
        let k = x0 + p - rx;
        if (k < 0 || k >= lw) {
          k = ((k % lw) + lw) % lw;
        }
        line[p] = pixels[(row + k) * 4 + 1];
      }
      slideMost(line, n, rx, fore, back, across, j * bw);
    }
  }
  const w = 2 * ry + 1;
  const n = lh + 2 * ry;
  const fore = new Uint8Array(n * bw);
  const back = new Uint8Array(n * bw);
  for (let b = 0; b < n; b += w) {
    const e = Math.min(b + w, n);
    for (let p = b; p < e; p++) {
      const j = p - ry;
      const to = p * bw;
      if (j < 0 || j >= lh) {
        if (p === b) {
          fore.fill(0, to, to + bw);
        } else {
          fore.copyWithin(to, to - bw, to);
        }
      } else if (p === b) {
        fore.set(across.subarray(j * bw, j * bw + bw), to);
      } else {
        for (let i = 0, from = j * bw, last = to - bw; i < bw; i++) {
          const v = across[from + i];
          const m = fore[last + i];
          fore[to + i] = Math.max(v, m);
        }
      }
    }
    for (let p = e - 1; p >= b; p--) {
      const j = p - ry;
      const to = p * bw;
      if (j < 0 || j >= lh) {
        if (p === e - 1) {
          back.fill(0, to, to + bw);
        } else {
          back.copyWithin(to, to + bw, to + 2 * bw);
        }
      } else if (p === e - 1) {
        back.set(across.subarray(j * bw, j * bw + bw), to);
      } else {
        for (let i = 0, from = j * bw, next = to + bw; i < bw; i++) {
          const v = across[from + i];
          const m = back[next + i];
          back[to + i] = Math.max(v, m);
        }
      }
    }
  }
  for (let j = 0; j < lh; j++) {
    for (let i = 0, a = j * bw, c = (j + w - 1) * bw, o = j * lw + x0; i < bw; i++) {
      const x = back[a + i];
      const y = fore[c + i];
      out[o + i] = Math.max(x, y);
    }
  }
}

export function reach(
  pixels: ArrayLike<number>,
  lw: number,
  lh: number,
  rx: number,
  ry: number,
): Uint8Array {
  const out = new Uint8Array(lw * lh);
  for (let x0 = 0; x0 < lw; x0 += BAND) {
    reachBand(pixels, lw, lh, rx, ry, x0, Math.min(lw, x0 + BAND), out);
  }
  return out;
}

export type Reach = Readonly<{
  layer: CloudLayer;
  rx: number;
  ry: number;
  out: Uint8Array;
  done: Uint8Array;
}>;

export const reachLazily = (layer: CloudLayer, rx: number, ry: number): Reach => ({
  layer,
  rx,
  ry,
  out: new Uint8Array(layer.width * layer.height),
  done: new Uint8Array(Math.ceil(layer.width / BAND)),
});

export function reachAt(r: Reach, i: number, j: number, lw: number): number {
  if (r.done[i >> BAND_BITS] === 0) {
    workOut(r, i >> BAND_BITS);
  }
  return r.out[j * lw + i];
}

function workOut(r: Reach, b: number) {
  const { pixels, width: lw, height: lh } = r.layer;
  reachBand(pixels, lw, lh, r.rx, r.ry, b * BAND, Math.min(lw, b * BAND + BAND), r.out);
  r.done[b] = 1;
}

export type SkyCells = ReturnType<typeof skyCells>;

export type StillSky = {
  columns: number;
  rows: number;
  cw: number;
  ch: number;
  text: string;
  rgb: Record<SkyTheme, ArrayLike<number>>;
};

export const OPEN_SKY = -3;

export function skyCells(o: {
  still: StillSky;
  near: CloudLayer;
  far: CloudLayer;
  shapes: Float32Array;
}) {
  const { still, shapes, near, far } = o;
  const { columns, rows } = still;
  const density = new Float32Array(columns * rows);
  still.text.split("\n").forEach((line, r) => {
    if (r >= rows) {
      return;
    }
    for (let c = 0; c < Math.min(columns, line.length); c++) {
      density[r * columns + c] = Math.max(0, SKY_RAMP.indexOf(line[c])) / (SKY_RAMP.length - 1);
    }
  });
  const stillAt = (x: number, y: number) => {
    const c = wrap(Math.floor(x / still.cw), columns);
    const r = Math.min(rows - 1, Math.max(0, Math.floor(y / still.ch)));
    return r * columns + c;
  };

  const sample = (layer: CloudLayer, x: number, y: number, out: Float32Array) => {
    const { pixels, width: lw, height: lh } = layer;
    const fx = wrap(x / 2, lw) - 0.5;
    const fy = Math.min(lh - 1.001, Math.max(0, y / 2 - 0.5));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const u = fx - x0;
    const v = fy - y0;
    const xa = x0 < 0 ? x0 + lw : x0;
    const xb = xa + 1 === lw ? 0 : xa + 1;
    const ia = (y0 * lw + xa) * 4;
    const ib = (y0 * lw + xb) * 4;
    const ic = ia + lw * 4;
    const id = ib + lw * 4;
    const wa = (1 - u) * (1 - v);
    const wb = u * (1 - v);
    const wc = (1 - u) * v;
    const wd = u * v;
    out[0] = pixels[ia] * wa + pixels[ib] * wb + pixels[ic] * wc + pixels[id] * wd;
    out[1] = pixels[ia + 1] * wa + pixels[ib + 1] * wb + pixels[ic + 1] * wc + pixels[id + 1] * wd;
  };
  const around = (layer: CloudLayer, scale: number) =>
    reachLazily(
      layer,
      REACH + Math.ceil(((BILLOW.x + CURL.x) * scale) / 2),
      REACH + Math.ceil(((BILLOW.y + CURL.y) * scale) / 2),
    );
  const findClouds = (smallest: number) => {
    if (noise.length === 0) {
      noise = makeNoise();
    }
    const nearer = smallest > 0 ? bigClouds(near, smallest) : near;
    return {
      near: nearer,
      nearAround: reachLazily(nearer, REACH, REACH),
      farAround: reachLazily(far, REACH, REACH),
      nearWide: around(nearer, 1),
      farWide: around(far, FAR_SCALE),
    };
  };
  const found: Partial<Record<SkyTheme, ReturnType<typeof findClouds>>> = {};
  const nearby = (layer: CloudLayer, reachOf: Reach, x: number, y: number) => {
    const { width: lw, height: lh } = layer;
    const i = wrap(Math.floor(x / 2), lw);
    const j = Math.min(lh - 1, Math.max(0, Math.floor(y / 2)));
    return reachAt(reachOf, i, j, lw);
  };
  const table = (fn: (v: number) => number) => {
    const t = new Float32Array(256);
    for (let v = 0; v < 256; v++) {
      t[v] = fn(v);
    }
    return t;
  };
  const cover = table((v) => smooth(0.2, 0.7, v / 255));

  const shading = {
    light: [...THEMES.light.inside].map((g) => GLYPHS.indexOf(g)),
    dark: [...THEMES.dark.inside].map((g) => GLYPHS.indexOf(g)),
    vice: [...THEMES.vice.inside].map((g) => GLYPHS.indexOf(g)),
  };
  const want = new Float32Array(6);
  const tile = [0, 0, 0];
  const n = new Float32Array(2);
  const f = new Float32Array(2);

  const shadeGlyph = (theme: SkyTheme, shade: number, jitter: number, shown: number) => {
    const glyphs = shading[theme];
    const at = shade ** 1.35 * (glyphs.length - 0.5) + jitter;
    const j = shown < 0 ? -1 : glyphs.indexOf(shown);
    if (j >= 0 && Math.abs(j + 0.5 - at) < KEEP_SHADE) {
      return shown;
    }
    return glyphs[Math.min(glyphs.length - 1, Math.max(0, Math.floor(at)))];
  };
  const shapeGlyph = (shown: number) => {
    let best = -1;
    let bestD = 0;
    for (let k = 0; k < 6; k++) {
      bestD += want[k] * want[k];
    }
    let shownD = shown === -1 ? bestD : Number.POSITIVE_INFINITY;
    for (let e = 0; e < EDGE.length; e++) {
      const g = EDGE[e];
      let d = EDGE_COST[e];
      const s = g * 6;
      for (let k = 0; k < 6; k++) {
        const diff = shapes[s + k] - want[k];
        d += diff * diff;
      }
      if (g === shown) {
        shownD = d;
      }
      if (d < bestD) {
        bestD = d;
        best = g;
      }
    }
    return shownD <= bestD + KEEP_SHAPE ? shown : best;
  };
  const lerp = (colours: readonly Rgb[], shade: number, out: number[], from: number) => {
    const p = Math.min(colours.length - 1.0001, Math.max(0, shade) * (colours.length - 1));
    const j = Math.floor(p);
    const q = p - j;
    for (let k = 0; k < 3; k++) {
      out[from + k] = colours[j][k] + (colours[j + 1][k] - colours[j][k]) * q;
    }
  };

  let noise = new Float32Array(0);
  const grain = new Float32Array(4);
  const noiseAt = (u: number, v: number, out: Float32Array) => {
    const fu = wrap(u, NOISE_SIZE);
    const fv = wrap(v, NOISE_SIZE);
    const x0 = fu | 0;
    const y0 = fv | 0;
    const a = fu - x0;
    const b = fv - y0;
    const x1 = x0 + 1 === NOISE_SIZE ? 0 : x0 + 1;
    const y1 = y0 + 1 === NOISE_SIZE ? 0 : y0 + 1;
    const i00 = (y0 * NOISE_SIZE + x0) * 4;
    const i01 = (y0 * NOISE_SIZE + x1) * 4;
    const i10 = (y1 * NOISE_SIZE + x0) * 4;
    const i11 = (y1 * NOISE_SIZE + x1) * 4;
    for (let k = 0; k < 4; k++) {
      const top = noise[i00 + k] + (noise[i01 + k] - noise[i00 + k]) * a;
      const bottom = noise[i10 + k] + (noise[i11 + k] - noise[i10 + k]) * a;
      out[k] = top + (bottom - top) * b;
    }
  };

  let time = 0;
  let nearShift = 0;
  let farShift = 0;
  const at = (seconds: number) => {
    time = seconds;
    nearShift = drift(seconds, WIND.near);
    farShift = drift(seconds, WIND.far, 3);
  };

  const shapeAt = (u: number, y: number, scale: number, seed: number, out: Float32Array) => {
    const s = NOISE_CELL / scale;
    noiseAt(
      ((u + BILLOW.drift[0] * time) * s) / BILLOW.across + seed,
      ((y + BILLOW.drift[1] * time) * s) / BILLOW.down + seed * 0.7,
      grain,
    );
    const dx = BILLOW.x * grain[0];
    const dy = BILLOW.y * grain[1];
    const shade = grain[2];
    const fray = grain[3];
    noiseAt(
      ((u + CURL.drift[0] * time) * s) / CURL.across + 61.3 + seed,
      ((y + CURL.drift[1] * time) * s) / CURL.down + 17.9 + seed,
      grain,
    );
    out[0] = (dx + CURL.x * grain[0]) * scale;
    out[1] = (dy + CURL.y * grain[1]) * scale;
    out[2] = Math.max(-1, Math.min(1, 0.6 * fray + 0.7 * grain[2])) * FRAY;
    out[3] = shade * SHADE_SHIFT * 255;
  };
  const nearShape = new Float32Array(4);
  const farShape = new Float32Array(4);
  const covered = (v: number, fray: number) => {
    const c = v / 255;
    const frayed = (c + fray * 4 * c * (1 - c)) * 255;
    return cover[toByte(frayed)];
  };
  const shadeOf = (v: number, by: number) => toByte(v + by);

  const cell = (
    x0: number,
    y0: number,
    cw: number,
    ch: number,
    theme: SkyTheme,
    out: number[],
    shown = -1,
    pushX = 0,
    pushY = 0,
  ) => {
    const cx = x0 + cw / 2;
    const cy = y0 + ch / 2;
    const i = stillAt(cx, cy);
    const map = still.rgb[theme];
    const left = x0 - pushX;
    const top = y0 - pushY;
    const lx = cx - pushX;
    const ly = cy - pushY;
    let hasNear = false;
    let hasFar = false;
    const t = THEMES[theme];
    let nearer = near;
    if (t.clouds) {
      found[theme] ??= findClouds(t.smallest);
      const c = found[theme];
      nearer = c.near;
      hasNear = nearby(nearer, c.nearWide, lx - nearShift, ly) >= 3;
      hasFar = t.far && nearby(far, c.farWide, lx - farShift, ly) >= 3;
      if (hasNear) {
        shapeAt(lx - nearShift, ly, 1, 0, nearShape);
        hasNear =
          nearby(nearer, c.nearAround, lx - nearShift + nearShape[0], ly + nearShape[1]) >= 3;
      }
      if (hasFar) {
        shapeAt(lx - farShift, ly, FAR_SCALE, 37.1, farShape);
        hasFar = nearby(far, c.farAround, lx - farShift + farShape[0], ly + farShape[1]) >= 3;
      }
    }
    const skyR = map[i * 4];
    const skyG = map[i * 4 + 1];
    const skyB = map[i * 4 + 2];
    out[0] = skyR;
    out[4] = skyR;
    out[1] = skyG;
    out[5] = skyG;
    out[2] = skyB;
    out[6] = skyB;
    out[3] = density[i];
    const wash = t.wash[0] + (t.wash[1] - t.wash[0]) * density[i];
    out[7] = wash;
    if (!(hasNear || hasFar)) {
      return OPEN_SKY;
    }
    let sum = 0;
    let bare = 1;
    let most = 0;
    let shaded = 0;
    let nearSum = 0;
    let aN = 0;
    let aF = 0;
    let sN = 0;
    let sF = 0;
    for (let k = 0; k < 6; k++) {
      const x = left + REGIONS[k][0] * cw;
      const y = top + REGIONS[k][1] * ch;
      if (hasNear) {
        sample(nearer, x - nearShift + nearShape[0], y + nearShape[1], n);
        aN = covered(n[1], nearShape[2]);
        sN = shadeOf(n[0], nearShape[3]);
      }
      if (hasFar) {
        sample(far, x - farShift + farShape[0], y + farShape[1], f);
        aF = covered(f[1], farShape[2]);
        sF = shadeOf(f[0], farShape[3]);
      }
      const a = aN + aF * (1 - aN);
      want[k] = a * EDGE_INK;
      bare = Math.min(bare, a);
      most = Math.max(most, a);
      sum += a;
      nearSum += aN;
      shaded += (aN * sN + aF * (1 - aN) * sF) / 255;
    }
    if (most < 0.14) {
      return OPEN_SKY;
    }
    const shade = sum > 0 ? shaded / sum : 0;
    const coverage = sum / 6;
    const onNear = nearSum >= sum * 0.5;
    const u = Math.floor((lx - (onNear ? nearShift : farShift)) / cw);
    const v = Math.floor(ly / ch);
    const inside = coverage >= 0.6 && bare >= 0.3;
    lerp(t.tile, shade, tile, 0);
    const a =
      (inside ? smooth(0.55, 0.9, coverage) : 0.8 * smooth(0.15, 0.9, coverage)) *
      (onNear ? 1 : 0.85);
    const shown7 = a + (1 - a) * wash;
    for (let k = 0; k < 3; k++) {
      out[4 + k] = (a * tile[k] + (1 - a) * wash * out[4 + k]) / shown7;
    }
    out[7] = shown7;
    if (inside) {
      lerp(t.glyph, shade, out, 0);
      const jitter = (hash(u, v, onNear ? 3 : 5) - 0.5) * 1.5;
      return shadeGlyph(theme, shade, jitter, shown);
    }
    const best = shapeGlyph(shown);
    if (best < 0) {
      return want[5] < EDGE_INK * 0.35 ? OPEN_SKY : -1;
    }
    lerp(t.edge, shade, out, 0);
    return best;
  };

  return { at, cell };
}
