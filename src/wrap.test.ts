import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { wrap } from "./wrap.ts";

const slow = (x: number, n: number) => {
  let w = x % n;
  if (w < 0) w += n;
  return w;
};

describe("wrap", () => {
  test("is x % n made positive, to the last bit", () => {
    let seed = 1;
    const rand = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 4294967296;
    };
    for (const n of [128, 1200, 400, 7]) {
      for (let i = 0; i < 20000; i++) {
        const x = (rand() - 0.5) * 2 ** (1 + ((i % 7) * 4));
        assert.ok(wrap(x, n) === slow(x, n), `wrap(${x}, ${n})`);
      }
    }
  });

  test("holds right at the edges", () => {
    for (const n of [128, 1200]) {
      for (const x of [0, n, -n, n - 1e-12, -1e-12, n * 1e6 - 1e-7, -(n * 1e6) + 1e-7, 0.5, -0.5]) {
        assert.ok(wrap(x, n) === slow(x, n), `wrap(${x}, ${n})`);
        assert.ok(wrap(x, n) >= 0 && wrap(x, n) < n);
      }
    }
  });
});
