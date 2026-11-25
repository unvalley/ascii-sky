import { type Air, seenAt } from "./air.ts";
import {
  glyphOf,
  hash,
  OPEN_SKY,
  range,
  SKY_RAMP,
  type SkyCells,
  type SkyTheme,
  span,
} from "./cells.ts";

const SINE_SIZE = 4096;
const SINE = Float64Array.from({ length: SINE_SIZE + 1 }, (_, i) =>
  Math.sin((i / SINE_SIZE) * Math.PI * 2),
);
const PER_RADIAN = SINE_SIZE / (Math.PI * 2);

export const sine = (a: number): number => {
  const turns = a * PER_RADIAN;
  const at = turns - Math.floor(turns / SINE_SIZE) * SINE_SIZE;
  const i = at | 0;
  const v = SINE[i];
  return v + (SINE[i + 1] - v) * (at - i);
};

export type Grid = Readonly<{
  width: number;
  height: number;
  dpr: number;
  pw: number;
  ph: number;
  cw: number;
  ch: number;
  cols: number;
  rows: number;
  originX: number;
  skyX: number;
  left: Int32Array;
  across: Int32Array;
  top: Int32Array;
  down: Int32Array;
  faint: number;
  faintRow: number;
}>;

export type Cell = Readonly<{ cw: number; ch: number }>;

export const layoutGrid = (
  width: number,
  height: number,
  dpr: number,
  skyWidth: number,
  { cw, ch }: Cell,
  faint = 0,
): Grid => {
  const half = Math.floor(width / 2 / cw);
  const originX = width / 2 - half * cw;
  const cols = half * 2;
  const rows = Math.ceil(height / ch);
  const xAt = (c: number) => originX + c * cw;
  const left = Int32Array.from({ length: cols }, (_, c) => Math.round(xAt(c) * dpr));
  const top = Int32Array.from({ length: rows }, (_, r) => Math.round(r * ch * dpr));
  return {
    width,
    height,
    dpr,
    pw: Math.round(width * dpr),
    ph: Math.round(height * dpr),
    cw,
    ch,
    cols,
    rows,
    originX,
    skyX: skyWidth / 2 - width / 2,
    left,
    across: left.map((from, c) => Math.round((xAt(c) + cw) * dpr) - from),
    top,
    down: top.map((from, r) => Math.round((r * ch + ch) * dpr) - from),
    faint,
    faintRow: faint > 0 ? Math.min(rows, Math.ceil(faint / ch)) : rows,
  };
};

const GLOW = { light: [16, 82, 214], dark: [214, 240, 255], vice: [0, 190, 230] } as const;
const WIND_TINT = {
  light: { glyph: 1, tile: 0 },
  dark: { glyph: 1, tile: 0 },
  vice: { glyph: 2.2, tile: 0.4 },
} as const;
const STREAK = { glow: 0.28, speed: 50 };
const GUSTY = 0.7;
const LEVEL = 2.4;
const UNLIT = 0.02;
const ALONG = glyphOf("-");
const GUST = glyphOf("~");
const UP = glyphOf("|");
const RISING = glyphOf("/");
const FALLING = glyphOf("\\");
const RAMP = [...SKY_RAMP].map(glyphOf);
const STAR = [...".......++*"].map(glyphOf);
export const TURNS = 3;
export const EVERY_ROW = -1;
export const UNDRAWN = -2;

export type Stars = Readonly<{
  stars: number;
  star: readonly number[];
  glow: readonly number[];
  sparkle?: boolean;
}>;

export const NIGHT: Stars = {
  stars: 0.03,
  star: [255, 246, 216],
  glow: [176, 200, 255],
  sparkle: true,
};
const NO_STARS: Stars = { stars: 0, star: [255, 255, 255], glow: GLOW.dark };

export const starAt = (sc: number, r: number, share: number): boolean => hash(sc, r, 101) < share;

export const TICK = 0.09;
export const MOST = { big: 4, small: 12 };
export const TINTS = [
  [255, 255, 255],
  [253, 230, 138],
  [224, 247, 255],
] as const;

