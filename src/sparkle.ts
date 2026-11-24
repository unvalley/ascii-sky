/**
 * Sparkles in the night sky: now and then a star glints (. + * + .), or opens into a cross and
 * closes again. Each tick steps every sparkle a frame and lays its glyphs
 * over the cells it covers; the sky draws them where it is open (see
 * shade.ts). Cells whose sparkle glyph changed are marked, row by row, so
 * the sky works them out even on a frame that isn't their row's turn.
 *
 * Plain data changed in place; nothing allocates once it is made.
 */
import { GLYPHS } from "./cells.ts";

/** How long a sparkle's frame lasts, in seconds. */
export const TICK = 0.09;

/** [column offset, row offset, glyph] for each cell a frame draws. */
type Step = readonly (readonly [number, number, number])[];
const g = (s: string) => GLYPHS.indexOf(s);

/** A glint: . + * + . */
const SMALL: readonly Step[] = [".", "+", "*", "+", "."].map((s) => [[0, 0, g(s)]] as const);

/** A star that opens into a cross and closes again. */
const BIG: readonly Step[] = [
  [[0, 0, g(".")]],
  [[0, 0, g("+")]],
  [
    [0, 0, g("*")],
    [-1, 0, g("-")],
    [1, 0, g("-")],
    [0, -1, g("|")],
    [0, 1, g("|")],
  ],
  [
    [0, 0, g("*")],
    [-1, 0, g("-")],
    [1, 0, g("-")],
    [-2, 0, g(".")],
    [2, 0, g(".")],
    [0, -1, g("|")],
    [0, 1, g("|")],
  ],
  [
    [0, 0, g("+")],
    [-1, 0, g("-")],
    [1, 0, g("-")],
    [0, -1, g("'")],
    [0, 1, g(".")],
  ],
  [[0, 0, g("+")]],
  [[0, 0, g(".")]],
];

/** How many of each are out at once, at most. */
export const MOST = { big: 4, small: 12 };

type Sparkle = { steps: readonly Step[] | null; age: number; c: number; r: number; tint: number };

export type Sparkles = {
  readonly cols: number;
  readonly rows: number;
  /** The glyph over each cell, -1 for none, and its tint (see TINTS). */
  readonly code: Int16Array;
  readonly tint: Uint8Array;
  /** Cells, and rows, whose glyph changed since the sky last drew them. */
  readonly touched: Uint8Array;
  readonly touchedRows: Uint8Array;
  readonly pool: Sparkle[];
  /** Seconds owed to the next tick. */
  owed: number;
};

/** The colours a sparkle takes on the dark page: white, pale gold, pale
 * sky. */
export const TINTS = [
  [255, 255, 255],
  [253, 230, 138],
  [224, 247, 255],
] as const;

export function createSparkles(cols: number, rows: number): Sparkles {
  return {
    cols,
    rows,
    code: new Int16Array(cols * rows).fill(-1),
    tint: new Uint8Array(cols * rows),
    touched: new Uint8Array(cols * rows),
    touchedRows: new Uint8Array(rows),
    pool: Array.from({ length: MOST.big + MOST.small }, () => ({
      steps: null,
      age: 0,
      c: 0,
      r: 0,
      tint: 0,
    })),
    owed: 0,
  };
}

/** Lays sparkle `s`'s current frame over the cells, or takes it off. */
function lay(sp: Sparkles, s: Sparkle, on: boolean) {
  const step = s.steps?.[s.age];
  if (!step) return;
  for (const [dc, dr, glyph] of step) {
    const c = s.c + dc;
    const r = s.r + dr;
    if (c < 0 || r < 0 || c >= sp.cols || r >= sp.rows) continue;
    const k = r * sp.cols + c;
    sp.code[k] = on ? glyph : -1;
    sp.tint[k] = s.tint;
    sp.touched[k] = 1;
    sp.touchedRows[r] = 1;
  }
}

/** Whether any cell a sparkle of `steps` at (c, r) would cover is taken. */
function crowded(sp: Sparkles, steps: readonly Step[], c: number, r: number) {
  const reach = steps === BIG ? 2 : 0;
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -reach; dc <= reach; dc++) {
      const cc = c + dc;
      const rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= sp.cols || rr >= sp.rows) return true;
      if (sp.code[rr * sp.cols + cc] >= 0) return true;
    }
  return false;
}

/**
 * Moves the sparkles on by `dt` seconds, a frame a tick, starting new ones
 * on stars: `isStar(c, r)` says where they are, among the first `rows`
 * rows. `random` gives numbers in [0, 1).
 */
export function stepSparkles(
  sp: Sparkles,
  dt: number,
  rows: number,
  isStar: (c: number, r: number) => boolean,
  random: () => number = Math.random,
): void {
  sp.owed += dt;
  while (sp.owed >= TICK) {
    sp.owed -= TICK;
    let big = 0;
    let small = 0;
    for (const s of sp.pool) {
      if (!s.steps) continue;
      lay(sp, s, false);
      s.age++;
      if (s.age >= s.steps.length) {
        s.steps = null;
        continue;
      }
      lay(sp, s, true);
      if (s.steps === BIG) big++;
      else small++;
    }
    const spawn = (steps: readonly Step[]) => {
      const free = sp.pool.find((s) => !s.steps);
      if (!free) return;
      // A star, if one turns up in a few tries.
      for (let tries = 0; tries < 24; tries++) {
        const c = 2 + Math.floor(random() * (sp.cols - 4));
        const r = 1 + Math.floor(random() * Math.max(1, Math.min(rows, sp.rows) - 2));
        if (!isStar(c, r) || crowded(sp, steps, c, r)) continue;
        free.steps = steps;
        free.age = 0;
        free.c = c;
        free.r = r;
        free.tint = Math.floor(random() * TINTS.length);
        lay(sp, free, true);
        return;
      }
    };
    if (big < MOST.big && random() < 0.35) spawn(BIG);
    for (let i = 0; i < 2; i++) if (small < MOST.small && random() < 0.6) spawn(SMALL);
  }
}
