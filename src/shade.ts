import { type Air, seenAt } from "./air.ts";
import {
  ALPHA,
  BLANK,
  BYTE_MAX,
  CENTRE,
  type CellAt,
  DENSITY,
  GLYPH_RGB,
  glyphOf,
  hash,
  hex,
  LOOK_SLOTS,
  OPEN_SKY,
  RGB,
  RGBA,
  range,
  rounded,
  SKY_RAMP,
  type SkyCells,
  type SkyTheme,
  span,
  TAU,
  TILE_ALPHA,
  TILE_RGB,
} from "./cells.ts";

const SINE_SIZE = 4096;
const SINE = Float64Array.from({ length: SINE_SIZE + 1 }, (_, i) =>
  Math.sin((i / SINE_SIZE) * Math.PI * 2),
);
const PER_RADIAN = SINE_SIZE / TAU;

export const sine = (a: number): number => {
  const turns = a * PER_RADIAN;
  const at = turns - Math.floor(turns / SINE_SIZE) * SINE_SIZE;
  const i = at | 0;
  const v = SINE[i];
  return v + (SINE[i + 1] - v) * (at - i);
};

const unit = (wave: number) => CENTRE + CENTRE * wave;

export type Grid = Readonly<{
  width: number;
  height: number;
  dpr: number;
  pixelWidth: number;
  pixelHeight: number;
  cellWidth: number;
  cellHeight: number;
  columns: number;
  rows: number;
  originX: number;
  skyOffset: number;
  columnLeft: Int32Array;
  columnWidth: Int32Array;
  rowTop: Int32Array;
  rowHeight: Int32Array;
  faintFrom: number;
  faintRow: number;
}>;

export type CellSize = Readonly<{ width: number; height: number }>;

export const layoutGrid = (
  width: number,
  height: number,
  dpr: number,
  skyWidth: number,
  cell: CellSize,
  faintFrom = 0,
): Grid => {
  const half = Math.floor(width / 2 / cell.width);
  const originX = width / 2 - half * cell.width;
  const columns = half * 2;
  const rows = Math.ceil(height / cell.height);
  const xAt = (c: number) => originX + c * cell.width;
  const columnLeft = Int32Array.from({ length: columns }, (_, c) => Math.round(xAt(c) * dpr));
  const rowTop = Int32Array.from({ length: rows }, (_, r) => Math.round(r * cell.height * dpr));
  return {
    width,
    height,
    dpr,
    pixelWidth: Math.round(width * dpr),
    pixelHeight: Math.round(height * dpr),
    cellWidth: cell.width,
    cellHeight: cell.height,
    columns,
    rows,
    originX,
    skyOffset: skyWidth / 2 - width / 2,
    columnLeft,
    columnWidth: columnLeft.map((left, c) => Math.round((xAt(c) + cell.width) * dpr) - left),
    rowTop,
    rowHeight: rowTop.map((top, r) => Math.round((r * cell.height + cell.height) * dpr) - top),
    faintFrom,
    faintRow: faintFrom > 0 ? Math.min(rows, Math.ceil(faintFrom / cell.height)) : rows,
  };
};

const GLOW = { light: hex("#1052d6"), dark: hex("#d6f0ff"), sunset: hex("#00bee6") };
const WIND_TINT = {
  light: { glyph: 1, tile: 0 },
  dark: { glyph: 1, tile: 0 },
  sunset: { glyph: 2.2, tile: 0.4 },
};
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
const BAND = {
  across: 0.09,
  acrossSpeed: 0.3,
  down: 0.15,
  downSpeed: 0.23,
  light: 0.93,
  depth: 0.07,
};
const BREATH = { floor: 0.9, depth: 0.1 };
const BREATH_SEED = { phase: 23, pace: 37 };
const BREATH_PACE = { slowest: 0.25, spread: 0.9 };
const TWINKLE = { floor: 0.35, depth: 0.65, speed: 2.2 };
const STAR_SEED = { place: 101, glyph: 103 };
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
  star: hex("#fff6d8"),
  glow: hex("#b0c8ff"),
  sparkle: true,
};
const NO_STARS: Stars = { stars: 0, star: hex("#ffffff"), glow: GLOW.dark };

