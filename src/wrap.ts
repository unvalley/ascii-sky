/**
 * `x` wrapped into [0, n), as `x % n`, plus n when negative, gives it, but
 * several times faster: `%` on a fraction is a slow call, and the cloud
 * layers and their noise wrap every point a cell looks up. The result is
 * the same to the last bit: x - k·n is exact for the sizes the sky uses,
 * and a quotient that rounds onto a whole number is corrected after.
 */
export function wrap(x: number, n: number): number {
  const w = x - Math.floor(x / n) * n;
  return w < 0 ? w + n : w >= n ? w - n : w;
}
