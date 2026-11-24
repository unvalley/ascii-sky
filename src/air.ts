/**
 * The air over the sky, a value a cell: the wind a visitor's pointer stirs
 * up. Moving the pointer through the sky pushes the air along with it; the
 * push spreads to the cells around and dies away. A click or tap sends a
 * gust out from where it lands: a front of wind that runs outwards, slowing
 * as it spreads, stronger some ways than others, and leaves the air it
 * passed moving and lit behind it. The air carries clouds with
 * it: each cell keeps how far its air has carried them (`dx`, `dy`, page
 * pixels), which slowly springs back, so a pushed cloud drifts back into
 * shape. `glow` is how much the air is moving, for the sky to light.
 *
 * The air is plain data and these functions change it in place: it is
 * stepped up to four times a frame over every cell, so nothing here
 * allocates once the air is made.
 */

import { hash } from "./hash.ts";

/** How long the parts of the air take to die away, in seconds. */
const WIND_LIFE = 0.45;
const GLOW_LIFE = 0.7;
/** Pushed clouds drift back over about this long. */
const SPRING = 2.6;
/** How much of the pointer's speed the air takes on, and the most it can. */
const DRAG = 0.55;
const MOST_SPEED = 900;
export const MOST_PUSH = 70;
/** The pointer's speed, in page pixels a second, that lights the air fully. */
const BRIGHT_SPEED = 1400;
/** How far round the pointer it pushes the air, in page pixels: as far
 * whatever the cells' size. */
const REACH = 28;
/**
 * A gust: how far its front runs (page pixels) and for how long (seconds),
 * how thick the front is either side (page pixels), the speed it gives the
 * air at first (page pixels a second) and the glow it adds a step, both
 * falling as it spreads, and how many stronger and weaker ways it blows.
 */
const GUST = { reach: 128, life: 0.8, band: 11, speed: 320, glow: 0.45, lanes: 9 };
/** The cell width the air's spreading was set for, in page pixels: on
 * smaller cells it spreads more often a step, so it reaches as far. */
const SPREAD_CELL = 8;
/** Behind a gust's front the air settles at once, so what shows is the
 * front running out, not a disc of wind: what of its wind and glow the
 * air keeps a step. */
const SETTLE = { wind: 0.7, glow: 0.82 };
/** Gusts blowing at once; another click takes the oldest one's place. */
const MOST_GUSTS = 4;
/** A gust's place in `gusts`: where it started, how old it is (seconds,
 * below 0 when the place is free), and how hard it blows each way round
 * (GUST.lanes values, see lanesOf). */
const GUST_X = 0;
const GUST_Y = 1;
const GUST_AGE = 2;
const GUST_LANES = 3;
export const GUST_SIZE = GUST_LANES + GUST.lanes;
/** The most glow a cell holds. */
const MOST_GLOW = 1.2;
/** Below this much movement anywhere, the air is still. */
const STILL = 0.05;
/** Air that lights a cell at all, or carries a cloud over it by this many
 * page pixels, shows: the sky works such cells out every frame
 * (shade.ts), and draws at the full rate while there are any (engine.ts). */
export const SEEN = { glow: 0.02, push: 2 };

export type Air = {
  readonly cols: number;
  readonly rows: number;
  /** A cell in page pixels. */
  readonly cw: number;
  readonly ch: number;
  /** The wind, page pixels a second. */
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  /** How far the air has carried the clouds, page pixels. */
  readonly dx: Float32Array;
  readonly dy: Float32Array;
  readonly glow: Float32Array;
  /** Room to spread a field into. */
  readonly spare: Float32Array;
  /** Where the pointer was last, and when (ms), while it is over the sky. */
  readonly pointer: { x: number; y: number; t: number; on: boolean };
  /** The gusts blowing (see GUST_SIZE), and how many there have been. */
  readonly gusts: Float64Array;
  puffs: number;
  /** Whether any air moves, so a still sky skips the work. */
  stirred: boolean;
  /** Whether it moves any cell enough to show (see SEEN), or a gust
   * blows: until it settles, the sky draws at its full rate. */
  lively: boolean;
};

