/**
 * Vice: the sky as a Vice City sunset, for the "vice" theme. Its colours
 * run down the sky from violet through pink to orange, a little deeper
 * where the painting's blue is denser, so its brushwork still shows. Its
 * clouds are fewer and lit by the low sun (THEMES.vice in cells.ts), and
 * the pointer's wind is the sea's teal (shade.ts).
 *
 * The colours are worked out in the browser from the still sky's glyphs,
 * so the theme needs no file of its own; until the live sky is drawn the
 * page can show the same gradient (viceGradient, see still.ts).
 */
import { SKY_RAMP } from "./cells.ts";
import { fromOklab, oklab } from "./oklab.ts";

/** The sunset, top down: page pixels from the top of the sky, and the
 * colour there. A sky 240 page pixels tall ends in pink, one 360 tall
 * in orange; further down it turns gold. */
export const VICE_STOPS: readonly (readonly [number, string])[] = [
  [0, "#5a4cc2"],
  [100, "#9551c6"],
  [180, "#df4f9d"],
  [260, "#ff6a63"],
  [340, "#ff9148"],
  [440, "#ffbb4a"],
];

/** How much darker (OKLab lightness) a cell is where the painting's blue
 * is densest than where it is lightest. */
const DEPTH = 0.1;

const rgbOf = (hex: string) =>
  [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];

/** The sunset's colour in OKLab `y` page pixels down. */
function sunsetAt(y: number): [number, number, number] {
  const last = VICE_STOPS.length - 1;
  if (y <= VICE_STOPS[0][0]) return oklab(...rgbOf(VICE_STOPS[0][1]));
  if (y >= VICE_STOPS[last][0]) return oklab(...rgbOf(VICE_STOPS[last][1]));
  let i = 0;
  while (VICE_STOPS[i + 1][0] < y) i++;
  const [y0, c0] = VICE_STOPS[i];
  const [y1, c1] = VICE_STOPS[i + 1];
  const t = (y - y0) / (y1 - y0);
  const a = oklab(...rgbOf(c0));
  const b = oklab(...rgbOf(c1));
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * The still sky's colours for the vice theme, a pixel a cell (RGBA), from
 * its glyphs (`text`, a line of SKY_RAMP glyphs a row) on cells `ch` page
 * pixels tall: the sunset at each row's middle, deeper by how dense the
 * painting's blue is there.
 */
export function viceColours(
  columns: number,
  rows: number,
  ch: number,
  text: string,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(columns * rows * 4);
  // A row has one colour for each glyph of the ramp: work those out once.
  const levels = SKY_RAMP.length;
  const row = new Uint8ClampedArray(levels * 3);
  const lines = text.split("\n");
  for (let r = 0; r < rows; r++) {
    const [L, a, b] = sunsetAt((r + 0.5) * ch);
    for (let g = 0; g < levels; g++) {
      const d = g / (levels - 1);
      const [R, G, B] = fromOklab(L + DEPTH * (0.5 - d), a, b);
      row[g * 3] = R;
      row[g * 3 + 1] = G;
      row[g * 3 + 2] = B;
    }
    const line = lines[r] ?? "";
    for (let c = 0; c < columns; c++) {
      const g = Math.max(0, SKY_RAMP.indexOf(line[c] ?? "."));
      const o = (r * columns + c) * 4;
      out[o] = row[g * 3];
      out[o + 1] = row[g * 3 + 1];
      out[o + 2] = row[g * 3 + 2];
      out[o + 3] = 255;
    }
  }
  return out;
}

/** The sunset as a CSS gradient down the sky, for the page to show until
 * the live sky is drawn. */
export const viceGradient = () =>
  `linear-gradient(to bottom, ${VICE_STOPS.map(([y, c]) => `${c} ${y}px`).join(", ")})`;