type Step = readonly (readonly [number, number, number])[];

const SMALL: readonly Step[] = [...".+*+."].map((s) => [[0, 0, glyphOf(s)]] as const);
const BIG: readonly Step[] = [
  [[0, 0, glyphOf(".")]],
  [[0, 0, glyphOf("+")]],
  [
    [0, 0, glyphOf("*")],
    [-1, 0, glyphOf("-")],
    [1, 0, glyphOf("-")],
    [0, -1, glyphOf("|")],
    [0, 1, glyphOf("|")],
  ],
  [
    [0, 0, glyphOf("*")],
    [-1, 0, glyphOf("-")],
    [1, 0, glyphOf("-")],
    [-2, 0, glyphOf(".")],
    [2, 0, glyphOf(".")],
    [0, -1, glyphOf("|")],
    [0, 1, glyphOf("|")],
  ],
  [
    [0, 0, glyphOf("+")],
    [-1, 0, glyphOf("-")],
    [1, 0, glyphOf("-")],
    [0, -1, glyphOf("'")],
    [0, 1, glyphOf(".")],
  ],
  [[0, 0, glyphOf("+")]],
  [[0, 0, glyphOf(".")]],
];

type Sparkle = Readonly<{
  steps: readonly Step[] | null;
  age: number;
  c: number;
  r: number;
  tint: number;
}>;

const GONE: Sparkle = { steps: null, age: 0, c: 0, r: 0, tint: 0 };

export type Sparkles = {
  readonly cols: number;
  readonly rows: number;
  readonly code: Int16Array;
  readonly tint: Uint8Array;
  readonly touched: Uint8Array;
  readonly touchedRows: Uint8Array;
  pool: readonly Sparkle[];
  owed: number;
};

export const createSparkles = (cols: number, rows: number): Sparkles => ({
  cols,
  rows,
  code: new Int16Array(cols * rows).fill(-1),
  tint: new Uint8Array(cols * rows),
  touched: new Uint8Array(cols * rows),
  touchedRows: new Uint8Array(rows),
  pool: range(MOST.big + MOST.small).map(() => GONE),
  owed: 0,
});

const lay = (sp: Sparkles, s: Sparkle, on: boolean) => {
  const step = s.steps?.[s.age] ?? [];
  step.forEach(([dc, dr, glyph]) => {
    const c = s.c + dc;
    const r = s.r + dr;
    if (c < 0 || r < 0 || c >= sp.cols || r >= sp.rows) {
      return;
    }
    const k = r * sp.cols + c;
    sp.code[k] = on ? glyph : -1;
    sp.tint[k] = s.tint;
    sp.touched[k] = 1;
    sp.touchedRows[r] = 1;
  });
};

const crowded = (sp: Sparkles, steps: readonly Step[], c: number, r: number) => {
  const reach = steps === BIG ? 2 : 0;
  return span(r - 1, r + 1).some((rr) =>
    span(c - reach, c + reach).some(
      (cc) => cc < 0 || rr < 0 || cc >= sp.cols || rr >= sp.rows || sp.code[rr * sp.cols + cc] >= 0,
    ),
  );
};

type Spot = Readonly<{ c: number; r: number }>;

const findSpot = (
  sp: Sparkles,
  steps: readonly Step[],
  rows: number,
  isStar: (c: number, r: number) => boolean,
  random: () => number,
  tries: number,
): Spot | null => {
  if (tries === 0) {
    return null;
  }
  const c = 2 + Math.floor(random() * (sp.cols - 4));
  const r = 1 + Math.floor(random() * Math.max(1, Math.min(rows, sp.rows) - 2));
  return isStar(c, r) && !crowded(sp, steps, c, r)
    ? { c, r }
    : findSpot(sp, steps, rows, isStar, random, tries - 1);
};

