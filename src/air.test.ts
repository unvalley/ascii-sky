import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  blow,
  calm,
  createAir,
  fitAir,
  GUST_SIZE,
  laneAt,
  lanesOf,
  MOST_PUSH,
  puff,
  SEEN,
  seenAt,
  stepAir,
} from "./air.ts";
import { STEP } from "./clock.ts";

const CW = 8;
const CH = 12;
const at = (air: ReturnType<typeof createAir>, x: number, y: number) =>
  Math.floor(y / CH) * air.cols + Math.floor(x / CW);
const still = (a: Float32Array) => a.every((v) => v === 0);
const settle = (air: ReturnType<typeof createAir>, seconds: number) => {
  for (let i = 0; i < seconds / STEP; i++) stepAir(air, STEP);
};

describe("lively air", () => {
  test("a sweep makes the air lively; it settles well before the air is still", () => {
    const air = createAir(40, 30, CW, CH);
    assert.equal(air.lively, false);
    for (let i = 0; i <= 10; i++) blow(air, 40 + i * 20, 150, 1000 + i * 16);
    assert.equal(air.lively, true);
    stepAir(air, STEP);
    assert.equal(air.lively, true);
    let settled = 0;
    for (let i = 1; air.stirred && i < 60 * 60; i++) {
      stepAir(air, STEP);
      if (!air.lively && !settled) settled = i * STEP;
    }
    assert.ok(settled > 0, "settles");
    // Lively until no cell shows any more, which comes before stillness.
    assert.ok(air.stirred === false);
  });

  test("lively while any cell shows, and only then", () => {
    const air = createAir(40, 30, CW, CH);
    for (let i = 0; i <= 10; i++) blow(air, 40 + i * 20, 150, 1000 + i * 16);
    for (let s = 0; s < 60 * 20 && air.stirred; s++) {
      stepAir(air, STEP);
      const any = Array.from({ length: air.cols * air.rows }, (_, k) => seenAt(air, k)).some(Boolean);
      assert.equal(air.lively, any, `step ${s}`);
    }
  });

  test("a gust keeps it lively while it blows", () => {
    const air = createAir(40, 30, CW, CH);
    puff(air, 160, 180);
    assert.equal(air.lively, true);
    stepAir(air, STEP);
    assert.equal(air.lively, true);
  });

  test("shows above a pixel or two of push, or any glow", () => {
    assert.ok(SEEN.push >= 1 && SEEN.glow > 0);
  });
});

