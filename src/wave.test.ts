import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { sine } from "./wave.ts";

describe("sine", () => {
  test("is within 3e-7 of Math.sin, near and far from 0, either side", () => {
    let worst = 0;
    for (const base of [0, 1e3, 1e5, -50]) {
      for (let a = base; a < base + 20; a += 0.0007) {
        worst = Math.max(worst, Math.abs(sine(a) - Math.sin(a)));
      }
    }
    assert.ok(worst < 3e-7, `worst ${worst}`);
  });

  test("is exact where the table is", () => {
    assert.equal(sine(0), 0);
    assert.equal(sine(Math.PI / 2), 1);
  });
});