export const starAt = (column: number, row: number, share: number): boolean =>
  hash(column, row, STAR_SEED.place) < share;

export const TICK = 0.09;
export const MOST = { big: 4, small: 12 };
export const TINTS = [hex("#ffffff"), hex("#fde68a"), hex("#e0f7ff")];
const SPAWN_TRIES = 24;
const SPAWN_MARGIN = { columns: 2, rows: 1 };
const BIG_CHANCE = 0.35;
const SMALL_CHANCE = 0.6;
const SMALL_TRIES = 2;
const BIG_REACH = 2;

type Step = readonly (readonly [number, number, number])[];

const picture = (...lines: string[]): Step => {
  const middleRow = (lines.length - 1) / 2;
  const middleColumn = (lines[0].length - 1) / 2;
  return lines.flatMap((line, y) =>
    [...line].flatMap((glyph, x) =>
      glyph === " " ? [] : [[x - middleColumn, y - middleRow, glyphOf(glyph)] as const],
    ),
  );
};

const SMALL: readonly Step[] = [...".+*+."].map((glyph) => picture(glyph));
const BIG: readonly Step[] = [
  picture("."),
  picture("+"),
  picture(" | ", "-*-", " | "),
  picture("  |  ", ".-*-.", "  |  "),
  picture(" ' ", "-+-", " . "),
  picture("+"),
  picture("."),
];

type Sparkle = Readonly<{
  steps: readonly Step[] | null;
  age: number;
  column: number;
  row: number;
  tint: number;
}>;

const GONE: Sparkle = { steps: null, age: 0, column: 0, row: 0, tint: 0 };

export type Sparkles = {
  readonly columns: number;
  readonly rows: number;
  readonly code: Int16Array;
  readonly tint: Uint8Array;
  readonly touched: Uint8Array;
  readonly touchedRows: Uint8Array;
  pool: readonly Sparkle[];
  owed: number;
};

export const createSparkles = (columns: number, rows: number): Sparkles => ({
  columns,
  rows,
  code: new Int16Array(columns * rows).fill(BLANK),
  tint: new Uint8Array(columns * rows),
  touched: new Uint8Array(columns * rows),
  touchedRows: new Uint8Array(rows),
  pool: range(MOST.big + MOST.small).map(() => GONE),
  owed: 0,
});

const lay = (sp: Sparkles, s: Sparkle, on: boolean) => {
  const step = s.steps?.[s.age] ?? [];
  step.forEach(([dc, dr, glyph]) => {
    const c = s.column + dc;
    const r = s.row + dr;
    if (c < 0 || r < 0 || c >= sp.columns || r >= sp.rows) {
      return;
    }
    const k = r * sp.columns + c;
    sp.code[k] = on ? glyph : BLANK;
    sp.tint[k] = s.tint;
    sp.touched[k] = 1;
    sp.touchedRows[r] = 1;
  });
};

const crowded = (sp: Sparkles, steps: readonly Step[], column: number, row: number) => {
  const reach = steps === BIG ? BIG_REACH : 0;
  return span(row - 1, row + 1).some((r) =>
    span(column - reach, column + reach).some(
      (c) => c < 0 || r < 0 || c >= sp.columns || r >= sp.rows || sp.code[r * sp.columns + c] >= 0,
    ),
  );
};

type Spot = Readonly<{ column: number; row: number }>;

const findSpot = (
  sp: Sparkles,
  steps: readonly Step[],
  rows: number,
  isStar: (column: number, row: number) => boolean,
  random: () => number,
  tries: number,
): Spot | null => {
  if (tries === 0) {
    return null;
  }
  const column =
    SPAWN_MARGIN.columns + Math.floor(random() * (sp.columns - 2 * SPAWN_MARGIN.columns));
  const row =
    SPAWN_MARGIN.rows +
    Math.floor(random() * Math.max(1, Math.min(rows, sp.rows) - 2 * SPAWN_MARGIN.rows));
  return isStar(column, row) && !crowded(sp, steps, column, row)
    ? { column, row }
    : findSpot(sp, steps, rows, isStar, random, tries - 1);
};

