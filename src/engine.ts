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
import { createSparkles, type Sparkles, stepSparkles } from "./sparkle.ts";

const MOST_DPR = 3;
export const CONTROLS = "a, button, input, textarea, select, label, [role]";

export type ThemeChoice = Theme | "auto";

export type SkyOptions = {
  theme?: ThemeChoice;
  faintFrom?: number;
  ignore?: string;
  night?: Stars;
};

export type Sky = {
  setTheme: (theme: ThemeChoice) => void;
  stop: () => void;
};

export function startSky(
  canvas: HTMLCanvasElement,
  cells: SkyCells,
  skyWidth: number,
  cell: Cell,
  { theme: chosen = "auto", faintFrom, ignore = CONTROLS, night }: SkyOptions = {},
): Sky {
  const layers = createLayers(canvas);
  const still = globalThis.matchMedia("(prefers-reduced-motion: reduce)");
  const darkScheme = globalThis.matchMedia("(prefers-color-scheme: dark)");
  let choice = chosen;
  const themeOf = (): Theme => {
    if (choice !== "auto") {
      return choice;
    }
    return darkScheme.matches ? "dark" : "light";
  };

  let grid: Grid | null = null;
  let faintAt = 0;
  let atlas: Atlas | null = null;
  let frame: Frame | null = null;
  let sparkles: Sparkles | null = null;
  const isStar = (c: number, r: number) =>
    grid !== null &&
    night !== undefined &&
    starAt(Math.floor((grid.originX + c * grid.cw + grid.skyX) / grid.cw), r, night.stars);
  let images: { colours: ImageData; tiles: ImageData } | null = null;
  let air: Air = createAir(0, 0, 1, 1);
  let theme = themeOf();
  let time = 0;
  let last = 0;
  let owed = 0;
  let rate = FULL_RATE;
  let rateSince = 0;
  let drawnAt = Number.NEGATIVE_INFINITY;
  const costs = new Float64Array(PACE_FRAMES);
  const sorted = new Float64Array(PACE_FRAMES);
  let costed = 0;
  let raf = 0;
  let visible = true;
  let stopped = false;
  let ready = false;

  let drawn = 0;
  const draw = (half: number, every = TURNS) => {
    if (!(grid && atlas && frame && images)) {
      return;
    }
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
    if (rect.width < 1 || rect.height < 1) {
      return;
    }
    const dpr = Math.min(globalThis.devicePixelRatio || 1, MOST_DPR);
    const faint =
      faintFrom ??
      (Number.parseFloat(getComputedStyle(canvas).getPropertyValue("--sky-faint")) || 0);
    if (
      grid &&
      grid.width === rect.width &&
      grid.height === rect.height &&
      grid.dpr === dpr &&
      faint === faintAt
    ) {
      return;
    }
    faintAt = faint;
    const next = layoutGrid(rect.width, rect.height, dpr, skyWidth, cell, faint);
    if (!atlas || dpr !== grid?.dpr) {
      atlas = drawAtlas(next.cw, next.ch, dpr);
    }
    grid = next;
    sparkles = night?.sparkle ? createSparkles(grid.cols, grid.rows) : null;
    images = sizeLayers(layers, grid);
    frame = createFrame(grid, images.colours.data, images.tiles.data);
    air = fitAir(air, grid.cols, grid.rows, grid.cw, grid.ch);
    drawn = 0;
    draw(EVERY_ROW);
  };

  const pace = (next: number, now: number) => {
    if (next === rate) {
      return;
    }
    rate = next;
    rateSince = now;
    costed = 0;
  };

  const tick = (now: number) => {
    pace(retried(rate, rateSince, now), now);
    const isCalm = !air.lively;
    const due = beat(drawnAt, isCalm ? Math.min(rate, CALM_RATE) : rate, now);
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
    for (let i = 0; i < steps; i++) {
      stepAir(air, STEP);
    }
    owed = owedAfter(owed, steps);
    if (sparkles && grid && theme === "dark") {
      stepSparkles(sparkles, dt, grid.faintRow, isStar);
    }
    draw(drawn++ & 1, isCalm ? 1 : TURNS);
    if (!isCalm) {
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
    if (stopped) {
      return;
    }
    if (still.matches) {
      time = 0;
      draw(EVERY_ROW);
      return;
    }
    if (!visible || document.hidden) {
      return;
    }
    last = performance.now();
    drawnAt = Number.NEGATIVE_INFINITY;
    raf = requestAnimationFrame(tick);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (still.matches || e.pointerType === "touch") {
      return;
    }
    if (!visible) {
      return calm(air);
    }
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height) {
      blow(air, x, y, e.timeStamp);
    } else {
      calm(air);
    }
  };
  const onPointerDown = (e: PointerEvent) => {
    if (still.matches) {
      return;
    }
    const target = e.target as Element | null;
    if (ignore && target?.closest?.(ignore)) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height) {
      puff(air, x, y);
    }
  };
  const onLeave = () => calm(air);
  const onTheme = () => {
    const next = themeOf();
    if (stopped || next === theme) {
      return;
    }
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
  globalThis.addEventListener("pointermove", onPointerMove, { passive: true });
  globalThis.addEventListener("pointerdown", onPointerDown, { passive: true });
  document.documentElement.addEventListener("pointerleave", onLeave);
  globalThis.addEventListener("blur", onLeave);

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
    globalThis.removeEventListener("pointermove", onPointerMove);
    globalThis.removeEventListener("pointerdown", onPointerDown);
    document.documentElement.removeEventListener("pointerleave", onLeave);
    globalThis.removeEventListener("blur", onLeave);
  };

  return {
    setTheme(next) {
      choice = next;
      onTheme();
    },
    stop,
  };
}