/** Still air over `cols` × `rows` cells of `cw` × `ch` page pixels. */
export function createAir(cols: number, rows: number, cw: number, ch: number): Air {
  const n = cols * rows;
  return {
    cols,
    rows,
    cw,
    ch,
    vx: new Float32Array(n),
    vy: new Float32Array(n),
    dx: new Float32Array(n),
    dy: new Float32Array(n),
    glow: new Float32Array(n),
    spare: new Float32Array(n),
    pointer: { x: 0, y: 0, t: 0, on: false },
    gusts: new Float64Array(MOST_GUSTS * GUST_SIZE).fill(-1),
    puffs: 0,
    stirred: false,
    lively: false,
  };
}

/**
 * The air for a grid of this size: the same air, moving as it was, when
 * only the cells' size changes; still air when the grid does.
 */
export function fitAir(air: Air, cols: number, rows: number, cw: number, ch: number): Air {
  if (cols === air.cols && rows === air.rows)
    return cw === air.cw && ch === air.ch ? air : { ...air, cw, ch };
  return { ...createAir(cols, rows, cw, ch), pointer: air.pointer };
}

/**
 * Visits each cell within `reach` cells of page point (x, y) with its
 * weight, 1 at the middle, and marks the air as moving.
 */
function around(
  air: Air,
  x: number,
  y: number,
  reach: number,
  visit: (w: number, i: number, c: number, r: number) => void,
) {
  const { cols, rows, cw, ch } = air;
  const c0 = Math.floor(x / cw);
  const r0 = Math.floor(y / ch);
  const down = Math.ceil((reach * cw) / ch);
  const r1 = Math.min(rows - 1, r0 + down);
  const c1 = Math.min(cols - 1, c0 + reach);
  for (let r = Math.max(0, r0 - down); r <= r1; r++)
    for (let c = Math.max(0, c0 - reach); c <= c1; c++) {
      const d = Math.hypot(((c + 0.5) * cw - x) / cw, ((r + 0.5) * ch - y) / cw);
      if (d > reach + 0.5) continue;
      visit((1 - d / (reach + 1)) ** 2, r * cols + c, c, r);
    }
  air.stirred = true;
  air.lively = true;
}

/** The pointer is over the sky at page point (x, y), at `t` ms. */
export function blow(air: Air, x: number, y: number, t: number): void {
  const last = air.pointer;
  if (last.on && t > last.t) {
    const dt = Math.max(8, t - last.t) / 1000;
    let sx = (x - last.x) / dt;
    let sy = (y - last.y) / dt;
    const speed = Math.hypot(sx, sy);
    if (speed > MOST_SPEED) {
      sx *= MOST_SPEED / speed;
      sy *= MOST_SPEED / speed;
    }
    const lift = Math.min(1, speed / BRIGHT_SPEED);
    const { vx, vy, glow } = air;
    around(air, x, y, Math.max(1, Math.round(REACH / air.cw)), (w, i) => {
      vx[i] += (sx * DRAG - vx[i]) * w;
      vy[i] += (sy * DRAG - vy[i]) * w;
      glow[i] = Math.min(MOST_GLOW, glow[i] + w * lift);
    });
  }
  last.x = x;
  last.y = y;
  last.t = t;
  last.on = true;
}

/** The pointer has left the sky. */
export function calm(air: Air): void {
  air.pointer.on = false;
}

/** A gust of wind sent out from page point (x, y) (see GUST). */
export function puff(air: Air, x: number, y: number): void {
  const { gusts } = air;
  // A free place, or the oldest gust's.
  let at = 0;
  for (let g = 0; g < MOST_GUSTS; g++) {
    const age = gusts[g * GUST_SIZE + GUST_AGE];
    if (age < 0) {
      at = g;
      break;
    }
    if (age > gusts[at * GUST_SIZE + GUST_AGE]) at = g;
  }
  const o = at * GUST_SIZE;
  gusts[o + GUST_X] = x;
  gusts[o + GUST_Y] = y;
  gusts[o + GUST_AGE] = 0;
  lanesOf(++air.puffs, gusts, o + GUST_LANES);
  air.stirred = true;
  air.lively = true;
}

