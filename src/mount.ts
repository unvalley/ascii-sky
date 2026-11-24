/**
 * The sky in one call: loads its files (load.ts) and runs it on a canvas
 * (engine.ts), with the night's stars on the dark sky.
 */
import { sky } from "./art.ts";
import { type Sky, type SkyOptions, startSky, type ThemeChoice } from "./engine.ts";
import type { SkyAssets } from "./files.ts";
import { loadSky } from "./load.ts";
import { NIGHT } from "./night.ts";

/** A cell of the still sky, in page pixels: the sky is drawn on these. */
export const SKY_CELL = { cw: sky.cellWidth, ch: sky.cellHeight } as const;
/** The still sky's size in page pixels. Wider canvases repeat it
 * sideways; it is drawn centred. */
export const SKY_WIDTH = sky.columns * sky.cellWidth;
export const SKY_HEIGHT = sky.rows * sky.cellHeight;

export type MountOptions = SkyOptions & {
  /** Where the sky's files are served (see files.ts); "/ascii-sky/" by
   * default. */
  assets?: SkyAssets;
};

/** A sky that is loading, then running. */
export type MountedSky = Sky & {
  /** Settles once the sky has loaded and started (or was stopped before
   * that); rejects if its files could not be loaded. */
  ready: Promise<void>;
};

/**
 * Loads the sky and runs it on `canvas`, sized by CSS. The canvas gets a
 * `data-ready` attribute once the sky is first drawn, to fade it in by.
 */
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
