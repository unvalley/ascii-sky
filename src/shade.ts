import { type Air, seenAt } from "./air.ts";
import { GLYPHS, OPEN_SKY, SKY_RAMP, type SkyCells, type SkyTheme } from "./cells.ts";
import type { Grid } from "./grid.ts";
import { type Sparkles, TINTS } from "./sparkle.ts";
import { hash } from "./hash.ts";
import { sine } from "./wave.ts";

export type Theme = SkyTheme;

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
const glyph = (g: string) => GLYPHS.indexOf(g);
const ALONG = glyph("-");
const GUST = glyph("~");
const UP = glyph("|");
const RISING = glyph("/");
const FALLING = glyph("\\");
const RAMP = [...SKY_RAMP].map(glyph);
export const TURNS = 3;
export type Stars = Readonly<{
  stars: number;
  star: readonly number[];
  glow: readonly number[];
  sparkle?: boolean;
}>;
const NO_STARS: Stars = { stars: 0, star: [255, 255, 255], glow: GLOW.dark };
const STAR = [".", ".", ".", ".", ".", ".", ".", "+", "+", "*"].map(glyph);
export const starAt = (sc: number, r: number, share: number): boolean =>
  hash(sc, r, 101) < share;
export const UNDRAWN = -2;

export type Frame = Readonly<{
  colours: Uint8ClampedArray;
  tiles: Uint8ClampedArray;
  shown: Int16Array;
  changed: Int32Array;
  breath: Float32Array;
  bandAcross: Float64Array;
  bandDown: Float64Array;
  out: number[];
}>;

export function createFrame(
  grid: Grid,
  colours: Uint8ClampedArray,
  tiles: Uint8ClampedArray,
): Frame {
  const { cols, rows } = grid;
  return {
    colours,
    tiles,
    shown: new Int16Array(cols * rows).fill(UNDRAWN),
    changed: new Int32Array(cols * rows),
    breath: breathing(cols, rows),
    bandAcross: new Float64Array(cols),
    bandDown: new Float64Array(rows),
    out: [0, 0, 0, 0, 0, 0, 0, 0],
  };
}

export function breathing(cols: number, rows: number): Float32Array {
  const breath = new Float32Array(cols * rows * 2);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = (r * cols + c) * 2;
      breath[i] = hash(c, r, 23) * Math.PI * 2;
      breath[i + 1] = 0.25 + hash(c, r, 37) * 0.9;
    }
  return breath;
}

export function streak(vx: number, vy: number, glow: number): number {
  const ax = Math.abs(vx);
  const ay = Math.abs(vy);
  if (ax > ay * LEVEL) return glow > GUSTY ? GUST : ALONG;
  if (ay > ax * LEVEL) return UP;
  return vx * vy < 0 ? RISING : FALLING;
}

export const EVERY_ROW = -1;

export function shadeFrame(
  grid: Grid,
  cells: SkyCells,
  air: Air,
  frame: Frame,
  t: number,
  theme: Theme,
  half: number = EVERY_ROW,
  every = 1,
  turn = 0,
  night: Stars = NO_STARS,
  sparkles: Sparkles | null = null,
): number {
  const { cols, rows, cw, ch, originX, skyX, faintRow } = grid;
  const { colours, tiles, shown, changed, breath, bandAcross, bandDown, out } = frame;
  const dark = theme === "dark";
  const glow = dark ? night.glow : GLOW[theme];
  const windTint = WIND_TINT[theme];
  const stars = dark ? night.stars : 0;
  const sparks = dark ? sparkles : null;
  const stirred = air.stirred;
  const { vx, vy, dx, dy } = air;
  const airGlow = air.glow;
  const top = RAMP.length - 1;
  for (let c = 0; c < cols; c++) bandAcross[c] = Math.sin(c * 0.09 + t * 0.3);
  for (let r = 0; r < rows; r++) bandDown[r] = Math.sin(r * 0.15 - t * 0.23);
  cells.at(t);

  let n = 0;
  for (let r = 0; r < rows; r++) {
    if (r >= faintRow && half !== EVERY_ROW && (r & 1) !== half) continue;
    const offTurn = every > 1 && half !== EVERY_ROW && r % every !== turn;
    if (offTurn && !stirred && !sparks?.touchedRows[r]) continue;
    const y = r * ch;
    const down = bandDown[r];
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c;
      if (offTurn && !seenAt(air, k) && !sparks?.touched[k]) continue;
      const o = k * 4;
      const was = shown[k];
      let code = cells.cell(
        originX + c * cw + skyX,
        y,
        cw,
        ch,
        theme,
        out,
        was >= 0 ? was : -1,
        stirred ? dx[k] : 0,
        stirred ? dy[k] : 0,
      );
      let alpha = 1;
      if (code === OPEN_SKY) {
        const breathe = 0.5 + 0.5 * sine(t * breath[k * 2 + 1] + breath[k * 2]);
        const band = 0.93 + 0.07 * bandAcross[c] * down;
        alpha = (0.9 + 0.1 * breathe) * band;
        out[7] *= band;
        code = RAMP[(out[3] * top + 0.5) | 0];
        if (stars > 0) {
          const sc = Math.floor((originX + c * cw + skyX) / cw);
          if (starAt(sc, r, stars)) {
            code = STAR[(hash(sc, r, 103) * STAR.length) | 0];
            const twinkle = 0.5 + 0.5 * sine(t * 2.2 * breath[k * 2 + 1] + breath[k * 2]);
            alpha = 0.35 + 0.65 * twinkle;
            out[0] = night.star[0];
            out[1] = night.star[1];
            out[2] = night.star[2];
          }
        }
        if (sparks) {
          const spark = sparks.code[k];
          sparks.touched[k] = 0;
          if (spark >= 0) {
            code = spark;
            const tint = TINTS[sparks.tint[k]];
            out[0] = tint[0];
            out[1] = tint[1];
            out[2] = tint[2];
            alpha = 1;
          }
        }
        const g = stirred ? Math.min(1, airGlow[k]) : 0;
        if (g > UNLIT) {
          alpha = alpha + (1 - alpha) * g;
          const m = Math.min(1, g * windTint.glyph);
          for (let j = 0; j < 3; j++) out[j] += (glow[j] - out[j]) * m;
          if (windTint.tile > 0)
            for (let j = 0; j < 3; j++) out[4 + j] += (glow[j] - out[4 + j]) * g * windTint.tile;
          const wx = vx[k];
          const wy = vy[k];
          if (g > STREAK.glow && Math.abs(wx) + Math.abs(wy) > STREAK.speed)
            code = streak(wx, wy, g);
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
      if (code === shown[k]) continue;
      shown[k] = code;
      changed[n++] = k;
    }
    if (sparks) sparks.touchedRows[r] = 0;
  }
  return n;
}
