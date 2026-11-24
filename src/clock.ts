/**
 * When the sky is drawn and how far it moves. The air moves in fixed
 * steps, however often the screen redraws; the sky is drawn at most 60
 * times a second, so a 120 Hz screen costs no more than a 60 Hz one, 30
 * where drawing it is slow, and 20 while the air is still.
 */

/** One step of the air, in seconds, and the most a frame takes. */
export const STEP = 1 / 60;
export const MAX_STEPS = 4;
/** The longest a frame moves the sky on, in seconds, after a stall. */
export const MAX_DT = 0.1;

/** Frames a second: full, and where frames are slow to draw. */
export const FULL_RATE = 60;
export const HALF_RATE = 30;
/** Frames a second while nothing stirs the air. At the full rate each row
 * is worked out one frame in TURNS (shade.ts), 20 times a second; a still
 * sky works out every row a frame instead, at that rate, so it shows the
 * same with a third of the drawing. */
export const CALM_RATE = 20;
/** How many frames' cost decides the rate, and the median cost in ms
 * that halves it (half a 60 Hz frame) or brings it back. */
export const PACE_FRAMES = 30;
export const SLOW_MS = 8;
export const QUICK_MS = 5;
/** How early, in ms, a frame may come and still be drawn: animation
 * frame times wander by about a millisecond. */
export const EARLY_MS = 1.5;

/**
 * The beat a frame at `now` keeps if it is drawn, given the last one was
 * due at `drawnAt`, or NaN to skip it. It keeps to the beat, so a 90 Hz
 * screen draws two frames in three, but starts a new beat after a stall
 * rather than catch up.
 */
export function beat(drawnAt: number, rate: number, now: number): number {
  const gap = 1000 / rate;
  const due = drawnAt + gap;
  if (now < due - EARLY_MS) return Number.NaN;
  return now - due < gap ? due : now;
}

/** How many steps the air takes with `owed` seconds to make up. */
export function stepsFor(owed: number): number {
  let n = 0;
  for (let left = owed; left >= STEP && n < MAX_STEPS; left -= STEP) n++;
  return n;
}

/** The seconds still owed after taking `n` steps (none after a stall). */
export function owedAfter(owed: number, n: number): number {
  if (n === MAX_STEPS) return 0;
  let left = owed;
  for (let i = 0; i < n; i++) left -= STEP;
  return left;
}

/** The frame rate after a window of frames whose median cost was `ms`. */
export function paced(rate: number, ms: number): number {
  if (ms > SLOW_MS) return HALF_RATE;
  if (ms < QUICK_MS) return FULL_RATE;
  return rate;
}

/** After this long at the half rate, the full rate is tried again: frames
 * are timed by the clock on the wall, so a machine busy with something
 * else for a while makes them look slow, and the sky shouldn't stay at 30
 * for good because of it. */
export const RETRY_MS = 5000;

/** The rate to draw at `now`, at `rate` since `since` (ms). */
export function retried(rate: number, since: number, now: number): number {
  return rate === HALF_RATE && now - since >= RETRY_MS ? FULL_RATE : rate;
}

/** The median of `values`, sorted in `scratch` (as long), so nothing is
 * allocated. */
export function median(values: Float64Array, scratch: Float64Array): number {
  scratch.set(values);
  scratch.sort();
  return scratch[values.length >> 1];
}
