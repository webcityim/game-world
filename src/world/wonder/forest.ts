import * as THREE from "three/webgpu";
import { displace, paint, rngOf, sweep, S, xform } from "../geo";
import { broadleaf, conifer } from "../vegetation";
import { makeWaterfall, rockPainter, vcMat, type Wonder } from "./common";

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 单位石柱(高 1、底半径 1)。非均匀缩放后得到不同粗细高矮的石柱。 */
function pillarVariant(seed: number, segs = 28, radial = 20): THREE.BufferGeometry {
  const line = new THREE.LineCurve3(new THREE.Vector3(0, -0.05, 0), new THREE.Vector3(0, 1, 0));
  const g = sweep(
    line,
    segs,
    radial,
    (t, th) => {
      const flare = 1 + 0.5 * Math.exp(-t * 9);
      const taper = 1 - 0.2 * t;
      const wave = 1 + 0.1 * Math.sin(t * 11 + seed) + 0.06 * Math.sin(t * 27 + seed * 3.1);
      const lobes = 1 + 0.13 * Math.cos(th * 3 + seed + t * 2.5) + 0.06 * Math.cos(th * 7 - seed * 2 + t * 5);
      const lip = 1 + 0.2 * smooth(0.9, 0.97, t) * (1 - smooth(0.97, 1.0, t));
      return flare * taper * wave * lobes * lip;
    },
    true,
  );
  const d = displace(g, seed * 7 + 1, 6, 0.035, 4);
  const paintRock = rockPainter({ a: [0.66, 0.6, 0.5], b: [0.44, 0.39, 0.33], band: 1.6, seed, moss: [0.2, 0.42, 0.16], mossMin: 0.62, darkenBelow: 6 });
  paint(d, (x, y, z, nx, ny, nz) => {
    // 垂直石纹被"高度"拉伸到 ~0..1,再放大到合适的频率
    const c = paintRock(x * 50, y * 50, z * 50, nx, ny, nz);
    // 顶面是草地,侧面上部也有绿色滴落的痕迹
    const top = smooth(0.62, 0.82, ny) * smooth(0.9, 0.98, y);
    const drip = smooth(0.78, 0.97, y) * 0.45;
    const g0: [number, number, number] = [0.22, 0.46, 0.17];
    return [
      c[0] * (1 - Math.max(top, drip)) + g0[0] * Math.max(top, drip),
      c[1] * (1 - Math.max(top, drip)) + g0[1] * Math.max(top, drip),
      c[2] * (1 - Math.max(top, drip)) + g0[2] * Math.max(top, drip),
    ];
  });
  return d;
}

