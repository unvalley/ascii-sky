import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createAir } from "./air.ts";
import { GLYPHS, OPEN_SKY, SKY_RAMP, type SkyCells } from "./cells.ts";
import { layoutGrid } from "./grid.ts";
import { breathing, createFrame, EVERY_ROW, shadeFrame, streak, UNDRAWN } from "./shade.ts";
import { createSparkles, TINTS } from "./sparkle.ts";

const CELL = { cw: 6, ch: 9.75 };
const CLOUD = GLYPHS.indexOf("8");
const sky = (density: number) => GLYPHS.indexOf(SKY_RAMP[Math.round(density * (SKY_RAMP.length - 1))]);

function fakeCells(density: number, cloudFrom = Number.POSITIVE_INFINITY) {
  const seen = { cells: 0, push: [0, 0] };
  const cells: SkyCells = {
    at: () => {},
    cell: (x0, _y0, _cw, _ch, _theme, out, _shown, pushX = 0, pushY = 0) => {
      seen.cells++;
      if (pushX || pushY) seen.push = [pushX, pushY];
      out[0] = 100;
      out[1] = 150;
      out[2] = 200;
      out[3] = density;
      out[4] = out[5] = out[6] = 220;
      out[7] = 0.3;
      return x0 >= cloudFrom ? CLOUD : OPEN_SKY;
    },
  };
  return { cells, seen };
}

function setup(width = 400, height = 240, faint = 0) {
  const grid = layoutGrid(width, height, 1, width, CELL, faint);
  const n = grid.cols * grid.rows * 4;
  const frame = createFrame(grid, new Uint8ClampedArray(n), new Uint8ClampedArray(n));
  const air = createAir(grid.cols, grid.rows, grid.cw, grid.ch);
  return { grid, frame, air };
}

describe("shadeFrame", () => {
  test("draws every cell in the first frame", () => {
    const { grid, frame, air } = setup();
    assert.ok(frame.shown.every((v) => v === UNDRAWN));
    const changed = shadeFrame(grid, fakeCells(0.5).cells, air, frame, 0, "light");
    assert.equal(changed, grid.cols * grid.rows);
    assert.deepEqual(
      [...frame.changed.subarray(0, changed)],
      Array.from({ length: changed }, (_, k) => k),
    );
  });

  test("redraws nothing when nothing has moved", () => {
    const { grid, frame, air } = setup();
    const { cells } = fakeCells(0.5);
    shadeFrame(grid, cells, air, frame, 0, "light");
    assert.equal(shadeFrame(grid, cells, air, frame, 0.4, "light"), 0);
  });

  test("draws open sky as a glyph as dense as the painting's blue, on its tile", () => {
    for (const [density, glyph] of [
      [0, "."],
      [0.5, "o"],
      [1, "@"],
    ] as const) {
      const { grid, frame, air } = setup();
      shadeFrame(grid, fakeCells(density).cells, air, frame, 0, "light");
      assert.equal(frame.shown[0], GLYPHS.indexOf(glyph), `density ${density}`);
      assert.ok(frame.tiles[3] > 0);
    }
  });

  test("lets open sky breathe in strength, not in glyph", () => {
    const { grid, frame, air } = setup();
    const { cells } = fakeCells(0.5);
    const alphas = new Set<number>();
    for (let t = 0; t < 20; t += 0.5) {
      shadeFrame(grid, cells, air, frame, t, "light");
      alphas.add(frame.colours[3]);
      assert.equal(frame.shown[0], sky(0.5));
    }
    assert.ok(alphas.size > 3);
    for (const a of alphas) assert.ok(a >= 0.86 * 0.9 * 255 - 1 && a <= 255);
  });

  test("draws clouds' glyphs as they are, in full", () => {
    const { grid, frame, air } = setup();
    shadeFrame(grid, fakeCells(0.5, 200).cells, air, frame, 0, "light");
    const k = grid.cols - 1;
    assert.equal(frame.shown[k], CLOUD);
    assert.equal(frame.colours[k * 4 + 3], 255);
    assert.deepEqual([...frame.colours.subarray(k * 4, k * 4 + 3)], [100, 150, 200]);
    assert.equal(frame.tiles[k * 4 + 3], Math.round(0.3 * 255));
  });

  test("carries the clouds with the air, only while it moves", () => {
    const { grid, frame, air } = setup();
    const { cells, seen } = fakeCells(0.5);
    air.dx.fill(5);
    air.dy.fill(-2);
    shadeFrame(grid, cells, air, frame, 0, "light");
    assert.deepEqual(seen.push, [0, 0]);
    air.stirred = true;
    shadeFrame(grid, cells, air, frame, 0, "light");
    assert.deepEqual(seen.push, [5, -2]);
  });

  test("lights the sky the air moves through, in the theme's colour", () => {
    const { grid, frame, air } = setup();
    air.stirred = true;
    air.glow[0] = 1;
    shadeFrame(grid, fakeCells(0.5).cells, air, frame, 0, "dark");
    assert.deepEqual([...frame.colours.subarray(0, 4)], [214, 240, 255, 255]);
    assert.equal(frame.shown[0], sky(0.5));
  });

  test("shows fast air as streaks along it", () => {
    const { grid, frame, air } = setup();
    air.stirred = true;
    air.glow[0] = 0.5;
    air.vx[0] = 200;
    shadeFrame(grid, fakeCells(0.5).cells, air, frame, 0, "light");
    assert.equal(frame.shown[0], GLYPHS.indexOf("-"));
  });
});

