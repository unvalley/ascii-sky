/**
 * The glyphs the sky is drawn with, each drawn once in white on a strip of
 * cells, to be stamped from; and the glyphs' shapes, for picking them by
 * shape (see cells.ts).
 */
import { GLYPHS, measureGlyph, normaliseShapes } from "./cells.ts";

const FONT = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
/** How much larger glyphs are drawn to measure their shapes. */
const MEASURE = 8;
/** The gap along the top and left of every cell (see paint.ts), and the
 * room kept clear around the glyphs inside it, in page pixels. */
const GAP = 1;
const PAD = 0.25;
/** The size the font's ink is measured at, to fit its glyphs. */
const PROBE = 100;

/** How far the glyphs' ink reaches from where they are drawn: up and down
 * from the baseline, left and right from the pen, at PROBE px. */
export type Ink = Readonly<{ up: number; down: number; left: number; right: number }>;

/**
 * The font size and the pen (x, baseline y) that put every glyph wholly
 * inside its tile, clear of the gap, and centred in the room left: so no
 * glyph runs over the lines between tiles, and every glyph sits in the
 * middle of its tile. In page pixels, in a cell `cw` × `ch`.
 */
export function fitGlyphs(ink: Ink, cw: number, ch: number) {
  const roomW = cw - GAP - 2 * PAD;
  const roomH = ch - GAP - 2 * PAD;
  const wide = ink.left + ink.right;
  const tall = ink.up + ink.down;
  const k = Math.min(roomW / wide, roomH / tall);
  return {
    size: PROBE * k,
    x: GAP + PAD + (roomW - wide * k) / 2 + ink.left * k,
    y: GAP + PAD + (roomH - tall * k) / 2 + ink.up * k,
  };
}

/** The ink all the glyphs reach together, in `a`'s font at PROBE px. */
function measureInk(a: CanvasRenderingContext2D): Ink {
  a.font = `bold ${PROBE}px ${FONT}`;
  let up = 0;
  let down = 0;
  let left = 0;
  let right = 0;
  for (const g of GLYPHS) {
    const m = a.measureText(g);
    up = Math.max(up, m.actualBoundingBoxAscent);
    down = Math.max(down, m.actualBoundingBoxDescent);
    left = Math.max(left, m.actualBoundingBoxLeft);
    right = Math.max(right, m.actualBoundingBoxRight);
  }
  return { up, down, left, right };
}

export type Atlas = Readonly<{
  canvas: HTMLCanvasElement;
  /** A cell of the strip, in its pixels. */
  gw: number;
  gh: number;
  ctx: CanvasRenderingContext2D | null;
}>;

/** Each glyph in white, a cell each, for cells `cw` × `ch` page pixels
 * drawn `scale` device pixels a page pixel: inside its tile and in its
 * middle (fitGlyphs), its pen on whole device pixels so it draws sharp. */
export function drawAtlas(cw: number, ch: number, scale: number): Atlas {
  const gw = Math.ceil(cw * scale);
  const gh = Math.ceil(ch * scale);
  const canvas = document.createElement("canvas");
  canvas.width = gw * GLYPHS.length;
  canvas.height = gh;
  const a = canvas.getContext("2d", { willReadFrequently: true });
  if (!a) return { canvas, gw, gh, ctx: null };
  a.fillStyle = "#fff";
  a.textBaseline = "alphabetic";
  const fit = fitGlyphs(measureInk(a), cw, ch);
  a.font = `bold ${fit.size * scale}px ${FONT}`;
  const inside = Math.round(GAP * scale);
  const x = Math.round(fit.x * scale);
  const y = Math.round(fit.y * scale);
  GLYPHS.forEach((g, i) => {
    a.save();
    a.beginPath();
    a.rect(i * gw + inside, inside, gw - inside, gh - inside);
    a.clip();
    a.fillText(g, i * gw + x, y);
    a.restore();
  });
  return { canvas, gw, gh, ctx: a };
}

/** The glyphs' shapes in this font, in cells `cw` × `ch`, for picking them
 * by shape (see cells.ts). */
export function measureShapes(cw: number, ch: number): Float32Array | null {
  const big = drawAtlas(cw, ch, MEASURE);
  if (!big.ctx) return null;
  const ink = big.ctx.getImageData(0, 0, big.canvas.width, big.gh).data;
  const measured = GLYPHS.map((_, g) => {
    const one = new Uint8ClampedArray(big.gw * big.gh);
    for (let y = 0; y < big.gh; y++)
      for (let x = 0; x < big.gw; x++)
        one[y * big.gw + x] = ink[(y * big.canvas.width + g * big.gw + x) * 4 + 3];
    return measureGlyph(one, big.gw, big.gh, 1, 0);
  });
  return normaliseShapes(measured);
}
