export const STEP = 1 / 60;
export const MAX_STEPS = 4;
export const MAX_DT = 0.1;

export const FULL_RATE = 60;
export const HALF_RATE = 30;
export const CALM_RATE = 20;
export const PACE_FRAMES = 30;
export const SLOW_MS = 8;
export const QUICK_MS = 5;
export const EARLY_MS = 1.5;

export function beat(drawnAt: number, rate: number, now: number): number {
  const gap = 1000 / rate;
  const due = drawnAt + gap;
  if (now < due - EARLY_MS) {
    return Number.NaN;
  }
  return now - due < gap ? due : now;
}

export function stepsFor(owed: number): number {
  let n = 0;
  for (let left = owed; left >= STEP && n < MAX_STEPS; left -= STEP) {
    n++;
  }
  return n;
}

export function owedAfter(owed: number, n: number): number {
  if (n === MAX_STEPS) {
    return 0;
  }
  let left = owed;
  for (let i = 0; i < n; i++) {
    left -= STEP;
  }
  return left;
}

export function paced(rate: number, ms: number): number {
  if (ms > SLOW_MS) {
    return HALF_RATE;
  }
  if (ms < QUICK_MS) {
    return FULL_RATE;
  }
  return rate;
}

export const RETRY_MS = 5000;

export function retried(rate: number, since: number, now: number): number {
  return rate === HALF_RATE && now - since >= RETRY_MS ? FULL_RATE : rate;
}

export function median(values: Float64Array, scratch: Float64Array): number {
  scratch.set(values);
  scratch.sort();
  return scratch[values.length >> 1];
}
