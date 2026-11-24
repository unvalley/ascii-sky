/**
 * Mixes a 32-bit number so every bit of it moves about half the bits of
 * the result: lowbias32, from Chris Wellons' hash-prospector (public domain).
 */
function mix(n: number): number {
  let h = n;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h;
}

/** A stable number in [0, 1) for a cell (x, y), one of several streams z. */
export function hash(x: number, y: number, z: number): number {
  return (mix(mix(mix(z | 0) ^ (y | 0)) ^ (x | 0)) >>> 0) / 4294967296;
}
