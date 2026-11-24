/**
 * Runs the sky on a canvas: sizes it, steps the air, works each frame out
 * (shade.ts) and draws it (paint.ts), up to 60 times a second (clock.ts).
 * It stops while the sky is off screen or the tab is hidden, and with
 * reduced motion draws once and stays still. Everything that touches the
 * page is here (and in load.ts); the rest is plain functions over plain
 * data.
 */
import { type Air, blow, calm, createAir, fitAir, puff, stepAir } from "./air.ts";
import { type Atlas, drawAtlas } from "./atlas.ts";
import type { SkyCells } from "./cells.ts";
import {
  beat,
  CALM_RATE,
  FULL_RATE,
  MAX_DT,
  median,
  owedAfter,
  PACE_FRAMES,
  paced,
  retried,
  STEP,
  stepsFor,
} from "./clock.ts";
import { type Cell, type Grid, layoutGrid } from "./grid.ts";
import { createSparkles, type Sparkles, stepSparkles } from "./sparkle.ts";
import { composite, createLayers, sizeLayers, stamp } from "./paint.ts";
import {
  createFrame,
  EVERY_ROW,
  type Frame,
  type Stars,
  shadeFrame,
  starAt,
  type Theme,
  TURNS,
} from "./shade.ts";

/** Most device pixels a page pixel: a 3x phone, or a 2x screen zoomed in
 * half as large again, still gets its own pixels. */
const MOST_DPR = 3;
/** What a click or tap on these does is theirs, not a puff of wind. */
export const CONTROLS = "a, button, input, textarea, select, label, [role]";

/** A theme, or "auto" for the visitor's colour scheme (light or dark). */
export type ThemeChoice = Theme | "auto";

export type SkyOptions = {
  /** Which sky to draw; "auto" (the default) follows the visitor's
   * colour scheme. Change it later with `setTheme`. */
  theme?: ThemeChoice;
  /** Page pixels from the top of the canvas from which the sky is faint
   * (say, behind text under a fading mask), so its rows are worked out
   * every other frame. By default the canvas's `--sky-faint` CSS
   * property, read whenever it is sized; 0 or unset for nowhere. */
  faintFrom?: number;
  /** A click or tap on an element matching this selector is left to it,
   * not taken as a gust of wind. */
  ignore?: string;
  /** The night's stars and wind (see shade.ts); without them the dark sky
   * has none. */
  night?: Stars;
};

/** A running sky. */
export type Sky = {
  /** Draws another theme from the next frame on. */
  setTheme(theme: ThemeChoice): void;
  /** Stops the sky and lets go of everything it listens to. */
  stop(): void;
};

/**
 * Starts the sky on `canvas` with `cells` (see cells.ts), drawn on the
 * still sky's cells; `skyWidth` is the still sky's width in page pixels.
 */
