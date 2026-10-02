/** 确定性随机数(mulberry32)。同一个种子永远生成同一座城市。 */
export class Rng {
  private a: number;

  constructor(seed: number) {
    this.a = seed >>> 0 || 1;
  }

  next(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** 派生一个子随机源,避免增删某一类物体时影响其他物体的随机序列。 */
  fork(salt: number): Rng {
    return new Rng(Math.imul(this.a ^ salt, 2654435761) + salt);
  }
}

/** 整数坐标的稳定哈希 → [0,1) */
export function hash2(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
