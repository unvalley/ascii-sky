export function wrap(x: number, n: number): number {
  const w = x - Math.floor(x / n) * n;
  if (w < 0) {
    return w + n;
  }
  if (w >= n) {
    return w - n;
  }
  return w;
}
