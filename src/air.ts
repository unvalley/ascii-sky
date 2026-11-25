import { hash, range, smooth } from "./cells.ts";

const WIND_LIFE = 0.45;
const GLOW_LIFE = 0.7;
const SPRING = 2.6;
const DRAG = 0.55;
const MOST_SPEED = 900;
export const MOST_PUSH = 70;
const BRIGHT_SPEED = 1400;
const REACH = 28;
const GUST = { reach: 128, life: 0.8, band: 11, speed: 320, glow: 0.45, lanes: 9 };
const SPREAD_CELL = 8;
const SETTLE = { wind: 0.7, glow: 0.82 };
const MOST_GUSTS = 4;
const MOST_GLOW = 1.2;
const STILL = 0.05;
const SEEN = { glow: 0.02, push: 2 };

type Gust = Readonly<{ x: number; y: number; age: number; lanes: Float64Array }>;
type Pointer = Readonly<{ x: number; y: number; t: number; on: boolean }>;

const NO_GUST: Gust = { x: 0, y: 0, age: -1, lanes: new Float64Array(GUST.lanes) };

export type Air = {
  readonly cols: number;
  readonly rows: number;
  readonly cw: number;
  readonly ch: number;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly dx: Float32Array;
  readonly dy: Float32Array;
  readonly glow: Float32Array;
  readonly spare: Float32Array;
  pointer: Pointer;
  gusts: readonly Gust[];
  puffs: number;
  stirred: boolean;
  lively: boolean;
};

export const createAir = (cols: number, rows: number, cw: number, ch: number): Air => {
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
    gusts: range(MOST_GUSTS).map(() => NO_GUST),
    puffs: 0,
    stirred: false,
    lively: false,
  };
};

export const fitAir = (air: Air, cols: number, rows: number, cw: number, ch: number): Air => {
  if (cols === air.cols && rows === air.rows) {
    return cw === air.cw && ch === air.ch ? air : { ...air, cw, ch };
  }
  return { ...createAir(cols, rows, cw, ch), pointer: air.pointer };
};

const stir = (air: Air, x: number, y: number, sx: number, sy: number, lift: number) => {
  const { cols, rows, cw, ch, vx, vy, glow } = air;
  const reach = Math.max(1, Math.round(REACH / cw));
  const c0 = Math.floor(x / cw);
  const r0 = Math.floor(y / ch);
  const down = Math.ceil((reach * cw) / ch);
  const r1 = Math.min(rows - 1, r0 + down);
  const c1 = Math.min(cols - 1, c0 + reach);
  for (let r = Math.max(0, r0 - down); r <= r1; r++) {
    for (let c = Math.max(0, c0 - reach); c <= c1; c++) {
      const d = Math.hypot(((c + 0.5) * cw - x) / cw, ((r + 0.5) * ch - y) / cw);
      if (d > reach + 0.5) {
        continue;
      }
      const w = (1 - d / (reach + 1)) ** 2;
      const i = r * cols + c;
      vx[i] += (sx * DRAG - vx[i]) * w;
      vy[i] += (sy * DRAG - vy[i]) * w;
      glow[i] = Math.min(MOST_GLOW, glow[i] + w * lift);
    }
  }
  air.stirred = true;
  air.lively = true;
};

export const blow = (air: Air, x: number, y: number, t: number): void => {
  const last = air.pointer;
  if (last.on && t > last.t) {
    const dt = Math.max(8, t - last.t) / 1000;
    const wx = (x - last.x) / dt;
    const wy = (y - last.y) / dt;
    const speed = Math.hypot(wx, wy);
    const slower = speed > MOST_SPEED ? MOST_SPEED / speed : 1;
    stir(air, x, y, wx * slower, wy * slower, Math.min(1, speed / BRIGHT_SPEED));
  }
  air.pointer = { x, y, t, on: true };
};

export const calm = (air: Air): void => {
  air.pointer = { ...air.pointer, on: false };
};

const slotFor = (gusts: readonly Gust[]): number => {
  const free = gusts.findIndex((g) => g.age < 0);
  return free >= 0
    ? free
    : gusts.reduce((oldest, g, i) => (g.age > gusts[oldest].age ? i : oldest), 0);
};

export const puff = (air: Air, x: number, y: number): void => {
  const slot = slotFor(air.gusts);
  air.puffs += 1;
  const fresh = { x, y, age: 0, lanes: lanesOf(air.puffs) };
  air.gusts = air.gusts.map((g, i) => (i === slot ? fresh : g));
  air.stirred = true;
  air.lively = true;
};

export const lanesOf = (seed: number): Float64Array => {
  const heights = range(GUST.lanes).map((k) => hash(k, seed, 71));
  const least = Math.min(1, ...heights);
  const most = Math.max(0, ...heights);
  return Float64Array.from(heights, (h) => smooth(0.25, 0.75, (h - least) / (most - least || 1)));
};

