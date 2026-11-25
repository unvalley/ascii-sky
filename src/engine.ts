import { type Air, blow, calm, createAir, fitAir, puff, stepAir } from "./air.ts";
import {
  GLYPHS,
  measureGlyph,
  normaliseShapes,
  range,
  type SkyCells,
  type SkyTheme,
} from "./cells.ts";
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

export const beat = (drawnAt: number, rate: number, now: number): number => {
  const gap = 1000 / rate;
  const due = drawnAt + gap;
  if (now < due - EARLY_MS) {
    return Number.NaN;
  }
  return now - due < gap ? due : now;
};

type Clock = Readonly<{ time: number; last: number; owed: number; drawnAt: number }>;

const owing = (owed: number, steps = 0): Readonly<{ owed: number; steps: number }> => {
  if (steps === MAX_STEPS) {
    return { owed: 0, steps };
  }
  return owed >= STEP ? owing(owed - STEP, steps + 1) : { owed, steps };
};

const advance = (clock: Clock, now: number, due: number) => {
  const dt = Math.min(MAX_DT, (now - clock.last) / 1000);
  const { owed, steps } = owing(clock.owed + dt);
  return { clock: { time: clock.time + dt, last: now, owed, drawnAt: due }, dt, steps };
};

type Pace = Readonly<{ rate: number; since: number; costs: readonly number[] }>;

const paced = (pace: Pace, rate: number, now: number): Pace =>
  rate === pace.rate ? pace : { rate, since: now, costs: [] };

const retried = (pace: Pace, now: number): Pace =>
  pace.rate === HALF_RATE && now - pace.since >= RETRY_MS ? paced(pace, FULL_RATE, now) : pace;

const median = (values: readonly number[]) => [...values].sort((a, b) => a - b)[values.length >> 1];

const timed = (pace: Pace, cost: number, now: number): Pace => {
  const costs = [...pace.costs, cost];
  if (costs.length < PACE_FRAMES) {
    return { ...pace, costs };
  }
  const ms = median(costs);
  const counted = { ...pace, costs: [] };
  if (ms > SLOW_MS) {
    return paced(counted, HALF_RATE, now);
  }
  return ms < QUICK_MS ? paced(counted, FULL_RATE, now) : counted;
};

const FONT = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
const MEASURE = 8;
const GAP = 1;
const PAD = 0.25;
const PROBE = 100;

type Ink = Readonly<{ up: number; down: number; left: number; right: number }>;

export const fitGlyphs = (ink: Ink, cw: number, ch: number) => {
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
};

const measureInk = (ctx: CanvasRenderingContext2D): Ink => {
  ctx.font = `bold ${PROBE}px ${FONT}`;
  return GLYPHS.map((g) => ctx.measureText(g)).reduce(
    (ink, m) => ({
      up: Math.max(ink.up, m.actualBoundingBoxAscent),
      down: Math.max(ink.down, m.actualBoundingBoxDescent),
      left: Math.max(ink.left, m.actualBoundingBoxLeft),
      right: Math.max(ink.right, m.actualBoundingBoxRight),
    }),
    { up: 0, down: 0, left: 0, right: 0 },
  );
};

const context2d = (canvas: HTMLCanvasElement, settings?: CanvasRenderingContext2DSettings) => {
  const ctx = canvas.getContext("2d", settings);
  if (!ctx) {
    throw new Error("ascii-sky: no 2d context");
  }
  return ctx;
};

type Atlas = Readonly<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; gw: number }>;

const drawAtlas = (cw: number, ch: number, scale: number): Atlas => {
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
};

export const measureShapes = (cw: number, ch: number): Float32Array => {
  const { canvas, ctx, gw } = drawAtlas(cw, ch, MEASURE);
  const gh = canvas.height;
  const ink = ctx.getImageData(0, 0, canvas.width, gh).data;
  return normaliseShapes(
    range(GLYPHS.length).map((g) =>
      measureGlyph(
        Uint8ClampedArray.from({ length: gw * gh }, (_, i) => {
          const x = i % gw;
          return ink[(((i - x) / gw) * canvas.width + g * gw + x) * 4 + 3];
        }),
        gw,
        gh,
      ),
    ),
  );
};

const layer = (canvas = document.createElement("canvas")) => ({ canvas, ctx: context2d(canvas) });

const createLayers = (canvas: HTMLCanvasElement) => ({
  main: layer(canvas),
  mask: layer(),
  ink: layer(),
  gaps: layer(),
  tint: layer(),
  tiles: layer(),
});

type Layers = ReturnType<typeof createLayers>;
type Images = Readonly<{ colours: ImageData; tiles: ImageData }>;

const sizeLayers = (layers: Layers, grid: Grid): Images => {
  const { main, mask, ink, gaps, tint, tiles } = layers;
  const { pw, ph, cols, rows, dpr, originX, cw, ch } = grid;
  [main, mask, ink, gaps].forEach(({ canvas }) => {
    canvas.width = pw;
    canvas.height = ph;
  });
  [tint, tiles].forEach(({ canvas }) => {
    canvas.width = cols;
    canvas.height = rows;
  });
  main.ctx.imageSmoothingEnabled = false;
  ink.ctx.imageSmoothingEnabled = false;
  const line = Math.max(1, Math.round(dpr));
  gaps.ctx.fillStyle = "#000";
  range(cols + 1).forEach((c) => {
    gaps.ctx.fillRect(Math.round((originX + c * cw) * dpr), 0, line, ph);
  });
  range(rows + 1).forEach((r) => {
    gaps.ctx.fillRect(0, Math.round(r * ch * dpr), pw, line);
  });
  return {
    colours: tint.ctx.createImageData(cols, rows),
    tiles: tiles.ctx.createImageData(cols, rows),
  };
};

