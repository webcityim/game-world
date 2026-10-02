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

/** 以某个地点为原点的切平面坐标系:u = 东(沿 heading 旋转),v = 北。 */
interface Frame {
  x: number;
  y: number;
  z: number;
  e1: [number, number, number];
  e2: [number, number, number];
}

function makeFrame(dir: { x: number; y: number; z: number }, heading: number): Frame {
  const up: [number, number, number] = [dir.x, dir.y, dir.z];
  const ref: [number, number, number] = Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const cross = (a: number[], b: number[]): [number, number, number] => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  let t1 = cross(ref, up);
  let l = Math.hypot(...t1);
  t1 = [t1[0] / l, t1[1] / l, t1[2] / l];
  const t2 = cross(up, t1);
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const e1: [number, number, number] = [t1[0] * c + t2[0] * s, t1[1] * c + t2[1] * s, t1[2] * c + t2[2] * s];
  const e2: [number, number, number] = [-t1[0] * s + t2[0] * c, -t1[1] * s + t2[1] * c, -t1[2] * s + t2[2] * c];
  return { x: dir.x, y: dir.y, z: dir.z, e1, e2 };
}

/** 环绕某地点的山系(盆地 + 群山),让城市抬头就能看到山。 */
interface Massif {
  f: Frame;
  rIn: number;
  rOut: number;
  rEnd: number;
  amp: number;
  /** 山势偏向的方向(v 为正 = 偏北),>0 时北侧更高 */
  tilt: number;
}

/** 手工设计的河:从北边的山里流出,蜿蜒向南,汇入一个湖。 */
interface River {
  f: Frame;
  u0: number;
  len: number;
  w0: number;
  amp: number;
  lam: number;
  p1: number;
  p2: number;
}

export type RGB = [number, number, number];

/** 设计地貌分区:沙漠 / 草原 / 峡谷 / 断崖 / 湖泊 */
export type ZoneKind = "desert" | "grass" | "canyon" | "cliff" | "lake";
const ZONE_INDEX: Record<ZoneKind, number> = { desert: 0, grass: 1, canyon: 2, cliff: 3, lake: 4 };
interface Zone {
  x: number;
  y: number;
  z: number;
  r: number;
  kind: number;
  seed: number;
}
/** 各分区权重(0..1);lakeBowl = 湖盆,lake = 湖岸平原(包住湖盆) */
export interface ZoneWeights {
  desert: number;
  grass: number;
  canyon: number;
  cliff: number;
  lake: number;
  lakeBowl: number;
}
export const newZoneWeights = (): ZoneWeights => ({ desert: 0, grass: 0, canyon: 0, cliff: 0, lake: 0, lakeBowl: 0 });

/**
 * 行星地形:输入单位球面方向,输出海拔(米,海平面 = 0)。
 * 所有噪声坐标都在单位球上采样,频率 f 对应的波长约为 R / f 米。
 */
export class Terrain {
  private readonly n: Noise3;
  private readonly flats: FlatZone[] = [];
  private readonly massifs: Massif[] = [];
  private readonly rivers: River[] = [];
  private readonly zones: Zone[] = [];
  private readonly zw: ZoneWeights = newZoneWeights();

  constructor(seed: number = SEED) {
    this.n = createNoise3(seed);
  }

  addFlatZone(dir: { x: number; y: number; z: number }, inner: number, outer: number, height: number) {
    this.flats.push({ x: dir.x, y: dir.y, z: dir.z, inner, outer, height });
  }

  /**
   * 在 dir 周围 rIn 米以内保持原样(盆地),rIn~rOut 逐渐隆起成山,rEnd 外消失。
   * amp 是山脉高度尺度(夸张前,米)。
   */
  addMassif(dir: { x: number; y: number; z: number }, heading: number, rIn: number, rOut: number, rEnd: number, amp: number, tilt = 0.5) {
    this.massifs.push({ f: makeFrame(dir, heading), rIn, rOut, rEnd, amp, tilt });
  }

