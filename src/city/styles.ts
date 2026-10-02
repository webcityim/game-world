import { Facade, GeometryBuilder, hex, jitter } from "./builder";
import type { LayoutParams, Lot } from "./layout";
import { Rng } from "./rng";

type RGB = readonly [number, number, number];

/** 建筑生成结果(地块本地坐标:正门朝 +Z)。 */
export interface BuildingResult {
  /** 碰撞盒(地块本地):中心、半宽、半深、总高 */
  box: { cx: number; cz: number; hw: number; hd: number; h: number };
  /** 正门(地块本地):门洞中心 x、门所在墙面 z、宽、高、门槛高度 y(默认 0) */
  door: { x: number; z: number; w: number; h: number; y?: number } | null;
}

/** 地标的可交互点(城市本地坐标由 city.ts 换算)。 */
export interface LandmarkResult {
  boxes: BuildingResult["box"][];
  /** 地标上的特殊交互点(地标本地坐标) */
  specials: { kind: "bell" | "gong" | "fountain" | "elevator"; x: number; y: number; z: number }[];
  /** 电梯顶层的观景位置(仅现代风格) */
  deck?: { x: number; y: number; z: number };
}

export interface TreeKind {
  trunkH: [number, number];
  crownR: [number, number];
  /** 树冠形状 */
  crown: "round" | "cone" | "palm";
  colors: number[];
  trunk: number;
}

export interface StyleDef {
  id: "meadow" | "orient" | "desert" | "neo";
  layout: Omit<LayoutParams, "radius">;
  ground: number;
  road: number;
  sidewalk: number;
  plaza: number;
  grass: number;
  door: number;
  lampHead: number;
  lampPost: number;
  lampH: number;
  trees: TreeKind[];
  /** NPC 衣服配色 */
  clothes: number[];
  greetings: string[];
  building(b: GeometryBuilder, lot: Lot, rng: Rng): BuildingResult;
  landmark(b: GeometryBuilder, rng: Rng): LandmarkResult;
}

const pick = (rng: Rng, cs: number[]): RGB => jitter(hex(rng.pick(cs)), 0.08, rng.next());

// ====================================================================== 草原风(欧式小镇)

const meadow: StyleDef = {
  id: "meadow",
  layout: {
    block: 58,
    road: 9,
    avenue: 14,
    sidewalk: 2.6,
    lotFront: [7, 11],
    lotDepth: [11, 15],
    lots: "perimeter",
    parkChance: 0.07,
    edgeSparse: 0.35,
  },
  ground: 0x6f9a4a,
  road: 0x8c8478,
  sidewalk: 0xb5aa96,
  plaza: 0xc2b59c,
  grass: 0x5f8f3e,
  door: 0x6b4429,
  lampHead: 0xffd27a,
  lampPost: 0x2b2b30,
  lampH: 4.2,
  trees: [
    { trunkH: [2.2, 3.4], crownR: [2.2, 3.4], crown: "round", colors: [0x4c8a32, 0x5e9a3a, 0x3f7a2c], trunk: 0x5a4030 },
    { trunkH: [1.5, 2.2], crownR: [1.6, 2.4], crown: "cone", colors: [0x2f6a35, 0x37703a], trunk: 0x4a3426 },
  ],
  clothes: [0x3a5f9a, 0x9a3a3a, 0x4f7a3a, 0xc9a24a, 0x6a4a8a, 0xe0d8c8],
  greetings: [
    "风岚城欢迎你,旅行者!",
    "听说大教堂的钟声能传到十里外。",
    "城墙外的风车又转起来了。",
    "今天的面包刚出炉,要来一块吗?",
    "我年轻时也像你一样到处冒险。",
    "广场上的商铺用的是会动的招牌,真神奇。",
  ],
  building(b, lot, rng) {
    const alley = rng.chance(0.22);
    const fw = Math.max(4, lot.w - (alley ? 1.6 : 0.15));
    const fd = Math.min(lot.d - 1, rng.range(9, 12.5));
    const zc = lot.d / 2 - 0.6 - fd / 2;
    const floors = Math.max(1, Math.round((1 - lot.t) * 2.2 + rng.range(1.2, 2.6)));
    const h = floors * 3.2 + 0.3;
    const wall = pick(rng, [0xe8dcc0, 0xf2ece0, 0xe3c99a, 0xe8c8b8, 0xd8d0b8, 0xc9b79a]);
    const roof = pick(rng, [0xa4472e, 0x8c3a28, 0x4a5868, 0x5a4a3c, 0xb0583a]);
    const timber = rng.chance(0.45);
    b.box(0, zc, fw, fd, 0, h, wall, timber ? Facade.Timber : Facade.Windows, null);
    // 石砌勒脚
    b.box(0, zc, fw + 0.14, fd + 0.14, 0, 0.6, hex(0x8e877a), Facade.Plain, null);
    const along = fw >= fd * 0.85 || rng.chance(0.3);
    let rise: number;
    if (along) {
      rise = fd * rng.range(0.42, 0.62);
      b.gable(0, zc, fw, fd, h, rise, 0.45, roof, wall);
    } else {
      // 山墙朝街:屋脊沿 Z,把坐标系转 90° 画((x,z) → (-z,x))
      const r = fw * rng.range(0.5, 0.7);
      rise = r;
      b.rotated(Math.PI / 2, () => b.gable(-zc, 0, fd, fw, h, r, 0.45, roof, wall));
    }
    if (rng.chance(0.55)) {
      const cx = rng.range(-fw / 3, fw / 3);
      b.box(cx, zc - fd * 0.15, 0.8, 0.8, h + 0.3, h + rise * 0.85 + 0.9, hex(0x7a5a48), Facade.Plain);
    }
    const doorX = rng.range(-fw / 2 + 1.2, fw / 2 - 1.2);
    return {
      box: { cx: 0, cz: zc, hw: fw / 2, hd: fd / 2, h: h + rise },
      door: { x: doorX, z: zc + fd / 2, w: 1.1, h: 2.3 },
    };
  },
  landmark: (b) => cathedral(b),
};

