import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  blow,
  calm,
  createAir,
  fitAir,
  laneAt,
  lanesOf,
  MOST_PUSH,
  puff,
  seenAt,
  stepAir,
} from "./air.ts";
import { range } from "./cells.ts";
import { STEP } from "./engine.ts";

const CW = 8;
const CH = 12;
const at = (air: ReturnType<typeof createAir>, x: number, y: number) =>
  Math.floor(y / CH) * air.columns + Math.floor(x / CW);
const still = (a: Float32Array) => a.every((v) => v === 0);
const settle = (air: ReturnType<typeof createAir>, seconds: number) => {
  range(Math.ceil(seconds / STEP)).forEach(() => {
    stepAir(air, STEP);
  });
};
const sweep = (air: ReturnType<typeof createAir>) => {
  range(11).forEach((i) => {
    blow(air, 40 + i * 20, 150, 1000 + i * 16);
  });
};

describe("lively air", () => {
  test("a sweep makes the air lively; it settles well before the air is still", () => {
    const air = createAir(40, 30, CW, CH);
    assert.equal(air.lively, false);
    sweep(air);
    assert.equal(air.lively, true);
    stepAir(air, STEP);
    assert.equal(air.lively, true);
    const lively = range(60 * 60 - 1).map(() => {
      if (air.stirred) {
        stepAir(air, STEP);
      }
      return air.lively;
    });
    assert.ok(lively.includes(false), "settles");
    assert.ok(air.stirred === false);
  });

  test("lively while any cell shows, and only then", () => {
    const air = createAir(40, 30, CW, CH);
    sweep(air);
    range(60 * 20).forEach((s) => {
      if (!air.stirred) {
        return;
      }
      stepAir(air, STEP);
      const any = range(air.columns * air.rows).some((k) => seenAt(air, k));
      assert.equal(air.lively, any, `step ${s}`);
    });
  });

  test("a gust keeps it lively while it blows", () => {
    const air = createAir(40, 30, CW, CH);
    puff(air, 160, 180);
    assert.equal(air.lively, true);
    stepAir(air, STEP);
    assert.equal(air.lively, true);
  });
});

describe("air", () => {
  test("starts still, and still air stays still", () => {
    const air = createAir(40, 30, CW, CH);
    stepAir(air, STEP);
    assert.equal(air.stirred, false);
    assert.ok([air.vx, air.vy, air.dx, air.dy, air.glow].every(still));
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
    assert.ok(air.vx.every((v) => v <= 900 * 0.55 + 1e-3));
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
    const away = (k: number) =>
      Math.hypot(((k % air.columns) + 0.5) * CW - x, (Math.floor(k / air.columns) + 0.5) * CH - y);
    const out = () =>
      air.glow.reduce((sum, g, k) => sum + g * away(k), 0) /
      air.glow.reduce((sum, g) => sum + g, 0);
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
    const sum = (field: Float32Array, where: (k: number) => boolean) =>
      field.reduce((total, v, k) => (where(k) ? total + v : total), 0);
    const west = (k: number) => ((k % air.columns) + 0.5) * CW < x;
    const north = (k: number) => (Math.floor(k / air.columns) + 0.5) * CH < y;
    const left = sum(air.vx, west);
    const right = sum(air.vx, (k) => !west(k));
    const up = sum(air.vy, north);
    const down = sum(air.vy, (k) => !north(k));
    assert.ok(left < 0 && right > 0, `${left} ${right}`);
    assert.ok(up < 0 && down > 0, `${up} ${down}`);
  });

  test("every gust comes out in streams with calm between, not as a ring", () => {
    const angles = range(629).map((i) => -Math.PI + i * 0.01);
    range(50).forEach((i) => {
      const lanes = lanesOf(i + 1);
      const along = angles.map((a) => laneAt(lanes, a));
      const least = Math.min(...along);
      const most = Math.max(...along);
      assert.ok(least < 0.01 && most > 0.99, `gust ${i + 1}: ${least} .. ${most}`);
    });
  });

  test("a gust's streams go round the circle without a seam", () => {
    range(6).forEach((i) => {
      const lanes = lanesOf(i + 1);
      assert.ok(Math.abs(laneAt(lanes, Math.PI - 1e-9) - laneAt(lanes, -Math.PI)) < 1e-6);
    });
  });

  test("many clicks at once take the oldest gust's place", () => {
    const air = createAir(40, 30, CW, CH);
    range(7).forEach((i) => {
      puff(air, 100 + i * 10, 150);
      settle(air, STEP * 3);
    });
    assert.equal(air.puffs, 7);
    assert.ok(air.gusts.every((g) => g.age >= 0));
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
    range(60).forEach(() => {
      puff(air, 160, 180);
      stepAir(air, STEP);
    });
    assert.ok(air.dx.every((x, i) => Math.hypot(x, air.dy[i]) <= MOST_PUSH + 1e-3));
  });

  test("settles back to still once the gusts have blown, and stops working", () => {
    const air = createAir(40, 30, CW, CH);
    puff(air, 160, 180);
    settle(air, 30);
    assert.equal(air.stirred, false);
    assert.ok([air.vx, air.vy, air.dx, air.dy, air.glow].every(still));
    assert.ok(air.gusts.every((g) => g.age < 0));
  });

  test("keeps moving when only the cells' size changes", () => {
    const air = createAir(40, 30, CW, CH);
    puff(air, 160, 180);
    const same = fitAir(air, 40, 30, CW, CH);
    assert.equal(same, air);
    const resized = fitAir(air, 40, 30, 9, 13.5);
    assert.equal(resized.vx, air.vx);
    assert.equal(resized.stirred, true);
    assert.equal(resized.cellWidth, 9);
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