describe("faint rows", () => {
  test("take turns, each every other frame", () => {
    const { grid, frame, air } = setup(400, 240, 150);
    const { cells, seen } = fakeCells(0.5);
    shadeFrame(grid, cells, air, frame, 0, "light", EVERY_ROW);
    const asked = (half: number) => {
      seen.cells = 0;
      shadeFrame(grid, cells, air, frame, 0, "light", half);
      return seen.cells;
    };
    let full = 0;
    const turn = [0, 0];
    for (let r = 0; r < grid.rows; r++) {
      if (r < grid.faintRow) full += grid.cols;
      else turn[r & 1] += grid.cols;
    }
    assert.ok(grid.faintRow < grid.rows);
    assert.equal(asked(0), full + turn[0]);
    assert.equal(asked(1), full + turn[1]);
  });

  test("are all worked out when asked for every row", () => {
    const { grid, frame, air } = setup(400, 240, 150);
    const { cells, seen } = fakeCells(0.5);
    shadeFrame(grid, cells, air, frame, 0, "light", EVERY_ROW);
    assert.equal(seen.cells, grid.cols * grid.rows);
  });
});

describe("turns", () => {
  test("work out one row in `every` a frame, each row in its turn", () => {
    const { grid, frame, air } = setup(400, 240);
    const { cells, seen } = fakeCells(0.5);
    shadeFrame(grid, cells, air, frame, 0, "light", EVERY_ROW);
    let total = 0;
    for (let turn = 0; turn < 3; turn++) {
      seen.cells = 0;
      shadeFrame(grid, cells, air, frame, 0, "light", 0, 3, turn);
      const rows = Array.from({ length: grid.rows }, (_, r) => r).filter((r) => r % 3 === turn);
      assert.equal(seen.cells, rows.length * grid.cols);
      total += seen.cells;
    }
    assert.equal(total, grid.rows * grid.cols);
  });

  test("still work out the cells the air is moving, every frame", () => {
    const { grid, frame, air } = setup(400, 240);
    const { cells, seen } = fakeCells(0.5);
    shadeFrame(grid, cells, air, frame, 0, "light", EVERY_ROW);
    air.stirred = true;
    const k = 1 * grid.cols + 5;
    air.glow[k] = 0.5;
    air.dx[k + 1] = 3;
    seen.cells = 0;
    shadeFrame(grid, cells, air, frame, 0, "light", 0, 3, 0);
    const due = Array.from({ length: grid.rows }, (_, r) => r).filter((r) => r % 3 === 0);
    assert.equal(seen.cells, due.length * grid.cols + 2);
  });
});

