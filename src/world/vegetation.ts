import * as THREE from "three/webgpu";
import { float, instanceIndex, positionGeometry, positionLocal, sin, time, vec3 } from "three/tsl";
import { PLANET_RADIUS } from "../config";
import { createNoise3 } from "./noise";
import { displace, merge, paint, rngOf, RY, S, T, xform } from "./geo";
import type { Terrain } from "./terrain";

/**
 * 地表植被:按地形块生成,全部用实例化绘制。
 *
 * 细节分三档(由地形块层级决定,层级越高离相机越近):
 *   - 层级 13(块边长 ~1.2 km):树丛("林冠团块"),远看一片森林
 *   - 层级 14(~600 m):中模树(几十个三角形)
 *   - 层级 15(~300 m):高模树 + 灌木 / 草丛 / 野花 / 岩石
 * 森林分布由 Terrain.forest() 决定,地表颜色也用同一个函数压暗,所以远近一致。
 */

export const VEG_MIN_LEVEL = 13;
export const VEG_GROUND_LEVEL = 15;

export interface VegChunk {
  group: THREE.Group;
  /** 只在很近时显示的地被(草丛、花、岩石) */
  ground: THREE.Object3D[];
  /** 级别 15 的块:近处用精细树模型,远一点换成中等精度(同一批实例) */
  treesHi: THREE.Object3D[];
  treesMid: THREE.Object3D[];
  dispose(): void;
}

export interface VegInput {
  level: number;
  face: number;
  i: number;
  j: number;
  size: number;
  center: THREE.Vector3;
  /** (N+1)² 个顶点,相对 center 的位置 / 法线 */
  pos: Float32Array;
  nor: Float32Array;
  N: number;
}

const Y = new THREE.Vector3(0, 1, 0);

// ------------------------------------------------------------------ 几何(只创建一次)

function blob(r: number, detail: number, seed: number, amp: number): THREE.BufferGeometry {
  return displace(new THREE.IcosahedronGeometry(r, detail), seed, 0.7 / r, amp * r, 3);
}

/** tier: 2 = 近(含 true),1 = 中(含 false),0 = 远(几十个三角形) */
const tierOf = (t: boolean | number) => (t === true ? 2 : t === false ? 1 : t);

export function broadleaf(tierArg: boolean | number): THREE.BufferGeometry {
  const tier = tierOf(tierArg);
  const hi = tier >= 2;
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.17, 0.3, 3.4, hi ? 6 : 4, 1);
  xform(trunk, T(0, 1.7, 0));
  paint(trunk, (x, y) => [0.3 + 0.05 * Math.sin(y * 7 + x * 9), 0.2, 0.12]);
  parts.push(trunk);
  const lobes: [number, number, number, number][] = tier === 0
    ? [[0, 5.0, 0, 3.0]]
    : hi
    ? [
        [0, 5.2, 0, 2.5],
        [1.4, 4.3, 0.5, 1.8],
        [-1.3, 4.6, -0.7, 1.9],
        [0.3, 6.4, 0.3, 1.6],
        [0.2, 4.2, -1.5, 1.5],
      ]
    : [
        [0, 5.0, 0, 2.7],
        [0.9, 4.2, 0.4, 1.8],
      ];
  lobes.forEach(([x, y, z, r], k) => {
    const g = blob(r, tier === 0 ? 0 : 1, 11 + k * 7, tier === 0 ? 0.1 : 0.22);
    xform(g, T(x, y, z));
    paint(g, (_x, py, _z, nx, ny) => {
      const top = Math.min(1, Math.max(0, (py - 3) / 4));
      const lit = 0.55 + 0.45 * ny;
      return [(0.12 + 0.12 * top) * lit + 0.04, (0.34 + 0.2 * top) * lit + 0.06, (0.08 + 0.05 * top) * lit + 0.02];
    });
    parts.push(g);
  });
  return merge(parts);
}

export function conifer(tierArg: boolean | number): THREE.BufferGeometry {
  const tier = tierOf(tierArg);
  const hi = tier >= 2;
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.15, 0.28, 2.2, 4, 1);
  xform(trunk, T(0, 1.1, 0));
  paint(trunk, [0.27, 0.17, 0.1]);
  parts.push(trunk);
  const tiers = hi ? 5 : tier === 1 ? 3 : 2;
  for (let k = 0; k < tiers; k++) {
    const t = k / (tiers - 1);
    const r = 2.1 * (1 - t * 0.78);
    const h = 3.0 - t * 0.9;
    const cone = new THREE.ConeGeometry(r, h, hi ? 8 : tier === 1 ? 6 : 5, 1, true);
    xform(cone, T(0, 2.2 + t * (hi ? 7.6 : 7.4) + h * 0.5, 0));
    const g = hi ? displace(cone, 40 + k, 1.2, 0.18, 2) : cone;
    paint(g, (_x, py, _z, nx, ny) => {
      const lit = 0.5 + 0.5 * Math.max(0, ny + 0.2);
      return [0.05 * lit + 0.03, (0.2 + 0.08 * (1 - t)) * lit + 0.05, 0.09 * lit + 0.03];
    });
    parts.push(g);
  }
  return merge(parts);
}

