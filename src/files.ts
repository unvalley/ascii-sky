/**
 * The sky's files (see art.ts): the still sky's glyphs and its colour by
 * day and by night, and the two cloud layers. They are in the package's
 * `assets` folder; serve that folder (or each file) and say where.
 */
import { sky } from "./art.ts";

export const SKY_FILES = {
  text: "sky.txt",
  light: "sky-light.webp",
  dark: "sky-dark.webp",
  near: "clouds-near.webp",
  far: "clouds-far.webp",
} as const;

export type SkyFile = keyof typeof SKY_FILES;

/** Where the sky's files are served: the URL of a folder holding all of
 * them, or each file's own URL. */
export type SkyAssets = string | Readonly<Record<SkyFile, string>>;

/** Where the files are looked for unless told otherwise. */
export const DEFAULT_ASSETS = "/ascii-sky/";

/** The URL of one of the sky's files. A folder's carries the version of
 * the files' content, so they can be cached for good. */
export function skyUrl(assets: SkyAssets, file: SkyFile): string {
  if (typeof assets !== "string") return assets[file];
  const base = assets.endsWith("/") ? assets : `${assets}/`;
  return `${base}${SKY_FILES[file]}?v=${sky.version}`;
}
