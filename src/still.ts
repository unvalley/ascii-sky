/**
 * The still sky as a CSS background: its colours, a pixel a cell,
 * stretched over the cells, as pale on the whole as the live sky (without
 * its glyphs, stars or clouds). Shown under the canvas, it gives the page
 * the sky's colours at first paint, before the live sky has loaded.
 */
import type { SkyTheme } from "./cells.ts";
import { DEFAULT_ASSETS, type SkyAssets, skyUrl } from "./files.ts";
import { SKY_HEIGHT, SKY_WIDTH } from "./mount.ts";
import { viceGradient } from "./vice.ts";

/** How strongly the still sky shows, to match the live sky's colour on
 * the whole (measured cell by cell against it). */
const OPACITY: Record<SkyTheme, number> = { light: 0.4, dark: 0.33, vice: 0.4 };

export type StillSkyStyle = {
  background: string;
  imageRendering: "pixelated";
  opacity: number;
};

/**
 * The style of an element behind the canvas, covering it, that shows the
 * still sky in `theme` until the live sky is drawn. Like the live sky it
 * is centred and repeats sideways. The vice theme's sunset is a gradient
 * and needs no file.
 */
export function stillSky(theme: SkyTheme, assets: SkyAssets = DEFAULT_ASSETS): StillSkyStyle {
  const size = `${SKY_WIDTH}px ${SKY_HEIGHT}px`;
  const background =
    theme === "vice"
      ? viceGradient()
      : `url("${skyUrl(assets, theme)}") center top / ${size} repeat-x`;
  return { background, imageRendering: "pixelated", opacity: OPACITY[theme] };
}
