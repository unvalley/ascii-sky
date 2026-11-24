const SIZE = 4096;
const TABLE = new Float64Array(SIZE + 1);
for (let i = 0; i <= SIZE; i++) TABLE[i] = Math.sin((i / SIZE) * Math.PI * 2);
const PER_RADIAN = SIZE / (Math.PI * 2);

export function sine(a: number): number {
  const turns = a * PER_RADIAN;
  const at = turns - Math.floor(turns / SIZE) * SIZE;
  const i = at | 0;
  const v = TABLE[i];
  return v + (TABLE[i + 1] - v) * (at - i);
}
