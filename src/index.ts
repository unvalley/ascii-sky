import {
  type CloudLayer,
  type SkyCells,
  type SkyTheme,
  skyCells,
  viceColours,
  viceGradient,
} from "./cells.ts";
import { measureShapes, type Sky, type SkyOptions, startSky, type ThemeChoice } from "./engine.ts";
import { NIGHT } from "./shade.ts";

export type { SkyTheme } from "./cells.ts";
export { CONTROLS, type ThemeChoice } from "./engine.ts";
export { NIGHT, type Stars } from "./shade.ts";

export const sky = {
  columns: 400,
  rows: 71,
  cellWidth: 6,
  cellHeight: 9.75,
  version: "0654411dbe",
};

export const SKY_WIDTH = sky.columns * sky.cellWidth;
export const SKY_HEIGHT = sky.rows * sky.cellHeight;

const SKY_FILES = {
  text: "sky.txt",
  light: "sky-light.webp",
  dark: "sky-dark.webp",
  near: "clouds-near.webp",
  far: "clouds-far.webp",
} as const;

export type SkyAssets = string | Readonly<Record<keyof typeof SKY_FILES, string>>;

const DEFAULT_ASSETS = "/ascii-sky/";

function skyUrl(assets: SkyAssets, file: keyof typeof SKY_FILES): string {
  if (typeof assets !== "string") {
    return assets[file];
  }
  const base = assets.endsWith("/") ? assets : `${assets}/`;
  return `${base}${SKY_FILES[file]}?v=${sky.version}`;
}

async function fetched(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`ascii-sky: ${url} answered ${response.status}`);
  }
  return response;
}

async function pixelsOf(url: string, signal?: AbortSignal): Promise<CloudLayer> {
  const response = await fetched(url, signal);
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

async function loadSky(assets: SkyAssets, signal: AbortSignal): Promise<SkyCells> {
  const [text, light, dark, near, far] = await Promise.all([
    fetched(skyUrl(assets, "text"), signal).then((response) => response.text()),
    pixelsOf(skyUrl(assets, "light"), signal),
    pixelsOf(skyUrl(assets, "dark"), signal),
    pixelsOf(skyUrl(assets, "near"), signal),
    pixelsOf(skyUrl(assets, "far"), signal),
  ]);
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
    shapes: measureShapes(sky.cellWidth, sky.cellHeight),
  });
}

const STILL_OPACITY: Record<SkyTheme, number> = { light: 0.4, dark: 0.33, vice: 0.4 };

export type StillSkyStyle = {
  background: string;
  imageRendering: "pixelated";
  opacity: number;
};

export function stillSky(theme: SkyTheme, assets: SkyAssets = DEFAULT_ASSETS): StillSkyStyle {
  const background =
    theme === "vice"
      ? viceGradient()
      : `url("${skyUrl(assets, theme)}") center top / ${SKY_WIDTH}px ${SKY_HEIGHT}px repeat-x`;
  return { background, imageRendering: "pixelated", opacity: STILL_OPACITY[theme] };
}

export type MountOptions = SkyOptions & {
  assets?: SkyAssets;
};

export type MountedSky = Sky & {
  ready: Promise<void>;
};

export function mountSky(
  canvas: HTMLCanvasElement,
  { assets = DEFAULT_ASSETS, night = NIGHT, theme = "auto", ...options }: MountOptions = {},
): MountedSky {
  const loading = new AbortController();
  let running: Sky | null = null;
  let choice: ThemeChoice = theme;
  let stopped = false;
  const cell = { cw: sky.cellWidth, ch: sky.cellHeight };
  const ready = loadSky(assets, loading.signal).then(
    (cells) => {
      if (!stopped) {
        running = startSky(canvas, cells, SKY_WIDTH, cell, { ...options, night, theme: choice });
      }
    },
    (error: unknown) => {
      if (!stopped) {
        throw error;
      }
    },
  );
  return {
    ready,
    setTheme(next) {
      choice = next;
      running?.setTheme(next);
    },
    stop() {
      stopped = true;
      loading.abort();
      running?.stop();
      running = null;
    },
  };
}
