/**
 * What each cell of the live sky shows: open sky, or a glyph and its
 * colour where the clouds are. Used by the sky's frame (shade.ts).
 *
 * Open sky is the still sky's glyph on a tile of its blue (drawn by the
 * sky's frame), the clouds glyphs on tiles of their own, paler, so they
 * stand out from it. Where cloud and sky meet, glyphs are picked by
 * shape, after Alex Harri's ASCII renderer
 * (alexharri.com/blog/ascii-rendering): each glyph is measured by how
 * much ink it puts in six round regions of its cell, two across and
 * three down. A cell is sampled at the same six points for how much ink
 * the picture wants there, and gets the glyph that matches best. So a
 * cloud's edge is drawn by glyphs that keep their ink on the sky's side,
 * and as the cloud drifts they change with it. Inside a cloud, its
 * shading takes glyphs from a short ramp by how much ink they hold.
 */

import { hash } from "./hash.ts";
import { wrap } from "./wrap.ts";

/** The still sky's glyphs, light to heavy (as in sky.txt). */
export const SKY_RAMP = ".:+*ox%#@";
/** Every glyph a cell can show; a space is a blank cell. */
export const GLYPHS = [...new Set([...SKY_RAMP, ..."-_'`,;~()8|/\\"])];
/** The glyphs a cloud's edge is drawn with, soft ones, as a cloud's
 * outline is drawn by hand: .--. ( ) '--' */
const EDGE = [...".,'`-_~():;"].map((g) => GLYPHS.indexOf(g));
/** Brackets and tildes only where they fit clearly, or they crowd an edge:
 * what each edge glyph costs before its shape is compared. */
const COSTLY = [..."~()"].map((g) => GLYPHS.indexOf(g));
const EDGE_COST = EDGE.map((g) => (COSTLY.includes(g) ? 0.06 : 0));

/** The six regions, as fractions of the cell, and their radius. Level,
 * not staggered, so a flat edge matches a level glyph. */
export const REGIONS = [
  [0.27, 0.2],
  [0.73, 0.2],
  [0.27, 0.5],
  [0.73, 0.5],
  [0.27, 0.8],
  [0.73, 0.8],
] as const;
export const REGION_RADIUS = 0.24; // of the cell's width

/**
 * A glyph's ink in each region: the mean alpha of its pixels inside each
 * circle, from a picture of the glyph filling one cell (`alpha` is every
 * `stride`th byte of a `w` × `h` image).
 */
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
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++)
      for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > radius * radius)
          continue;
        n++;
        if (x >= 0 && y >= 0 && x < w && y < h)
          sum += alpha[(y * w + x) * stride + offset] / 255;
      }
    out[k] = n ? sum / n : 0;
  }
  return out;
}

/**
 * The glyphs' shapes, each region scaled by the most any glyph puts
 * there, so that 1 is full ink.
 */
export function normaliseShapes(measured: Float32Array[]) {
  const shapes = new Float32Array(GLYPHS.length * 6);
  const most = new Float32Array(6);
  for (const m of measured)
    for (let k = 0; k < 6; k++) most[k] = Math.max(most[k], m[k]);
  measured.forEach((m, g) => {
    for (let k = 0; k < 6; k++)
      shapes[g * 6 + k] = most[k] ? m[k] / most[k] : 0;
  });
  return shapes;
}

/**
 * A cloud layer at half the page's pixels (RGBA): red is shade (0 lit ..
 * 255 deep), green how much cloud.
 */
export type CloudLayer = {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
};

type Rgb = readonly [number, number, number];
/** The sky's themes: by day on the light page, a night on the dark one,
 * and a Vice City sunset (vice.ts). */
export type SkyTheme = "light" | "dark" | "vice";
/**
 * How a theme draws clouds: a cloud is a block of tiles, each cell
 * filled and shaded by the light, with a glyph on it
 * that is sparse where the cloud is lit and dense in its shade. Its edge
 * is glyphs alone, no tiles, so it reads soft against the sky.
 */
