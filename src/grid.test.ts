import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { layoutGrid } from "./grid.ts";

const SKY = 2400;
const CELL = { cw: 6, ch: 9.75 };

describe("layoutGrid", () => {
  for (const [width, dpr] of [
    [1440, 2],
    [390, 2],
    [1366.5, 1],
    [822, 3],
  ] as const) {
    const g = layoutGrid(width, 700, dpr, SKY, CELL);

    test(`${width} px: cells are the size asked for`, () => {
      assert.equal(g.cw, CELL.cw);
      assert.equal(g.ch, CELL.ch);
    });

    test(`${width} px: the grid is whole cells inside the canvas, centred`, () => {
      assert.ok(g.originX >= 0 && g.originX < g.cw);
      assert.ok(g.originX + g.cols * g.cw <= width);
      assert.ok(Math.abs(g.originX + (g.cols * g.cw) / 2 - width / 2) < 1e-9);
      assert.ok(g.rows * g.ch >= 700 && (g.rows - 1) * g.ch < 700);
    });

    test(`${width} px: cells tile the canvas without gaps or overlaps`, () => {
      for (let c = 0; c + 1 < g.cols; c++) assert.equal(g.left[c] + g.across[c], g.left[c + 1]);
      for (let r = 0; r + 1 < g.rows; r++) assert.equal(g.top[r] + g.down[r], g.top[r + 1]);
    });

    test(`${width} px: the still sky is centred`, () => {
      assert.equal(g.skyX + width / 2, SKY / 2);
    });
  }

  test("turns faint from the first row wholly below the faint line", () => {
    const g = layoutGrid(390, 700, 2, SKY, CELL, 280);
    assert.ok(g.faintRow * g.ch >= 280 && (g.faintRow - 1) * g.ch < 280);
  });

  test("with no faint line, no row is faint", () => {
    const g = layoutGrid(1440, 700, 2, SKY, CELL);
    assert.equal(g.faintRow, g.rows);
  });

  test("the backing store is the canvas in device pixels", () => {
    const g = layoutGrid(1440, 700, 2, SKY, CELL);
    assert.equal(g.pw, 2880);
    assert.equal(g.ph, 1400);
  });
});
