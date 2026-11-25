import { readFileSync } from "node:fs";
import sharp from "sharp";
import { blow, createAir, puff, stepAir } from "../src/air.ts";
import { GLYPHS, range, skyCells, sunsetColours } from "../src/cells.ts";
import { STEP } from "../src/engine.ts";
import { sky } from "../src/index.ts";
import { createFrame, layoutGrid, shadeFrame, TURNS } from "../src/shade.ts";

const ROOT = new URL("..", import.meta.url).pathname;
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
    cw: sky.cellWidth,
    ch: sky.cellHeight,
    text,
    rgb: {
      light: light.pixels,
      dark: dark.pixels,
      sunset: sunsetColours(sky.columns, sky.rows, sky.cellHeight, text),
    },
  },
  near,
  far,
  shapes: new Float32Array(GLYPHS.length * 6).fill(0.5),
});

const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const bench = (width, dpr) => {
  const hero = width >= 768 ? 360 : 240;
  const grid = layoutGrid(
    width,
    sky.rows * sky.cellHeight,
    dpr,
    sky.columns * sky.cellWidth,
    { cw: sky.cellWidth, ch: sky.cellHeight },
    hero + 40,
  );
  const n = grid.cols * grid.rows * 4;
  const frame = createFrame(grid, new Uint8ClampedArray(n), new Uint8ClampedArray(n));
  const air = createAir(grid.cols, grid.rows, grid.cw, grid.ch);
  const run = (frames, stir) => {
    const times = range(frames).map((i) => {
      if (stir) {
        const x = (width / 2) * (1 + Math.sin(i / 20));
        blow(air, x, 150 + 80 * Math.sin(i / 13), i * 16.7);
        if (i % 60 === 0) {
          puff(air, x, 200);
        }
      }
      const a = performance.now();
      stepAir(air, STEP);
      const b = performance.now();
      shadeFrame(grid, cells, air, frame, (i + 1) * STEP, "light", i & 1, TURNS, i % TURNS);
      return { shade: performance.now() - b, air: b - a };
    });
    const settled = times.slice(60);
    return {
      shade: median(settled.map((t) => t.shade)),
      air: median(settled.map((t) => t.air)),
    };
  };
  const still = run(400, false);
  const wind = run(400, true);
  const f = (x) => `${x.toFixed(2)} ms`;
  console.log(
    `${String(width).padStart(4)} px (${grid.cols}×${grid.rows} cells): still ${f(still.shade)} a frame; in wind ${f(wind.shade)} + air ${f(wind.air)}`,
  );
};
[
  [1440, 2],
  [820, 2],
  [390, 2],
].forEach(([width, dpr]) => {
  bench(width, dpr);
});
