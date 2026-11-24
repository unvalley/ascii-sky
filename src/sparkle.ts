import { GLYPHS } from "./cells.ts";

export const TICK = 0.09;

type Step = readonly (readonly [number, number, number])[];
const g = (s: string) => GLYPHS.indexOf(s);

const SMALL: readonly Step[] = [".", "+", "*", "+", "."].map((s) => [[0, 0, g(s)]] as const);

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

export const MOST = { big: 4, small: 12 };

type Sparkle = { steps: readonly Step[] | null; age: number; c: number; r: number; tint: number };

export type Sparkles = {
  readonly cols: number;
  readonly rows: number;
  readonly code: Int16Array;
  readonly tint: Uint8Array;
  readonly touched: Uint8Array;
  readonly touchedRows: Uint8Array;
  readonly pool: Sparkle[];
  owed: number;
};

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

function lay(sp: Sparkles, s: Sparkle, on: boolean) {
  const step = s.steps?.[s.age];
  if (!step) {
    return;
  }
  for (const [dc, dr, glyph] of step) {
    const c = s.c + dc;
    const r = s.r + dr;
    if (c < 0 || r < 0 || c >= sp.cols || r >= sp.rows) {
      continue;
    }
    const k = r * sp.cols + c;
    sp.code[k] = on ? glyph : -1;
    sp.tint[k] = s.tint;
    sp.touched[k] = 1;
    sp.touchedRows[r] = 1;
  }
}

function crowded(sp: Sparkles, steps: readonly Step[], c: number, r: number) {
  const reach = steps === BIG ? 2 : 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -reach; dc <= reach; dc++) {
      const cc = c + dc;
      const rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= sp.cols || rr >= sp.rows) {
        return true;
      }
      if (sp.code[rr * sp.cols + cc] >= 0) {
        return true;
      }
    }
  }
  return false;
}

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
      if (!s.steps) {
        continue;
      }
      lay(sp, s, false);
      s.age++;
      if (s.age >= s.steps.length) {
        s.steps = null;
        continue;
      }
      lay(sp, s, true);
      if (s.steps === BIG) {
        big++;
      } else {
        small++;
      }
    }
    const spawn = (steps: readonly Step[]) => {
      const free = sp.pool.find((s) => !s.steps);
      if (!free) {
        return;
      }
      for (let tries = 0; tries < 24; tries++) {
        const c = 2 + Math.floor(random() * (sp.cols - 4));
        const r = 1 + Math.floor(random() * Math.max(1, Math.min(rows, sp.rows) - 2));
        if (!isStar(c, r) || crowded(sp, steps, c, r)) {
          continue;
        }
        free.steps = steps;
        free.age = 0;
        free.c = c;
        free.r = r;
        free.tint = Math.floor(random() * TINTS.length);
        lay(sp, free, true);
        return;
      }
    };
    if (big < MOST.big && random() < 0.35) {
      spawn(BIG);
    }
    for (let i = 0; i < 2; i++) {
      if (small < MOST.small && random() < 0.6) {
        spawn(SMALL);
      }
    }
  }
}