export type Theme = {
  /** The glyphs on a cloud's tiles, lit to deep; a space draws none. */
  inside: string;
  /** Tiles, from lit into shade. */
  tile: readonly Rgb[];
  /** Glyphs on the tiles, from lit into shade. */
  glyph: readonly Rgb[];
  /** Glyphs at a cloud's edge, from lit into shade. */
  edge: readonly Rgb[];
  /** How much of open sky's tile shows, where the painting has least
   * blue and where it has most. */
  wash: readonly [number, number];
  /** Clouds smaller than this (page pixels square) are left out; 0 draws
   * them all. */
  smallest: number;
  /** Whether there are clouds; without them the sky is open everywhere
   * (the dark page's night, see night.ts). */
  clouds: boolean;
  /** Whether the far layer's smaller, higher clouds show too, or only
   * the near layer's big ones. */
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
  // On the light page a lit cloud is white, nearly the page, its glyphs
  // pale blue, deepening into its shade.
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
  // Were there clouds on the dark page, they would be the brightest thing
  // in the sky: white, blue in their shade, glyphs a little deeper.
  dark: {
    inside: " .:;o8%#@",
    tile: palette("#ffffff", "#e6edf8", "#bccbe4", "#8a9fc6"),
    glyph: palette("#c6d4ea", "#aebfdc", "#8ea3c8", "#6d83ad"),
    edge: palette("#ffffff", "#e6edf8", "#bccbe4", "#8a9fc6"),
    wash: [0.18, 0.42],
    smallest: 0,
    // The dark page's sky is a night with stars and no clouds (night.ts);
    // the cloud colours above are a day's, kept should clouds come back.
    clouds: false,
    far: false,
  },
  // A Vice City sunset (vice.ts): a few big clouds low in the sky, lit
  // peach by the low sun, pink into their shade and violet deep in it,
  // and none of the far layer's small high ones, so the sky above is
  // clear, nor the near layer's small ones.
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

/**
 * `layer` without its clouds smaller than `smallest` page pixels square:
 * each cloud is the layer's pixels with any cloud that touch, side by
 * side or one above the other (wrapping sideways, as the layer does).
 */
export function bigClouds(layer: CloudLayer, smallest: number): CloudLayer {
  const { pixels, width: w, height: h } = layer;
  const out = new Uint8ClampedArray(pixels);
  if (smallest <= 0) return { pixels: out, width: w, height: h };
  // A layer pixel is two page pixels each way.
  const least = smallest / 4;
  const seen = new Uint8Array(w * h);
  const cloud = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || pixels[start * 4 + 1] === 0) continue;
    // Gather the cloud from here, then rub it out if it is small.
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
      for (const j of next)
        if (j >= 0 && !seen[j] && pixels[j * 4 + 1] > 0) {
          seen[j] = 1;
          cloud[todo++] = j;
        }
    }
    if (size < least)
      for (let k = 0; k < size; k++) {
        out[cloud[k] * 4] = 0;
        out[cloud[k] * 4 + 1] = 0;
      }
  }
  return { pixels: out, width: w, height: h };
}

/** Ink a cloud stands for where it meets the sky, to pick its edge glyphs. */
const EDGE_INK = 0.7;

/**
 * The wind. Each layer has its mean speed in page pixels a second, the
 * near clouds faster, and it blows in gusts: two slow swells, so the
 * clouds speed up and ease off, never stopping.
 */
export const WIND = { near: 18, far: 8 };
const GUSTS = [
  // [share of the mean speed, period in seconds, phase]
  [0.45, 23, 0],
  [0.25, 8.7, 1.1],
] as const;
/** How far a layer at `mean` speed has drifted after `seconds`. */
export function drift(seconds: number, mean: number, lag = 0) {
  let d = seconds;
  for (const [share, period, phase] of GUSTS) {
    const w = (2 * Math.PI) / period;
    d +=
      (share / w) * (Math.sin(w * (seconds - lag) + phase) - Math.sin(phase));
  }
  return d * mean;
}

