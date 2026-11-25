import { type Air, blow, calm, createAir, fitAir, puff, stepAir } from "./air.ts";
import { GLYPHS, measureGlyph, normaliseShapes, type SkyCells, type SkyTheme } from "./cells.ts";
import {
  type Cell,
  createFrame,
  EVERY_ROW,
  type Frame,
  type Grid,
  layoutGrid,
  type Stars,
  shadeFrame,
  starAt,
  stepSparkles,
  TURNS,
} from "./shade.ts";

export const STEP = 1 / 60;
const MAX_STEPS = 4;
const MAX_DT = 0.1;
export const FULL_RATE = 60;
export const HALF_RATE = 30;
const CALM_RATE = FULL_RATE / TURNS;
const PACE_FRAMES = 30;
const SLOW_MS = 8;
const QUICK_MS = 5;
const EARLY_MS = 1.5;
const RETRY_MS = 5000;
const MOST_DPR = 3;
export const CONTROLS = "a, button, input, textarea, select, label, [role]";

export function beat(drawnAt: number, rate: number, now: number): number {
  const gap = 1000 / rate;
  const due = drawnAt + gap;
  if (now < due - EARLY_MS) {
    return Number.NaN;
  }
  return now - due < gap ? due : now;
}

const FONT = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
const MEASURE = 8;
const GAP = 1;
const PAD = 0.25;
const PROBE = 100;

type Ink = Readonly<{ up: number; down: number; left: number; right: number }>;

export function fitGlyphs(ink: Ink, cw: number, ch: number) {
  const roomW = cw - GAP - 2 * PAD;
  const roomH = ch - GAP - 2 * PAD;
  const wide = ink.left + ink.right;
  const tall = ink.up + ink.down;
  const k = Math.min(roomW / wide, roomH / tall);
  return {
    size: PROBE * k,
    x: GAP + PAD + (roomW - wide * k) / 2 + ink.left * k,
    y: GAP + PAD + (roomH - tall * k) / 2 + ink.up * k,
  };
}

function measureInk(ctx: CanvasRenderingContext2D): Ink {
  ctx.font = `bold ${PROBE}px ${FONT}`;
  let up = 0;
  let down = 0;
  let left = 0;
  let right = 0;
  for (const g of GLYPHS) {
    const m = ctx.measureText(g);
    up = Math.max(up, m.actualBoundingBoxAscent);
    down = Math.max(down, m.actualBoundingBoxDescent);
    left = Math.max(left, m.actualBoundingBoxLeft);
    right = Math.max(right, m.actualBoundingBoxRight);
  }
  return { up, down, left, right };
}

function context2d(canvas: HTMLCanvasElement, settings?: CanvasRenderingContext2DSettings) {
  const ctx = canvas.getContext("2d", settings);
  if (!ctx) {
    throw new Error("ascii-sky: no 2d context");
  }
  return ctx;
}

type Atlas = Readonly<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; gw: number }>;

