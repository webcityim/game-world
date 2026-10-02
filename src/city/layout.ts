import { Rng } from "./rng";

/**
 * 城市布局(纯数据,不涉及几何体)。坐标是城市本地坐标:XZ 平面,单位米,原点 = 城市中心。
 *
 *  - 道路是间距 P 的正交网格,每 4 条一条宽大道;城市边界是带噪声的圆。
 *  - 中心 2×2 个街区合成广场,放地标(首都放商铺广场)。
 *  - 普通街区沿四周切出临街地块(front 朝街),中间留院子;少数街区做公园。
 *  - 现代风格的街区改为 1/2/4 栋塔楼。
 */

export interface LayoutParams {
  radius: number;
  block: number;
  road: number;
  avenue: number;
  sidewalk: number;
  lotFront: [number, number];
  lotDepth: [number, number];
  /** "perimeter" = 沿街排屋, "towers" = 街区塔楼 */
  lots: "perimeter" | "towers";
  parkChance: number;
  /** 边缘地块被留空(变成院子)的概率 */
  edgeSparse: number;
}

export interface Lot {
  /** 地块中心 */
  x: number;
  z: number;
  /** 临街面宽(地块本地 X)与进深(本地 Z) */
  w: number;
  d: number;
  /** 地块朝向:本地 +Z(正门)在城市坐标中的方向 = (sin rot, cos rot) */
  rot: number;
  /** 0 = 市中心, 1 = 城市边缘 */
  t: number;
}

export type BlockKind = "lots" | "park" | "plaza";

export interface Block {
  i: number;
  j: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  kind: BlockKind;
  courtyard: { x0: number; z0: number; x1: number; z1: number } | null;
}

export interface RoadEdge {
  /** 端点节点 key */
  a: string;
  b: string;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** 路宽 */
  w: number;
  /** true = 沿 X 方向 */
  alongX: boolean;
}

export interface RoadNode {
  key: string;
  x: number;
  z: number;
  /** 路口尺寸 = 两条相交道路的宽度 */
  wx: number;
  wz: number;
  edges: number[];
}

export interface CityLayout {
  params: LayoutParams;
  pitch: number;
  blocks: Block[];
  lots: Lot[];
  nodes: Map<string, RoadNode>;
  edges: RoadEdge[];
  /** 中心广场的半边长 */
  plazaHalf: number;
}

const key = (i: number, j: number) => `${i},${j}`;