const spawn = (
  sp: Sparkles,
  pool: readonly Sparkle[],
  steps: readonly Step[],
  rows: number,
  isStar: (c: number, r: number) => boolean,
  random: () => number,
): readonly Sparkle[] => {
  const slot = pool.findIndex((s) => !s.steps);
  const spot = slot < 0 ? null : findSpot(sp, steps, rows, isStar, random, 24);
  if (!spot) {
    return pool;
  }
  const born = { steps, age: 0, ...spot, tint: Math.floor(random() * TINTS.length) };
  lay(sp, born, true);
  return pool.map((s, i) => (i === slot ? born : s));
};

const older = (sp: Sparkles, s: Sparkle): Sparkle => {
  if (!s.steps) {
    return s;
  }
  lay(sp, s, false);
  const next = s.age + 1 < s.steps.length ? { ...s, age: s.age + 1 } : GONE;
  lay(sp, next, true);
  return next;
};

const tickSparkles = (
  sp: Sparkles,
  pool: readonly Sparkle[],
  rows: number,
  isStar: (c: number, r: number) => boolean,
  random: () => number,
): readonly Sparkle[] => {
  const now = pool.map((s) => older(sp, s));
  const big = now.filter((s) => s.steps === BIG).length;
  const small = now.filter((s) => s.steps === SMALL).length;
  const withBig =
    big < MOST.big && random() < 0.35 ? spawn(sp, now, BIG, rows, isStar, random) : now;
  return range(2).reduce(
    (p) => (small < MOST.small && random() < 0.6 ? spawn(sp, p, SMALL, rows, isStar, random) : p),
    withBig,
  );
};

export const stepSparkles = (
  sp: Sparkles,
  dt: number,
  rows: number,
  isStar: (c: number, r: number) => boolean,
  random: () => number = Math.random,
): void => {
  const settle = (debt: number, live: readonly Sparkle[]): readonly [number, readonly Sparkle[]] =>
    debt >= TICK ? settle(debt - TICK, tickSparkles(sp, live, rows, isStar, random)) : [debt, live];
  const [owed, pool] = settle(sp.owed + dt, sp.pool);
  sp.owed = owed;
  sp.pool = pool;
};

export type Frame = Readonly<{
  colours: Uint8ClampedArray;
  tiles: Uint8ClampedArray;
  shown: Int16Array;
  changed: Int32Array;
  breath: Float32Array;
  out: number[];
  night: Stars;
  sparkles: Sparkles | null;
}>;

export const breathing = (cols: number, rows: number): Float32Array =>
  Float32Array.from({ length: cols * rows * 2 }, (_, i) => {
    const k = Math.floor(i / 2);
    const c = k % cols;
    const r = (k - c) / cols;
    return i % 2 === 0 ? hash(c, r, 23) * Math.PI * 2 : 0.25 + hash(c, r, 37) * 0.9;
  });

export const createFrame = (
  grid: Grid,
  colours: Uint8ClampedArray,
  tiles: Uint8ClampedArray,
  night: Stars = NO_STARS,
): Frame => {
  const { cols, rows } = grid;
  return {
    colours,
    tiles,
    shown: new Int16Array(cols * rows).fill(UNDRAWN),
    changed: new Int32Array(cols * rows),
    breath: breathing(cols, rows),
    out: [0, 0, 0, 0, 0, 0, 0, 0],
    night,
    sparkles: night.sparkle ? createSparkles(cols, rows) : null,
  };
};

export const streak = (vx: number, vy: number, glow: number): number => {
  const ax = Math.abs(vx);
  const ay = Math.abs(vy);
  if (ax > ay * LEVEL) {
    return glow > GUSTY ? GUST : ALONG;
  }
  if (ay > ax * LEVEL) {
    return UP;
  }
  return vx * vy < 0 ? RISING : FALLING;
};

const paint = (out: number[], rgb: readonly number[]) => {
  out[0] = rgb[0];
  out[1] = rgb[1];
  out[2] = rgb[2];
};