function drawAtlas(cw: number, ch: number, scale: number): Atlas {
  const gw = Math.ceil(cw * scale);
  const gh = Math.ceil(ch * scale);
  const canvas = document.createElement("canvas");
  canvas.width = gw * GLYPHS.length;
  canvas.height = gh;
  const ctx = context2d(canvas, { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "alphabetic";
  const fit = fitGlyphs(measureInk(ctx), cw, ch);
  ctx.font = `bold ${fit.size * scale}px ${FONT}`;
  const inside = Math.round(GAP * scale);
  const x = Math.round(fit.x * scale);
  const y = Math.round(fit.y * scale);
  GLYPHS.forEach((g, i) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(i * gw + inside, inside, gw - inside, gh - inside);
    ctx.clip();
    ctx.fillText(g, i * gw + x, y);
    ctx.restore();
  });
  return { canvas, ctx, gw };
}

export function measureShapes(cw: number, ch: number): Float32Array {
  const { canvas, ctx, gw } = drawAtlas(cw, ch, MEASURE);
  const gh = canvas.height;
  const ink = ctx.getImageData(0, 0, canvas.width, gh).data;
  return normaliseShapes(
    GLYPHS.map((_, g) => {
      const one = new Uint8ClampedArray(gw * gh);
      for (let y = 0; y < gh; y++) {
        for (let x = 0; x < gw; x++) {
          one[y * gw + x] = ink[(y * canvas.width + g * gw + x) * 4 + 3];
        }
      }
      return measureGlyph(one, gw, gh);
    }),
  );
}

const layer = (canvas = document.createElement("canvas")) => ({ canvas, ctx: context2d(canvas) });

function createLayers(canvas: HTMLCanvasElement) {
  return {
    main: layer(canvas),
    mask: layer(),
    ink: layer(),
    gaps: layer(),
    tint: layer(),
    tiles: layer(),
  };
}

type Layers = ReturnType<typeof createLayers>;
type Images = Readonly<{ colours: ImageData; tiles: ImageData }>;

function sizeLayers(layers: Layers, grid: Grid): Images {
  const { main, mask, ink, gaps, tint, tiles } = layers;
  const { pw, ph, cols, rows, dpr, originX, cw, ch } = grid;
  for (const { canvas } of [main, mask, ink, gaps]) {
    canvas.width = pw;
    canvas.height = ph;
  }
  for (const { canvas } of [tint, tiles]) {
    canvas.width = cols;
    canvas.height = rows;
  }
  main.ctx.imageSmoothingEnabled = false;
  ink.ctx.imageSmoothingEnabled = false;
  const line = Math.max(1, Math.round(dpr));
  gaps.ctx.fillStyle = "#000";
  for (let c = 0; c <= cols; c++) {
    gaps.ctx.fillRect(Math.round((originX + c * cw) * dpr), 0, line, ph);
  }
  for (let r = 0; r <= rows; r++) {
    gaps.ctx.fillRect(0, Math.round(r * ch * dpr), pw, line);
  }
  return {
    colours: tint.ctx.createImageData(cols, rows),
    tiles: tiles.ctx.createImageData(cols, rows),
  };
}

function stamp(layers: Layers, atlas: Atlas, grid: Grid, frame: Frame, count: number) {
  const mask = layers.mask.ctx;
  const { cols, left, across, top, down } = grid;
  for (let n = 0; n < count; n++) {
    const k = frame.changed[n];
    const r = (k / cols) | 0;
    const c = k - r * cols;
    const x = left[c];
    const y = top[r];
    const w = across[c];
    const h = down[r];
    mask.clearRect(x, y, w, h);
    const code = frame.shown[k];
    if (code >= 0) {
      mask.drawImage(atlas.canvas, code * atlas.gw, 0, w, h, x, y, w, h);
    }
  }
}

function composite(layers: Layers, grid: Grid, images: Images) {
  const { main, mask, ink, gaps, tint, tiles } = layers;
  const { cols, rows, cw, ch, dpr, originX } = grid;
  const toX = originX * dpr;
  const toW = cols * cw * dpr;
  const toH = rows * ch * dpr;
  tiles.ctx.putImageData(images.tiles, 0, 0);
  main.ctx.globalCompositeOperation = "copy";
  main.ctx.drawImage(tiles.canvas, 0, 0, cols, rows, toX, 0, toW, toH);
  main.ctx.globalCompositeOperation = "destination-out";
  main.ctx.drawImage(gaps.canvas, 0, 0);
  tint.ctx.putImageData(images.colours, 0, 0);
  ink.ctx.globalCompositeOperation = "copy";
  ink.ctx.drawImage(mask.canvas, 0, 0);
  ink.ctx.globalCompositeOperation = "source-in";
  ink.ctx.drawImage(tint.canvas, 0, 0, cols, rows, toX, 0, toW, toH);
  main.ctx.globalCompositeOperation = "source-over";
  main.ctx.drawImage(ink.canvas, 0, 0);
}

export type ThemeChoice = SkyTheme | "auto";

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

type View = Readonly<{ grid: Grid; atlas: Atlas; frame: Frame; images: Images }>;

export function startSky(
  canvas: HTMLCanvasElement,
  cells: SkyCells,
  skyWidth: number,
  cell: Cell,
  { theme: chosen = "auto", faintFrom, ignore = CONTROLS, night }: SkyOptions = {},
): Sky {
  const layers = createLayers(canvas);
  const reduced = globalThis.matchMedia("(prefers-reduced-motion: reduce)");
  const darkScheme = globalThis.matchMedia("(prefers-color-scheme: dark)");
  const listening = new AbortController();
  let choice = chosen;
  const themeOf = (): SkyTheme => {
    if (choice !== "auto") {
      return choice;
    }
    return darkScheme.matches ? "dark" : "light";
  };

  let view: View | null = null;
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
  let drawn = 0;
  let raf = 0;
  let visible = true;
  let stopped = false;

  const isStar = (c: number, r: number) => {
    if (!view) {
      return false;
    }
    const { originX, cw, skyX } = view.grid;
    return starAt(Math.floor((originX + c * cw + skyX) / cw), r, view.frame.night.stars);
  };

  const draw = (half: number, every = TURNS) => {
    if (!view) {
      return;
    }
    const { grid, atlas, frame, images } = view;
    const turn = half === EVERY_ROW ? 0 : drawn % every;
    const changed = shadeFrame(grid, cells, air, frame, time, theme, half, every, turn);
    stamp(layers, atlas, grid, frame, changed);
    composite(layers, grid, images);
    if (canvas.dataset.ready === undefined) {
      canvas.dataset.ready = "";
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
    const was = view?.grid;
    if (
      was &&
      was.width === rect.width &&
      was.height === rect.height &&
      was.dpr === dpr &&
      was.faint === faint
    ) {
      return;
    }
    const grid = layoutGrid(rect.width, rect.height, dpr, skyWidth, cell, faint);
    const atlas = view && was?.dpr === dpr ? view.atlas : drawAtlas(cell.cw, cell.ch, dpr);
    const images = sizeLayers(layers, grid);
    view = {
      grid,
      atlas,
      images,
      frame: createFrame(grid, images.colours.data, images.tiles.data, night),
    };
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
    raf = requestAnimationFrame(tick);
    if (rate === HALF_RATE && now - rateSince >= RETRY_MS) {
      pace(FULL_RATE, now);
    }
    const isCalm = !air.lively;
    const due = beat(drawnAt, isCalm ? Math.min(rate, CALM_RATE) : rate, now);
    if (Number.isNaN(due)) {
      return;
    }
    drawnAt = due;
    const begin = performance.now();
    const dt = Math.min(MAX_DT, (now - last) / 1000);
    last = now;
    time += dt;
    owed += dt;
    let steps = 0;
    while (owed >= STEP && steps < MAX_STEPS) {
      stepAir(air, STEP);
      owed -= STEP;
      steps++;
    }
    if (steps === MAX_STEPS) {
      owed = 0;
    }
    const sparkles = theme === "dark" ? view?.frame.sparkles : null;
    if (view && sparkles) {
      stepSparkles(sparkles, dt, view.grid.faintRow, isStar);
    }
    draw(drawn++ & 1, isCalm ? 1 : TURNS);
    if (isCalm) {
      return;
    }
    costs[costed++] = performance.now() - begin;
    if (costed < PACE_FRAMES) {
      return;
    }
    costed = 0;
    sorted.set(costs);
    sorted.sort();
    const ms = sorted[PACE_FRAMES >> 1];
    if (ms > SLOW_MS) {
      pace(HALF_RATE, now);
    } else if (ms < QUICK_MS) {
      pace(FULL_RATE, now);
    }
  };

  const schedule = () => {
    cancelAnimationFrame(raf);
    if (stopped) {
      return;
    }
    if (reduced.matches) {
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

  const pointerAt = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    return x >= 0 && y >= 0 && x <= rect.width && y <= rect.height ? { x, y } : null;
  };
  const onPointerMove = (e: PointerEvent) => {
    if (reduced.matches || e.pointerType === "touch") {
      return;
    }
    const at = visible ? pointerAt(e) : null;
    if (at) {
      blow(air, at.x, at.y, e.timeStamp);
    } else {
      calm(air);
    }
  };
  const onPointerDown = (e: PointerEvent) => {
    if (reduced.matches || (ignore && (e.target as Element | null)?.closest?.(ignore))) {
      return;
    }
    const at = pointerAt(e);
    if (at) {
      puff(air, at.x, at.y);
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
  const { signal } = listening;
  darkScheme.addEventListener("change", onTheme, { signal });
  reduced.addEventListener("change", schedule, { signal });
  document.addEventListener("visibilitychange", schedule, { signal });
  globalThis.addEventListener("pointermove", onPointerMove, { passive: true, signal });
  globalThis.addEventListener("pointerdown", onPointerDown, { passive: true, signal });
  document.documentElement.addEventListener("pointerleave", onLeave, { signal });
  globalThis.addEventListener("blur", onLeave, { signal });

  resize();
  schedule();

  return {
    setTheme(next) {
      choice = next;
      onTheme();
    },
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      sized.disconnect();
      seen.disconnect();
      listening.abort();
    },
  };
}