describe("air", () => {
  test("starts still, and still air stays still", () => {
    const air = createAir(40, 30, CW, CH);
    stepAir(air, STEP);
    assert.equal(air.stirred, false);
    for (const f of [air.vx, air.vy, air.dx, air.dy, air.glow]) assert.ok(still(f));
  });

  test("the pointer's first move only says where it is", () => {
    const air = createAir(40, 30, CW, CH);
    blow(air, 100, 100, 1000);
    assert.equal(air.stirred, false);
    assert.ok(still(air.vx));
  });

  test("moving the pointer pushes the air its way, near it only", () => {
    const air = createAir(40, 30, CW, CH);
    blow(air, 100, 100, 1000);
    blow(air, 116, 100, 1016);
    const here = at(air, 116, 100);
    assert.equal(air.stirred, true);
    assert.ok(air.vx[here] > 0);
    assert.ok(Math.abs(air.vy[here]) < 1e-6);
    assert.ok(air.glow[here] > 0);
    assert.equal(air.vx[at(air, 300, 300)], 0);
  });

  test("a fast pointer pushes no harder than the most", () => {
    const air = createAir(40, 30, CW, CH);
    blow(air, 0, 100, 1000);
    blow(air, 300, 100, 1001);
    for (const v of air.vx) assert.ok(v <= 900 * 0.55 + 1e-3);
  });

  test("after the pointer leaves, its next move starts afresh", () => {
    const air = createAir(40, 30, CW, CH);
    blow(air, 100, 100, 1000);
    calm(air);
    blow(air, 200, 100, 1016);
    assert.equal(air.stirred, false);
  });

  test("a click sends a gust out whose front runs outwards over time", () => {
    const air = createAir(81, 61, CW, CH);
    const x = 40.5 * CW;
    const y = 30.5 * CH;
    puff(air, x, y);
    assert.equal(air.stirred, true);
    // How far from the click the lit air is, on average.
    const out = () => {
      let sum = 0;
      let weight = 0;
      for (let r = 0; r < air.rows; r++)
        for (let c = 0; c < air.cols; c++) {
          const g = air.glow[r * air.cols + c];
          sum += g * Math.hypot((c + 0.5) * CW - x, (r + 0.5) * CH - y);
          weight += g;
        }
      return sum / weight;
    };
    settle(air, STEP * 6);
    const early = out();
    settle(air, STEP * 18);
    assert.ok(out() > early + 2 * CW, `${early} then ${out()}`);
  });

  test("a gust blows outwards", () => {
    const air = createAir(81, 61, CW, CH);
    const x = 40.5 * CW;
    const y = 30.5 * CH;
    puff(air, x, y);
    settle(air, STEP * 12);
    let left = 0;
    let right = 0;
    let up = 0;
    let down = 0;
    for (let r = 0; r < air.rows; r++)
      for (let c = 0; c < air.cols; c++) {
        const i = r * air.cols + c;
        if ((c + 0.5) * CW < x) left += air.vx[i];
        else right += air.vx[i];
        if ((r + 0.5) * CH < y) up += air.vy[i];
        else down += air.vy[i];
      }
    assert.ok(left < 0 && right > 0, `${left} ${right}`);
    assert.ok(up < 0 && down > 0, `${up} ${down}`);
  });

  test("every gust comes out in streams with calm between, not as a ring", () => {
    const lanes = new Float64Array(GUST_SIZE);
    for (let seed = 1; seed <= 50; seed++) {
      lanesOf(seed, lanes, 0);
      let least = 1;
      let most = 0;
      for (let a = -Math.PI; a < Math.PI; a += 0.01) {
        const l = laneAt(lanes, 0, a);
        least = Math.min(least, l);
        most = Math.max(most, l);
      }
      assert.ok(least < 0.01 && most > 0.99, `gust ${seed}: ${least} .. ${most}`);
    }
  });

  test("a gust's streams go round the circle without a seam", () => {
    const lanes = new Float64Array(GUST_SIZE);
    for (let seed = 1; seed <= 6; seed++) {
      lanesOf(seed, lanes, 0);
      assert.ok(Math.abs(laneAt(lanes, 0, Math.PI - 1e-9) - laneAt(lanes, 0, -Math.PI)) < 1e-6);
    }
  });

  test("many clicks at once take the oldest gust's place", () => {
    const air = createAir(40, 30, CW, CH);
    for (let i = 0; i < 7; i++) {
      puff(air, 100 + i * 10, 150);
      settle(air, STEP * 3);
    }
    assert.equal(air.puffs, 7);
    for (let g = 0; g < air.gusts.length; g += GUST_SIZE) assert.ok(air.gusts[g + 2] >= 0);
  });

  test("the same clicks blow the same way", () => {
    const run = () => {
      const air = createAir(40, 30, CW, CH);
      puff(air, 120, 150);
      settle(air, STEP * 5);
      puff(air, 200, 100);
      settle(air, STEP * 20);
      return air;
    };
    const a = run();
    const b = run();
    assert.deepEqual(a.vx, b.vx);
    assert.deepEqual(a.glow, b.glow);
  });

  test("never carries a cloud further than the most", () => {
    const air = createAir(40, 30, CW, CH);
    for (let t = 0; t < 60; t++) {
      puff(air, 160, 180);
      stepAir(air, STEP);
    }
    for (let i = 0; i < air.dx.length; i++)
      assert.ok(Math.hypot(air.dx[i], air.dy[i]) <= MOST_PUSH + 1e-3);
  });

  test("settles back to still once the gusts have blown, and stops working", () => {
    const air = createAir(40, 30, CW, CH);
    puff(air, 160, 180);
    settle(air, 30);
    assert.equal(air.stirred, false);
    for (const f of [air.vx, air.vy, air.dx, air.dy, air.glow]) assert.ok(still(f));
    for (let g = 0; g < air.gusts.length; g += GUST_SIZE) assert.ok(air.gusts[g + 2] < 0);
  });

  test("keeps moving when only the cells' size changes", () => {
    const air = createAir(40, 30, CW, CH);
    puff(air, 160, 180);
    const same = fitAir(air, 40, 30, CW, CH);
    assert.equal(same, air);
    const resized = fitAir(air, 40, 30, 9, 13.5);
    assert.equal(resized.vx, air.vx);
    assert.equal(resized.stirred, true);
    assert.equal(resized.cw, 9);
  });

  test("starts still on a new grid, remembering the pointer", () => {
    const air = createAir(40, 30, CW, CH);
    blow(air, 100, 100, 1000);
    puff(air, 160, 180);
    const bigger = fitAir(air, 50, 30, CW, CH);
    assert.equal(bigger.stirred, false);
    assert.equal(bigger.vx.length, 50 * 30);
    assert.equal(bigger.pointer, air.pointer);
  });
});
