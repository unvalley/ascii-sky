import type { SkyTheme } from "./cells.ts";
import { DEFAULT_ASSETS, type SkyAssets, skyUrl } from "./files.ts";
import { SKY_HEIGHT, SKY_WIDTH } from "./mount.ts";
import { viceGradient } from "./vice.ts";

const OPACITY: Record<SkyTheme, number> = { light: 0.4, dark: 0.33, vice: 0.4 };

export type StillSkyStyle = {
  background: string;
  imageRendering: "pixelated";
  opacity: number;
};

export function stillSky(theme: SkyTheme, assets: SkyAssets = DEFAULT_ASSETS): StillSkyStyle {
  const size = `${SKY_WIDTH}px ${SKY_HEIGHT}px`;
  const background =
    theme === "vice"
      ? viceGradient()
      : `url("${skyUrl(assets, theme)}") center top / ${size} repeat-x`;
  return { background, imageRendering: "pixelated", opacity: OPACITY[theme] };
}
