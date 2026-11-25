import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { range } from "./cells.ts";
import { beat, FULL_RATE, fitGlyphs, HALF_RATE } from "./engine.ts";

const INK = { up: 76, down: 22, left: 2, right: 58 };
const GAP = 1;
const PAD = 0.25;

describe("fitGlyphs", () => {
  (
    [
      [6, 9.75],
      [8, 12],
    ] as const
  ).forEach(([cw, ch]) => {
    const fit = fitGlyphs(INK, cw, ch);
    const k = fit.size / 100;
    const top = fit.y - INK.up * k;
    const bottom = fit.y + INK.down * k;
    const left = fit.x - INK.left * k;
    const right = fit.x + INK.right * k;

    test(`${cw} × ${ch} cells: every glyph stays inside its tile, clear of the gap`, () => {
      assert.ok(top >= GAP + PAD - 1e-9, `top ${top}`);
      assert.ok(left >= GAP + PAD - 1e-9, `left ${left}`);
      assert.ok(bottom <= ch - PAD + 1e-9, `bottom ${bottom}`);
      assert.ok(right <= cw - PAD + 1e-9, `right ${right}`);
    });

    test(`${cw} × ${ch} cells: the glyphs are in the middle of the tile`, () => {
      assert.ok(Math.abs(top - GAP - (ch - bottom)) < 1e-9);
      assert.ok(Math.abs(left - GAP - (cw - right)) < 1e-9);
    });

    test(`${cw} × ${ch} cells: as large as fits`, () => {
      const fills = Math.max(
        (right - left) / (cw - GAP - 2 * PAD),
        (bottom - top) / (ch - GAP - 2 * PAD),
      );
      assert.ok(Math.abs(fills - 1) < 1e-9);
    });
  });
});

const drawnIn = (hz: number, rate: number, seconds = 1) =>
  range(hz * seconds).reduce(
    (clock, i) => {
      const due = beat(clock.drawnAt, rate, ((i + 1) * 1000) / hz);
      return Number.isNaN(due) ? clock : { drawnAt: due, drawn: clock.drawn + 1 };
    },
    { drawnAt: Number.NEGATIVE_INFINITY, drawn: 0 },
  ).drawn;

describe("beat", () => {
  test("draws the first frame whenever it comes", () => {
    assert.equal(beat(Number.NEGATIVE_INFINITY, FULL_RATE, 12_345.6), 12_345.6);
  });

  test("draws every frame of a 60 Hz screen", () => {
    assert.equal(drawnIn(60, FULL_RATE, 2), 120);
  });

  test("draws 60 frames a second on faster screens", () => {
    assert.equal(drawnIn(120, FULL_RATE, 2), 120);
    assert.equal(drawnIn(90, FULL_RATE, 2), 120);
    const at144 = drawnIn(144, FULL_RATE, 2);
    assert.ok(at144 >= 118 && at144 <= 121, `144 Hz drew ${at144} in 2 s`);
  });

  test("draws every other frame at the half rate", () => {
    assert.equal(drawnIn(60, HALF_RATE, 2), 60);
    assert.equal(drawnIn(120, HALF_RATE, 2), 60);
  });

  test("takes a frame that comes a little early", () => {
    assert.equal(beat(0, FULL_RATE, 1000 / 60 - 1), 1000 / 60);
    assert.ok(Number.isNaN(beat(0, FULL_RATE, 1000 / 60 - 2)));
  });

  test("starts a new beat after a stall instead of catching up", () => {
    assert.equal(beat(1000, FULL_RATE, 1500), 1500);
    assert.ok(Number.isNaN(beat(1500, FULL_RATE, 1508)));
  });
});