function tuft(): THREE.BufferGeometry {
  // 三片交叉的草叶,每片两个三角形
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI;
    const blade = new THREE.PlaneGeometry(0.22, 0.85, 1, 2);
    xform(blade, T(0, 0.42, 0));
    // 叶尖收窄
    const p = blade.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      p.setX(i, p.getX(i) * (1 - (y / 0.85) * 0.85));
      p.setZ(i, (y / 0.85) * 0.12 * (k % 2 ? -1 : 1));
    }
    xform(blade, RY(a));
    blade.computeVertexNormals();
    paint(blade, (_x, py) => [0.18 + 0.2 * (py / 0.85), 0.36 + 0.22 * (py / 0.85), 0.08 + 0.05 * (py / 0.85)]);
    parts.push(blade);
  }
  return merge(parts);
}

function bush(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const spots: [number, number, number, number][] = [
    [0, 0.55, 0, 0.8],
    [0.6, 0.4, 0.2, 0.55],
    [-0.5, 0.45, -0.3, 0.6],
  ];
  spots.forEach(([x, y, z, r], k) => {
    const g = blob(r, 1, 70 + k, 0.25);
    xform(g, T(x, y, z));
    paint(g, (_x, py, _z, _nx, ny) => [0.1 + 0.08 * ny, 0.3 + 0.12 * ny, 0.07]);
    parts.push(g);
  });
  return merge(parts);
}

function flower(): THREE.BufferGeometry {
  const stem = new THREE.CylinderGeometry(0.012, 0.016, 0.45, 3, 1);
  xform(stem, T(0, 0.22, 0));
  paint(stem, [0.2, 0.45, 0.12]);
  const head = new THREE.IcosahedronGeometry(0.075, 0);
  xform(head, T(0, 0.48, 0));
  paint(head, [1, 1, 1]);
  return merge([stem, head]);
}

function rock(): THREE.BufferGeometry {
  const g = displace(new THREE.IcosahedronGeometry(0.7, 1), 5, 1.6, 0.25, 3);
  xform(g, S(1, 0.7, 1));
  paint(g, (x, y, z) => {
    const n = 0.5 + 0.12 * Math.sin(x * 9 + z * 7);
    return [n * 0.78, n * 0.75, n * 0.7];
  });
  return g;
}

export class Vegetation {
  private readonly broad = [broadleaf(0), broadleaf(1), broadleaf(2)];
  private readonly coni = [conifer(0), conifer(1), conifer(2)];
  private readonly tuftGeo = tuft();
  private readonly bushGeo = bush();
  private readonly flowerGeo = flower();
  private readonly rockGeo = rock();
  private readonly leafMat: THREE.MeshStandardNodeMaterial;
  private readonly grassMat: THREE.MeshStandardNodeMaterial;
  private readonly solidMat: THREE.MeshStandardNodeMaterial;
  private readonly noise = createNoise3(4242);
  /** ?veg=0 关闭,0.5 减半 */
  readonly density: number;

  constructor(
    private readonly terrain: Terrain,
    density = 1,
  ) {
    this.density = density;

    // 风:顶端晃动,权重 = 树内高度²。positionGeometry 是实例变换之前的原始顶点位置。
    const phase = instanceIndex.toFloat().mul(0.731).add(positionLocal.x.mul(0.013));
    const gust = sin(time.mul(1.25).add(phase)).add(sin(time.mul(2.3).add(phase.mul(1.7))).mul(0.4));
    const treeSway = () => {
      const w = positionGeometry.y.mul(positionGeometry.y).mul(0.0042).mul(gust);
      return positionLocal.add(vec3(w, float(0), w.mul(0.55)));
    };
    const grassSway = () => {
      const w = positionGeometry.y.mul(positionGeometry.y).mul(0.32).mul(gust);
      return positionLocal.add(vec3(w, float(0), w.mul(0.7)));
    };

    this.leafMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    this.leafMat.positionNode = treeSway();
    this.grassMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
    this.grassMat.positionNode = grassSway();
    this.solidMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  }

