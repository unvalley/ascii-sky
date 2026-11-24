import { sky } from "./art.ts";
import { measureShapes } from "./atlas.ts";
import { type SkyCells, skyCells } from "./cells.ts";
import { DEFAULT_ASSETS, type SkyAssets, skyUrl } from "./files.ts";
import { viceColours } from "./vice.ts";

async function pixelsOf(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`ascii-sky: ${url} answered ${response.status}`);
  }
  const bitmap = await createImageBitmap(await response.blob(), {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });
  const { width, height } = bitmap;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("ascii-sky: no 2d context");
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { pixels: ctx.getImageData(0, 0, width, height).data, width, height };
}

async function textOf(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`ascii-sky: ${url} answered ${response.status}`);
  }
  return response.text();
}

export async function loadSky(
  assets: SkyAssets = DEFAULT_ASSETS,
  signal?: AbortSignal,
): Promise<SkyCells> {
  const [text, light, dark, near, far] = await Promise.all([
    textOf(skyUrl(assets, "text"), signal),
    pixelsOf(skyUrl(assets, "light"), signal),
    pixelsOf(skyUrl(assets, "dark"), signal),
    pixelsOf(skyUrl(assets, "near"), signal),
    pixelsOf(skyUrl(assets, "far"), signal),
  ]);
  const shapes = measureShapes(sky.cellWidth, sky.cellHeight);
  if (!shapes) {
    throw new Error("ascii-sky: no 2d context");
  }
  return skyCells({
    still: {
      columns: sky.columns,
      rows: sky.rows,
      cw: sky.cellWidth,
      ch: sky.cellHeight,
      text,
      rgb: {
        light: light.pixels,
        dark: dark.pixels,
        vice: viceColours(sky.columns, sky.rows, sky.cellHeight, text),
      },
    },
    near,
    far,
    shapes,
  });
}