export function startSky(
  canvas: HTMLCanvasElement,
  cells: SkyCells,
  skyWidth: number,
  cell: Cell,
  { theme: chosen = "auto", faintFrom, ignore = CONTROLS, night }: SkyOptions = {},
): Sky {
  const layers = createLayers(canvas);
  const still = window.matchMedia("(prefers-reduced-motion: reduce)");
  const darkScheme = window.matchMedia("(prefers-color-scheme: dark)");
  let choice = chosen;
  const themeOf = (): Theme =>
    choice === "auto" ? (darkScheme.matches ? "dark" : "light") : choice;

  // What is drawn: set when the canvas is sized.
  let grid: Grid | null = null;
  /** Where the page showed the sky faintly from, when it was sized. */
  let faintAt = 0;
  let atlas: Atlas | null = null;
  let frame: Frame | null = null;
  let sparkles: Sparkles | null = null;
  /** Whether the still sky has a star at the grid's cell (c, r). */
  const isStar = (c: number, r: number) =>
    !!grid &&
    !!night &&
    starAt(Math.floor((grid.originX + c * grid.cw + grid.skyX) / grid.cw), r, night.stars);
  let images: { colours: ImageData; tiles: ImageData } | null = null;
  let air: Air = createAir(0, 0, 1, 1);
  let theme = themeOf();
  // The clock.
  let time = 0;
  let last = 0;
  let owed = 0;
  let rate = FULL_RATE;
  // When the rate last changed.
  let rateSince = 0;
  let drawnAt = Number.NEGATIVE_INFINITY;
  const costs = new Float64Array(PACE_FRAMES);
  const sorted = new Float64Array(PACE_FRAMES);
  let costed = 0;
  // The loop.
  let raf = 0;
  let visible = true;
  let stopped = false;
  let ready = false;

  // Frames drawn since the canvas was sized: faint rows take turns by it.
  let drawn = 0;
  /** Draws a frame: faint rows of parity `half`, and one row in `every`
   * of the rest by turns (see shadeFrame). */
  const draw = (half: number, every = TURNS) => {
    if (!grid || !atlas || !frame || !images) return;
    const turn = half === EVERY_ROW ? 0 : drawn % every;
    const changed = shadeFrame(
      grid,
      cells,
      air,
      frame,
      time,
      theme,
      half,
      every,
      turn,
      night,
      sparkles,
    );
    stamp(layers, atlas, grid, frame.shown, frame.changed, changed);
    composite(layers, grid, images.colours, images.tiles);
    if (!ready) {
      canvas.dataset.ready = "";
      ready = true;
    }
  };

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MOST_DPR);
    // From where the sky is faint: given, or as the page's CSS says.
    const faint =
      faintFrom ??
      (Number.parseFloat(getComputedStyle(canvas).getPropertyValue("--sky-faint")) || 0);
    // The observer's first look finds the size the sky was started at:
    // it is drawn already.
    if (
      grid &&
      grid.width === rect.width &&
      grid.height === rect.height &&
      grid.dpr === dpr &&
      faint === faintAt
    )
      return;
    faintAt = faint;
    const next = layoutGrid(rect.width, rect.height, dpr, skyWidth, cell, faint);
    if (!atlas || dpr !== grid?.dpr) atlas = drawAtlas(next.cw, next.ch, dpr);
    grid = next;
    sparkles = night?.sparkle ? createSparkles(grid.cols, grid.rows) : null;
    images = sizeLayers(layers, grid);
    frame = createFrame(grid, images.colours.data, images.tiles.data);
    air = fitAir(air, grid.cols, grid.rows, grid.cw, grid.ch);
    drawn = 0;
    draw(EVERY_ROW);
  };

  const pace = (next: number, now: number) => {
    if (next === rate) return;
    rate = next;
    rateSince = now;
    costed = 0;
  };

  const tick = (now: number) => {
    pace(retried(rate, rateSince, now), now);
    // While the air shows nowhere, every row a frame, a third as often.
    const calm = !air.lively;
    const due = beat(drawnAt, calm ? Math.min(rate, CALM_RATE) : rate, now);
    if (Number.isNaN(due)) {
      raf = requestAnimationFrame(tick);
      return;
    }
    drawnAt = due;
    const begin = performance.now();
    const dt = Math.min(MAX_DT, (now - last) / 1000);
    last = now;
    time += dt;
    owed += dt;
    const steps = stepsFor(owed);
    for (let i = 0; i < steps; i++) stepAir(air, STEP);
    owed = owedAfter(owed, steps);
    if (sparkles && grid && theme === "dark") stepSparkles(sparkles, dt, grid.faintRow, isStar);
    draw(drawn++ & 1, calm ? 1 : TURNS);
    // The rate is paced by frames drawn by turns: a calm frame does more.
    if (!calm) {
      costs[costed++] = performance.now() - begin;
      if (costed === PACE_FRAMES) {
        costed = 0;
        pace(paced(rate, median(costs, sorted)), now);
      }
    }
    raf = requestAnimationFrame(tick);
  };

  const schedule = () => {
    cancelAnimationFrame(raf);
    if (stopped) return;
    if (still.matches) {
      time = 0;
      draw(EVERY_ROW);
      return;
    }
    if (!visible || document.hidden) return;
    last = performance.now();
    drawnAt = Number.NEGATIVE_INFINITY;
    raf = requestAnimationFrame(tick);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (still.matches || e.pointerType === "touch") return;
    // Off screen, the pointer can't be over the sky: no need to look.
    if (!visible) return calm(air);
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height) blow(air, x, y, e.timeStamp);
    else calm(air);
  };
  const onPointerDown = (e: PointerEvent) => {
    if (still.matches) return;
    const target = e.target as Element | null;
    if (ignore && target?.closest?.(ignore)) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height) puff(air, x, y);
  };
  const onLeave = () => calm(air);
  const onTheme = () => {
    const next = themeOf();
    if (stopped || next === theme) return;
    theme = next;
    draw(EVERY_ROW);
  };

  const sized = new ResizeObserver(resize);
  const seen = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? true;
    schedule();
  });
  sized.observe(canvas);
  seen.observe(canvas);
  darkScheme.addEventListener("change", onTheme);
  still.addEventListener("change", schedule);
  document.addEventListener("visibilitychange", schedule);
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("pointerdown", onPointerDown, { passive: true });
  document.documentElement.addEventListener("pointerleave", onLeave);
  window.addEventListener("blur", onLeave);

  resize();
  schedule();

  const stop = () => {
    stopped = true;
    cancelAnimationFrame(raf);
    sized.disconnect();
    seen.disconnect();
    darkScheme.removeEventListener("change", onTheme);
    still.removeEventListener("change", schedule);
    document.removeEventListener("visibilitychange", schedule);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerdown", onPointerDown);
    document.documentElement.removeEventListener("pointerleave", onLeave);
    window.removeEventListener("blur", onLeave);
  };

  return {
    setTheme(next) {
      choice = next;
      onTheme();
    },
    stop,
  };
}