/**
 * How a cloud changes shape as it goes. Points in a cloud are looked up
 * a little off where they are, by smooth noise that travels with the
 * cloud and slowly through it: broad billows, and finer curls at its
 * edges. Noise also frays and fills its thin edges and moves its shade,
 * so no cloud keeps one shape. Sizes and reaches are page pixels; `drift`
 * is how fast each noise slides through the cloud, a second.
 */
const BILLOW = { across: 240, down: 120, x: 28, y: 12, drift: [14, -3] };
// Long and low, so edges fray into streaks along the wind.
const CURL = { across: 90, down: 30, x: 8, y: 5, drift: [-16, 4] };
/** How much an edge frays or fills, and the shade moves (0 .. 1). */
const FRAY = 0.55;
const SHADE_SHIFT = 0.14;
/** The far clouds are smaller: their noise is too. */
const FAR_SCALE = 0.6;

/** Smooth noise that tiles, four values a texel from -1 to 1. */
const NOISE_SIZE = 128;
/** Texels between the noise's lattice points. */
const NOISE_CELL = 16;
function makeNoise() {
  const lattice = NOISE_SIZE / NOISE_CELL;
  let seed = 7;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = new Float32Array(NOISE_SIZE * NOISE_SIZE * 4);
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  // Where each texel falls between lattice points, the same across as
  // down (the noise is square): the points either side and how far along.
  const lo = new Int32Array(NOISE_SIZE);
  const hi = new Int32Array(NOISE_SIZE);
  const along = new Float64Array(NOISE_SIZE);
  // Two octaves of value noise, the finer at half strength.
  for (const [n, weight] of [
    [lattice, 1],
    [lattice * 2, 0.5],
  ]) {
    const values = new Float64Array(n * n * 4);
    for (let i = 0; i < values.length; i++) values[i] = rand() * 2 - 1;
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
          out[o + k] +=
            weight * (a + (b - a) * u + (c - a + (d - c - b + a) * u) * v);
        }
      }
    }
  }
  let most = 0;
  for (const v of out) most = Math.max(most, Math.abs(v));
  for (let i = 0; i < out.length; i++) out[i] /= most;
  return out;
}

/**
 * The most of each window `2r + 1` long along the first `n` values of
 * `line` (a line padded by `r` at both ends), into `most` from `at`:
 * `n - 2r` values. It takes the most in blocks the window's length, from
 * the front and from the back (van Herk, Gil and Werman), so it costs the
 * same however far it reaches.
 */
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
      if (v > m) m = v;
      fore[p] = m;
    }
    m = line[e - 1];
    back[e - 1] = m;
    for (let p = e - 2; p >= b; p--) {
      const v = line[p];
      if (v > m) m = v;
      back[p] = m;
    }
  }
  for (let k = 0, length = n - 2 * r; k < length; k++) {
    const a = back[k];
    const c = fore[k + w - 1];
    most[at + k] = a > c ? a : c;
  }
}

/** How many columns of a layer `reach` works out at a time: 2^7. */
const BAND_BITS = 7;
const BAND = 1 << BAND_BITS;