/** 大教堂:正门朝 -Z(面向广场中心),钟楼在前,中殿屋脊沿 Z。 */
function cathedral(b: GeometryBuilder): LandmarkResult {
  const stone = hex(0xcfc6b2);
  const roof = hex(0x4a5868);
  const naveW = 16;
  const naveL = 34;
  const naveZ = 6;
  b.box(0, naveZ, naveW, naveL, 0, 15, stone, Facade.Windows, null);
  // 转 90° 后,原坐标 (x, z) 对应新坐标 (-z, x)
  b.rotated(Math.PI / 2, () => {
    b.gable(-naveZ, 0, naveL, naveW, 15, 8, 0.6, roof, stone);
    b.gable(-naveZ, -naveW / 2 - 3.5, naveL - 6, 7, 8, 2.5, 0.3, roof, stone);
    b.gable(-naveZ, naveW / 2 + 3.5, naveL - 6, 7, 8, 2.5, 0.3, roof, stone);
  });
  // 钟楼:30 m 以下实心,上面是四根角柱围成的开放钟层(钟挂在里面,city.ts 生成)
  const tz = naveZ - naveL / 2 - 4;
  const trim = hex(0xb8ae98);
  b.box(0, tz, 10, 10, 0, 30, stone, Facade.Windows, null);
  b.box(0, tz, 10.6, 10.6, 30, 31, trim, Facade.Plain, trim);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 4.2, tz + sz * 4.2, 1.6, 1.6, 31, 38, stone, Facade.Plain, null);
  b.box(0, tz, 11, 11, 38, 39, trim, Facade.Plain, trim);
  b.cone(0, tz, 6.4, 39, 24, 8, roof);
  // 侧廊
  b.box(-naveW / 2 - 3.5, naveZ, 7, naveL - 6, 0, 8, stone, Facade.Windows, null);
  b.box(naveW / 2 + 3.5, naveZ, 7, naveL - 6, 0, 8, stone, Facade.Windows, null);
  // 后殿半圆
  b.cylinder(0, naveZ + naveL / 2, 7, 7, 0, 13, 12, stone, Facade.Windows);
  b.dome(0, naveZ + naveL / 2, 7, 13, 12, 3, roof, 0.7);
  return {
    boxes: [
      { cx: 0, cz: naveZ, hw: naveW / 2 + 7, hd: naveL / 2, h: 23 },
      { cx: 0, cz: tz, hw: 5.5, hd: 5.5, h: 63 },
      { cx: 0, cz: naveZ + naveL / 2, hw: 7, hd: 7, h: 18 },
    ],
    specials: [{ kind: "bell", x: 0, y: 1.2, z: tz - 5.5 }],
  };
}

// ====================================================================== 东方风(青瓦镇)