export function generateLayout(p: LayoutParams, seed: number): CityLayout {
  const rng = new Rng(seed);
  const P = p.block + p.road;
  const K = Math.ceil(p.radius / P) + 1;
  const lineW = (k: number) => (k % 4 === 0 ? p.avenue : p.road);

  // 边界噪声:按角度的几个低频正弦
  const ph = [rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28)];
  const edgeR = (a: number) =>
    p.radius * (0.86 + 0.08 * Math.sin(a * 2 + ph[0]) + 0.05 * Math.sin(a * 3 + ph[1]) + 0.03 * Math.sin(a * 5 + ph[2]));

  const blockAt = new Map<string, Block>();
  const blocks: Block[] = [];
  for (let i = -K; i < K; i++) {
    for (let j = -K; j < K; j++) {
      const x0 = i * P + lineW(i) / 2;
      const x1 = (i + 1) * P - lineW(i + 1) / 2;
      const z0 = j * P + lineW(j) / 2;
      const z1 = (j + 1) * P - lineW(j + 1) / 2;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const r = Math.hypot(cx, cz);
      if (r > edgeR(Math.atan2(cz, cx))) continue;
      const plaza = (i === -1 || i === 0) && (j === -1 || j === 0);
      const kind: BlockKind = plaza ? "plaza" : rng.chance(p.parkChance) ? "park" : "lots";
      const b: Block = { i, j, x0, z0, x1, z1, kind, courtyard: null };
      blocks.push(b);
      blockAt.set(key(i, j), b);
    }
  }

  // ---- 道路:每条网格边只要有一侧街区存在就保留;两侧都是广场则并入广场铺装
  const nodes = new Map<string, RoadNode>();
  const edges: RoadEdge[] = [];
  const isPlaza = (i: number, j: number) => blockAt.get(key(i, j))?.kind === "plaza";
  const has = (i: number, j: number) => blockAt.has(key(i, j));
  const node = (i: number, j: number): RoadNode => {
    const k = key(i, j);
    let n = nodes.get(k);
    if (!n) {
      n = { key: k, x: i * P, z: j * P, wx: lineW(i), wz: lineW(j), edges: [] };
      nodes.set(k, n);
    }
    return n;
  };
  const addEdge = (i0: number, j0: number, i1: number, j1: number, w: number, alongX: boolean) => {
    const a = node(i0, j0);
    const b = node(i1, j1);
    const idx = edges.length;
    edges.push({ a: a.key, b: b.key, ax: a.x, az: a.z, bx: b.x, bz: b.z, w, alongX });
    a.edges.push(idx);
    b.edges.push(idx);
  };
  for (let i = -K; i < K; i++) {
    for (let j = -K; j <= K; j++) {
      // 沿 X 的边:(i,j)-(i+1,j),两侧街区 (i,j-1) 与 (i,j)
      const s = has(i, j - 1);
      const n = has(i, j);
      if ((s || n) && !(isPlaza(i, j - 1) && isPlaza(i, j))) addEdge(i, j, i + 1, j, lineW(j), true);
    }
  }
  for (let i = -K; i <= K; i++) {
    for (let j = -K; j < K; j++) {
      const w = has(i - 1, j);
      const e = has(i, j);
      if ((w || e) && !(isPlaza(i - 1, j) && isPlaza(i, j))) addEdge(i, j, i, j + 1, lineW(i), false);
    }
  }

  // ---- 地块
  const lots: Lot[] = [];
  const sw = p.sidewalk;
  for (const b of blocks) {
    if (b.kind !== "lots") continue;
    const bx0 = b.x0 + sw;
    const bx1 = b.x1 - sw;
    const bz0 = b.z0 + sw;
    const bz1 = b.z1 - sw;
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    const t = Math.min(1, Math.hypot(cx, cz) / p.radius);
    const brng = rng.fork(b.i * 7919 + b.j * 104729);
    const keep = () => !(t > 0.55 && brng.chance(p.edgeSparse * (t - 0.55) * 2.2));

    if (p.lots === "towers") {
      const W = bx1 - bx0;
      const D = bz1 - bz0;
      // 大多数街区切成 2×2 栋塔楼,少数 2×1 或整块一栋
      const r = brng.next();
      const splitsX = r < 0.12 ? 1 : 2;
      const splitsZ = r < 0.32 ? 1 : 2;
      for (let a = 0; a < splitsX; a++) {
        for (let c = 0; c < splitsZ; c++) {
          const lx0 = bx0 + (W / splitsX) * a;
          const lz0 = bz0 + (D / splitsZ) * c;
          const lw = W / splitsX;
          const ld = D / splitsZ;
          const x = lx0 + lw / 2;
          const z = lz0 + ld / 2;
          // 正门朝向最近的街道
          const dz1 = bz1 - (lz0 + ld);
          const dz0 = lz0 - bz0;
          const dx1 = bx1 - (lx0 + lw);
          const dx0 = lx0 - bx0;
          const m = Math.min(dz1, dz0, dx1, dx0);
          let rot = 0;
          if (m === dz1) rot = 0;
          else if (m === dz0) rot = Math.PI;
          else if (m === dx1) rot = Math.PI / 2;
          else rot = -Math.PI / 2;
          const alongX = rot === 0 || rot === Math.PI;
          if (t > 0.8 && brng.chance(0.25)) continue;
          lots.push({ x, z, w: alongX ? lw : ld, d: alongX ? ld : lw, rot, t });
        }
      }
      continue;
    }

    const innerW = bx1 - bx0;
    const innerD = bz1 - bz0;
    const depth = Math.min(brng.range(p.lotDepth[0], p.lotDepth[1]), innerD / 2, innerW / 2);
    const march = (len: number, emit: (s: number, f: number) => void) => {
      let s = 0;
      while (len - s > 0.5) {
        let f = brng.range(p.lotFront[0], p.lotFront[1]);
        if (len - s - f < p.lotFront[0]) f = len - s;
        emit(s, f);
        s += f;
      }
    };
    // 南(+Z)、北(-Z)两边占满整段(含转角),东西两边夹在中间
    march(innerW, (s, f) => keep() && lots.push({ x: bx0 + s + f / 2, z: bz1 - depth / 2, w: f, d: depth, rot: 0, t }));
    march(innerW, (s, f) =>
      keep() && lots.push({ x: bx1 - s - f / 2, z: bz0 + depth / 2, w: f, d: depth, rot: Math.PI, t }),
    );
    const sideLen = innerD - 2 * depth;
    if (sideLen > p.lotFront[0]) {
      march(sideLen, (s, f) =>
        keep() && lots.push({ x: bx1 - depth / 2, z: bz1 - depth - s - f / 2, w: f, d: depth, rot: Math.PI / 2, t }),
      );
      march(sideLen, (s, f) =>
        keep() && lots.push({ x: bx0 + depth / 2, z: bz0 + depth + s + f / 2, w: f, d: depth, rot: -Math.PI / 2, t }),
      );
    }
    const cw = innerW - 2 * depth;
    const cd = innerD - 2 * depth;
    if (cw > 4 && cd > 4) {
      b.courtyard = { x0: bx0 + depth, z0: bz0 + depth, x1: bx1 - depth, z1: bz1 - depth };
    }
  }

  const plazaHalf = P - lineW(1) / 2;
  return { params: p, pitch: P, blocks, lots, nodes, edges, plazaHalf };
}
