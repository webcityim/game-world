import { PLANET_RADIUS, SEED, TERRAIN_EXAGGERATION } from "../config";
import { createNoise3, type Noise3 } from "./noise";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** 压平区域:商铺广场、奇观地基等,让地形在这里变成平地。 */
interface FlatZone {
  x: number;
  y: number;
  z: number;
  /** 完全平整的半径(米) */
  inner: number;
  /** 过渡到自然地形的外半径(米) */
  outer: number;
  /** 平整后的海拔(米,已含夸张) */
  height: number;
}

export type RGB = [number, number, number];

/**
 * 行星地形:输入单位球面方向,输出海拔(米,海平面 = 0)。
 * 所有噪声坐标都在单位球上采样,频率 f 对应的波长约为 R / f 米。
 */
export class Terrain {
  private readonly n: Noise3;
  private readonly flats: FlatZone[] = [];

  constructor(seed: number = SEED) {
    this.n = createNoise3(seed);
  }

  addFlatZone(dir: { x: number; y: number; z: number }, inner: number, outer: number, height: number) {
    this.flats.push({ x: dir.x, y: dir.y, z: dir.z, inner, outer, height });
  }

  private fbm(
    x: number,
    y: number,
    z: number,
    f0: number,
    octaves: number,
    maxFreq: number,
    gain: number,
    o: number,
  ): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = f0;
    for (let i = 0; i < octaves; i++) {
      if (i > 0 && f > maxFreq) break;
      sum += amp * this.n(x * f + o, y * f + o * 1.7, z * f + o * 2.3);
      norm += amp;
      amp *= gain;
      f *= 2.03;
    }
    return sum / norm;
  }

  private ridged(
    x: number,
    y: number,
    z: number,
    f0: number,
    octaves: number,
    maxFreq: number,
    gain: number,
    o: number,
  ): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = f0;
    for (let i = 0; i < octaves; i++) {
      if (i > 0 && f > maxFreq) break;
      const r = 1 - Math.abs(this.n(x * f + o, y * f + o * 1.7, z * f + o * 2.3));
      sum += amp * r * r;
      norm += amp;
      amp *= gain;
      f *= 2.1;
    }
    return sum / norm;
  }

  /** 生物群系噪声,用于给地表上色(沙漠 / 草地)。 */
  biome(x: number, y: number, z: number): number {
    return this.fbm(x, y, z, 2.2, 3, 1e9, 0.5, 301.5);
  }

  /** 细节噪声,用于给颜色加一点斑驳。 */
  speckle(x: number, y: number, z: number, maxFreq: number): number {
    return this.fbm(x, y, z, 900, 3, maxFreq, 0.5, 17.3);
  }

  /**
   * @param maxFreq 最高采样频率。低层级的地形块只采样低频,避免远处出现高频走样。
   */
  height(x: number, y: number, z: number, maxFreq: number): number {
    // 大陆:低频,决定海陆分布
    const c = this.fbm(x, y, z, 1.2, 5, maxFreq, 0.5, 11.3);
    const t = c - 0.02;
    let h = t < 0 ? t * 14000 : Math.pow(t, 0.85) * 2200;
    const land = smooth(0, 0.12, t);

    // 山脉:脊状噪声,只出现在内陆并被另一层噪声遮罩成"山系"
    const mMask =
      smooth(0.08, 0.45, t) * smooth(-0.1, 0.35, this.fbm(x, y, z, 3.1, 3, maxFreq, 0.5, 41.7));
    const ridge = this.ridged(x, y, z, 7, 8, maxFreq, 0.52, 73.1);
    h += ridge * mMask * 8200;

    // 丘陵
    h += this.fbm(x, y, z, 30, 4, maxFreq, 0.5, 5.9) * 350 * land;

    // 河流:低频噪声的零值等值线形成连续的河网,在低地雕刻河谷
    if (land > 0) {
      const r = Math.abs(this.fbm(x, y, z, 6, 4, maxFreq, 0.5, 97.3));
      const riverMask = 1 - smooth(0, 0.018, r);
      const lowland = 1 - smooth(60, 500, h);
      const k = riverMask * lowland * land;
      h += (-6 - h) * k;
    }

    h *= TERRAIN_EXAGGERATION;

    for (const f of this.flats) {
      const dx = x - f.x;
      const dy = y - f.y;
      const dz = z - f.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) * PLANET_RADIUS;
      if (d < f.outer) {
        const w = 1 - smooth(f.inner, f.outer, d);
        h = mix(h, f.height, w);
      }
    }
    return h;
  }

  /**
   * 地表颜色。
   * @param h 海拔(米,含夸张)
   * @param slope 0 = 平地,越大越陡
   * @param ny 纬度分量(单位方向的 y)
   * @param biome 生物群系噪声
   * @param speck 斑驳噪声
   */
  color(h: number, slope: number, ny: number, biome: number, speck: number, out: RGB): RGB {
    const hn = h / TERRAIN_EXAGGERATION;
    let r: number;
    let g: number;
    let b: number;

    if (hn < 0) {
      // 海床:越深越暗
      const d = smooth(0, 3000, -hn);
      r = mix(0.46, 0.05, d);
      g = mix(0.42, 0.1, d);
      b = mix(0.3, 0.18, d);
    } else if (hn < 10) {
      r = 0.78;
      g = 0.72;
      b = 0.52;
    } else {
      // 草地 / 干旱地带
      const arid = smooth(0.1, 0.3, biome) * (1 - smooth(0.35, 0.7, Math.abs(ny)));
      const gr = 0.2 + 0.1 * speck;
      r = mix(0.27 + 0.06 * speck, 0.72, arid);
      g = mix(0.42 + gr * 0.3, 0.6, arid);
      b = mix(0.17, 0.34, arid);

      // 高海拔:草 -> 岩石
      const rock = smooth(1500, 3200, hn);
      r = mix(r, 0.45, rock);
      g = mix(g, 0.42, rock);
      b = mix(b, 0.39, rock);

      // 陡坡裸岩
      const steep = smooth(0.05, 0.22, slope);
      r = mix(r, 0.4, steep);
      g = mix(g, 0.37, steep);
      b = mix(b, 0.34, steep);

      // 雪线:越靠近两极越低
      const snowline = 4300 - 3700 * ny * ny;
      const snow = smooth(snowline, snowline + 500, hn + speck * 120);
      r = mix(r, 0.94, snow);
      g = mix(g, 0.96, snow);
      b = mix(b, 0.98, snow);

      // 极地冰盖
      const ice = smooth(0.86, 0.93, Math.abs(ny));
      r = mix(r, 0.92, ice);
      g = mix(g, 0.95, ice);
      b = mix(b, 0.98, ice);
    }

    out[0] = r;
    out[1] = g;
    out[2] = b;
    return out;
  }
}