const orient: StyleDef = {
  id: "orient",
  layout: {
    block: 62,
    road: 10,
    avenue: 16,
    sidewalk: 2.8,
    lotFront: [10, 15],
    lotDepth: [12, 17],
    lots: "perimeter",
    parkChance: 0.1,
    edgeSparse: 0.45,
  },
  ground: 0x6a8f52,
  road: 0x7a7570,
  sidewalk: 0x9a958c,
  plaza: 0xa8a294,
  grass: 0x5a8a48,
  door: 0x8a2a20,
  lampHead: 0xff6a3a,
  lampPost: 0x3a2a22,
  lampH: 3.6,
  trees: [
    { trunkH: [1.8, 2.8], crownR: [2.0, 3.0], crown: "round", colors: [0xf2b8c8, 0xeaa0b8, 0xf6c8d4], trunk: 0x4a3028 },
    { trunkH: [2.5, 4.0], crownR: [1.5, 2.2], crown: "cone", colors: [0x2f5a35, 0x3a6a3a], trunk: 0x4a3426 },
  ],
  clothes: [0x8a2a2a, 0x2a4a6a, 0x3a6a5a, 0xd8c8a8, 0x5a3a6a, 0xc88a3a],
  greetings: [
    "青瓦镇的灯笼一到夜里就全亮了。",
    "塔顶的铜锣敲一下,整条街都听得见。",
    "樱花开的时候,镇上最热闹。",
    "要不要来杯茶?刚从山上采的。",
    "这些屋檐翘起来,是为了把雨水甩远一点。",
  ],
  building(b, lot, rng) {
    const fw = Math.max(5, lot.w - rng.range(1.2, 2.6));
    const fd = Math.min(lot.d - 2.2, rng.range(9, 12.5));
    const zc = lot.d / 2 - 1.8 - fd / 2;
    const floors = Math.max(1, Math.min(3, Math.round((1 - lot.t) * 1.6 + rng.range(0.6, 1.8))));
    const wall = pick(rng, [0xece4d4, 0xe0d4bc, 0xd8c4a0, 0xf2ece2]);
    const wood = hex(0x8a5a3a);
    const roof = pick(rng, [0x3f4a4f, 0x2f5d50, 0x34404a, 0x2c4a6b, 0x5a3a30]);
    const red = hex(0xa8322a);
    // 石台基
    b.box(0, zc, fw + 1.4, fd + 1.4, 0, 0.6, hex(0x8a8580), Facade.Plain);
    let y = 0.6;
    let bw = fw;
    let bd = fd;
    for (let f = 0; f < floors; f++) {
      const top = y + 3.3;
      b.box(0, zc, bw, bd, y, top, f === 0 ? wall : rng.chance(0.5) ? wall : jitter(wood, 0.1, rng.next()), Facade.Windows, null, 0.6);
      if (f === 0) {
        // 檐柱
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cylinder(sx * (bw / 2 + 0.25), zc + sz * (bd / 2 + 0.25), 0.2, 0.2, y, top, 6, red);
      }
      if (f < floors - 1) {
        // 腰檐
        b.hip(0, zc, bw, bd, top, 0.5, 0.5, roof, 0.9);
        y = top + 0.4;
        bw -= 1.4;
        bd -= 1.4;
      } else {
        y = top;
      }
    }
    const rise = Math.min(bw, bd) * 0.32;
    b.hip(0, zc, bw, bd, y, rise, 0.5, roof, 1.1);
    return {
      box: { cx: 0, cz: zc, hw: fw / 2 + 0.7, hd: fd / 2 + 0.7, h: y + rise },
      door: { x: 0, z: zc + fd / 2, w: 1.6, h: 2.5, y: 0.6 },
    };
  },
  landmark(b) {
    // 七层宝塔,正门朝 -Z
    const base = hex(0x8a8580);
    const wall = hex(0xe8dcc4);
    const roof = hex(0x2f5d50);
    const red = hex(0xa8322a);
    b.box(0, 0, 24, 24, 0, 1.6, base, Facade.Plain);
    b.box(0, 0, 20, 20, 1.6, 2.4, base, Facade.Plain);
    let y = 2.4;
    let s = 13;
    for (let i = 0; i < 7; i++) {
      const h = i === 0 ? 5.5 : 4.2;
      b.box(0, 0, s, s, y, y + h, i % 2 === 0 ? wall : red, Facade.Windows, null, y);
      if (i === 0) for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cylinder(sx * (s / 2 + 0.4), sz * (s / 2 + 0.4), 0.35, 0.35, y, y + h, 8, red);
      b.hip(0, 0, s, s, y + h, 1.1, 0.8, roof, 1.6);
      y += h + 0.6;
      s -= 1.3;
    }
    b.hip(0, 0, s + 1.3, s + 1.3, y - 0.6, 3.0, 0.6, roof, 1.2);
    b.cylinder(0, 0, 0.35, 0.15, y + 2.2, y + 9, 8, hex(0xc9a24a));
    for (let k = 0; k < 4; k++) b.cylinder(0, 0, 0.9 - k * 0.15, 0.9 - k * 0.15, y + 3 + k * 1.4, y + 3.3 + k * 1.4, 10, hex(0xc9a24a));
    // 门前铜锣架
    b.box(-2.2, -14, 0.3, 0.3, 0, 3.4, red, Facade.Plain);
    b.box(2.2, -14, 0.3, 0.3, 0, 3.4, red, Facade.Plain);
    b.box(0, -14, 4.8, 0.3, 3.2, 3.5, red, Facade.Plain);
    return {
      boxes: [
        { cx: 0, cz: 0, hw: 12, hd: 12, h: 2.4 },
        { cx: 0, cz: 0, hw: 7.5, hd: 7.5, h: y + 9 },
      ],
      specials: [{ kind: "gong", x: 0, y: 2, z: -14 }],
    };
  },
};

