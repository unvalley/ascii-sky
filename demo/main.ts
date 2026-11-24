/// <reference types="vite/client" />
import { mountSky, SKY_HEIGHT, type SkyTheme, stillSky, type ThemeChoice } from "../src/index.ts";

const root = document.documentElement;
const box = document.querySelector<HTMLElement>(".sky");
const canvas = document.querySelector<HTMLCanvasElement>(".sky canvas");
const still = document.querySelector<HTMLElement>(".sky-still");
if (!box || !canvas || !still) throw new Error("demo: the sky's elements are missing");

// The demo serves the package's assets folder at its base URL.
const assets = import.meta.env.BASE_URL;
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const resolve = (choice: ThemeChoice): SkyTheme =>
  choice === "auto" ? (dark.matches ? "dark" : "light") : choice;

const saved = (() => {
  try {
    return localStorage.getItem("ascii-sky-theme") as ThemeChoice | null;
  } catch {
    return null;
  }
})();
let choice: ThemeChoice = saved ?? "auto";

box.style.height = `${SKY_HEIGHT}px`;
const sky = mountSky(canvas, { assets, theme: choice });
sky.ready.catch((error) => console.error(error));

const buttons = [...document.querySelectorAll<HTMLButtonElement>(".themes button")];
const show = () => {
  root.dataset.theme = choice;
  Object.assign(still.style, stillSky(resolve(choice), assets));
  for (const b of buttons) b.setAttribute("aria-pressed", String(b.dataset.theme === choice));
};
for (const b of buttons)
  b.addEventListener("click", () => {
    choice = (b.dataset.theme ?? "auto") as ThemeChoice;
    try {
      localStorage.setItem("ascii-sky-theme", choice);
    } catch {}
    sky.setTheme(choice);
    show();
  });
dark.addEventListener("change", show);
show();
