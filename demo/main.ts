/// <reference types="vite/client" />
import { mountSky, SKY_HEIGHT, type SkyTheme, stillSky, type ThemeChoice } from "../src/index.ts";

const CHOICES: readonly ThemeChoice[] = ["auto", "light", "sunset", "dark"];
const STORE_KEY = "ascii-sky-theme";

const root: HTMLElement = document.documentElement;
const box = document.querySelector<HTMLElement>(".sky");
const canvas = document.querySelector<HTMLCanvasElement>(".sky canvas");
const still = document.querySelector<HTMLElement>(".sky-still");
const themes = document.querySelector<HTMLElement>(".themes");
if (!(box && canvas && still && themes)) {
  throw new Error("demo: the sky's elements are missing");
}

const assets: string = import.meta.env.BASE_URL;
const darkScheme = globalThis.matchMedia("(prefers-color-scheme: dark)");
const skyFor = (wanted: ThemeChoice): SkyTheme => {
  if (wanted !== "auto") {
    return wanted;
  }
  return darkScheme.matches ? "dark" : "light";
};

const choiceOf = (value: unknown): ThemeChoice =>
  CHOICES.find((choice) => choice === value) ?? "auto";

const stored = <T>(use: (storage: Storage) => T, otherwise: T): T => {
  try {
    return use(localStorage);
  } catch {
    return otherwise;
  }
};
const load = (): ThemeChoice => stored((storage) => choiceOf(storage.getItem(STORE_KEY)), "auto");
const save = (value: ThemeChoice): void =>
  stored((storage) => storage.setItem(STORE_KEY, value), undefined);

const first = load();
const chosen = (): ThemeChoice => choiceOf(root.dataset.theme);

box.style.height = `${SKY_HEIGHT}px`;
const sky = mountSky(canvas, { assets, theme: first });

const buttons: HTMLButtonElement[] = [...themes.querySelectorAll<HTMLButtonElement>("button")];
const show = (choice: ThemeChoice): void => {
  root.dataset.theme = choice;
  const { background, imageRendering, opacity } = stillSky(skyFor(choice), assets);
  still.style.background = background;
  still.style.imageRendering = imageRendering;
  still.style.setProperty("--still-opacity", String(opacity));
  buttons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.theme === choice));
  });
};
themes.addEventListener("click", (event) => {
  const button =
    event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button") : undefined;
  if (!button) {
    return;
  }
  const choice = choiceOf(button.dataset.theme);
  save(choice);
  sky.setTheme(choice);
  show(choice);
});
darkScheme.addEventListener("change", () => show(chosen()));
show(first);
