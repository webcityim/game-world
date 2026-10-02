import * as THREE from "three/webgpu";
import { attribute, color, mix, smoothstep, sin, time } from "three/tsl";
import { BUILD_BUDGET_MS, GRID, MAX_LEVEL, PLANET_RADIUS, SPLIT_FACTOR } from "../config";
import { Terrain, type RGB } from "./terrain";
import { Vegetation, VEG_MIN_LEVEL, type VegChunk } from "./vegetation";

/**
 * 立方体球面 + 四叉树 LOD。
 *
 * - 立方体 6 个面各是一棵四叉树,点按"等角"映射到球面,畸变小。
 * - 每个地形块的顶点坐标相对块中心存储(float32 精度足够),块的世界位置在 CPU 上用 float64
 *   计算并减去相机位置("浮动原点"),所以行星半径达到 6371km 也不会在地面抖动。
 * - 块的水面是同网格、半径 = R 的另一个 mesh,只有块内存在海平面以下的地形时才创建。
 */

interface Face {
  n: [number, number, number];
  a: [number, number, number];
  b: [number, number, number];
}

// a × b = n,保证从外侧看是逆时针。
const FACES: Face[] = [
  { n: [1, 0, 0], a: [0, 0, -1], b: [0, 1, 0] },
  { n: [-1, 0, 0], a: [0, 0, 1], b: [0, 1, 0] },
  { n: [0, 1, 0], a: [1, 0, 0], b: [0, 0, -1] },
  { n: [0, -1, 0], a: [1, 0, 0], b: [0, 0, 1] },
  { n: [0, 0, 1], a: [1, 0, 0], b: [0, 1, 0] },
  { n: [0, 0, -1], a: [-1, 0, 0], b: [0, 1, 0] },
];

const QUARTER_PI = Math.PI / 4;

function faceDir(face: number, u: number, v: number, out: THREE.Vector3): THREE.Vector3 {
  const f = FACES[face];
  const U = Math.tan(u * QUARTER_PI);
  const V = Math.tan(v * QUARTER_PI);
  out.set(
    f.n[0] + f.a[0] * U + f.b[0] * V,
    f.n[1] + f.a[1] * U + f.b[1] * V,
    f.n[2] + f.a[2] * U + f.b[2] * V,
  );
  return out.normalize();
}

interface ChunkNode {
  face: number;
  level: number;
  i: number;
  j: number;
  dir: THREE.Vector3;
  center: THREE.Vector3;
  /** 用于 LOD 距离判断的中心:center 抬升到块内平均海拔(山地块离海平面几千米,否则永远细分不下去) */
  lodCenter: THREE.Vector3;
  /** 块的边长(米,近似) */
  size: number;
  /** 块的角半径(弧度) */
  angRadius: number;
  ready: boolean;
  lastUsed: number;
  children?: ChunkNode[];
  land?: THREE.Mesh;
  water?: THREE.Mesh;
  veg?: VegChunk | null;
  /** veg 已经尝试生成过(null 也算) */
  vegDone?: boolean;
}

export interface PlanetStats {
  active: number;
  built: number;
  maxLevel: number;
}

export class Planet {
  readonly group = new THREE.Group();
  readonly terrain: Terrain;

  private readonly roots: ChunkNode[] = [];
  private readonly all: ChunkNode[] = [];
  private active: ChunkNode[] = [];
  private frame = 0;
  private builtCount = 0;

  private readonly landMaterial: THREE.MeshStandardNodeMaterial;
  private readonly waterMaterial: THREE.MeshStandardNodeMaterial;

  // 复用的临时对象
  private readonly camDir = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();
  private readonly color: RGB = [0, 0, 0];

  private readonly vegetation: Vegetation;

