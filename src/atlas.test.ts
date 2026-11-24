import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fitGlyphs } from "./atlas.ts";

// Roughly a bold monospace font's reach at 100 px: tall brackets, 0.6 em wide.
const INK = { up: 76, down: 22, left: 2, right: 58 };
const GAP = 1;
const PAD = 0.25;

describe("fitGlyphs", () => {
  for (const [cw, ch] of [
    [6, 9.75],
    [8, 12],
  ] as const) {
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
  }
});
