function mix(n: number): number {
  let h = n;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7f_eb_35_2d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x84_6c_a6_8b);
  h ^= h >>> 16;
  return h;
}

export function hash(x: number, y: number, z: number): number {
  return (mix(mix(mix(z | 0) ^ (y | 0)) ^ (x | 0)) >>> 0) / 4_294_967_296;
}
