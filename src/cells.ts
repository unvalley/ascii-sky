function mix(n: number): number {
  let h = n;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7f_eb_35_2d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x84_6c_a6_8b);
  h ^= h >>> 16;
  return h;
}

export function hash(x: number, y: number, z: number): number {
  return (mix(mix(mix(z | 0) ^ (y | 0)) ^ (x | 0)) >>> 0) / 4_294_967_296;
}

export function wrap(x: number, n: number): number {
  const w = x - Math.floor(x / n) * n;
  if (w < 0) {
    return w + n;
  }
  if (w >= n) {
    return w - n;
  }
  return w;
}

export const smooth = (a: number, b: number, t: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

const toByte = (x: number) => {
  if (x < 0) {
    return 0;
  }
  if (x > 255) {
    return 255;
  }
  return x | 0;
};

type Rgb = readonly [number, number, number];

export const hex = (h: string): Rgb => [
  Number.parseInt(h.slice(1, 3), 16),
  Number.parseInt(h.slice(3, 5), 16),
  Number.parseInt(h.slice(5, 7), 16),
];

const toLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => {
  const c = v <= 0.003_130_8 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
};

export function oklab(r: number, g: number, b: number): [number, number, number] {
  const R = toLinear(r);
  const G = toLinear(g);
  const B = toLinear(b);
  const l = Math.cbrt(0.412_221_470_8 * R + 0.536_332_536_3 * G + 0.051_445_992_9 * B);
  const m = Math.cbrt(0.211_903_498_2 * R + 0.680_699_545_1 * G + 0.107_396_956_6 * B);
  const s = Math.cbrt(0.088_302_461_9 * R + 0.281_718_837_6 * G + 0.629_978_700_5 * B);
  return [
    0.210_454_255_3 * l + 0.793_617_785 * m - 0.004_072_046_8 * s,
    1.977_998_495_1 * l - 2.428_592_205 * m + 0.450_593_709_9 * s,
    0.025_904_037_1 * l + 0.782_771_766_2 * m - 0.808_675_766 * s,
  ];
}

export function fromOklab(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.396_337_777_4 * a + 0.215_803_757_3 * b) ** 3;
  const m = (L - 0.105_561_345_8 * a - 0.063_854_172_8 * b) ** 3;
  const s = (L - 0.089_484_177_5 * a - 1.291_485_548 * b) ** 3;
  return [
    fromLinear(4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s),
    fromLinear(-1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s),
    fromLinear(-0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701 * s),
  ];
}

export const SKY_RAMP = ".:+*ox%#@";
export const GLYPHS = [...new Set([...SKY_RAMP, ..."-_'`,;~()8|/\\"])];
export const glyphOf = (g: string) => GLYPHS.indexOf(g);
const codes = (glyphs: string) => [...glyphs].map(glyphOf);
const EDGE_GLYPHS = ".,'`-_~():;";
const EDGE = codes(EDGE_GLYPHS);
const EDGE_COST = [...EDGE_GLYPHS].map((g) => ("~()".includes(g) ? 0.06 : 0));

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
const EDGE_INK = 0.7;

