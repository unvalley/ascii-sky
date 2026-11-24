/**
 * Where the sky's cells are on the canvas. Everything about a size is
 * worked out here once, when the canvas is sized, so a frame only reads it.
 */

export type Grid = Readonly<{
  /** The canvas in page pixels, and device pixels a page pixel. */
  width: number;
  height: number;
  dpr: number;
  /** The canvas's backing size in device pixels. */
  pw: number;
  ph: number;
  /** A cell in page pixels. */
  cw: number;
  ch: number;
  cols: number;
  rows: number;
  /** The page x of the first column, and the still sky's x at page x 0. */
  originX: number;
  skyX: number;
  /** Each column's left edge and width, each row's top and height, in
   * device pixels. */
  left: Int32Array;
  across: Int32Array;
  top: Int32Array;
  down: Int32Array;
  /** From this row on the sky is faint (the page fades it behind its
   * text), and each row is worked out every other frame. */
  faintRow: number;
}>;

/** A cell, in page pixels. */
export type Cell = Readonly<{ cw: number; ch: number }>;

/**
 * The grid of `cell`s for a canvas `width` × `height` page pixels: whole
 * columns from its middle out, so the grid sits evenly and none is cut at
 * an edge (a sliver narrower than a cell is left bare at either side).
 * `skyWidth` is the still sky's width; it is centred. From `faint` page
 * pixels down the sky is faint; 0 for nowhere.
 */
export function layoutGrid(
  width: number,
  height: number,
  dpr: number,
  skyWidth: number,
  { cw, ch }: Cell,
  faint = 0,
): Grid {
  const half = Math.floor(width / 2 / cw);
  const originX = width / 2 - half * cw;
  const cols = half * 2;
  const rows = Math.ceil(height / ch);

  const left = new Int32Array(cols);
  const across = new Int32Array(cols);
  for (let c = 0; c < cols; c++) {
    const x = originX + c * cw;
    left[c] = Math.round(x * dpr);
    across[c] = Math.round((x + cw) * dpr) - left[c];
  }
  const top = new Int32Array(rows);
  const down = new Int32Array(rows);
  for (let r = 0; r < rows; r++) {
    const y = r * ch;
    top[r] = Math.round(y * dpr);
    down[r] = Math.round((y + ch) * dpr) - top[r];
  }
  const faintRow = faint > 0 ? Math.min(rows, Math.ceil(faint / ch)) : rows;

  return {
    width,
    height,
    dpr,
    pw: Math.round(width * dpr),
    ph: Math.round(height * dpr),
    cw,
    ch,
    cols,
    rows,
    originX,
    skyX: skyWidth / 2 - width / 2,
    left,
    across,
    top,
    down,
    faintRow,
  };
}
