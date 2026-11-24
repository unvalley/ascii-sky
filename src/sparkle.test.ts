import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { GLYPHS } from "./cells.ts";
import { createSparkles, MOST, stepSparkles, TICK } from "./sparkle.ts";

function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    return s / 4_294_967_296;
  };
}
const shown = (code: Int16Array) => [...code].filter((c) => c >= 0).length;

describe("sparkles", () => {
  test("come out only on stars, within the rows asked for", () => {
    const sp = createSparkles(60, 40);
    const random = seeded(3);
    const star = (c: number, r: number) => (c * 7 + r * 13) % 11 === 0;
    for (let i = 0; i < 40; i++) {
      stepSparkles(sp, TICK, 20, star, random);
    }
    for (const s of sp.pool) {
      if (!s.steps) {
        continue;
      }
      assert.ok(star(s.c, s.r));
      assert.ok(s.r >= 1 && s.r < 20);
    }
    assert.ok(shown(sp.code) > 0);
  });

  test("never more than so many at once", () => {
    const sp = createSparkles(80, 40);
    const random = seeded(5);
    for (let i = 0; i < 200; i++) {
      stepSparkles(sp, TICK, 40, () => true, random);
      assert.ok(sp.pool.filter((s) => s.steps).length <= MOST.big + MOST.small);
    }
  });

  test("glint and go: with no stars nothing new starts, and the rest goes out", () => {
    const sp = createSparkles(60, 30);
    const random = seeded(7);
    for (let i = 0; i < 20; i++) {
      stepSparkles(sp, TICK, 30, () => true, random);
    }
    assert.ok(shown(sp.code) > 0);
    for (let i = 0; i < 20; i++) {
      stepSparkles(sp, TICK, 30, () => false, random);
    }
    assert.equal(shown(sp.code), 0);
    assert.ok(sp.pool.every((s) => !s.steps));
  });

  test("mark the cells, and their rows, whose glyph changed", () => {
    const sp = createSparkles(60, 30);
    stepSparkles(sp, TICK, 30, () => true, seeded(9));
    const drawn = [...sp.code.keys()].filter((k) => sp.code[k] >= 0);
    assert.ok(drawn.length > 0);
    for (const k of drawn) {
      assert.equal(sp.touched[k], 1);
      assert.equal(sp.touchedRows[Math.floor(k / sp.cols)], 1);
    }
  });

  test("draw a sparkle's glyphs", () => {
    const sp = createSparkles(60, 30);
    const random = seeded(11);
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      stepSparkles(sp, TICK, 30, () => true, random);
      for (const c of sp.code) {
        if (c >= 0) {
          seen.add(GLYPHS[c]);
        }
      }
    }
    for (const glyph of [".", "+", "*", "-", "|"]) {
      assert.ok(seen.has(glyph), glyph);
    }
  });

  test("wait for a whole tick before moving", () => {
    const sp = createSparkles(60, 30);
    stepSparkles(sp, TICK / 2, 30, () => true, seeded(13));
    assert.equal(shown(sp.code), 0);
    stepSparkles(sp, TICK / 2, 30, () => true, seeded(13));
    assert.ok(shown(sp.code) > 0);
  });
});