  constructor(terrain: Terrain, vegDensity = 1) {
    this.terrain = terrain;
    this.vegetation = new Vegetation(terrain, vegDensity);

    // 单面渲染:之前用 DoubleSide 时,裙边的背面法线被翻转,在地面上显示成一条条黑线
    this.landMaterial = new THREE.MeshStandardNodeMaterial({
      vertexColors: true,
      roughness: 0.96,
      metalness: 0,
    });

    // 水色随时间在两种蓝之间缓慢起伏。
    // 注意不能用块内坐标(positionLocal,数值可达上百万米)做正弦,float32 下会出现摩尔纹。
    this.waterMaterial = new THREE.MeshStandardNodeMaterial({
      transparent: true,
      opacity: 0.88,
      roughness: 0.12,
      metalness: 0.05,
      depthWrite: false,
    });
    // 水面:按水深从浅青渐变到深蓝,岸边泛白,叠加随时间流动的波纹。
    // wpos 是行星坐标按 4096 m 取模的结果,波纹频率取 2π·整数/4096,所以跨地形块无缝。
    const depth = attribute("wdepth", "float");
    const wp = attribute("wpos", "vec3");
    const k = (Math.PI * 2) / 4096;
    // 三组斜向波叠加(不用正弦相乘,否则会出现棋盘格)
    const ripple = sin(wp.x.add(wp.z).mul(k * 70).add(time.mul(1.1)))
      .add(sin(wp.x.sub(wp.z).mul(k * 53).sub(time.mul(1.4))).mul(0.8))
      .add(sin(wp.y.mul(k * 113).add(wp.x.mul(k * 29)).add(time.mul(2.1))).mul(0.5))
      .mul(0.45);
    const body = mix(color(0x3aa9b8), color(0x0f3f7a), smoothstep(0.02, 0.55, depth));
    const foam = smoothstep(0.1, 0.0, depth);
    this.waterMaterial.colorNode = body.add(ripple.mul(0.045)).add(foam.mul(0.55).mul(ripple.mul(0.3).add(0.8)));
    this.waterMaterial.opacityNode = mix(0.5, 0.92, smoothstep(0.0, 0.3, depth));
    this.waterMaterial.roughnessNode = mix(0.35, 0.1, smoothstep(0.0, 0.3, depth));

    for (let f = 0; f < 6; f++) {
      const root = this.makeNode(f, 0, 0, 0);
      this.build(root);
      this.roots.push(root);
    }
  }

  /** 单位方向处的地表海拔(米)。用于相机碰撞和放置建筑。 */
  heightAt(dir: THREE.Vector3): number {
    return this.terrain.height(dir.x, dir.y, dir.z, 3e5);
  }

  get stats(): PlanetStats {
    let maxLevel = 0;
    for (const n of this.active) if (n.level > maxLevel) maxLevel = n.level;
    return { active: this.active.length, built: this.builtCount, maxLevel };
  }

  // ---------------------------------------------------------------- 四叉树

  private makeNode(face: number, level: number, i: number, j: number): ChunkNode {
    const R = PLANET_RADIUS;
    const tiles = 2 ** level;
    const u = -1 + (2 * (i + 0.5)) / tiles;
    const v = -1 + (2 * (j + 0.5)) / tiles;
    const dir = faceDir(face, u, v, new THREE.Vector3());
    const size = (R * (Math.PI / 2)) / tiles;
    const node: ChunkNode = {
      face,
      level,
      i,
      j,
      dir,
      center: dir.clone().multiplyScalar(R),
      lodCenter: dir.clone().multiplyScalar(R),
      size,
      angRadius: (Math.PI / 2 / tiles) * 0.8,
      ready: false,
      lastUsed: 0,
    };
    this.all.push(node);
    return node;
  }

  private childrenOf(node: ChunkNode): ChunkNode[] {
    if (!node.children) {
      const l = node.level + 1;
      const parentH = node.lodCenter.length() - PLANET_RADIUS;
      node.children = [
        this.makeNode(node.face, l, node.i * 2, node.j * 2),
        this.makeNode(node.face, l, node.i * 2 + 1, node.j * 2),
        this.makeNode(node.face, l, node.i * 2, node.j * 2 + 1),
        this.makeNode(node.face, l, node.i * 2 + 1, node.j * 2 + 1),
      ];
      // 子块在建好之前先沿用父块的海拔来判断距离
      for (const k of node.children) k.lodCenter.copy(k.dir).multiplyScalar(PLANET_RADIUS + parentH);
    }
    return node.children;
  }

  private culled(node: ChunkNode, horizon: number): boolean {
    const cos = Math.min(1, Math.max(-1, this.camDir.dot(node.dir)));
    return Math.acos(cos) > horizon + node.angRadius + 0.012;
  }