// ====================================================================== 沙漠风(金沙城)

const desert: StyleDef = {
  id: "desert",
  layout: {
    block: 48,
    road: 7,
    avenue: 12,
    sidewalk: 2.0,
    lotFront: [6, 10],
    lotDepth: [9, 13],
    lots: "perimeter",
    parkChance: 0.05,
    edgeSparse: 0.3,
  },
  ground: 0xd8bf8a,
  road: 0xb8a07a,
  sidewalk: 0xd0b88e,
  plaza: 0xe0cca0,
  grass: 0x8a9a4a,
  door: 0x2a5a7a,
  lampHead: 0xffc860,
  lampPost: 0x6a4a2a,
  lampH: 3.8,
  trees: [{ trunkH: [4.5, 7.5], crownR: [2.6, 3.6], crown: "palm", colors: [0x4a7a2a, 0x5a8a30], trunk: 0x8a6a48 }],
  clothes: [0xe8e0d0, 0x2a5a8a, 0xa83a2a, 0xd8a83a, 0x3a7a6a, 0x6a3a5a],
  greetings: [
    "金沙城的水比黄金还珍贵。",
    "宫殿前的喷泉,据说从来没停过。",
    "白天太热,我们都在晚上逛集市。",
    "要买香料吗?全城最地道的。",
    "沙暴快来了,记得把窗户关好。",
  ],
  building(b, lot, rng) {
    const fw = Math.max(4, lot.w - (rng.chance(0.25) ? 1.4 : 0.1));
    const fd = Math.min(lot.d - 0.6, rng.range(8, 12.5));
    const zc = lot.d / 2 - 0.3 - fd / 2;
    const floors = Math.max(1, Math.round((1 - lot.t) * 2 + rng.range(0.6, 2.2)));
    const h = floors * 3.2 + 0.2;
    const wall = pick(rng, [0xd9b98a, 0xe6d3b3, 0xc98f63, 0xf0ebe0, 0xe0c090]);
    const roofC = jitter(wall, 0.08, 0.2);
    b.box(0, zc, fw, fd, 0, h, wall, Facade.Windows, roofC);
    // 女儿墙
    const pt = 0.3;
    const ph = rng.range(0.6, 1.1);
    b.box(0, zc + fd / 2 - pt / 2, fw, pt, h, h + ph, wall, Facade.Plain);
    b.box(0, zc - fd / 2 + pt / 2, fw, pt, h, h + ph, wall, Facade.Plain);
    b.box(fw / 2 - pt / 2, zc, pt, fd - 2 * pt, h, h + ph, wall, Facade.Plain);
    b.box(-fw / 2 + pt / 2, zc, pt, fd - 2 * pt, h, h + ph, wall, Facade.Plain);
    let top = h + ph;
    if (fw > 7 && rng.chance(0.22)) {
      const r = Math.min(fw, fd) * 0.28;
      const dome = pick(rng, [0x3a7aa8, 0x2a8a8a, 0xf0ebe0, 0xc9a24a]);
      b.cylinder(0, zc, r, r, h, h + 1.2, 12, wall, Facade.Plain);
      b.dome(0, zc, r, h + 1.2, 12, 4, dome, 1.1);
      top = h + 1.2 + r * 1.1;
    } else if (rng.chance(0.3)) {
      // 屋顶小房
      const rw = fw * 0.35;
      b.box(-fw / 2 + rw / 2 + 0.4, zc - fd / 4, rw, fd * 0.4, h, h + 2.6, wall, Facade.Windows, roofC, h);
      top = h + 2.6;
    }
    if (rng.chance(0.35)) {
      // 一楼布遮阳篷
      const aw = pick(rng, [0xb83a2a, 0x2a6a9a, 0xd8a83a, 0x3a8a5a]);
      b.box(0, zc + fd / 2 + 0.8, fw * 0.8, 1.6, 2.9, 3.0, aw, Facade.Plain);
    }
    return {
      box: { cx: 0, cz: zc, hw: fw / 2, hd: fd / 2, h: top },
      door: { x: rng.range(-fw / 2 + 1.1, fw / 2 - 1.1), z: zc + fd / 2, w: 1.1, h: 2.4 },
    };
  },
  landmark(b) {
    // 圆顶宫殿 + 四座宣礼塔,正门朝 -Z
    const wall = hex(0xf0e6d0);
    const trim = hex(0xc9a24a);
    const dome = hex(0x3a7aa8);
    b.box(0, 6, 40, 30, 0, 14, wall, Facade.Windows, wall);
    b.box(0, 6, 41, 31, 14, 15, trim, Facade.Plain);
    b.cylinder(0, 6, 11, 11, 15, 20, 16, wall, Facade.Windows);
    b.dome(0, 6, 11, 20, 16, 6, dome, 1.25);
    b.cylinder(0, 6, 0.4, 0.1, 20 + 13.75, 20 + 18, 6, trim);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = sx * 23;
        const z = 6 + sz * 18;
        b.cylinder(x, z, 1.8, 1.5, 0, 34, 10, wall, Facade.Plain);
        b.cylinder(x, z, 2.3, 2.3, 26, 27, 10, trim, Facade.Plain);
        b.dome(x, z, 1.6, 34, 10, 3, dome, 1.2);
        b.cone(x, z, 0.3, 34 + 1.9, 2.4, 6, trim, Facade.Plain);
      }
    }
    // 正门拱(用方框近似)
    b.box(0, 6 - 15 - 1, 10, 2, 0, 18, wall, Facade.Plain);
    // 门前喷泉池
    b.cylinder(0, -20, 5.5, 5.5, 0, 0.7, 20, hex(0xd8ccb0), Facade.Plain);
    b.cylinder(0, -20, 0.6, 0.4, 0.7, 2.6, 8, hex(0xd8ccb0), Facade.Plain);
    return {
      boxes: [
        { cx: 0, cz: 6, hw: 20, hd: 15, h: 34 },
        { cx: 0, cz: -10, hw: 5, hd: 1, h: 18 },
        { cx: 0, cz: -20, hw: 5.5, hd: 5.5, h: 0.7 },
        ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ cx: sx * 23, cz: 6 + sz * 18, hw: 1.9, hd: 1.9, h: 38 }))),
      ],
      specials: [{ kind: "fountain", x: 0, y: 1, z: -20 }],
    };
  },
};