const smooth = (a: number, b: number, t: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

/**
 * How hard gust `seed` blows each way round, GUST.lanes values from 0 to
 * 1 into `out` from `at`: its strongest way all of it, its weakest none,
 * so every gust comes out in a few streams with calm between, as a gust
 * does, not as a ring.
 */
export function lanesOf(seed: number, out: Float64Array, at: number): void {
  let least = 1;
  let most = 0;
  for (let k = 0; k < GUST.lanes; k++) {
    const h = hash(k, seed, 71);
    out[at + k] = h;
    least = Math.min(least, h);
    most = Math.max(most, h);
  }
  for (let k = 0; k < GUST.lanes; k++)
    out[at + k] = smooth(0.25, 0.75, (out[at + k] - least) / (most - least || 1));
}

/** How hard the gust whose lanes are in `lanes` from `at` blows towards
 * `angle` (radians), smoothly between its lanes. */
export function laneAt(lanes: Float64Array, at: number, angle: number): number {
  const p = (angle / (Math.PI * 2) + 1) * GUST.lanes;
  const i = Math.floor(p);
  const f = p - i;
  const a = lanes[at + (i % GUST.lanes)];
  const b = lanes[at + ((i + 1) % GUST.lanes)];
  return a + (b - a) * f * f * (3 - 2 * f);
}

/** Blows gust `g` at its age: its front, a ring as far out as it has run,
 * pushes the air there outwards and lights it, and the air it has passed
 * settles. */
function blowFront(air: Air, g: number) {
  const { cols, rows, cw, ch, vx, vy, glow, gusts } = air;
  const o = g * GUST_SIZE;
  const gx = gusts[o + GUST_X];
  const gy = gusts[o + GUST_Y];
  const fade = 1 - gusts[o + GUST_AGE] / GUST.life;
  // Fast at first, slowing as it spreads.
  const radius = GUST.reach * (1 - fade * fade);
  const band = GUST.band;
  const speed = GUST.speed * fade;
  const lift = GUST.glow * fade;
  const out = radius + band;
  const r1 = Math.min(rows - 1, Math.floor((gy + out) / ch));
  const c1 = Math.min(cols - 1, Math.floor((gx + out) / cw));
  for (let r = Math.max(0, Math.floor((gy - out) / ch)); r <= r1; r++)
    for (let c = Math.max(0, Math.floor((gx - out) / cw)); c <= c1; c++) {
      const ox = (c + 0.5) * cw - gx;
      const oy = (r + 0.5) * ch - gy;
      const d = Math.sqrt(ox * ox + oy * oy);
      const i = r * cols + c;
      if (d < radius - band) {
        vx[i] *= SETTLE.wind;
        vy[i] *= SETTLE.wind;
        glow[i] *= SETTLE.glow;
        continue;
      }
      const off = Math.abs(d - radius);
      if (off >= band || d === 0) continue;
      const w = (1 - off / band) * laneAt(gusts, o + GUST_LANES, Math.atan2(oy, ox));
      vx[i] += ((ox / d) * speed - vx[i]) * w;
      vy[i] += ((oy / d) * speed - vy[i]) * w;
      glow[i] = Math.min(MOST_GLOW, glow[i] + lift * w);
    }
}

/** Blows every gust on by `dt` seconds; whether any still blows. */
function blowGusts(air: Air, dt: number): boolean {
  const { gusts } = air;
  let blowing = false;
  for (let g = 0; g < MOST_GUSTS; g++) {
    const o = g * GUST_SIZE + GUST_AGE;
    if (gusts[o] < 0) continue;
    blowFront(air, g);
    gusts[o] += dt;
    if (gusts[o] >= GUST.life) gusts[o] = -1;
    else blowing = true;
  }
  return blowing;
}

/**
 * Blurs `field` into its four neighbours by `share`, then scales it by
 * `keep`; past the edges a cell counts itself. The first and last column
 * are done apart, so the cells between need no edge checks. (A grid has at
 * least two columns.)
 */
function spread(air: Air, field: Float32Array, share: number, keep: number) {
  const { cols, rows, spare } = air;
  const self = 1 - share;
  const side = share / 4;
  const last = cols - 1;
  for (let r = 0; r < rows; r++) {
    const row = r * cols;
    const end = row + last;
    // Above the top row and below the bottom one, a cell is its own neighbour.
    const up = r > 0 ? -cols : 0;
    const dn = r < rows - 1 ? cols : 0;
    let v = field[row];
    spare[row] =
      (v * self + (v + field[row + 1] + field[row + up] + field[row + dn]) * side) * keep;
    for (let i = row + 1; i < end; i++) {
      v = field[i];
      spare[i] =
        (v * self + (field[i - 1] + field[i + 1] + field[i + up] + field[i + dn]) * side) * keep;
    }
    v = field[end];
    spare[end] =
      (v * self + (field[end - 1] + v + field[end + up] + field[end + dn]) * side) * keep;
  }
  field.set(spare);
}

/** Moves the air on by `dt` seconds. */
export function stepAir(air: Air, dt: number): void {
  if (!air.stirred) return;
  const blowing = blowGusts(air, dt);
  const { vx, vy, dx, dy, glow } = air;
  const wind = Math.exp(-dt / WIND_LIFE);
  const shine = Math.exp(-dt / GLOW_LIFE);
  const spring = Math.exp(-dt / SPRING);
  let most = 0;
  for (let i = 0; i < dx.length; i++) {
    let px = (dx[i] + vx[i] * dt) * spring;
    let py = (dy[i] + vy[i] * dt) * spring;
    // Not Math.hypot, which is several times slower; these never overflow.
    const d = Math.sqrt(px * px + py * py);
    if (d > MOST_PUSH) {
      px *= MOST_PUSH / d;
      py *= MOST_PUSH / d;
    }
    dx[i] = px;
    dy[i] = py;
    const pushed = Math.abs(px) + Math.abs(py);
    const lit = glow[i] * 40;
    if (pushed > most) most = pushed;
    if (lit > most) most = lit;
  }
  // Spreading goes a cell a pass, as far as the square root of the passes:
  // on cells smaller than SPREAD_CELL, more passes, so the air spreads as
  // far in page pixels; each pass keeps its share of what the step keeps.
  const passes = Math.max(1, Math.round((SPREAD_CELL / air.cw) ** 2));
  const keepWind = wind ** (1 / passes);
  const keepShine = shine ** (1 / passes);
  for (let p = 0; p < passes; p++) {
    spread(air, vx, 0.5, keepWind);
    spread(air, vy, 0.5, keepWind);
    spread(air, dx, 0.25, 1);
    spread(air, dy, 0.25, 1);
    spread(air, glow, 0.5, keepShine);
  }
  if (most < STILL && !blowing) {
    vx.fill(0);
    vy.fill(0);
    dx.fill(0);
    dy.fill(0);
    glow.fill(0);
    air.stirred = false;
  }
  air.lively = blowing || (air.stirred && seenAnywhere(air));
}

/** Whether the air at cell `k` shows (see SEEN). */
export const seenAt = (air: Air, k: number): boolean =>
  air.glow[k] > SEEN.glow ||
  air.dx[k] > SEEN.push ||
  air.dx[k] < -SEEN.push ||
  air.dy[k] > SEEN.push ||
  air.dy[k] < -SEEN.push;

function seenAnywhere(air: Air): boolean {
  for (let k = 0; k < air.glow.length; k++) if (seenAt(air, k)) return true;
  return false;
}
