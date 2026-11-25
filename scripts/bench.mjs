import { readFileSync } from "node:fs";
import sharp from "sharp";
import { blow, createAir, puff, stepAir } from "../src/air.ts";
import { GLYPHS, REGION_COUNT, RGBA, range, skyCells, sunsetColours } from "../src/cells.ts";
import { STEP } from "../src/engine.ts";
import { sky } from "../src/index.ts";
import { createFrame, layoutGrid, shadeFrame, TURNS } from "../src/shade.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const EVEN_SHAPE = 0.5;
const FRAMES = 400;
const WARM_UP = 60;
const DESKTOP = { from: 768, hero: 360, mobileHero: 240, faintBelowHero: 40 };
const SWEEP = { period: 20, y: 150, sway: 80, swayPeriod: 13, msPerFrame: 16.7 };
const GUST = { every: 60, y: 200 };
const SCREENS = [
  { width: 1440, dpr: 2 },
  { width: 820, dpr: 2 },
  { width: 390, dpr: 2 },
];
const LABEL_WIDTH = 4;
const pixelsOf = async (name) => {
  const { data, info } = await sharp(`${ROOT}/assets/${name}`)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { pixels: new Uint8ClampedArray(data), width: info.width, height: info.height };
};
const [light, dark, near, far] = await Promise.all(
  ["sky-light.webp", "sky-dark.webp", "clouds-near.webp", "clouds-far.webp"].map(pixelsOf),
);
const text = readFileSync(`${ROOT}/assets/sky.txt`, "utf8");
const cells = skyCells({
  still: {
    columns: sky.columns,
    rows: sky.rows,
    cellWidth: sky.cellWidth,
    cellHeight: sky.cellHeight,
    text,
    rgb: {
      light: light.pixels,
      dark: dark.pixels,
      sunset: sunsetColours(sky.columns, sky.rows, sky.cellHeight, text),
    },
  },
  near,
  far,
  shapes: new Float32Array(GLYPHS.length * REGION_COUNT).fill(EVEN_SHAPE),
});

const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const bench = ({ width, dpr }) => {
  const hero = width >= DESKTOP.from ? DESKTOP.hero : DESKTOP.mobileHero;
  const grid = layoutGrid(
    width,
    sky.rows * sky.cellHeight,
    dpr,
    sky.columns * sky.cellWidth,
    { width: sky.cellWidth, height: sky.cellHeight },
    hero + DESKTOP.faintBelowHero,
  );
  const n = grid.columns * grid.rows * RGBA;
  const frame = createFrame(grid, new Uint8ClampedArray(n), new Uint8ClampedArray(n));
  const air = createAir(grid.columns, grid.rows, grid.cellWidth, grid.cellHeight);
  const run = (frames, stir) => {
    const times = range(frames).map((i) => {
      if (stir) {
        const x = (width / 2) * (1 + Math.sin(i / SWEEP.period));
        blow(air, x, SWEEP.y + SWEEP.sway * Math.sin(i / SWEEP.swayPeriod), i * SWEEP.msPerFrame);
        if (i % GUST.every === 0) {
          puff(air, x, GUST.y);
        }
      }
      const a = performance.now();
      stepAir(air, STEP);
      const b = performance.now();
      shadeFrame(grid, cells, air, frame, (i + 1) * STEP, "light", i & 1, TURNS, i % TURNS);
      return { shade: performance.now() - b, air: b - a };
    });
    const settled = times.slice(WARM_UP);
    return {
      shade: median(settled.map((t) => t.shade)),
      air: median(settled.map((t) => t.air)),
    };
  };
  const still = run(FRAMES, false);
  const wind = run(FRAMES, true);
  const f = (x) => `${x.toFixed(2)} ms`;
  console.log(
    `${String(width).padStart(LABEL_WIDTH)} px (${grid.columns}×${grid.rows} cells): still ${f(still.shade)} a frame; in wind ${f(wind.shade)} + air ${f(wind.air)}`,
  );
};
SCREENS.forEach((screen) => {
  bench(screen);
});
