/// <reference types="vite/client" />
import { mountSky, SKY_HEIGHT, type SkyTheme, stillSky, type ThemeChoice } from "../src/index.ts";

const CHOICES: readonly string[] = ["auto", "light", "dark", "vice"];
const STORE_KEY = "ascii-sky-theme";

const root = document.documentElement;
const box = document.querySelector<HTMLElement>(".sky");
const canvas = document.querySelector<HTMLCanvasElement>(".sky canvas");
const still = document.querySelector<HTMLElement>(".sky-still");
const themes = document.querySelector<HTMLElement>(".themes");
if (!(box && canvas && still && themes)) {
  throw new Error("demo: the sky's elements are missing");
}

const assets = import.meta.env.BASE_URL;
const darkScheme = globalThis.matchMedia("(prefers-color-scheme: dark)");
const skyFor = (wanted: ThemeChoice): SkyTheme => {
  if (wanted !== "auto") {
    return wanted;
  }
  return darkScheme.matches ? "dark" : "light";
};

const load = (): string | null => {
  try {
    return localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
};
const save = (value: string): boolean => {
  try {
    localStorage.setItem(STORE_KEY, value);
    return true;
  } catch {
    return false;
  }
};

const saved = load();
let choice = (saved !== null && CHOICES.includes(saved) ? saved : "auto") as ThemeChoice;

box.style.height = `${SKY_HEIGHT}px`;
const sky = mountSky(canvas, { assets, theme: choice });

const buttons = [...themes.querySelectorAll<HTMLButtonElement>("button")];
const show = () => {
  root.dataset.theme = choice;
  const { background, imageRendering, opacity } = stillSky(skyFor(choice), assets);
  still.style.background = background;
  still.style.imageRendering = imageRendering;
  still.style.setProperty("--still-opacity", String(opacity));
  for (const button of buttons) {
    button.setAttribute("aria-pressed", String(button.dataset.theme === choice));
  }
};
themes.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>("button");
  if (!button) {
    return;
  }
  choice = (button.dataset.theme ?? "auto") as ThemeChoice;
  save(choice);
  sky.setTheme(choice);
  show();
});
darkScheme.addEventListener("change", show);
show();
