import type { Atlas } from "./atlas.ts";
import type { Grid } from "./grid.ts";

export type Layers = Readonly<{
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  mask: HTMLCanvasElement;
  maskCtx: CanvasRenderingContext2D;
  ink: HTMLCanvasElement;
  inkCtx: CanvasRenderingContext2D;
  gaps: HTMLCanvasElement;
  gapsCtx: CanvasRenderingContext2D;
  tint: HTMLCanvasElement;
  tintCtx: CanvasRenderingContext2D;
  tiles: HTMLCanvasElement;
  tilesCtx: CanvasRenderingContext2D;
}>;

const layer = (canvas: HTMLCanvasElement) => {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  return ctx;
};

export function createLayers(canvas: HTMLCanvasElement): Layers {
  const make = () => document.createElement("canvas");
  const [mask, ink, gaps, tint, tiles] = [make(), make(), make(), make(), make()];
  return {
    canvas,
    ctx: layer(canvas),
    mask,
    maskCtx: layer(mask),
    ink,
    inkCtx: layer(ink),
    gaps,
    gapsCtx: layer(gaps),
    tint,
    tintCtx: layer(tint),
    tiles,
    tilesCtx: layer(tiles),
  };
}

export function sizeLayers(layers: Layers, grid: Grid) {
  const { canvas, ctx, mask, ink, inkCtx, gaps, gapsCtx, tint, tintCtx, tiles, tilesCtx } = layers;
  const { pw, ph, cols, rows, dpr, originX, cw, ch } = grid;
  for (const c of [canvas, mask, ink, gaps]) {
    c.width = pw;
    c.height = ph;
  }
  tint.width = tiles.width = cols;
  tint.height = tiles.height = rows;
  ctx.imageSmoothingEnabled = false;
  inkCtx.imageSmoothingEnabled = false;
  const line = Math.max(1, Math.round(dpr));
  gapsCtx.fillStyle = "#000";
  for (let c = 0; c <= cols; c++)
    gapsCtx.fillRect(Math.round((originX + c * cw) * dpr), 0, line, ph);
  for (let r = 0; r <= rows; r++) gapsCtx.fillRect(0, Math.round(r * ch * dpr), pw, line);
  return {
    colours: tintCtx.createImageData(cols, rows),
    tiles: tilesCtx.createImageData(cols, rows),
  };
}

export function stamp(
  layers: Layers,
  atlas: Atlas,
  grid: Grid,
  shown: Int16Array,
  changed: Int32Array,
  count: number,
): void {
  const { maskCtx } = layers;
  const { canvas: glyphs, gw } = atlas;
  const { cols, left, across, top, down } = grid;
  for (let n = 0; n < count; n++) {
    const k = changed[n];
    const r = (k / cols) | 0;
    const c = k - r * cols;
    const x = left[c];
    const y = top[r];
    const w = across[c];
    const h = down[r];
    maskCtx.clearRect(x, y, w, h);
    const code = shown[k];
    if (code >= 0) maskCtx.drawImage(glyphs, code * gw, 0, w, h, x, y, w, h);
  }
}

export function composite(
  layers: Layers,
  grid: Grid,
  colours: ImageData,
  tileImage: ImageData,
): void {
  const { ctx, mask, ink, inkCtx, gaps, tint, tintCtx, tiles, tilesCtx } = layers;
  const { cols, rows, cw, ch, dpr, originX } = grid;
  const toX = originX * dpr;
  const toW = cols * cw * dpr;
  const toH = rows * ch * dpr;
  tilesCtx.putImageData(tileImage, 0, 0);
  ctx.globalCompositeOperation = "copy";
  ctx.drawImage(tiles, 0, 0, cols, rows, toX, 0, toW, toH);
  ctx.globalCompositeOperation = "destination-out";
  ctx.drawImage(gaps, 0, 0);
  tintCtx.putImageData(colours, 0, 0);
  inkCtx.globalCompositeOperation = "copy";
  inkCtx.drawImage(mask, 0, 0);
  inkCtx.globalCompositeOperation = "source-in";
  inkCtx.drawImage(tint, 0, 0, cols, rows, toX, 0, toW, toH);
  ctx.globalCompositeOperation = "source-over";
  ctx.drawImage(ink, 0, 0);
}