/**
 * The most cloud (a layer's green, RGBA `pixels` `lw` × `lh`) within `rx`
 * × `ry` pixels of each pixel in columns `x0` to `x1`, wrapping sideways
 * and clear past its top and bottom, into those columns of `out` (`lw` ×
 * `lh`). Rows are taken first, then columns, a whole row of them at a
 * time, in the order they lie in memory.
 */
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
        if (k < 0 || k >= lw) k = ((k % lw) + lw) % lw;
        line[p] = pixels[(row + k) * 4 + 1];
      }
      slideMost(line, n, rx, fore, back, across, j * bw);
    }
  }
  // Down the columns, all of them at once: block by block of rows, the
  // most so far from the block's first row and from its last.
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
        if (p === b) fore.fill(0, to, to + bw);
        else fore.copyWithin(to, to - bw, to);
      } else if (p === b) fore.set(across.subarray(j * bw, j * bw + bw), to);
      else
        for (let i = 0, from = j * bw, last = to - bw; i < bw; i++) {
          const v = across[from + i];
          const m = fore[last + i];
          fore[to + i] = v > m ? v : m;
        }
    }
    for (let p = e - 1; p >= b; p--) {
      const j = p - ry;
      const to = p * bw;
      if (j < 0 || j >= lh) {
        if (p === e - 1) back.fill(0, to, to + bw);
        else back.copyWithin(to, to + bw, to + 2 * bw);
      } else if (p === e - 1) back.set(across.subarray(j * bw, j * bw + bw), to);
      else
        for (let i = 0, from = j * bw, next = to + bw; i < bw; i++) {
          const v = across[from + i];
          const m = back[next + i];
          back[to + i] = v > m ? v : m;
        }
    }
  }
  for (let j = 0; j < lh; j++)
    for (let i = 0, a = j * bw, c = (j + w - 1) * bw, o = j * lw + x0; i < bw; i++) {
      const x = back[a + i];
      const y = fore[c + i];
      out[o + i] = x > y ? x : y;
    }
}

/**
 * The most cloud within `rx` × `ry` pixels of each pixel of a layer (see
 * reachBand), so a cell can tell clear sky from one look.
 */
export function reach(
  pixels: ArrayLike<number>,
  lw: number,
  lh: number,
  rx: number,
  ry: number,
): Uint8Array {
  const out = new Uint8Array(lw * lh);
  for (let x0 = 0; x0 < lw; x0 += BAND)
    reachBand(pixels, lw, lh, rx, ry, x0, Math.min(lw, x0 + BAND), out);
  return out;
}

/**
 * `reach` for a layer, worked out a band of columns at a time, the first
 * time a pixel in the band is looked at (see reachAt): the sky starts with
 * only the part of the clouds it shows, and works out the rest as they
 * drift in.
 */
export type Reach = Readonly<{
  layer: CloudLayer;
  rx: number;
  ry: number;
  out: Uint8Array;
  /** Which bands are worked out. */
  done: Uint8Array;
}>;

export const reachLazily = (layer: CloudLayer, rx: number, ry: number): Reach => ({
  layer,
  rx,
  ry,
  out: new Uint8Array(layer.width * layer.height),
  done: new Uint8Array(Math.ceil(layer.width / BAND)),
});

/** The reach at pixel (i, j) of a layer `lw` wide, its band worked out
 * first if need be. */
export function reachAt(r: Reach, i: number, j: number, lw: number): number {
  if (r.done[i >> BAND_BITS] === 0) workOut(r, i >> BAND_BITS);
  return r.out[j * lw + i];
}

function workOut(r: Reach, b: number) {
  const { pixels, width: lw, height: lh } = r.layer;
  reachBand(pixels, lw, lh, r.rx, r.ry, b * BAND, Math.min(lw, b * BAND + BAND), r.out);
  r.done[b] = 1;
}

export type SkyCells = ReturnType<typeof skyCells>;

/**
 * The still sky (the painting with its clouds taken out) on a grid of
 * its own: `columns` × `rows` cells of `cw` × `ch` page pixels, tiling
 * sideways. `text` is a line of glyphs a row, from SKY_RAMP: how much
 * ink the painting's blue wants there. `rgb` is its colour per theme, a
 * pixel a cell (RGBA).
 */
export type StillSky = {
  columns: number;
  rows: number;
  cw: number;
  ch: number;
  text: string;
  rgb: Record<SkyTheme, ArrayLike<number>>;
};

/** What `cell` returns for open sky: the frame draws the still sky's
 * glyph there. */
export const OPEN_SKY = -3;

