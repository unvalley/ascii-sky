import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SKY_RAMP } from "./cells.ts";
import { oklab } from "./oklab.ts";
import { SUNSET_STOPS, sunsetColours, sunsetGradient } from "./sunset.ts";

const COLUMNS = 3;
const ROWS = 60;
const CH = 10;
/** A still sky whose columns hold the lightest, a middle and the densest glyph. */
const text = Array.from(
  { length: ROWS },
  () => `${SKY_RAMP[0]}${SKY_RAMP[4]}${SKY_RAMP[SKY_RAMP.length - 1]}`,
).join("\n");
const colours = sunsetColours(COLUMNS, ROWS, CH, text);
const at = (c: number, r: number) => {
  const o = (r * COLUMNS + c) * 4;
  return [colours[o], colours[o + 1], colours[o + 2], colours[o + 3]];
};
/** Hue in degrees (OKLab), 0 .. 360. */
const hue = ([r, g, b]: number[]) => {
  const [, a, bb] = oklab(r, g, b);
  return ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
};

describe("sunset", () => {
  test("a colour a cell, opaque", () => {
    assert.equal(colours.length, COLUMNS * ROWS * 4);
    for (let r = 0; r < ROWS; r++) assert.equal(at(1, r)[3], 255);
  });

  test("runs from violet at the top to orange low down", () => {
    const top = at(1, 0);
    const low = at(1, 33); // 335 page pixels down
    assert.ok(top[2] > top[1] && top[2] > 150, `violet top: ${top}`);
    assert.ok(low[0] > 230 && low[0] > low[1] && low[1] > low[2], `orange low: ${low}`);
    assert.ok(hue(top) > 260 && hue(top) < 320, `top hue ${hue(top)}`);
    assert.ok(hue(low) > 30 && hue(low) < 80, `low hue ${hue(low)}`);
  });

  test("is deeper where the painting's blue is denser", () => {
    for (const r of [0, 20, 40]) {
      const [light, middle, dense] = [0, 1, 2].map((c) => oklab(...(at(c, r).slice(0, 3) as [number, number, number]))[0]);
      assert.ok(light > middle && middle > dense, `row ${r}: ${light} ${middle} ${dense}`);
    }
  });

  test("the page's gradient has the same stops", () => {
    const css = sunsetGradient();
    for (const [y, c] of SUNSET_STOPS) assert.ok(css.includes(`${c} ${y}px`), css);
  });
});