  private visit(node: ChunkNode, cam: THREE.Vector3, horizon: number, t0: number) {
    node.lastUsed = this.frame;
    const dist = cam.distanceTo(node.lodCenter);
    const wantSplit = node.level < MAX_LEVEL && dist < node.size * SPLIT_FACTOR;

    if (wantSplit) {
      const kids = this.childrenOf(node)
        .filter((k) => !this.culled(k, horizon))
        .sort((a, b) => cam.distanceToSquared(a.lodCenter) - cam.distanceToSquared(b.lodCenter));

      for (const k of kids) {
        if (!k.ready && performance.now() - t0 < BUILD_BUDGET_MS) this.build(k);
      }
      if (kids.length > 0 && kids.every((k) => k.ready)) {
        for (const k of kids) this.visit(k, cam, horizon, t0);
        return;
      }
    }
    // 子块没准备好(或不需要细分)时继续画自己;父块一定已经就绪。
    this.active.push(node);
  }

  /** 每帧调用。cam 为相机在行星坐标系下的位置(米,float64)。 */
  update(cam: THREE.Vector3) {
    this.frame++;
    const t0 = performance.now();

    for (const n of this.active) {
      if (n.land) n.land.visible = false;
      if (n.water) n.water.visible = false;
      if (n.veg) n.veg.group.visible = false;
    }
    this.active = [];

    const camLen = cam.length();
    this.camDir.copy(cam).divideScalar(camLen || 1);
    const horizon = Math.acos(Math.min(1, PLANET_RADIUS / Math.max(camLen, 1)));

    for (const root of this.roots) {
      if (!this.culled(root, horizon)) this.visit(root, cam, horizon, t0);
    }

    // 植被:每帧最多给最近的一个活动块生成(地形先出来,树随后长出来)
    let nextVeg: ChunkNode | null = null;
    let nextD = Infinity;
    for (const n of this.active) {
      if (n.level >= VEG_MIN_LEVEL && !n.vegDone && n.ready) {
        const d = cam.distanceToSquared(n.lodCenter);
        if (d < nextD) {
          nextD = d;
          nextVeg = n;
        }
      }
    }
    // 植被有自己的预算:每帧一块,不和地形块抢(否则地形还在细分时树永远长不出来)
    if (nextVeg) this.buildVeg(nextVeg);

    for (const n of this.active) {
      if (n.land) {
        n.land.position.copy(n.center).sub(cam);
        n.land.visible = true;
      }
      if (n.water) {
        n.water.position.copy(n.center).sub(cam);
        n.water.visible = true;
      }
      if (n.veg) {
        n.veg.group.position.copy(n.center).sub(cam);
        n.veg.group.visible = true;
        // 草丛 / 花 / 岩石只在很近时画
        const near = cam.distanceTo(n.lodCenter) < n.size * 0.5 + 170;
        for (const g of n.veg.ground) g.visible = near;
        // 精细树只在近处;稍远换中等精度,更远(级别 13/14)本来就是低模
        if (n.veg.treesHi.length) {
          const fine = cam.distanceTo(n.lodCenter) < n.size * 0.5 + 420;
          for (const o of n.veg.treesHi) o.visible = fine;
          for (const o of n.veg.treesMid) o.visible = !fine;
        }
      }
    }

    if (this.frame % 60 === 0) this.evict();
  }

  private evict() {
    const MAX_BUILT = 500;
    if (this.builtCount <= MAX_BUILT) return;
    const stale = this.all
      .filter((n) => n.ready && n.level > 0 && this.frame - n.lastUsed > 120)
      .sort((a, b) => a.lastUsed - b.lastUsed);
    for (const n of stale) {
      if (this.builtCount <= MAX_BUILT * 0.8) break;
      this.dispose(n);
    }
  }

  private buildVeg(n: ChunkNode) {
    n.vegDone = true;
    if (!n.land) return;
    const geo = n.land.geometry;
    const veg = this.vegetation.build({
      level: n.level,
      face: n.face,
      i: n.i,
      j: n.j,
      size: n.size,
      center: n.center,
      pos: geo.getAttribute("position").array as Float32Array,
      nor: geo.getAttribute("normal").array as Float32Array,
      N: GRID,
    });
    if (veg) {
      veg.group.visible = false;
      this.group.add(veg.group);
      n.veg = veg;
    }
  }

  private dispose(n: ChunkNode) {
    if (n.veg) {
      this.group.remove(n.veg.group);
      n.veg.dispose();
      n.veg = undefined;
    }
    n.vegDone = false;
    if (n.land) {
      this.group.remove(n.land);
      n.land.geometry.dispose();
      n.land = undefined;
    }
    if (n.water) {
      this.group.remove(n.water);
      n.water.geometry.dispose();
      n.water = undefined;
    }
    n.ready = false;
    this.builtCount--;
  }

