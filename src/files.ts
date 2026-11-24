import { sky } from "./art.ts";

export const SKY_FILES = {
  text: "sky.txt",
  light: "sky-light.webp",
  dark: "sky-dark.webp",
  near: "clouds-near.webp",
  far: "clouds-far.webp",
} as const;

export type SkyFile = keyof typeof SKY_FILES;

export type SkyAssets = string | Readonly<Record<SkyFile, string>>;

export const DEFAULT_ASSETS = "/ascii-sky/";

export function skyUrl(assets: SkyAssets, file: SkyFile): string {
  if (typeof assets !== "string") {
    return assets[file];
  }
  const base = assets.endsWith("/") ? assets : `${assets}/`;
  return `${base}${SKY_FILES[file]}?v=${sky.version}`;
}
