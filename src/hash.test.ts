import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { hash } from "./hash.ts";

describe("hash", () => {
  test("is in [0, 1) and the same each time", () => {
    for (const [x, y, z] of [
      [0, 0, 0],
      [-5, 3, 23],
      [2 ** 31 - 1, -(2 ** 31), 37],
      [1e6, 1e6, 5],
    ]) {
      const h = hash(x, y, z);
      assert.ok(h >= 0 && h < 1);
      assert.equal(hash(x, y, z), h);
    }
  });

  test("spreads cells evenly", () => {
    const buckets = new Array(10).fill(0);
    for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) buckets[Math.floor(hash(x, y, 23) * 10)]++;
    for (const b of buckets) assert.ok(b > 850 && b < 1150, `bucket of ${b}`);
  });

  test("gives neighbours and streams unrelated numbers", () => {
    let same = 0;
    for (let x = 0; x < 1000; x++) {
      if (Math.abs(hash(x, 0, 1) - hash(x + 1, 0, 1)) < 0.005) same++;
      if (Math.abs(hash(x, 0, 23) - hash(x, 0, 37)) < 0.005) same++;
    }
    // Unrelated numbers come this close in 1 pair in 100: about 20 here.
    assert.ok(same < 45, `${same} near pairs`);
  });
});