export const shadeFrame = (
  grid: Grid,
  cells: SkyCells,
  air: Air,
  frame: Frame,
  t: number,
  theme: SkyTheme,
  half: number = EVERY_ROW,
  every = 1,
  turn = 0,
): number => {
  const { cols, rows, cw, ch, originX, skyX, faintRow } = grid;
  const { colours, tiles, shown, changed, breath, out, night } = frame;
  const dark = theme === "dark";
  const glow = dark ? night.glow : GLOW[theme];
  const windTint = WIND_TINT[theme];
  const stars = dark ? night.stars : 0;
  const sparks = dark ? frame.sparkles : null;
  const { stirred, vx, vy, dx, dy } = air;
  const airGlow = air.glow;
  const top = RAMP.length - 1;
  const across = Float64Array.from({ length: cols }, (_, c) => Math.sin(c * 0.09 + t * 0.3));
  const downs = Float64Array.from({ length: rows }, (_, r) => Math.sin(r * 0.15 - t * 0.23));
  const cellAt = cells.at(t, theme);

  let n = 0;
  for (let r = 0; r < rows; r++) {
    if (r >= faintRow && half !== EVERY_ROW && (r & 1) !== half) {
      continue;
    }
    const offTurn = every > 1 && half !== EVERY_ROW && r % every !== turn;
    if (offTurn && !stirred && !sparks?.touchedRows[r]) {
      continue;
    }
    const y = r * ch;
    const down = downs[r];
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c;
      if (offTurn && !seenAt(air, k) && !sparks?.touched[k]) {
        continue;
      }
      const o = k * 4;
      const was = shown[k];
      const drawn = cellAt(
        originX + c * cw + skyX,
        y,
        cw,
        ch,
        out,
        was >= 0 ? was : -1,
        stirred ? dx[k] : 0,
        stirred ? dy[k] : 0,
      );
      let code = drawn;
      let alpha = 1;
      if (drawn === OPEN_SKY) {
        const breathe = 0.5 + 0.5 * sine(t * breath[k * 2 + 1] + breath[k * 2]);
        const band = 0.93 + 0.07 * across[c] * down;
        alpha = (0.9 + 0.1 * breathe) * band;
        out[7] *= band;
        code = RAMP[(out[3] * top + 0.5) | 0];
        if (stars > 0) {
          const sc = Math.floor((originX + c * cw + skyX) / cw);
          if (starAt(sc, r, stars)) {
            code = STAR[(hash(sc, r, 103) * STAR.length) | 0];
            const twinkle = 0.5 + 0.5 * sine(t * 2.2 * breath[k * 2 + 1] + breath[k * 2]);
            alpha = 0.35 + 0.65 * twinkle;
            paint(out, night.star);
          }
        }
        if (sparks) {
          const spark = sparks.code[k];
          sparks.touched[k] = 0;
          if (spark >= 0) {
            code = spark;
            paint(out, TINTS[sparks.tint[k]]);
            alpha = 1;
          }
        }
        const g = stirred ? Math.min(1, airGlow[k]) : 0;
        if (g > UNLIT) {
          alpha += (1 - alpha) * g;
          const m = Math.min(1, g * windTint.glyph);
          for (let j = 0; j < 3; j++) {
            out[j] += (glow[j] - out[j]) * m;
            out[4 + j] += (glow[j] - out[4 + j]) * g * windTint.tile;
          }
          const wx = vx[k];
          const wy = vy[k];
          if (g > STREAK.glow && Math.abs(wx) + Math.abs(wy) > STREAK.speed) {
            code = streak(wx, wy, g);
          }
        }
      }
      colours[o] = out[0];
      colours[o + 1] = out[1];
      colours[o + 2] = out[2];
      colours[o + 3] = code < 0 ? 0 : (alpha * 255 + 0.5) | 0;
      tiles[o] = out[4];
      tiles[o + 1] = out[5];
      tiles[o + 2] = out[6];
      tiles[o + 3] = (out[7] * 255 + 0.5) | 0;
      if (code !== shown[k]) {
        shown[k] = code;
        changed[n++] = k;
      }
    }
    if (sparks) {
      sparks.touchedRows[r] = 0;
    }
  }
  return n;
};
