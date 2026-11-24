import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  beat,
  CALM_RATE,
  FULL_RATE,
  HALF_RATE,
  MAX_STEPS,
  median,
  owedAfter,
  paced,
  QUICK_MS,
  RETRY_MS,
  retried,
  SLOW_MS,
  STEP,
  stepsFor,
} from "./clock.ts";
import { TURNS } from "./shade.ts";

function drawnIn(hz: number, rate: number, seconds = 1) {
  let drawnAt = Number.NEGATIVE_INFINITY;
  let drawn = 0;
  for (let i = 1; i <= hz * seconds; i++) {
    const due = beat(drawnAt, rate, (i * 1000) / hz);
    if (Number.isNaN(due)) continue;
    drawnAt = due;
    drawn++;
  }
  return drawn;
}

describe("beat", () => {
  test("draws the first frame whenever it comes", () => {
    assert.equal(beat(Number.NEGATIVE_INFINITY, FULL_RATE, 12345.6), 12345.6);
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

describe("steps", () => {
  test("takes no step until one is owed", () => {
    assert.equal(stepsFor(0), 0);
    assert.equal(stepsFor(STEP * 0.99), 0);
    assert.equal(stepsFor(STEP), 1);
  });

  test("takes as many whole steps as are owed, up to the most a frame takes", () => {
    assert.equal(stepsFor(STEP * 2.5), 2);
    assert.equal(stepsFor(1), MAX_STEPS);
  });

  test("keeps what is left over, and forgets a stall", () => {
    const left = owedAfter(STEP * 2.5, 2);
    assert.ok(Math.abs(left - STEP / 2) < 1e-12);
    assert.equal(owedAfter(1, MAX_STEPS), 0);
  });

  test("never leaves a whole step owed", () => {
    for (let owed = 0; owed < STEP * MAX_STEPS; owed += STEP / 7) {
      const n = stepsFor(owed);
      assert.ok(owedAfter(owed, n) < STEP, `owed ${owed}`);
    }
  });
});

describe("pacing", () => {
  test("halves the rate when frames are slow", () => {
    assert.equal(paced(FULL_RATE, SLOW_MS + 0.1), HALF_RATE);
  });

  test("brings it back once they are quick", () => {
    assert.equal(paced(HALF_RATE, QUICK_MS - 0.1), FULL_RATE);
  });

  test("keeps the rate in between, so it doesn't flap", () => {
    const between = (SLOW_MS + QUICK_MS) / 2;
    assert.equal(paced(FULL_RATE, between), FULL_RATE);
    assert.equal(paced(HALF_RATE, between), HALF_RATE);
  });

  test("tries the full rate again after a while at the half rate", () => {
    assert.equal(retried(HALF_RATE, 1000, 1000 + RETRY_MS - 1), HALF_RATE);
    assert.equal(retried(HALF_RATE, 1000, 1000 + RETRY_MS), FULL_RATE);
    assert.equal(retried(FULL_RATE, 1000, 1000 + RETRY_MS * 3), FULL_RATE);
  });

  test("goes by the median, so one slow frame doesn't count", () => {
    const costs = new Float64Array(30).fill(3);
    costs[7] = 200;
    assert.equal(median(costs, new Float64Array(30)), 3);
  });

  test("leaves the costs as they were", () => {
    const costs = Float64Array.from([5, 1, 4, 2, 3]);
    assert.equal(median(costs, new Float64Array(5)), 3);
    assert.deepEqual([...costs], [5, 1, 4, 2, 3]);
  });
});

describe("calm rate", () => {
  test("a still sky draws every row as often as the full rate works each out", () => {
    assert.equal(CALM_RATE * TURNS, FULL_RATE);
  });
});
