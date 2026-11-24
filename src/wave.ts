/**
 * A sine for the hot path, from a table: every open-sky cell breathes on a
 * sine of its own each frame, and Math.sin there costs several times as
 * much as the rest of the cell. Within 3e-7 of Math.sin: an alpha of 255
 * steps moves by under a ten-thousandth of a step.
 */
const SIZE = 4096;
const TABLE = new Float64Array(SIZE + 1);
for (let i = 0; i <= SIZE; i++) TABLE[i] = Math.sin((i / SIZE) * Math.PI * 2);
const PER_RADIAN = SIZE / (Math.PI * 2);

/** sin(a), for any a. (Wrapped with floor, not %, which is slow on
 * fractions.) */
export function sine(a: number): number {
  const turns = a * PER_RADIAN;
  const at = turns - Math.floor(turns / SIZE) * SIZE;
  const i = at | 0;
  const v = TABLE[i];
  return v + (TABLE[i + 1] - v) * (at - i);
}