  /** 在一个已经生成好网格的地形块上撒植被;这一块没有植被时返回 null。 */
  build(inp: VegInput): VegChunk | null {
    if (this.density <= 0) return null;
    const { level, N, pos, nor, center } = inp;
    const W = N + 1;
    const rand = rngOf(((inp.face * 73856093) ^ (inp.i * 19349663) ^ (inp.j * 83492791) ^ (level * 2654435761)) >>> 0);
    const R = PLANET_RADIUS;
    const terrain = this.terrain;

    // ---- 候选点数量(随层级)
    const hiLevel = level >= VEG_GROUND_LEVEL;
    const treeCandidates = Math.round((level >= 15 ? 360 : level === 14 ? 420 : 220) * this.density);
    const tuftCandidates = hiLevel ? Math.round(520 * this.density) : 0;
    const bushCandidates = hiLevel ? Math.round(70 * this.density) : 0;
    const flowerCandidates = hiLevel ? Math.round(110 * this.density) : 0;
    const rockCandidates = hiLevel ? 34 : 0;

    const P = new THREE.Vector3();
    const D = new THREE.Vector3();
    const Nn = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const qy = new THREE.Quaternion();
    const m = new THREE.Matrix4();
    const sc = new THREE.Vector3();
    const rel = new THREE.Vector3();
    const col = new THREE.Color();

    interface Sample {
      rel: THREE.Vector3;
      dir: THREE.Vector3;
      hn: number;
      slope: number;
      biome: number;
      forest: number;
      ny: number;
    }
    const sampleAt = (): Sample | null => {
      const s = rand() * N;
      const t = rand() * N;
      const i = Math.min(N - 1, Math.floor(s));
      const j = Math.min(N - 1, Math.floor(t));
      const fs = s - i;
      const ft = t - j;
      const v00 = j * W + i;
      const v10 = v00 + 1;
      const v01 = v00 + W;
      const v11 = v01 + 1;
      const w00 = (1 - fs) * (1 - ft);
      const w10 = fs * (1 - ft);
      const w01 = (1 - fs) * ft;
      const w11 = fs * ft;
      const bl = (a: Float32Array, k: number) => a[v00 * 3 + k] * w00 + a[v10 * 3 + k] * w10 + a[v01 * 3 + k] * w01 + a[v11 * 3 + k] * w11;
      rel.set(bl(pos, 0), bl(pos, 1), bl(pos, 2));
      Nn.set(bl(nor, 0), bl(nor, 1), bl(nor, 2)).normalize();
      P.copy(center).add(rel);
      const len = P.length();
      D.copy(P).divideScalar(len);
      const hn = len - R;
      if (hn < 12) return null;
      if (terrain.inFlatZone(D.x, D.y, D.z)) return null;
      const slope = 1 - Nn.dot(D);
      const biome = terrain.biome(D.x, D.y, D.z);
      return { rel: rel.clone(), dir: D.clone(), hn, slope, biome, forest: terrain.forest(D.x, D.y, D.z, hn, slope, biome), ny: D.y };
    };

    const place = (smp: Sample, scale: number, sink = 0.15) => {
      q.setFromUnitVectors(Y, smp.dir);
      qy.setFromAxisAngle(Y, rand() * Math.PI * 2);
      q.multiply(qy);
      sc.set(scale, scale * (0.85 + rand() * 0.3), scale);
      const p = smp.rel.clone().addScaledVector(smp.dir, -sink);
      m.compose(p, q, sc);
      return m;
    };

    // ---- 树
    const broad: THREE.Matrix4[] = [];
    const broadCols: THREE.Color[] = [];
    const coni: THREE.Matrix4[] = [];
    const coniCols: THREE.Color[] = [];
    for (let k = 0; k < treeCandidates; k++) {
      const smp = sampleAt();
      if (!smp) continue;
      if (rand() > smp.forest) continue;
      const wantConi = smp.hn > 1100 || Math.abs(smp.ny) > 0.55 || this.noise(smp.dir.x * 600, smp.dir.y * 600, smp.dir.z * 600) > 0.35;
      const grove = level === VEG_MIN_LEVEL ? 2.8 + rand() * 1.4 : 1;
      const scale = (0.75 + rand() * 0.65) * grove;
      place(smp, scale);
      // 色调:干旱区偏黄,每棵略有差异
      const arid = Math.min(1, Math.max(0, (smp.biome - 0.05) / 0.3));
      col.setRGB(0.88 + rand() * 0.3 + arid * 0.35, 0.9 + rand() * 0.25 + arid * 0.12, 0.85 + rand() * 0.2 - arid * 0.2);
      if (wantConi) {
        coni.push(m.clone());
        coniCols.push(col.clone());
      } else {
        broad.push(m.clone());
        broadCols.push(col.clone());
      }
    }

    const group = new THREE.Group();
    const ground: THREE.Object3D[] = [];
    const meshes: THREE.InstancedMesh[] = [];
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, ms: THREE.Matrix4[], cols: THREE.Color[] | null, cast: boolean, isGround: boolean) => {
      if (!ms.length) return null;
      const im = new THREE.InstancedMesh(geo, mat, ms.length);
      for (let k = 0; k < ms.length; k++) {
        im.setMatrixAt(k, ms[k]);
        if (cols) im.setColorAt(k, cols[k]);
      }
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = cast;
      im.receiveShadow = true;
      group.add(im);
      meshes.push(im);
      if (isGround) ground.push(im);
      return im;
    };
    const hi = level >= 15;
    const treesHi: THREE.Object3D[] = [];
    const treesMid: THREE.Object3D[] = [];
    const tier = hi ? 2 : level === 14 ? 1 : 0;
    const b = add(this.broad[tier], this.leafMat, broad, broadCols, hi, false);
    const c = add(this.coni[tier], this.leafMat, coni, coniCols, hi, false);
    if (b) (hi ? treesHi : treesMid).push(b);
    if (c) (hi ? treesHi : treesMid).push(c);
    if (hi) {
      // 同一批实例再画一份中等精度的,远处切换过去
      const b1 = add(this.broad[1], this.leafMat, broad, broadCols, false, false);
      const c1 = add(this.coni[1], this.leafMat, coni, coniCols, false, false);
      if (b1) treesMid.push(b1);
      if (c1) treesMid.push(c1);
      for (const o of treesMid) o.visible = false;
    }

