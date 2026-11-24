export type Grid = Readonly<{
  width: number;
  height: number;
  dpr: number;
  pw: number;
  ph: number;
  cw: number;
  ch: number;
  cols: number;
  rows: number;
  originX: number;
  skyX: number;
  left: Int32Array;
  across: Int32Array;
  top: Int32Array;
  down: Int32Array;
  faintRow: number;
}>;

export type Cell = Readonly<{ cw: number; ch: number }>;

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
