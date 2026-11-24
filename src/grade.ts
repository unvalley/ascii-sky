/**
 * The still sky's colours at night, made with the still sky
 * (scripts/sky-convert.mjs), so the page reads them as they are: the
 * painting's blue taken down to a navy, deeper where the painting's blue
 * is denser (the night has no clouds and has stars, see night.ts).
 */
import { SKY_RAMP } from "./cells.ts";
import { fromOklab, oklab } from "./oklab.ts";

/** The night: open sky's lightness (OKLab) where the painting's blue is
 * lightest and densest, how much of its colour it keeps, and how far its
 * hue turns (degrees; more is towards violet). The glyphs are this light;
 * their tiles show little of it (THEMES.dark's wash), so the glyphs stand
 * clear of them and read sharp. */
const NIGHT = { light: 0.41, dense: 0.29, chroma: 0.75, hue: 14 };

/**
 * The still sky's colours on the dark page (a pixel a cell, `channels`
 * bytes each, changed in place) taken to night: each cell's blue turned
 * and paled, and its lightness by how dense the painting's blue is there
 * (`text`, a line of SKY_RAMP glyphs a row).
 */
export function toNight(
  pixels: Uint8Array | Uint8ClampedArray,
  channels: number,
  columns: number,
  rows: number,
  text: string,
): void {
  const turn = (NIGHT.hue * Math.PI) / 180;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  text.split("\n").forEach((line, r) => {
    if (r >= rows) return;
    for (let c = 0; c < columns; c++) {
      const i = (r * columns + c) * channels;
      const d = Math.max(0, SKY_RAMP.indexOf(line[c] ?? ".")) / (SKY_RAMP.length - 1);
      const [, a0, b0] = oklab(pixels[i], pixels[i + 1], pixels[i + 2]);
      const a = (a0 * cos - b0 * sin) * NIGHT.chroma;
      const b = (a0 * sin + b0 * cos) * NIGHT.chroma;
      const [R, G, B] = fromOklab(NIGHT.light + (NIGHT.dense - NIGHT.light) * d, a, b);
      pixels[i] = R;
      pixels[i + 1] = G;
      pixels[i + 2] = B;
    }
  });
}