  // ---------------------------------------------------------------- 网格生成

  private build(node: ChunkNode) {
    const R = PLANET_RADIUS;
    const N = GRID;
    const M = N + 3; // 多取一圈,用来在块边缘算出无缝法线
    const tiles = 2 ** node.level;
    const step = 2 / tiles / N;
    const u0 = -1 + (2 * node.i) / tiles;
    const v0 = -1 + (2 * node.j) / tiles;
    const spacing = node.size / N;
    const maxFreq = R / (2 * spacing);
    const terrain = this.terrain;
    const dir = this.tmpDir;
    const center = node.center;

    const dirs = new Float64Array(M * M * 3);
    const heights = new Float64Array(M * M);
    const P = new Float64Array(M * M * 3);

    for (let jj = 0; jj < M; jj++) {
      for (let ii = 0; ii < M; ii++) {
        faceDir(node.face, u0 + (ii - 1) * step, v0 + (jj - 1) * step, dir);
        const idx = jj * M + ii;
        const h = terrain.height(dir.x, dir.y, dir.z, maxFreq);
        heights[idx] = h;
        dirs[idx * 3] = dir.x;
        dirs[idx * 3 + 1] = dir.y;
        dirs[idx * 3 + 2] = dir.z;
        P[idx * 3] = dir.x * (R + h);
        P[idx * 3 + 1] = dir.y * (R + h);
        P[idx * 3 + 2] = dir.z * (R + h);
      }
    }

    const W = N + 1;
    const mainCount = W * W;
    const skirtCount = 4 * W;
    const total = mainCount + skirtCount;
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    const skirtDepth = Math.max(30, node.size * 0.05);
    let minH = Infinity;

    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const gi = (j + 1) * M + (i + 1);
        const vi = j * W + i;
        const h = heights[gi];
        if (h < minH) minH = h;

        const dx = dirs[gi * 3];
        const dy = dirs[gi * 3 + 1];
        const dz = dirs[gi * 3 + 2];

        // 法线 = (沿 a 方向的差分) × (沿 b 方向的差分)
        const ia = (j + 1) * M + (i + 2);
        const ib = (j + 1) * M + i;
        const ic = (j + 2) * M + (i + 1);
        const id = j * M + (i + 1);
        const ax = P[ia * 3] - P[ib * 3];
        const ay = P[ia * 3 + 1] - P[ib * 3 + 1];
        const az = P[ia * 3 + 2] - P[ib * 3 + 2];
        const bx = P[ic * 3] - P[id * 3];
        const by = P[ic * 3 + 1] - P[id * 3 + 1];
        const bz = P[ic * 3 + 2] - P[id * 3 + 2];
        let nx = ay * bz - az * by;
        let ny = az * bx - ax * bz;
        let nz = ax * by - ay * bx;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl;
        ny /= nl;
        nz /= nl;

        pos[vi * 3] = P[gi * 3] - center.x;
        pos[vi * 3 + 1] = P[gi * 3 + 1] - center.y;
        pos[vi * 3 + 2] = P[gi * 3 + 2] - center.z;
        nor[vi * 3] = nx;
        nor[vi * 3 + 1] = ny;
        nor[vi * 3 + 2] = nz;

        const slope = 1 - (nx * dx + ny * dy + nz * dz);
        const biome = terrain.biome(dx, dy, dz);
        terrain.color(
          h,
          slope,
          dy,
          biome,
          terrain.speckle(dx, dy, dz, maxFreq),
          this.color,
          terrain.forest(dx, dy, dz, h, slope, biome),
        );
        col[vi * 3] = this.color[0];
        col[vi * 3 + 1] = this.color[1];
        col[vi * 3 + 2] = this.color[2];
      }
    }

    // 裙边:沿四条边向下复制一圈顶点,遮住相邻 LOD 之间的缝隙
    const edgeVertex = (e: number, k: number) =>
      e === 0 ? k : e === 1 ? N * W + k : e === 2 ? k * W : k * W + N;
    for (let e = 0; e < 4; e++) {
      for (let k = 0; k <= N; k++) {
        const src = edgeVertex(e, k);
        const dst = mainCount + e * W + k;
        const gi = e === 0 ? (1 * M + (k + 1)) : e === 1 ? ((N + 1) * M + (k + 1)) : e === 2 ? ((k + 1) * M + 1) : ((k + 1) * M + (N + 1));
        pos[dst * 3] = pos[src * 3] - dirs[gi * 3] * skirtDepth;
        pos[dst * 3 + 1] = pos[src * 3 + 1] - dirs[gi * 3 + 1] * skirtDepth;
        pos[dst * 3 + 2] = pos[src * 3 + 2] - dirs[gi * 3 + 2] * skirtDepth;
        nor[dst * 3] = nor[src * 3];
        nor[dst * 3 + 1] = nor[src * 3 + 1];
        nor[dst * 3 + 2] = nor[src * 3 + 2];
        col[dst * 3] = col[src * 3];
        col[dst * 3 + 1] = col[src * 3 + 1];
        col[dst * 3 + 2] = col[src * 3 + 2];
      }
    }

    const idx: number[] = [];
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const v00 = j * W + i;
        const v10 = v00 + 1;
        const v01 = v00 + W;
        const v11 = v01 + 1;
        idx.push(v00, v10, v01, v10, v11, v01);
      }
    }
    for (let e = 0; e < 4; e++) {
      for (let k = 0; k < N; k++) {
        const e0 = edgeVertex(e, k);
        const e1 = edgeVertex(e, k + 1);
        const s0 = mainCount + e * W + k;
        const s1 = s0 + 1;
        // 裙边两面都画(材质是单面的),从哪一侧看都不会露缝
        idx.push(e0, s0, e1, e1, s0, s1);
        idx.push(e0, e1, s0, e1, s1, s0);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint16Array(idx), 1));
    geo.computeBoundingSphere();

    const land = new THREE.Mesh(geo, this.landMaterial);
    land.receiveShadow = true;
    land.visible = false;
    this.group.add(land);
    node.land = land;

    // 水面:块内有低于海平面的地形才需要
    if (minH < 0) {
      const wpos = new Float32Array(mainCount * 3);
      const wnor = new Float32Array(mainCount * 3);
      const wdepth = new Float32Array(mainCount);
      const cmod = new THREE.Vector3(((center.x % 4096) + 4096) % 4096, ((center.y % 4096) + 4096) % 4096, ((center.z % 4096) + 4096) % 4096);
      const wwrap = new Float32Array(mainCount * 3);
      for (let j = 0; j <= N; j++) {
        for (let i = 0; i <= N; i++) {
          const gi = (j + 1) * M + (i + 1);
          const vi = j * W + i;
          const dx = dirs[gi * 3];
          const dy = dirs[gi * 3 + 1];
          const dz = dirs[gi * 3 + 2];
          wpos[vi * 3] = dx * R - center.x;
          wpos[vi * 3 + 1] = dy * R - center.y;
          wpos[vi * 3 + 2] = dz * R - center.z;
          wnor[vi * 3] = dx;
          wnor[vi * 3 + 1] = dy;
          wnor[vi * 3 + 2] = dz;
          wdepth[vi] = Math.min(1, Math.max(0, -heights[gi] / 60));
          // 块内连续(不在块内取模,避免插值跨越回绕点);块之间靠 4096 周期对齐
          wwrap[vi * 3] = wpos[vi * 3] + cmod.x;
          wwrap[vi * 3 + 1] = wpos[vi * 3 + 1] + cmod.y;
          wwrap[vi * 3 + 2] = wpos[vi * 3 + 2] + cmod.z;
        }
      }
      const wgeo = new THREE.BufferGeometry();
      wgeo.setAttribute("position", new THREE.BufferAttribute(wpos, 3));
      wgeo.setAttribute("normal", new THREE.BufferAttribute(wnor, 3));
      wgeo.setAttribute("wdepth", new THREE.BufferAttribute(wdepth, 1));
      wgeo.setAttribute("wpos", new THREE.BufferAttribute(wwrap, 3));
      wgeo.setIndex(new THREE.BufferAttribute(new Uint16Array(idx.slice(0, N * N * 6)), 1));
      wgeo.computeBoundingSphere();
      const water = new THREE.Mesh(wgeo, this.waterMaterial);
      water.visible = false;
      water.renderOrder = 1;
      this.group.add(water);
      node.water = water;
    }

    // 块中心的海拔(取中间那个顶点)
    const mid = (Math.floor(N / 2) + 1) * M + Math.floor(N / 2) + 1;
    node.lodCenter.copy(node.dir).multiplyScalar(R + heights[mid]);
    node.ready = true;
    this.builtCount++;
  }
}