  /**
   * 手工河流:中心线 u(v) = u0 + 蜿蜒,v 从 +len(山里)到 -len(湖)。
   * u0 是河到地点的横向偏移(米),w0 是下游的河床半宽(米)。
   */
  addRiver(dir: { x: number; y: number; z: number }, heading: number, u0: number, len: number, w0: number, seed = 1) {
    this.rivers.push({ f: makeFrame(dir, heading), u0, len, w0, amp: 650 + 120 * (seed % 3), lam: 5200 + 900 * (seed % 4), p1: seed * 1.7, p2: seed * 0.9 + 2 });
  }

  /** 设计地貌分区:radius 米内整体换成该地貌(边界带噪声,不是正圆)。 */
  addZone(dir: { x: number; y: number; z: number }, radius: number, kind: ZoneKind, seed = 1) {
    this.zones.push({ x: dir.x, y: dir.y, z: dir.z, r: radius, kind: ZONE_INDEX[kind], seed: 900 + seed * 13.7 });
  }

  /** 某点的分区权重(多个分区取最大)。 */
  zoneWeights(x: number, y: number, z: number, out: ZoneWeights = this.zw): ZoneWeights {
    out.desert = out.grass = out.canyon = out.cliff = out.lake = out.lakeBowl = 0;
    for (const zn of this.zones) {
      const dx = x - zn.x;
      const dy = y - zn.y;
      const dz = z - zn.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) * PLANET_RADIUS;
      if (d > zn.r * 2.4) continue;
      const wob = 1 + 0.32 * this.fbm(x, y, z, PLANET_RADIUS / (zn.r * 0.9), 2, 1e9, 0.5, zn.seed);
      const u = d / (zn.r * wob);
      if (zn.kind === 4) {
        out.lake = Math.max(out.lake, 1 - smooth(0.9, 2.2, u));
        out.lakeBowl = Math.max(out.lakeBowl, 1 - smooth(0.45, 0.95, u));
      } else {
        const w = 1 - smooth(0.55, 1.0, u);
        if (zn.kind === 0) out.desert = Math.max(out.desert, w);
        else if (zn.kind === 1) out.grass = Math.max(out.grass, w);
        else if (zn.kind === 2) out.canyon = Math.max(out.canyon, w);
        else out.cliff = Math.max(out.cliff, w);
      }
    }
    return out;
  }

  /** 把分区地貌混进自然地形。h 为夸张前的海拔(米)。 */
  private zoneTerrain(x: number, y: number, z: number, h: number, mf: number, w: ZoneWeights): number {
    if (w.lake > 0.001) h = mix(h, 22, w.lake * 0.95);

    if (w.grass > 0.001) {
      // 缓坡丘陵草原:大起伏很柔和,没有嶙峋的山
      const t = 52 + 60 * this.fbm(x, y, z, 420, 3, mf, 0.5, 701.1) + 16 * this.fbm(x, y, z, 3000, 2, mf, 0.5, 703.3);
      h = mix(h, t, w.grass * 0.96);
    }

    if (w.desert > 0.001) {
      // 沙丘:脊状噪声产生锋利的丘脊,大波浪 + 小波纹叠加,偶有平顶孤山
      const swell = this.fbm(x, y, z, 650, 3, mf, 0.5, 711.1);
      const dune = this.ridged(x, y, z, 2600, 3, mf, 0.5, 713.3);
      const ripple = this.ridged(x, y, z, 14000, 2, mf, 0.5, 717.7);
      const bn = this.fbm(x, y, z, 900, 2, mf, 0.5, 719.9);
      const butte = smooth(0.27, 0.31, bn) * (95 + 20 * this.fbm(x, y, z, 6000, 2, mf, 0.5, 721.1));
      const t = 34 + swell * 60 + dune * 30 + ripple * 3.2 + butte;
      h = mix(h, t, w.desert * 0.96);
    }

    if (w.canyon > 0.001) {
      // 高原 + 纵横交错的峡谷,谷壁一层层的台阶
      const plat = 250 + 30 * this.fbm(x, y, z, 500, 3, mf, 0.5, 731.1);
      const n1 = Math.abs(this.fbm(x, y, z, 1300, 3, mf, 0.5, 733.3));
      const n2 = Math.abs(this.fbm(x, y, z, 3300, 2, mf, 0.5, 737.7));
      const c1 = 1 - smooth(0.02, 0.075, n1);
      const c2 = 1 - smooth(0.015, 0.055, n2);
      const depth = Math.max(c1 * 215, c2 * 100 * smooth(0.0, 0.6, c1 + 0.5));
      const step = 42;
      const q = depth / step;
      const fl = Math.floor(q);
      const stepped = (fl + smooth(0.45, 0.72, q - fl)) * step;
      h = mix(h, plat - stepped, w.canyon * 0.97);
    }

    if (w.cliff > 0.001) {
      // 断崖:两道错落的陡崖线,把大地切成三级台阶
      const base = 60 + 36 * this.fbm(x, y, z, 700, 3, mf, 0.5, 741.1);
      const s1 = this.fbm(x, y, z, 230, 3, mf, 0.5, 743.3);
      const s2 = this.fbm(x, y, z, 380, 3, mf, 0.5, 747.7);
      const e = 0.0035;
      const t = base + 165 * smooth(-e, e, s1) + 120 * smooth(-e * 1.3, e * 1.3, s2 + 0.05) + 14 * this.ridged(x, y, z, 3200, 3, mf, 0.5, 749.9);
      h = mix(h, t, w.cliff * 0.97);
    }

    if (w.lakeBowl > 0.001) h = mix(h, -40, w.lakeBowl);
    return h;
  }

  private massifTerm(x: number, y: number, z: number, maxFreq: number): number {
    let add = 0;
    for (const m of this.massifs) {
      const dx = x - m.f.x;
      const dy = y - m.f.y;
      const dz = z - m.f.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) * PLANET_RADIUS;
      if (d > m.rEnd) continue;
      const w = smooth(m.rIn, m.rOut, d) * (1 - smooth(m.rOut * 1.5, m.rEnd, d));
      if (w <= 0.001) continue;
      const v = (dx * m.f.e2[0] + dy * m.f.e2[1] + dz * m.f.e2[2]) * PLANET_RADIUS;
      const tilt = 1 + m.tilt * Math.max(-0.7, Math.min(1, v / Math.max(d, 1)));
      // 山势包络:有高峰有垭口,不是一圈等高的墙
      const env = smooth(-0.3, 0.2, this.fbm(x, y, z, 150, 3, maxFreq, 0.5, 301.3));
      const rd = this.ridged(x, y, z, 700, 6, maxFreq, 0.5, 411.9);
      add += w * tilt * (0.2 + 0.8 * env) * m.amp * (0.3 + 1.1 * rd);
    }
    return add;
  }

  private riverTerm(x: number, y: number, z: number, h: number): number {
    for (const r of this.rivers) {
      const dx = x - r.f.x;
      const dy = y - r.f.y;
      const dz = z - r.f.z;
      const dd = Math.sqrt(dx * dx + dy * dy + dz * dz) * PLANET_RADIUS;
      if (dd > r.len * 1.4 + 6000) continue;
      const u = (dx * r.f.e1[0] + dy * r.f.e1[1] + dz * r.f.e1[2]) * PLANET_RADIUS;
      const v = (dx * r.f.e2[0] + dy * r.f.e2[1] + dz * r.f.e2[2]) * PLANET_RADIUS;
      const cu = (vv: number) => r.u0 + r.amp * Math.sin(vv / r.lam + r.p1) + 0.45 * r.amp * Math.sin(vv / (r.lam * 0.37) + r.p2);

      // 河段
      if (Math.abs(v) < r.len) {
        const taper = 1 - smooth(r.len * 0.8, r.len, v > 0 ? v : 0); // 北端(源头)渐隐
        const wv = r.w0 * (0.5 + 0.6 * (0.5 - v / (2 * r.len)));
        const dist = Math.abs(u - cu(v));
        const flood = (1 - smooth(wv * 0.9, wv * 13, dist)) * taper;
        const bed = (1 - smooth(wv * 0.55, wv, dist)) * taper;
        h = mix(h, Math.min(h, 16), flood * 0.92);
        h = mix(h, -7, bed);
      }
      // 河口湖
      const lv = -r.len * 0.86;
      const lu = cu(lv);
      const ld = Math.hypot(u - lu, v - lv);
      const lr = r.len * 0.12;
      if (ld < lr * 1.6) {
        h = mix(h, Math.min(h, 16), 1 - smooth(lr * 0.8, lr * 1.6, ld));
        h = mix(h, -30, 1 - smooth(lr * 0.55, lr, ld));
      }
    }
    return h;
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
    let b = this.fbm(x, y, z, 2.2, 3, 1e9, 0.5, 301.5);
    if (this.zones.length) {
      const w = this.zoneWeights(x, y, z);
      b += 1.4 * w.desert + 0.5 * w.canyon - 0.6 * w.grass;
    }
    return b;
  }

  /**
   * 植被(森林)密度 0..1。成片的林地 + 林中空地 + 河岸林;高海拔、陡坡、沙地、干旱区稀疏。
   * @param hn 海拔(米,含夸张)
   */
  forest(x: number, y: number, z: number, hn: number, slope: number, biome: number): number {
    if (hn < 12) return 0;
    const region = smooth(-0.4, 0.05, this.fbm(x, y, z, 70, 3, 1e9, 0.5, 501.1));
    const clump = 0.5 + 0.5 * smooth(-0.35, 0.3, this.fbm(x, y, z, 1100, 3, 1e9, 0.5, 733.7));
    let d = region * clump;
    if (this.zones.length) {
      const w = this.zoneWeights(x, y, z);
      d *= (1 - 0.8 * w.grass - 0.5 * w.cliff) * (1 - 0.97 * Math.max(w.desert, w.canyon * 0.8));
    }
    // 河岸 / 低洼湿地:树更密
    d = Math.max(d, 0.75 * (1 - smooth(14, 90, hn)) * smooth(-0.3, 0.2, this.fbm(x, y, z, 300, 2, 1e9, 0.5, 91.3)));
    d *= 1 - smooth(2200, 3400, hn);
    d *= 1 - smooth(0.07, 0.24, slope);
    d *= 1 - 0.85 * smooth(0.15, 0.35, biome);
    d *= 1 - smooth(0.85, 0.93, Math.abs(y)); // 极地无林
    return d;
  }

  /** 点 (x,y,z) 是否落在城市 / 奇观的压平地基里(margin 为额外外扩,米)。 */
  inFlatZone(x: number, y: number, z: number, margin = 0): boolean {
    for (const f of this.flats) {
      const dx = x - f.x;
      const dy = y - f.y;
      const dz = z - f.z;
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) * PLANET_RADIUS < f.outer + margin) return true;
    }
    return false;
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
    const inland = smooth(0.04, 0.3, t);

    // 山系:超大尺度的脊状噪声,出现在内陆并被另一层噪声遮罩
    const mMask = inland * smooth(-0.1, 0.35, this.fbm(x, y, z, 3.1, 3, maxFreq, 0.5, 41.7));
    h += this.ridged(x, y, z, 7, 8, maxFreq, 0.52, 73.1) * mMask * 6200;

    // 区域性格:有的地区群山连绵,有的地区一马平川(原神那种"一个国家一种地貌")
    const rug = smooth(-0.15, 0.2, this.fbm(x, y, z, 8, 3, maxFreq, 0.5, 211.3)) * inland;
    if (rug > 0.001) {
      // 高地山脉:波长约 100~150 km,峰顶突出
      const hi = this.ridged(x, y, z, 42, 6, maxFreq, 0.5, 133.7);
      const peak = smooth(0.3, 0.85, hi);
      h += peak * 2600 * rug;
      // 山体上的嶙峋碎岩
      h += this.ridged(x, y, z, 170, 4, maxFreq, 0.5, 19.9) * 420 * rug * smooth(0.25, 0.7, hi);
      // 台地 / 丹霞:把中高海拔压成一层层平台,形成悬崖
      const mesa = rug * smooth(0.15, 0.55, this.fbm(x, y, z, 15, 3, maxFreq, 0.5, 88.4));
      if (mesa > 0.001 && h > 120) {
        const step = 260;
        const q = h / step;
        const fl = Math.floor(q);
        const terraced = (fl + smooth(0.62, 0.78, q - fl)) * step;
        h = mix(h, terraced, 0.85 * mesa * smooth(120, 400, h));
      }
    }

    // 丘陵
    h += this.fbm(x, y, z, 30, 4, maxFreq, 0.5, 5.9) * 350 * land;

    // 地点周围的设计山系
    if (this.massifs.length) h += this.massifTerm(x, y, z, maxFreq);

    let dry = 1;
    if (this.zones.length) {
      const w = this.zoneWeights(x, y, z);
      h = this.zoneTerrain(x, y, z, h, maxFreq, w);
      dry = 1 - 0.95 * Math.max(w.desert, w.canyon, w.cliff * 0.7);
    }

    if (land > 0) {
      const lowland = 1 - smooth(150, 800, h);

      // 河网:噪声零值等值线 = 河道。宽度被另一层噪声调制,有宽有窄
      // 大河 ~ 1~2 km 宽, 支流 ~ 300~600 m 宽;只在低地雕刻,山区则是干谷
      const wv = 0.6 + 0.8 * (0.5 + 0.5 * this.fbm(x, y, z, 4, 2, maxFreq, 0.5, 61.1));
      const rMain = Math.abs(this.fbm(x, y, z, 6, 4, maxFreq, 0.5, 97.3));
      const rSide = Math.abs(this.fbm(x, y, z, 22, 3, maxFreq, 0.5, 143.9));
      const wMain = 0.00055 * wv;
      const wSide = 0.0009 * wv;
      const flood = Math.max(1 - smooth(0, wMain * 4, rMain), 0.75 * (1 - smooth(0, wSide * 4, rSide)));
      const bed = Math.max(1 - smooth(wMain * 0.3, wMain, rMain), 1 - smooth(wSide * 0.3, wSide, rSide));
      // 河漫滩:河两侧一片平缓的绿地;河床:压到海平面以下
      h = mix(h, 16, flood * lowland * land * 0.85 * dry);
      h = mix(h, -7, bed * lowland * land * dry);

      // 湖泊
      const lake = smooth(0.3, 0.4, this.fbm(x, y, z, 11, 3, maxFreq, 0.5, 177.7));
      h = mix(h, -30, lake * (1 - smooth(200, 600, h)) * land * dry);
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
    // 手工河流最后雕刻:即使穿过奇观 / 城市的平整地基,河道也不会被填平
    if (this.rivers.length) h = this.riverTerm(x, y, z, h / TERRAIN_EXAGGERATION) * TERRAIN_EXAGGERATION;
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
  color(h: number, slope: number, ny: number, biome: number, speck: number, out: RGB, forest = 0, zw?: ZoneWeights): RGB {
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

      // 林地:整体压暗、偏深绿,远处看就是一片森林
      r = mix(r, 0.14, forest * 0.55);
      g = mix(g, 0.3, forest * 0.5);
      b = mix(b, 0.1, forest * 0.5);

      if (zw) {
        // 草原:明亮的黄绿色
        if (zw.grass > 0.01) {
          const k = zw.grass * (1 - forest * 0.5);
          r = mix(r, 0.45 + 0.08 * speck, k);
          g = mix(g, 0.64 + 0.08 * speck, k);
          b = mix(b, 0.2, k);
        }
        // 沙漠:金黄沙地,沙丘迎光 / 背光两面深浅不同
        if (zw.desert > 0.01) {
          const k = zw.desert;
          const shade = 0.92 + 0.14 * speck + 0.25 * (0.5 - Math.min(0.5, slope * 3));
          r = mix(r, 0.88 * shade, k);
          g = mix(g, 0.7 * shade, k);
          b = mix(b, 0.42 * shade, k);
        }
        // 峡谷:一层层红褐色岩带,高原顶面偏枯黄
        if (zw.canyon > 0.01) {
          const band = 0.5 + 0.5 * Math.sin(hn * 0.22 + speck * 4);
          const fine = 0.5 + 0.5 * Math.sin(hn * 0.9 + speck * 9);
          const k = zw.canyon;
          r = mix(r, 0.62 + 0.24 * band - 0.05 * fine, k);
          g = mix(g, 0.3 + 0.2 * band - 0.04 * fine, k);
          b = mix(b, 0.17 + 0.13 * band, k);
        }
        // 断崖:岩层条带,顶部保留草色
        if (zw.cliff > 0.01) {
          const band = 0.5 + 0.5 * Math.sin(hn * 0.35 + speck * 3);
          const rockk = zw.cliff * smooth(0.025, 0.1, slope);
          r = mix(r, 0.48 + 0.14 * band, rockk);
          g = mix(g, 0.4 + 0.1 * band, rockk);
          b = mix(b, 0.32 + 0.06 * band, rockk);
        }
      }

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