    // ---- 地被(只有最高层级)
    if (hiLevel) {
      const tufts: THREE.Matrix4[] = [];
      const tuftCols: THREE.Color[] = [];
      for (let k = 0; k < tuftCandidates; k++) {
        const smp = sampleAt();
        if (!smp || smp.hn < 14 || smp.slope > 0.22) continue;
        if (smp.biome > 0.5 && rand() < 0.85) continue; // 沙漠里草很稀
        const snow = Math.min(1, Math.max(0, (smp.hn - 2500) / 600)) + (Math.abs(smp.ny) > 0.9 ? 1 : 0);
        if (snow > 0.5) continue;
        // 林下草少一点,草原多一点
        if (rand() > 0.9 - smp.forest * 0.35) continue;
        place(smp, 0.7 + rand() * 0.9, 0.02);
        const arid = Math.min(1, Math.max(0, (smp.biome - 0.05) / 0.3));
        col.setRGB(0.85 + rand() * 0.3 + arid * 0.6, 0.9 + rand() * 0.25 + arid * 0.25, 0.8 + rand() * 0.2 - arid * 0.15);
        tufts.push(m.clone());
        tuftCols.push(col.clone());
      }
      add(this.tuftGeo, this.grassMat, tufts, tuftCols, false, true);

      const bushes: THREE.Matrix4[] = [];
      for (let k = 0; k < bushCandidates; k++) {
        const smp = sampleAt();
        if (!smp || smp.slope > 0.2) continue;
        if (rand() > 0.25 + smp.forest * 0.7) continue;
        place(smp, 0.7 + rand() * 0.9, 0.1);
        bushes.push(m.clone());
      }
      add(this.bushGeo, this.solidMat, bushes, null, false, true);

      const flowers: THREE.Matrix4[] = [];
      const flowerCols: THREE.Color[] = [];
      const palette = [0xffffff, 0xffd84a, 0xff7ab6, 0xb084ff, 0xff6a4a];
      for (let k = 0; k < flowerCandidates; k++) {
        const smp = sampleAt();
        if (!smp || smp.hn < 14 || smp.slope > 0.15 || smp.forest > 0.7 || smp.biome > 0.2) continue;
        if (this.noise(smp.dir.x * 5200, smp.dir.y * 5200, smp.dir.z * 5200) < 0.1) continue; // 成片开花
        place(smp, 0.8 + rand() * 0.6, 0.02);
        col.setHex(palette[Math.floor(rand() * palette.length)]);
        flowers.push(m.clone());
        flowerCols.push(col.clone());
      }
      add(this.flowerGeo, this.solidMat, flowers, flowerCols, false, true);

      const rocks: THREE.Matrix4[] = [];
      for (let k = 0; k < rockCandidates; k++) {
        const smp = sampleAt();
        if (!smp) continue;
        const rocky = Math.min(1, smp.slope * 5 + Math.max(0, (smp.hn - 1500) / 1500));
        if (rand() > 0.15 + rocky * 0.8) continue;
        place(smp, 0.4 + Math.pow(rand(), 2.2) * 2.4, 0.15);
        rocks.push(m.clone());
      }
      add(this.rockGeo, this.solidMat, rocks, null, true, true);
    }

    if (!meshes.length) return null;
    return {
      group,
      ground,
      treesHi,
      treesMid,
      dispose() {
        for (const mesh of meshes) mesh.dispose();
      },
    };
  }
}