describe("wind", () => {
  test("in the GTA VI sky colours open sky's glyphs and tiles cyan; by day only its glyphs", () => {
    const at = (theme: "light" | "vice") => {
      const { grid, frame, air } = setup(400, 240);
      const { cells } = fakeCells(0.5);
      air.stirred = true;
      const k = 1 * grid.cols + 5;
      air.glow[k] = 0.4;
      shadeFrame(grid, cells, air, frame, 0, theme, EVERY_ROW);
      return {
        glyph: [...frame.colours.subarray(k * 4, k * 4 + 3)],
        tile: [...frame.tiles.subarray(k * 4, k * 4 + 3)],
      };
    };
    const day = at("light");
    assert.deepEqual(day.tile, [220, 220, 220], "the day's tiles stay as they are");
    const vice = at("vice");
    assert.ok(vice.tile[0] < day.tile[0] - 20 && vice.tile[2] > vice.tile[0] + 25, `a cyan tile: ${vice.tile}`);
    assert.ok(vice.glyph[0] < 30 && vice.glyph[1] > 175, `a cyan glyph: ${vice.glyph}`);
  });
});

describe("night", () => {
  const night = { stars: 0, star: [255, 246, 216], glow: [176, 200, 255], sparkle: true };

  test("draws a sparkle over open sky on the dark page, even when its row isn't due", () => {
    const { grid, frame, air } = setup(400, 240);
    const { cells } = fakeCells(0.5);
    const sp = createSparkles(grid.cols, grid.rows);
    shadeFrame(grid, cells, air, frame, 0, "dark", EVERY_ROW, 3, 0, night, sp);
    const k = 1 * grid.cols + 4;
    sp.code[k] = GLYPHS.indexOf("*");
    sp.tint[k] = 1;
    sp.touched[k] = 1;
    sp.touchedRows[1] = 1;
    shadeFrame(grid, cells, air, frame, 0, "dark", 0, 3, 0, night, sp);
    assert.equal(frame.shown[k], GLYPHS.indexOf("*"));
    assert.deepEqual([...frame.colours.subarray(k * 4, k * 4 + 4)], [...TINTS[1], 255]);
    assert.equal(sp.touched[k], 0);
    assert.equal(sp.touchedRows[1], 0);
  });

  test("shows no sparkles on the light page, or over a cloud", () => {
    const { grid, frame, air } = setup(400, 240);
    const sp = createSparkles(grid.cols, grid.rows);
    const k = grid.cols - 1;
    sp.code[k] = GLYPHS.indexOf("*");
    shadeFrame(grid, fakeCells(0.5).cells, air, frame, 0, "light", EVERY_ROW, 3, 0, night, sp);
    assert.equal(frame.shown[k], sky(0.5));
    shadeFrame(grid, fakeCells(0.5, 0).cells, air, frame, 0, "dark", EVERY_ROW, 3, 0, night, sp);
    assert.equal(frame.shown[k], CLOUD);
  });
});

describe("streak", () => {
  const g = (s: string) => GLYPHS.indexOf(s);
  test("level wind is a dash, a tilde when it glows hard", () => {
    assert.equal(streak(100, 10, 0.5), g("-"));
    assert.equal(streak(-100, 10, 0.9), g("~"));
  });
  test("upright wind is a bar", () => {
    assert.equal(streak(10, -100, 0.5), g("|"));
  });
  test("slanted wind leans its way (y runs down the page)", () => {
    assert.equal(streak(100, -100, 0.5), g("/"));
    assert.equal(streak(100, 100, 0.5), g("\\"));
  });
});

describe("breathing", () => {
  test("gives every cell its own phase and a pace, the same each time", () => {
    const a = breathing(30, 20);
    assert.deepEqual(a, breathing(30, 20));
    for (let i = 0; i < a.length; i += 2) {
      assert.ok(a[i] >= 0 && a[i] < Math.PI * 2 + 1e-6);
      assert.ok(a[i + 1] >= 0.25 && a[i + 1] < 1.15 + 1e-6);
    }
    assert.ok(new Set(a).size > a.length * 0.9);
  });
});