export const laneAt = (lanes: Float64Array, angle: number): number => {
  const p = (angle / (Math.PI * 2) + 1) * GUST.lanes;
  const i = Math.floor(p);
  const f = p - i;
  const a = lanes[i % GUST.lanes];
  const b = lanes[(i + 1) % GUST.lanes];
  return a + (b - a) * f * f * (3 - 2 * f);
};

const blowFront = (air: Air, gust: Gust) => {
  const { cols, rows, cw, ch, vx, vy, glow } = air;
  const { x: gx, y: gy, lanes } = gust;
  const fade = 1 - gust.age / GUST.life;
  const radius = GUST.reach * (1 - fade * fade);
  const band = GUST.band;
  const speed = GUST.speed * fade;
  const lift = GUST.glow * fade;
  const out = radius + band;
  const r1 = Math.min(rows - 1, Math.floor((gy + out) / ch));
  const c1 = Math.min(cols - 1, Math.floor((gx + out) / cw));
  for (let r = Math.max(0, Math.floor((gy - out) / ch)); r <= r1; r++) {
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
      if (off >= band || d === 0) {
        continue;
      }
      const w = (1 - off / band) * laneAt(lanes, Math.atan2(oy, ox));
      vx[i] += ((ox / d) * speed - vx[i]) * w;
      vy[i] += ((oy / d) * speed - vy[i]) * w;
      glow[i] = Math.min(MOST_GLOW, glow[i] + lift * w);
    }
  }
};

const aged = (gust: Gust, dt: number): Gust => {
  if (gust.age < 0) {
    return gust;
  }
  const age = gust.age + dt;
  return age >= GUST.life ? NO_GUST : { ...gust, age };
};

const spread = (air: Air, field: Float32Array, share: number, keep: number) => {
  const { cols, rows, spare } = air;
  const self = 1 - share;
  const side = share / 4;
  const last = cols - 1;
  for (let r = 0; r < rows; r++) {
    const row = r * cols;
    const end = row + last;
    const up = r > 0 ? -cols : 0;
    const dn = r < rows - 1 ? cols : 0;
    const first = field[row];
    spare[row] =
      (first * self + (first + field[row + 1] + field[row + up] + field[row + dn]) * side) * keep;
    for (let i = row + 1; i < end; i++) {
      spare[i] =
        (field[i] * self + (field[i - 1] + field[i + 1] + field[i + up] + field[i + dn]) * side) *
        keep;
    }
    const final = field[end];
    spare[end] =
      (final * self + (field[end - 1] + final + field[end + up] + field[end + dn]) * side) * keep;
  }
  field.set(spare);
};

export const stepAir = (air: Air, dt: number): void => {
  if (!air.stirred) {
    return;
  }
  air.gusts
    .filter((g) => g.age >= 0)
    .forEach((g) => {
      blowFront(air, g);
    });
  air.gusts = air.gusts.map((g) => aged(g, dt));
  const blowing = air.gusts.some((g) => g.age >= 0);
  const { vx, vy, dx, dy, glow } = air;
  const wind = Math.exp(-dt / WIND_LIFE);
  const shine = Math.exp(-dt / GLOW_LIFE);
  const spring = Math.exp(-dt / SPRING);
  let most = 0;
  for (let i = 0; i < dx.length; i++) {
    const px = (dx[i] + vx[i] * dt) * spring;
    const py = (dy[i] + vy[i] * dt) * spring;
    const d = Math.sqrt(px * px + py * py);
    const keep = d > MOST_PUSH ? MOST_PUSH / d : 1;
    const kx = px * keep;
    const ky = py * keep;
    dx[i] = kx;
    dy[i] = ky;
    most = Math.max(most, Math.abs(kx) + Math.abs(ky), glow[i] * 40);
  }
  const passes = Math.max(1, Math.round((SPREAD_CELL / air.cw) ** 2));
  const keepWind = wind ** (1 / passes);
  const keepShine = shine ** (1 / passes);
  range(passes).forEach(() => {
    spread(air, vx, 0.5, keepWind);
    spread(air, vy, 0.5, keepWind);
    spread(air, dx, 0.25, 1);
    spread(air, dy, 0.25, 1);
    spread(air, glow, 0.5, keepShine);
  });
  if (most < STILL && !blowing) {
    [vx, vy, dx, dy, glow].forEach((field) => {
      field.fill(0);
    });
    air.stirred = false;
  }
  air.lively = blowing || (air.stirred && air.glow.some((_, k) => seenAt(air, k)));
};

export const seenAt = (air: Air, k: number): boolean =>
  air.glow[k] > SEEN.glow ||
  air.dx[k] > SEEN.push ||
  air.dx[k] < -SEEN.push ||
  air.dy[k] > SEEN.push ||
  air.dy[k] < -SEEN.push;
