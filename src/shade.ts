/**
 * A frame of the sky, worked out cell by cell into plain arrays, with no
 * canvas in sight (paint.ts draws them). Every cell asks the cells (see
 * cells.ts) what is there now: open sky, a glyph as dense as the
 * painting's blue, on a tile of it, breathing in strength on a clock of
 * its own under light that drifts across in slow bands; or a cloud, a
 * glyph on a tile of its shade. The air carries the clouds and lights the
 * sky it moves through.
 */
import { type Air, seenAt } from "./air.ts";
import { GLYPHS, OPEN_SKY, SKY_RAMP, type SkyCells, type SkyTheme } from "./cells.ts";
import type { Grid } from "./grid.ts";
import { type Sparkles, TINTS } from "./sparkle.ts";
import { hash } from "./hash.ts";
import { sine } from "./wave.ts";

export type Theme = SkyTheme;

/** What the wind is drawn in: a deeper blue on the light page, near white
 * on the dark, and the sea's cyan in a sunset. */
const GLOW = { light: [16, 82, 214], dark: [214, 240, 255], sunset: [0, 190, 230] } as const;
/** How strongly the wind colours what it passes: open sky's glyphs (1 is
 * by how much the air glows) and their tiles (0 leaves them). The
 * sunset's glyphs are dense and bright, so its wind colours them sooner
 * and its tiles too, or it hardly shows. */
const WIND_TINT = {
  light: { glyph: 1, tile: 0 },
  dark: { glyph: 1, tile: 0 },
  sunset: { glyph: 2.2, tile: 0.4 },
} as const;
/** Air that glows this much and moves this fast (page pixels a second)
 * shows as a streak along the wind over open sky. */
const STREAK = { glow: 0.28, speed: 50 };
/** Glow above which a level streak is a gust. */
const GUSTY = 0.7;
/** How much more one way than the other the wind blows to show as a level
 * or upright streak, not a slanted one. */
const LEVEL = 2.4;
/** Glow below which open sky is left unlit. */
const UNLIT = 0.02;
const glyph = (g: string) => GLYPHS.indexOf(g);
const ALONG = glyph("-");
const GUST = glyph("~");
const UP = glyph("|");
const RISING = glyph("/");
const FALLING = glyph("\\");
/** Open sky's glyphs, by how much blue the painting has there. */
const RAMP = [...SKY_RAMP].map(glyph);
/** The clouds drift a pixel or so a frame, so each row is worked out one
 * frame in this many and still keeps up with them; the cells where the air
 * shows (see SEEN in air.ts) are worked out every frame, so the wind shows
 * smoothly. */
export const TURNS = 3;
/** Stars on the dark page: the share of open-sky cells that are stars,
 * their colour, the colour of the pointer's wind there, and whether they
 * sparkle (see night.ts and sparkle.ts). */
export type Stars = Readonly<{
  stars: number;
  star: readonly number[];
  glow: readonly number[];
  sparkle?: boolean;
}>;
const NO_STARS: Stars = { stars: 0, star: [255, 255, 255], glow: GLOW.dark };
/** A star's glyph: mostly small, a few bright. */
const STAR = [".", ".", ".", ".", ".", ".", ".", "+", "+", "*"].map(glyph);
/** Whether the still sky has a star at its column `sc`, row `r`, for a
 * night with this share of stars. */
export const starAt = (sc: number, r: number, share: number): boolean =>
  hash(sc, r, 101) < share;
/** What a cell shows before its first frame, so every cell is drawn then. */
export const UNDRAWN = -2;

/**
 * What a frame is worked out in, sized for one grid. `colours` and `tiles`
 * are a pixel a cell (RGBA), as the canvas takes them.
 */
export type Frame = Readonly<{
  /** Each cell's colour and how much of it shows, and its tile's. */
  colours: Uint8ClampedArray;
  tiles: Uint8ClampedArray;
  /** The glyph each cell shows; -1 for none. */
  shown: Int16Array;
  /** The cells whose glyph changed this frame, in order. */
  changed: Int32Array;
  /** Each cell's breathing: its phase and its pace. */
  breath: Float32Array;
  /** This frame's light, along the columns and down the rows. */
  bandAcross: Float64Array;
  bandDown: Float64Array;
  /** Room for what a cell is (see SkyCells). */
  out: number[];
}>;

/** A frame for `grid`, drawing into `colours` and `tiles`. */
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

/** Each cell's breathing, stable for the cell: a phase, and a pace. */
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

/** The streak open sky shows in wind (vx, vy) glowing `glow`. y runs down
 * the page. */
export function streak(vx: number, vy: number, glow: number): number {
  const ax = Math.abs(vx);
  const ay = Math.abs(vy);
  if (ax > ay * LEVEL) return glow > GUSTY ? GUST : ALONG;
  if (ay > ax * LEVEL) return UP;
  return vx * vy < 0 ? RISING : FALLING;
}


/** Work out every row, faint ones too (see shadeFrame). */
export const EVERY_ROW = -1;

/**
 * The sky `t` seconds in, in `theme`, into `frame`. Faint rows (see Grid)
 * are worked out only when their parity (row & 1) is `half`, so each
 * every other frame, unless `half` is EVERY_ROW. Returns how many cells
 * changed glyph; they are the first in `frame.changed`.
 */
export function shadeFrame(
  grid: Grid,
  cells: SkyCells,
  air: Air,
  frame: Frame,
  t: number,
  theme: Theme,
  half: number = EVERY_ROW,
  /** Work out one row in `every`, those whose row % every is `turn`, and
   * the cells the air is moving (see TURNS). */
  every = 1,
  turn = 0,
  night: Stars = NO_STARS,
  /** Sparkles over the stars (dark page only). */
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
    // A row not due this frame: only its cells the air is moving.
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
        // A glyph as dense as the painting's blue, breathing, in the light.
        const breathe = 0.5 + 0.5 * sine(t * breath[k * 2 + 1] + breath[k * 2]);
        const band = 0.93 + 0.07 * bandAcross[c] * down;
        alpha = (0.9 + 0.1 * breathe) * band;
        out[7] *= band;
        code = RAMP[(out[3] * top + 0.5) | 0];
        if (stars > 0) {
          // A star, where the still sky has one: it stays with the sky
          // whatever the page's width, and twinkles.
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
          // A sparkle over the open sky.
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
      // (x + 0.5) | 0 rounds as Math.round does for x ≥ 0, several times faster.
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