const spawn = (
  sp: Sparkles,
  pool: readonly Sparkle[],
  steps: readonly Step[],
  rows: number,
  isStar: (column: number, row: number) => boolean,
  random: () => number,
): readonly Sparkle[] => {
  const slot = pool.findIndex((s) => !s.steps);
  const spot = slot < 0 ? null : findSpot(sp, steps, rows, isStar, random, SPAWN_TRIES);
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
  isStar: (column: number, row: number) => boolean,
  random: () => number,
): readonly Sparkle[] => {
  const now = pool.map((s) => older(sp, s));
  const big = now.filter((s) => s.steps === BIG).length;
  const small = now.filter((s) => s.steps === SMALL).length;
  const withBig =
    big < MOST.big && random() < BIG_CHANCE ? spawn(sp, now, BIG, rows, isStar, random) : now;
  return range(SMALL_TRIES).reduce(
    (p) =>
      small < MOST.small && random() < SMALL_CHANCE ? spawn(sp, p, SMALL, rows, isStar, random) : p,
    withBig,
  );
};

export const stepSparkles = (
  sp: Sparkles,
  dt: number,
  rows: number,
  isStar: (column: number, row: number) => boolean,
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
  look: number[];
  night: Stars;
  sparkles: Sparkles | null;
}>;

export const breathing = (columns: number, rows: number): Float32Array =>
  Float32Array.from({ length: columns * rows * 2 }, (_, i) => {
    const k = Math.floor(i / 2);
    const c = k % columns;
    const r = (k - c) / columns;
    return i % 2 === 0
      ? hash(c, r, BREATH_SEED.phase) * Math.PI * 2
      : BREATH_PACE.slowest + hash(c, r, BREATH_SEED.pace) * BREATH_PACE.spread;
  });

