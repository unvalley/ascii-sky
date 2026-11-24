export function wrap(x: number, n: number): number {
  const w = x - Math.floor(x / n) * n;
  return w < 0 ? w + n : w >= n ? w - n : w;
}