/**
 * Per-cell picking for cells of any size, at points in the sky's own
 * pixels (x from the left of the still sky, wrapping; y from its top).
 * The cloud layers (RGBA) wrap sideways.
 */
export function skyCells(o: {
  still: StillSky;
  near: CloudLayer;
  far: CloudLayer;
  shapes: Float32Array;
}) {
  const { still, shapes, near, far } = o;
  const { columns, rows } = still;
  // How much ink the still sky wants in each of its cells, 0 .. 1.
  const density = new Float32Array(columns * rows);
  still.text.split("\n").forEach((line, r) => {
    if (r >= rows) return;
    for (let c = 0; c < Math.min(columns, line.length); c++)
      density[r * columns + c] =
        Math.max(0, SKY_RAMP.indexOf(line[c])) / (SKY_RAMP.length - 1);
  });
  /** The still sky's cell at a point. */
  const stillAt = (x: number, y: number) => {
    const c = wrap(Math.floor(x / still.cw), columns);
    const r = Math.min(rows - 1, Math.max(0, Math.floor(y / still.ch)));
    return r * columns + c;
  };

  // A layer at a page point, bilinear, as stored (0 .. 255): shade and
  // cloud into out[0] and out[1].
  const sample = (
    layer: CloudLayer,
    x: number,
    y: number,
    out: Float32Array,
  ) => {
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
    out[0] =
      pixels[ia] * wa + pixels[ib] * wb + pixels[ic] * wc + pixels[id] * wd;
    out[1] =
      pixels[ia + 1] * wa +
      pixels[ib + 1] * wb +
      pixels[ic + 1] * wc +
      pixels[id + 1] * wd;
  };
  // The most cloud within a cell's size of each layer pixel (see reach),
  // and within that and as far as a cloud's points are looked up off
  // where they are (see shapeAt). Made, with the noise, the first time a
  // cell looks for cloud (the dark page's night never does), and worked
  // out where cells look (see reachLazily).
  const REACH = 6;
  const around = (layer: CloudLayer, scale: number) =>
    reachLazily(
      layer,
      REACH + Math.ceil(((BILLOW.x + CURL.x) * scale) / 2),
      REACH + Math.ceil(((BILLOW.y + CURL.y) * scale) / 2),
    );
  /** The near layer a theme draws (without its small clouds, if it
   * leaves them out), and the lookups for it and the far layer. */
  const findClouds = (smallest: number) => {
    if (!noise.length) noise = makeNoise();
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
  /** Any cloud near a page point, from the nearest layer pixel. */
  const nearby = (layer: CloudLayer, around: Reach, x: number, y: number) => {
    const { width: lw, height: lh } = layer;
    const i = wrap(Math.floor(x / 2), lw);
    const j = Math.min(lh - 1, Math.max(0, Math.floor(y / 2)));
    return reachAt(around, i, j, lw);
  };
  // Lookups by stored value: how much a stored cloud value covers, and
  // each theme's ink by shade.
  const table = (fn: (v: number) => number) => {
    const t = new Float32Array(256);
    for (let v = 0; v < 256; v++) t[v] = fn(v);
    return t;
  };
  const cover = table((v) => smooth(0.2, 0.7, v / 255));

  // Each theme's shading glyphs, lit first; -1 for none.
  const shading = {
    light: [...THEMES.light.inside].map((g) => GLYPHS.indexOf(g)),
    dark: [...THEMES.dark.inside].map((g) => GLYPHS.indexOf(g)),
    vice: [...THEMES.vice.inside].map((g) => GLYPHS.indexOf(g)),
  };
  const want = new Float32Array(6);
  const tile = [0, 0, 0];
  const n = new Float32Array(2);
  const f = new Float32Array(2);

  // A cell keeps the glyph it shows unless another fits clearly better,
  // so glyphs do not flicker back and forth as a cloud's texture slides
  // through them by less than a cell.
  const KEEP_SHADE = 0.8;
  const KEEP_SHAPE = 0.1;

  /**
   * On a tile: a shading glyph by the shade (0 lit .. 1 deep), nudged by
   * `jitter` (under a glyph either way), which rides along with the cloud, so its
   * texture is not a pattern on the grid. -1 for none.
   */
  const shadeGlyph = (
    theme: SkyTheme,
    shade: number,
    jitter: number,
    shown: number,
  ) => {
    const glyphs = shading[theme];
    // Sparse over most of the cloud, dense only deep in its shade.
    const at = shade ** 1.35 * (glyphs.length - 0.5) + jitter;
    const j = shown < 0 ? -1 : glyphs.indexOf(shown);
    if (j >= 0 && Math.abs(j + 0.5 - at) < KEEP_SHADE) return shown;
    return glyphs[Math.min(glyphs.length - 1, Math.max(0, Math.floor(at)))];
  };
  /** Where cloud and sky meet: the glyph closest in shape, -1 for blank. */
  const shapeGlyph = (shown: number) => {
    let best = -1;
    let bestD = 0;
    for (let k = 0; k < 6; k++) bestD += want[k] * want[k];
    let shownD = shown === -1 ? bestD : Number.POSITIVE_INFINITY;
    for (let e = 0; e < EDGE.length; e++) {
      const g = EDGE[e];
      let d = EDGE_COST[e];
      const s = g * 6;
      for (let k = 0; k < 6; k++) {
        const e = shapes[s + k] - want[k];
        d += e * e;
      }
      if (g === shown) shownD = d;
      if (d < bestD) {
        bestD = d;
        best = g;
      }
    }
    return shownD <= bestD + KEEP_SHAPE ? shown : best;
  };
  /** A colour from lit into shade, into out[at ..]. */
  const lerp = (colours: readonly Rgb[], shade: number, out: number[], at: number) => {
    const p = Math.min(colours.length - 1.0001, Math.max(0, shade) * (colours.length - 1));
    const j = Math.floor(p);
    const q = p - j;
    for (let k = 0; k < 3; k++)
      out[at + k] = colours[j][k] + (colours[j + 1][k] - colours[j][k]) * q;
  };

  // Made with the clouds' lookups (findClouds), before any cell needs it.
  let noise = new Float32Array(0);
  const grain = new Float32Array(4);
  /** The noise at texel (u, v), wrapping, into `out`. */
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

  // This frame: how far each layer has drifted, and the time.
  let time = 0;
  let nearShift = 0;
  let farShift = 0;
  /** Sets the sky to how it is `seconds` in. */
  const at = (seconds: number) => {
    time = seconds;
    nearShift = drift(seconds, WIND.near);
    farShift = drift(seconds, WIND.far, 3);
  };

  /**
   * How a layer's cloud is moved about at a point `u` page pixels along
   * the layer, `y` down: written as [dx, dy, fray, shade] into `out`.
   * `scale` sizes the noise; `seed` sets each layer apart.
   */
  const shapeAt = (
    u: number,
    y: number,
    scale: number,
    seed: number,
    out: Float32Array,
  ) => {
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
  /** How much of a cell a stored cloud value covers, its edge frayed. */
  const covered = (v: number, fray: number) => {
    const c = v / 255;
    const frayed = (c + fray * 4 * c * (1 - c)) * 255;
    return cover[frayed < 0 ? 0 : frayed > 255 ? 255 : frayed | 0];
  };
  const shadeOf = (v: number, by: number) => {
    const s = v + by;
    return s < 0 ? 0 : s > 255 ? 255 : s | 0;
  };

  /**
   * The cell whose top left is (x0, y0), `cw` × `ch`, as the sky is now
   * (see `at`), showing glyph `shown` (-1 for none). The air has carried
   * the clouds over it (`pushX`, `pushY`) page pixels.
   *
   * Returns OPEN_SKY for open sky, with the sky's colour in out[0..2] and
   * how much blue the painting has there (0 .. 1) in out[3]. Otherwise it
   * returns the glyph (-1 for none) with its colour in out[0..2]. Either
   * way the cell's tile is in out[4..6], and how much of it shows
   * (0 .. 1) in out[7].
   */
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
    // Clouds are looked up where the air carried them from.
    x0 -= pushX;
    y0 -= pushY;
    const lx = cx - pushX;
    const ly = cy - pushY;
    // Each layer: any cloud near, wherever the noise moves its points?
    // Then, with the cell's points moved (one look does for all six, a
    // cell being small beside the noise), any cloud near them?
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
          nearby(
            nearer,
            c.nearAround,
            lx - nearShift + nearShape[0],
            ly + nearShape[1],
          ) >= 3;
      }
      if (hasFar) {
        shapeAt(lx - farShift, ly, FAR_SCALE, 37.1, farShape);
        hasFar =
          nearby(far, c.farAround, lx - farShift + farShape[0], ly + farShape[1]) >=
          3;
      }
    }
    // Open sky: its colour, how much blue the painting has there, and a
    // tile of the same blue, paler.
    out[0] = out[4] = map[i * 4];
    out[1] = out[5] = map[i * 4 + 1];
    out[2] = out[6] = map[i * 4 + 2];
    out[3] = density[i];
    const wash = t.wash[0] + (t.wash[1] - t.wash[0]) * density[i];
    out[7] = wash;
    // No cloud near: open sky.
    if (!hasNear && !hasFar) return OPEN_SKY;
    let sum = 0; // how much cloud over the six points
    let bare = 1; // the least at any of them
    let most = 0; // and the most
    let shaded = 0;
    let nearSum = 0;
    let aN = 0;
    let aF = 0;
    let sN = 0;
    let sF = 0;
    for (let k = 0; k < 6; k++) {
      const x = x0 + REGIONS[k][0] * cw;
      const y = y0 + REGIONS[k][1] * ch;
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
      // The near cloud in front of the far one.
      const a = aN + aF * (1 - aN);
      want[k] = a * EDGE_INK;
      bare = Math.min(bare, a);
      most = Math.max(most, a);
      sum += a;
      nearSum += aN;
      shaded += (aN * sN + aF * (1 - aN) * sF) / 255;
    }
    // Hardly any cloud: still open sky.
    if (most < 0.14) return OPEN_SKY;
    const shade = sum > 0 ? shaded / sum : 0;
    const cover = sum / 6;
    // Which cloud the cell is on, for a texture that rides along with it.
    const onNear = nearSum >= sum * 0.5;
    const u = Math.floor((lx - (onNear ? nearShift : farShift)) / cw);
    const v = Math.floor(ly / ch);
    const inside = cover >= 0.6 && bare >= 0.3;
    // The tile: the cloud's, shaded, over the sky's by how much cloud
    // there is, the far clouds' a little fainter. So an edge is soft.
    lerp(t.tile, shade, tile, 0);
    const a =
      (inside ? smooth(0.55, 0.9, cover) : 0.8 * smooth(0.15, 0.9, cover)) *
      (onNear ? 1 : 0.85);
    const shown7 = a + (1 - a) * wash;
    for (let k = 0; k < 3; k++)
      out[4 + k] = (a * tile[k] + (1 - a) * wash * out[4 + k]) / shown7;
    out[7] = shown7;
    if (inside) {
      // Inside: a glyph on the tile by its shade.
      lerp(t.glyph, shade, out, 0);
      const jitter = (hash(u, v, onNear ? 3 : 5) - 0.5) * 1.5;
      return shadeGlyph(theme, shade, jitter, shown);
    }
    // The edge: the glyph that keeps its ink on the cloud's side.
    const best = shapeGlyph(shown);
    if (best < 0) {
      // A cell the cloud only grazes stays open sky.
      return want[5] < EDGE_INK * 0.35 ? OPEN_SKY : -1;
    }
    lerp(t.edge, shade, out, 0);
    return best;
  };

  return { at, cell };
}