// ====================================================================== 现代风(霓虹都)

const neo: StyleDef = {
  id: "neo",
  layout: {
    block: 104,
    road: 14,
    avenue: 22,
    sidewalk: 4,
    lotFront: [0, 0],
    lotDepth: [0, 0],
    lots: "towers",
    parkChance: 0.08,
    edgeSparse: 0.3,
  },
  ground: 0x6a7a5a,
  road: 0x45474c,
  sidewalk: 0x9a9a98,
  plaza: 0xb0b0ac,
  grass: 0x5a8040,
  door: 0x1a2a3a,
  lampHead: 0xe8f4ff,
  lampPost: 0x5a5e66,
  lampH: 6.5,
  trees: [{ trunkH: [2.5, 3.5], crownR: [1.8, 2.6], crown: "round", colors: [0x4a8a3a, 0x5a9a42], trunk: 0x4a3a30 }],
  clothes: [0x1a1a22, 0x3a4a6a, 0xd8d8d8, 0x8a2a4a, 0x2a7a8a, 0xe8b83a],
  greetings: [
    "霓虹都的天际线是全星球最高的。",
    "中央塔的电梯能直达顶层观景台。",
    "晚上整座城都会亮起来,别错过。",
    "我在 87 楼上班,每天都看云海。",
    "听说城外的山脉里还有更古老的遗迹。",
  ],
  building(b, lot, rng) {
    const fw = Math.max(10, lot.w - rng.range(5, 9));
    const fd = Math.max(10, lot.d - rng.range(5, 9));
    const zc = 0;
    // 越靠近市中心越高,中心区 150~230 m,边缘 20~40 m
    const H = Math.max(16, (30 + 190 * Math.pow(1 - lot.t, 1.6)) * rng.range(0.6, 1.25));
    const glass = rng.chance(0.68);
    const col = glass ? pick(rng, [0x5f8fb0, 0x4f7a80, 0x7a8a99, 0x8a7458, 0x6a7aa0]) : pick(rng, [0xb8b8b0, 0xc8c0b0, 0x9a9a98]);
    const facade = glass ? Facade.Glass : Facade.Windows;
    // 裙楼
    const podH = 9.6;
    const podium = rng.chance(0.6) && H > 30;
    if (podium) b.box(0, zc, fw, fd, 0, podH, hex(0xa8a8a4), Facade.Windows, hex(0x8a8a88));
    // 塔身:1~3 段退台
    let y = podium ? podH : 0;
    let tw = podium ? fw * 0.72 : fw;
    let td = podium ? fd * 0.72 : fd;
    const tiers = H > 60 ? rng.int(1, 3) : 1;
    const segH = (H - y) / tiers;
    for (let k = 0; k < tiers; k++) {
      const top = y + segH;
      b.box(0, zc, tw, td, y, top, col, facade, hex(0x6a6a6a), 0);
      y = top;
      if (k < tiers - 1) {
        tw *= 0.78;
        td *= 0.78;
      }
    }
    // 屋顶设备 / 天线
    b.box(rng.range(-tw / 5, tw / 5), zc + rng.range(-td / 5, td / 5), tw * 0.35, td * 0.35, y, y + 3, hex(0x8a8a88), Facade.Plain);
    let top = y + 3;
    if (H > 80 && rng.chance(0.45)) {
      const ah = rng.range(10, 24);
      b.cylinder(0, zc, 0.35, 0.12, y + 3, y + 3 + ah, 6, hex(0xd0d0d0));
      top += ah;
    }
    // 最底下一段(裙楼或第一段塔身)的平面尺寸都是 fw × fd
    return {
      box: { cx: 0, cz: zc, hw: fw / 2, hd: fd / 2, h: top },
      door: { x: 0, z: zc + fd / 2, w: 2.4, h: 3 },
    };
  },
  landmark(b) {
    // 超高层中央塔(约 330 m),正门朝 -Z
    const glass = hex(0x6a9ac0);
    const frame = hex(0xc8ccd0);
    b.box(0, 0, 64, 64, 0, 18, hex(0xb0b0ac), Facade.Glass, hex(0x8a8a88));
    let y = 18;
    let s = 34;
    const segs = [70, 70, 60, 50, 40];
    for (const h of segs) {
      b.box(0, 0, s, s, y, y + h, glass, Facade.Glass, frame, 0);
      b.box(0, 0, s + 1.2, s + 1.2, y + h - 1.5, y + h, frame, Facade.Plain);
      y += h;
      s *= 0.84;
    }
    // 观景台
    b.cylinder(0, 0, s * 0.9, s * 0.9, y, y + 4, 16, frame, Facade.Glass);
    const deckY = y + 4;
    b.cylinder(0, 0, 1.2, 0.3, deckY, deckY + 60, 8, frame);
    // 入口雨棚
    b.box(0, -34, 16, 6, 5, 5.6, frame, Facade.Plain);
    // 塔身碰撞盒只到观景台顶面,这样玩家可以站在观景台上;天线单独一个细盒子
    return {
      boxes: [
        { cx: 0, cz: 0, hw: 32, hd: 32, h: 18 },
        { cx: 0, cz: 0, hw: 17, hd: 17, h: deckY },
        { cx: 0, cz: 0, hw: 1.3, hd: 1.3, h: deckY + 60 },
      ],
      specials: [{ kind: "elevator", x: 0, y: 1.5, z: -32.5 }],
      // 落在观景台边缘,否则台面会挡住脚下的城市
      deck: { x: 0, y: deckY + 1.8, z: -(s * 0.9 - 1.4) },
    };
  },
};

export const STYLES = { meadow, orient, desert, neo };
export type StyleId = keyof typeof STYLES;