const stamp = (layers: Layers, atlas: Atlas, grid: Grid, frame: Frame, count: number) => {
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
};

const composite = (layers: Layers, grid: Grid, images: Images) => {
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
};

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

type Running = {
  choice: ThemeChoice;
  theme: SkyTheme;
  view: View | null;
  air: Air;
  clock: Clock;
  pace: Pace;
  drawn: number;
  raf: number;
  visible: boolean;
};

export const startSky = (
  canvas: HTMLCanvasElement,
  cells: SkyCells,
  skyWidth: number,
  cell: Cell,
  { theme: chosen = "auto", faintFrom, ignore = CONTROLS, night }: SkyOptions = {},
): Sky => {
  const layers = createLayers(canvas);
  const reduced = globalThis.matchMedia("(prefers-reduced-motion: reduce)");
  const darkScheme = globalThis.matchMedia("(prefers-color-scheme: dark)");
  const listening = new AbortController();
  const { signal } = listening;
  const themeOf = (choice: ThemeChoice): SkyTheme => {
    if (choice !== "auto") {
      return choice;
    }
    return darkScheme.matches ? "dark" : "light";
  };

  const sky: Running = {
    choice: chosen,
    theme: themeOf(chosen),
    view: null,
    air: createAir(0, 0, 1, 1),
    clock: { time: 0, last: 0, owed: 0, drawnAt: Number.NEGATIVE_INFINITY },
    pace: { rate: FULL_RATE, since: 0, costs: [] },
    drawn: 0,
    raf: 0,
    visible: true,
  };

  const isStar = (c: number, r: number) => {
    if (!sky.view) {
      return false;
    }
    const { originX, cw, skyX } = sky.view.grid;
    return starAt(Math.floor((originX + c * cw + skyX) / cw), r, sky.view.frame.night.stars);
  };

  const draw = (half: number, every = TURNS) => {
    const { view } = sky;
    if (!view) {
      return;
    }
    const { grid, atlas, frame, images } = view;
    const turn = half === EVERY_ROW ? 0 : sky.drawn % every;
    const changed = shadeFrame(
      grid,
      cells,
      sky.air,
      frame,
      sky.clock.time,
      sky.theme,
      half,
      every,
      turn,
    );
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
    const was = sky.view?.grid;
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
    const atlas = sky.view && was?.dpr === dpr ? sky.view.atlas : drawAtlas(cell.cw, cell.ch, dpr);
    const images = sizeLayers(layers, grid);
    sky.view = {
      grid,
      atlas,
      images,
      frame: createFrame(grid, images.colours.data, images.tiles.data, night),
    };
    sky.air = fitAir(sky.air, grid.cols, grid.rows, grid.cw, grid.ch);
    sky.drawn = 0;
    draw(EVERY_ROW);
  };

  const tick = (now: number) => {
    sky.raf = requestAnimationFrame(tick);
    sky.pace = retried(sky.pace, now);
    const isCalm = !sky.air.lively;
    const rate = isCalm ? Math.min(sky.pace.rate, CALM_RATE) : sky.pace.rate;
    const due = beat(sky.clock.drawnAt, rate, now);
    if (Number.isNaN(due)) {
      return;
    }
    const begin = performance.now();
    const { clock, dt, steps } = advance(sky.clock, now, due);
    sky.clock = clock;
    range(steps).forEach(() => {
      stepAir(sky.air, STEP);
    });
    const sparkles = sky.theme === "dark" ? sky.view?.frame.sparkles : null;
    if (sky.view && sparkles) {
      stepSparkles(sparkles, dt, sky.view.grid.faintRow, isStar);
    }
    const half = sky.drawn & 1;
    sky.drawn += 1;
    draw(half, isCalm ? 1 : TURNS);
    if (!isCalm) {
      sky.pace = timed(sky.pace, performance.now() - begin, now);
    }
  };

  const schedule = () => {
    cancelAnimationFrame(sky.raf);
    if (signal.aborted) {
      return;
    }
    if (reduced.matches) {
      sky.clock = { ...sky.clock, time: 0 };
      draw(EVERY_ROW);
      return;
    }
    if (!sky.visible || document.hidden) {
      return;
    }
    sky.clock = { ...sky.clock, last: performance.now(), drawnAt: Number.NEGATIVE_INFINITY };
    sky.raf = requestAnimationFrame(tick);
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
    const at = sky.visible ? pointerAt(e) : null;
    if (at) {
      blow(sky.air, at.x, at.y, e.timeStamp);
    } else {
      calm(sky.air);
    }
  };
  const onPointerDown = (e: PointerEvent) => {
    if (reduced.matches || (ignore && (e.target as Element | null)?.closest?.(ignore))) {
      return;
    }
    const at = pointerAt(e);
    if (at) {
      puff(sky.air, at.x, at.y);
    }
  };
  const onLeave = () => calm(sky.air);
  const onTheme = () => {
    const next = themeOf(sky.choice);
    if (signal.aborted || next === sky.theme) {
      return;
    }
    sky.theme = next;
    draw(EVERY_ROW);
  };

  const sized = new ResizeObserver(resize);
  const seen = new IntersectionObserver(([entry]) => {
    sky.visible = entry?.isIntersecting ?? true;
    schedule();
  });
  sized.observe(canvas);
  seen.observe(canvas);
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
    setTheme: (next) => {
      sky.choice = next;
      onTheme();
    },
    stop: () => {
      listening.abort();
      cancelAnimationFrame(sky.raf);
      sized.disconnect();
      seen.disconnect();
    },
  };
};