export function measureGlyph(alpha: ArrayLike<number>, w: number, h: number) {
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
          sum += alpha[y * w + x] / 255;
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

export type SkyTheme = "light" | "dark" | "vice";

type Look = {
  inside: readonly number[];
  tile: readonly Rgb[];
  glyph: readonly Rgb[];
  edge: readonly Rgb[];
  wash: readonly [number, number];
  smallest: number;
  clouds: boolean;
  far: boolean;
};

const palette = (...colours: string[]) => colours.map(hex);

export const THEMES: Record<SkyTheme, Look> = {
  light: {
    inside: codes(" .:;o8%@"),
    tile: palette("#ffffff", "#f5f8fc", "#ebf1f8", "#dfe8f2"),
    glyph: palette("#b8cee0", "#a0bbd3", "#8aa8c6", "#7496b9"),
    edge: palette("#b8cee0", "#a0bbd3", "#8aa8c6", "#7496b9"),
    wash: [0.2, 0.5],
    smallest: 0,
    clouds: true,
    far: true,
  },
  dark: {
    inside: codes(" .:;o8%#@"),
    tile: palette("#ffffff", "#e6edf8", "#bccbe4", "#8a9fc6"),
    glyph: palette("#c6d4ea", "#aebfdc", "#8ea3c8", "#6d83ad"),
    edge: palette("#ffffff", "#e6edf8", "#bccbe4", "#8a9fc6"),
    wash: [0.18, 0.42],
    smallest: 0,
    clouds: false,
    far: false,
  },
  vice: {
    inside: codes(" .:;o8%@"),
    tile: palette("#ffeedd", "#ffd8c8", "#f9bfd2", "#e3a6d6"),
    glyph: palette("#ff9a68", "#f87a96", "#d064b0", "#985cc4"),
    edge: palette("#ff9a68", "#f87a96", "#d064b0", "#985cc4"),
    wash: [0.3, 0.6],
    smallest: 6000,
    clouds: true,
    far: false,
  },
};

export const VICE_STOPS: readonly (readonly [number, string])[] = [
  [0, "#5a4cc2"],
  [100, "#9551c6"],
  [180, "#df4f9d"],
  [260, "#ff6a63"],
  [340, "#ff9148"],
  [440, "#ffbb4a"],
];
const VICE_LAB = VICE_STOPS.map(([y, c]) => [y, oklab(...hex(c))] as const);
const VICE_DEPTH = 0.1;

function sunsetAt(y: number): readonly [number, number, number] {
  const last = VICE_LAB.length - 1;
  if (y <= VICE_LAB[0][0]) {
    return VICE_LAB[0][1];
  }
  if (y >= VICE_LAB[last][0]) {
    return VICE_LAB[last][1];
  }
  let i = 0;
  while (VICE_LAB[i + 1][0] < y) {
    i++;
  }
  const [y0, a] = VICE_LAB[i];
  const [y1, b] = VICE_LAB[i + 1];
  const t = (y - y0) / (y1 - y0);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function viceColours(
  columns: number,
  rows: number,
  ch: number,
  text: string,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(columns * rows * 4);
  const lines = text.split("\n");
  for (let r = 0; r < rows; r++) {
    const [L, a, b] = sunsetAt((r + 0.5) * ch);
    const shades = [...SKY_RAMP].map((_, g) =>
      fromOklab(L + VICE_DEPTH * (0.5 - g / (SKY_RAMP.length - 1)), a, b),
    );
    const line = lines[r] ?? "";
    for (let c = 0; c < columns; c++) {
      const o = (r * columns + c) * 4;
      out.set(shades[Math.max(0, SKY_RAMP.indexOf(line[c] ?? "."))], o);
      out[o + 3] = 255;
    }
  }
  return out;
}

export const viceGradient = () =>
  `linear-gradient(to bottom, ${VICE_STOPS.map(([y, c]) => `${c} ${y}px`).join(", ")})`;

export function bigClouds(layer: CloudLayer, smallest: number): CloudLayer {
  const { pixels, width: w, height: h } = layer;
  const out = new Uint8ClampedArray(pixels);
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
      for (const j of [
        y * w + (x + 1 === w ? 0 : x + 1),
        y * w + (x === 0 ? w - 1 : x - 1),
        y > 0 ? i - w : -1,
        y + 1 < h ? i + w : -1,
      ]) {
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
  r: number,
  fore: Uint8Array,
  back: Uint8Array,
  most: Uint8Array,
) {
  const n = line.length;
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
  for (let k = 0; k < most.length; k++) {
    most[k] = Math.max(back[k], fore[k + w - 1]);
  }
}

const BAND_BITS = 7;
const BAND = 1 << BAND_BITS;

function reachBand(layer: CloudLayer, rx: number, ry: number, x0: number, out: Uint8Array) {
  const { pixels, width: lw, height: lh } = layer;
  const bw = Math.min(lw, x0 + BAND) - x0;
  const across = new Uint8Array(bw * lh);
  const row = new Uint8Array(bw + 2 * rx);
  const rowFore = new Uint8Array(row.length);
  const rowBack = new Uint8Array(row.length);
  for (let j = 0; j < lh; j++) {
    for (let p = 0; p < row.length; p++) {
      let k = x0 + p - rx;
      if (k < 0 || k >= lw) {
        k = ((k % lw) + lw) % lw;
      }
      row[p] = pixels[(j * lw + k) * 4 + 1];
    }
    slideMost(row, rx, rowFore, rowBack, across.subarray(j * bw, j * bw + bw));
  }
  const column = new Uint8Array(lh + 2 * ry);
  const columnFore = new Uint8Array(column.length);
  const columnBack = new Uint8Array(column.length);
  const most = new Uint8Array(lh);
  for (let i = 0; i < bw; i++) {
    for (let j = 0; j < lh; j++) {
      column[ry + j] = across[j * bw + i];
    }
    slideMost(column, ry, columnFore, columnBack, most);
    for (let j = 0; j < lh; j++) {
      out[j * lw + x0 + i] = most[j];
    }
  }
}

export function reachOf(layer: CloudLayer, rx: number, ry: number) {
  const { width: lw, height: lh } = layer;
  const out = new Uint8Array(lw * lh);
  const done = new Uint8Array(Math.ceil(lw / BAND));
  return (x: number, y: number): number => {
    const i = wrap(Math.floor(x / 2), lw);
    const j = Math.min(lh - 1, Math.max(0, Math.floor(y / 2)));
    const b = i >> BAND_BITS;
    if (done[b] === 0) {
      reachBand(layer, rx, ry, b * BAND, out);
      done[b] = 1;
    }
    return out[j * lw + i];
  };
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

  let noise = new Float32Array(0);
  const wide = (layer: CloudLayer, scale: number) =>
    reachOf(
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
      nearAround: reachOf(nearer, REACH, REACH),
      farAround: reachOf(far, REACH, REACH),
      nearWide: wide(nearer, 1),
      farWide: wide(far, FAR_SCALE),
    };
  };
  const found: Partial<Record<SkyTheme, ReturnType<typeof findClouds>>> = {};

  const cover = new Float32Array(256);
  for (let v = 0; v < 256; v++) {
    cover[v] = smooth(0.2, 0.7, v / 255);
  }
  const want = new Float32Array(6);
  const tile = [0, 0, 0];
  const n = new Float32Array(2);
  const f = new Float32Array(2);

  const shadeGlyph = (glyphs: readonly number[], shade: number, jitter: number, shown: number) => {
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
  const lerp = (colours: readonly Rgb[], shade: number, out: number[]) => {
    const p = Math.min(colours.length - 1.0001, Math.max(0, shade) * (colours.length - 1));
    const j = Math.floor(p);
    const q = p - j;
    for (let k = 0; k < 3; k++) {
      out[k] = colours[j][k] + (colours[j + 1][k] - colours[j][k]) * q;
    }
  };

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
      hasNear = c.nearWide(lx - nearShift, ly) >= 3;
      hasFar = t.far && c.farWide(lx - farShift, ly) >= 3;
      if (hasNear) {
        shapeAt(lx - nearShift, ly, 1, 0, nearShape);
        hasNear = c.nearAround(lx - nearShift + nearShape[0], ly + nearShape[1]) >= 3;
      }
      if (hasFar) {
        shapeAt(lx - farShift, ly, FAR_SCALE, 37.1, farShape);
        hasFar = c.farAround(lx - farShift + farShape[0], ly + farShape[1]) >= 3;
      }
    }
    for (let k = 0; k < 3; k++) {
      const v = map[i * 4 + k];
      out[k] = v;
      out[4 + k] = v;
    }
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
        sN = toByte(n[0] + nearShape[3]);
      }
      if (hasFar) {
        sample(far, x - farShift + farShape[0], y + farShape[1], f);
        aF = covered(f[1], farShape[2]);
        sF = toByte(f[0] + farShape[3]);
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
    lerp(t.tile, shade, tile);
    const a =
      (inside ? smooth(0.55, 0.9, coverage) : 0.8 * smooth(0.15, 0.9, coverage)) *
      (onNear ? 1 : 0.85);
    const tileAlpha = a + (1 - a) * wash;
    for (let k = 0; k < 3; k++) {
      out[4 + k] = (a * tile[k] + (1 - a) * wash * out[4 + k]) / tileAlpha;
    }
    out[7] = tileAlpha;
    if (inside) {
      lerp(t.glyph, shade, out);
      const jitter = (hash(u, v, onNear ? 3 : 5) - 0.5) * 1.5;
      return shadeGlyph(t.inside, shade, jitter, shown);
    }
    const best = shapeGlyph(shown);
    if (best < 0) {
      return want[5] < EDGE_INK * 0.35 ? OPEN_SKY : -1;
    }
    lerp(t.edge, shade, out);
    return best;
  };

  return { at, cell };
}
