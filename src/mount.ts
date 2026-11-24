import { sky } from "./art.ts";
import { type Sky, type SkyOptions, startSky, type ThemeChoice } from "./engine.ts";
import type { SkyAssets } from "./files.ts";
import { loadSky } from "./load.ts";
import { NIGHT } from "./night.ts";

export const SKY_CELL = { cw: sky.cellWidth, ch: sky.cellHeight } as const;
export const SKY_WIDTH = sky.columns * sky.cellWidth;
export const SKY_HEIGHT = sky.rows * sky.cellHeight;

export type MountOptions = SkyOptions & {
  assets?: SkyAssets;
};

export type MountedSky = Sky & {
  ready: Promise<void>;
};

export function mountSky(
  canvas: HTMLCanvasElement,
  { assets, night = NIGHT, theme = "auto", ...options }: MountOptions = {},
): MountedSky {
  const loading = new AbortController();
  let running: Sky | null = null;
  let choice: ThemeChoice = theme;
  let stopped = false;
  const ready = loadSky(assets, loading.signal).then(
    (cells) => {
      if (stopped) return;
      running = startSky(canvas, cells, SKY_WIDTH, SKY_CELL, { ...options, night, theme: choice });
    },
    (error: unknown) => {
      if (!stopped) throw error;
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
