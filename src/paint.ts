/**
 * Draws a frame (see shade.ts) on the canvas. Cloud tiles are a pixel a
 * cell, stretched over the cells with the gaps between them cut out.
 * Glyphs are stamped in white on a mask of their own, only where
 * they change, then coloured in one pass by the cell colours, stretched
 * the same way, kept only where the mask has ink ("source-in").
 *
 * Everything here works on canvases; the numbers come worked out.
 */
import type { Atlas } from "./atlas.ts";
import type { Grid } from "./grid.ts";

/** The canvas and the ones behind it, as plain canvases and contexts. */
export type Layers = Readonly<{
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Glyphs in white, a cell each. */
  mask: HTMLCanvasElement;
  maskCtx: CanvasRenderingContext2D;
  /** The mask, coloured. */
  ink: HTMLCanvasElement;
  inkCtx: CanvasRenderingContext2D;
  /** The gaps between tiles, to cut out. */
  gaps: HTMLCanvasElement;
  gapsCtx: CanvasRenderingContext2D;
  /** A pixel a cell: the colours, and the tiles. */
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

/** The layers for drawing on `canvas`. */
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

/**
 * Sizes the layers for `grid`, clearing them, and draws the gaps: a line a
 * page pixel wide along the top and left of every cell. Returns the pixel
 * a cell colour and tile images to work frames out in.
 */
export function sizeLayers(layers: Layers, grid: Grid) {
  const { canvas, ctx, mask, ink, inkCtx, gaps, gapsCtx, tint, tintCtx, tiles, tilesCtx } = layers;
  const { pw, ph, cols, rows, dpr, originX, cw, ch } = grid;
  for (const c of [canvas, mask, ink, gaps]) {
    c.width = pw;
    c.height = ph;
  }
  tint.width = tiles.width = cols;
  tint.height = tiles.height = rows;
  // Sizing a canvas resets its context. The canvas and the ink take pixels
  // stretched over whole cells, never smoothed.
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

/** Stamps the `count` cells in `changed` with what they now show. */
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
    // Pixel for pixel, never scaled: a cell a pixel shorter or narrower
    // than the strip's (as cells round to whole pixels) takes the glyph
    // cropped, not squeezed, which would blur it.
    if (code >= 0) maskCtx.drawImage(glyphs, code * gw, 0, w, h, x, y, w, h);
  }
}

/** Puts the frame's tiles and colours on the canvas. */
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
  // The tiles, with the gaps between them cut out.
  tilesCtx.putImageData(tileImage, 0, 0);
  ctx.globalCompositeOperation = "copy";
  ctx.drawImage(tiles, 0, 0, cols, rows, toX, 0, toW, toH);
  ctx.globalCompositeOperation = "destination-out";
  ctx.drawImage(gaps, 0, 0);
  // Every glyph coloured at once, then over the tiles.
  tintCtx.putImageData(colours, 0, 0);
  inkCtx.globalCompositeOperation = "copy";
  inkCtx.drawImage(mask, 0, 0);
  inkCtx.globalCompositeOperation = "source-in";
  inkCtx.drawImage(tint, 0, 0, cols, rows, toX, 0, toW, toH);
  ctx.globalCompositeOperation = "source-over";
  ctx.drawImage(ink, 0, 0);
}