/** 石林:几十根喀斯特石柱,顶上长着树,脚下是碎石,一道瀑布从最高的石柱上泻下。 */
export function createStoneForest(): Wonder {
  const group = new THREE.Group();
  const rand = rngOf(314);
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
  const variants = seeds.map((s) => pillarVariant(s, 36, 22));
  const farVariants = seeds.map((s) => pillarVariant(s, 16, 12));
  const nearMeshes: THREE.Object3D[] = [];
  const farMeshes: THREE.Object3D[] = [];
  const mat = vcMat({ roughness: 0.97 });

  interface P {
    x: number;
    z: number;
    r: number;
    h: number;
  }
  const pillars: P[] = [];
  const tries = 400;
  for (let i = 0; i < tries && pillars.length < 72; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * 1050;
    const hh = 140 + Math.pow(rand(), 1.7) * 640 + Math.max(0, 1 - d / 500) * 220;
    const r = 26 + rand() * 46 + hh * 0.045;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (pillars.some((p) => Math.hypot(p.x - x, p.z - z) < (p.r + r) * 1.15)) continue;
    pillars.push({ x, z, r, h: hh });
  }
  const buckets: P[][] = variants.map(() => []);
  pillars.forEach((p, i) => buckets[i % variants.length].push(p));

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const Y = new THREE.Vector3(0, 1, 0);
  buckets.forEach((list, v) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(variants[v], mat, list.length);
    list.forEach((p, i) => {
      q.setFromAxisAngle(Y, rand() * 6.28);
      m4.compose(new THREE.Vector3(p.x, 0, p.z), q, new THREE.Vector3(p.r, p.h, p.r));
      im.setMatrixAt(i, m4);
    });
    im.computeBoundingSphere();
    im.castShadow = true;
    group.add(im);
    nearMeshes.push(im);
    const far = new THREE.InstancedMesh(farVariants[v], mat, list.length);
    far.instanceMatrix = im.instanceMatrix;
    far.computeBoundingSphere();
    far.visible = false;
    group.add(far);
    farMeshes.push(far);
  });

  // 脚下的碎石
  const rockGeos = [0, 1, 2].map((v) => {
    const g = displace(new THREE.IcosahedronGeometry(1, 1), 500 + v * 17, 1.8, 0.32, 3);
    xform(g, S(1, 0.7, 1));
    return paint(g, rockPainter({ a: [0.6, 0.55, 0.47], b: [0.4, 0.36, 0.3], band: 6, seed: 20 + v, moss: [0.2, 0.4, 0.15], mossMin: 0.5 }));
  });
  const rockLists: THREE.Matrix4[][] = [[], [], []];
  for (const p of pillars) {
    const n = 2 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const a = rand() * 6.28;
      const d = p.r * (1.2 + rand() * 1.6);
      const r = 6 + rand() * (10 + p.r * 0.35);
      q.setFromEuler(new THREE.Euler(rand() * 6, rand() * 6, rand() * 6));
      m4.compose(new THREE.Vector3(p.x + Math.cos(a) * d, r * 0.15, p.z + Math.sin(a) * d), q, new THREE.Vector3(r, r, r));
      rockLists[Math.floor(rand() * 3)].push(m4.clone());
    }
  }
  rockLists.forEach((list, v) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(rockGeos[v], mat, list.length);
    list.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.computeBoundingSphere();
    group.add(im);
  });

  // 细节层:石柱顶上的树
  const detail = new THREE.Group();
  const leafMat = vcMat({ roughness: 0.9 });
  const broad: THREE.Matrix4[] = [];
  const coni: THREE.Matrix4[] = [];
  for (const p of pillars) {
    const n = Math.min(7, 2 + Math.floor(p.r / 18));
    for (let k = 0; k < n; k++) {
      const a = rand() * 6.28;
      const d = Math.sqrt(rand()) * p.r * 0.62;
      const s = 1.2 + rand() * 1.5;
      q.setFromAxisAngle(Y, rand() * 6.28);
      m4.compose(new THREE.Vector3(p.x + Math.cos(a) * d, p.h * 0.995, p.z + Math.sin(a) * d), q, new THREE.Vector3(s, s * (0.9 + rand() * 0.3), s));
      (rand() < 0.45 ? coni : broad).push(m4.clone());
    }
  }
  for (const [geo, list] of [
    [broadleaf(true), broad],
    [conifer(true), coni],
  ] as const) {
    if (!list.length) continue;
    const im = new THREE.InstancedMesh(geo, leafMat, list.length);
    list.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.computeBoundingSphere();
    im.castShadow = true;
    detail.add(im);
  }
  group.add(detail);

  // 瀑布:从最高的石柱顶上落下
  const tallest = pillars.reduce((a, b) => (b.h > a.h ? b : a), pillars[0]);
  const fall = makeWaterfall(tallest.r * 0.5, tallest.h * 0.97);
  fall.position.set(tallest.x + tallest.r * 0.92, 0, tallest.z);
  fall.rotation.y = Math.PI / 2;
  group.add(fall);
  // 脚下的浅潭
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(tallest.r * 1.6, 40),
    new THREE.MeshStandardNodeMaterial({ color: 0x3a9fb8, roughness: 0.1, transparent: true, opacity: 0.85 }),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(tallest.x + tallest.r * 2.1, 1.2, tallest.z);
  group.add(pool);

  return {
    id: "forest",
    name: "石林 / Stone Forest",
    group,
    footprint: { inner: 780, outer: 1500 },
    view: { height: 520, back: 2400 },
    detail,
    detailDistance: 5000,
    setDistance: (d) => {
      const near = d < 3500;
      for (const o of nearMeshes) o.visible = near;
      for (const o of farMeshes) o.visible = !near;
    },
  };
}