export const createFrame = (
  grid: Grid,
  colours: Uint8ClampedArray,
  tiles: Uint8ClampedArray,
  night: Stars = NO_STARS,
): Frame => {
  const { columns, rows } = grid;
  return {
    colours,
    tiles,
    shown: new Int16Array(columns * rows).fill(UNDRAWN),
    changed: new Int32Array(columns * rows),
    breath: breathing(columns, rows),
    look: range(LOOK_SLOTS).map(() => 0),
    night,
    sparkles: night.sparkle ? createSparkles(columns, rows) : null,
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

const paint = (look: number[], rgb: readonly number[]) => {
  look[GLYPH_RGB] = rgb[0];
  look[GLYPH_RGB + 1] = rgb[1];
  look[GLYPH_RGB + 2] = rgb[2];
};

type Pass = Readonly<{
  grid: Grid;
  frame: Frame;
  air: Air;
  cellAt: CellAt;
  t: number;
  glow: readonly number[];
  windTint: Readonly<{ glyph: number; tile: number }>;
  stars: number;
  sparks: Sparkles | null;
  across: Float64Array;
  down: number;
}>;

const shadeRow = (pass: Pass, r: number, offTurn: boolean, changesSoFar: number): number => {
  const { grid, frame, air, cellAt, t, glow, windTint, stars, sparks, across, down } = pass;
  const { columns, cellWidth, cellHeight, originX, skyOffset } = grid;
  const { colours, tiles, shown, changed, breath, look, night } = frame;
  const { stirred, vx, vy, dx, dy } = air;
  const densest = RAMP.length - 1;
  const y = r * cellHeight;
  let changes = changesSoFar;
  for (let c = 0; c < columns; c++) {
    const k = r * columns + c;
    if (offTurn && !seenAt(air, k) && !sparks?.touched[k]) {
      continue;
    }
    const o = k * RGBA;
    const was = shown[k];
    const drawn = cellAt(
      originX + c * cellWidth + skyOffset,
      y,
      cellWidth,
      cellHeight,
      look,
      was >= 0 ? was : BLANK,
      stirred ? dx[k] : 0,
      stirred ? dy[k] : 0,
    );
    let code = drawn;
    let alpha = 1;
    if (drawn === OPEN_SKY) {
      const phase = breath[k * 2];
      const pace = breath[k * 2 + 1];
      const breathe = unit(sine(t * pace + phase));
      const band = BAND.light + BAND.depth * across[c] * down;
      alpha = (BREATH.floor + BREATH.depth * breathe) * band;
      look[TILE_ALPHA] *= band;
      code = RAMP[rounded(look[DENSITY] * densest)];
      if (stars > 0) {
        const skyColumn = Math.floor((originX + c * cellWidth + skyOffset) / cellWidth);
        if (starAt(skyColumn, r, stars)) {
          code = STAR[(hash(skyColumn, r, STAR_SEED.glyph) * STAR.length) | 0];
          const twinkle = unit(sine(t * TWINKLE.speed * pace + phase));
          alpha = TWINKLE.floor + TWINKLE.depth * twinkle;
          paint(look, night.star);
        }
      }
      if (sparks) {
        const spark = sparks.code[k];
        sparks.touched[k] = 0;
        if (spark >= 0) {
          code = spark;
          paint(look, TINTS[sparks.tint[k]]);
          alpha = 1;
        }
      }
      const g = stirred ? Math.min(1, air.glow[k]) : 0;
      if (g > UNLIT) {
        alpha += (1 - alpha) * g;
        const m = Math.min(1, g * windTint.glyph);
        for (let j = 0; j < RGB; j++) {
          look[GLYPH_RGB + j] += (glow[j] - look[GLYPH_RGB + j]) * m;
          look[TILE_RGB + j] += (glow[j] - look[TILE_RGB + j]) * g * windTint.tile;
        }
        const wx = vx[k];
        const wy = vy[k];
        if (g > STREAK.glow && Math.abs(wx) + Math.abs(wy) > STREAK.speed) {
          code = streak(wx, wy, g);
        }
      }
    }
    colours[o] = look[GLYPH_RGB];
    colours[o + 1] = look[GLYPH_RGB + 1];
    colours[o + 2] = look[GLYPH_RGB + 2];
    colours[o + ALPHA] = code < 0 ? 0 : rounded(alpha * BYTE_MAX);
    tiles[o] = look[TILE_RGB];
    tiles[o + 1] = look[TILE_RGB + 1];
    tiles[o + 2] = look[TILE_RGB + 2];
    tiles[o + ALPHA] = rounded(look[TILE_ALPHA] * BYTE_MAX);
    if (code !== shown[k]) {
      shown[k] = code;
      changed[changes++] = k;
    }
  }
  return changes;
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
  const { columns, rows, faintRow } = grid;
  const dark = theme === "dark";
  const sparks = dark ? frame.sparkles : null;
  const across = Float64Array.from({ length: columns }, (_, c) =>
    Math.sin(c * BAND.across + t * BAND.acrossSpeed),
  );
  const shared = {
    grid,
    frame,
    air,
    cellAt: cells.at(t, theme),
    t,
    glow: dark ? frame.night.glow : GLOW[theme],
    windTint: WIND_TINT[theme],
    stars: dark ? frame.night.stars : 0,
    sparks,
    across,
  };
  const skipped = (r: number) => r >= faintRow && half !== EVERY_ROW && (r & 1) !== half;
  return range(rows).reduce((changes, r) => {
    const offTurn = every > 1 && half !== EVERY_ROW && r % every !== turn;
    if (skipped(r) || (offTurn && !air.stirred && !sparks?.touchedRows[r])) {
      return changes;
    }
    const down = Math.sin(r * BAND.down - t * BAND.downSpeed);
    const next = shadeRow({ ...shared, down }, r, offTurn, changes);
    if (sparks) {
      sparks.touchedRows[r] = 0;
    }
    return next;
  }, 0);
};
