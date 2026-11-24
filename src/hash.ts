function mix(n: number): number {
  let h = n;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h;
}

export function hash(x: number, y: number, z: number): number {
  return (mix(mix(mix(z | 0) ^ (y | 0)) ^ (x | 0)) >>> 0) / 4294967296;
}
