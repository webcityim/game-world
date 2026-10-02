import * as THREE from "three/webgpu";
import { displace, paint, rngOf, sweep, S, T, xform } from "../geo";
import { broadleaf, conifer } from "../vegetation";
import { makeWaterfall, rockPainter, vcMat, type Wonder } from "./common";

/** 天然拱门:红色砂岩巨拱,岩层清晰、表面风蚀,拱下垂着一道水幕,脚下是碎石和绿洲。 */
export function createGreatArch(): Wonder {
  const group = new THREE.Group();
  const rand = rngOf(2718);
  const span = 780;
  const rise = span * 0.8;
  const base = 300;

  const paintStone = rockPainter({ a: [0.82, 0.46, 0.3], b: [0.5, 0.25, 0.17], band: 0.085, seed: 77, moss: [0.28, 0.45, 0.17], mossMin: 0.8, darkenBelow: 60 });
  const stoneMat = vcMat({ roughness: 1 });

  // ---- 拱体:沿半椭圆扫掠,截面是圆角方形(超椭圆),再压扁成"宽厚的拱"
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 28; i++) {
    const a = (i / 28) * Math.PI;
    pts.push(new THREE.Vector3(Math.cos(a) * span, Math.sin(a) * rise + base, 0));
  }
  const path = new THREE.CatmullRomCurve3(pts);
  const archRaw = sweep(
    path,
    180,
    44,
    (t, th) => {
      const crown = Math.sin(t * Math.PI);
      const R = 95 + 55 * crown + 18 * Math.sin(t * 23) + 12 * Math.sin(t * 61 + 1);
      // 超椭圆:p=3.2 → 圆角方形
      const c = Math.abs(Math.cos(th));
      const s = Math.abs(Math.sin(th));
      const sq = Math.pow(Math.pow(c, 3.2) + Math.pow(s, 3.2), -1 / 3.2);
      return R * sq;
    },
    true,
  );
  xform(archRaw, S(1, 1, 1.4));
  const arch = displace(archRaw, 12, 0.012, 32, 4);
  paint(arch, (x, y, z, nx, ny, nz) => paintStone(x, y, z, nx, ny, nz));
  const archMesh = new THREE.Mesh(arch, stoneMat);
  archMesh.castShadow = true;
  group.add(archMesh);

  // ---- 两侧基座:巨大的风蚀岩堆
  for (const s of [-1, 1]) {
    const g = new THREE.IcosahedronGeometry(1, 5);
    xform(g, S(250, 330, 330));
    const d = displace(g, 30 + s, 0.011, 55, 5);
    xform(d, T(s * span, base * 0.4, 0));
    // 压平底部
    const p = d.getAttribute("position");
    for (let i = 0; i < p.count; i++) if (p.getY(i) < -20) p.setY(i, -20 + (p.getY(i) + 20) * 0.3);
    d.computeVertexNormals();
    paint(d, (x, y, z, nx, ny, nz) => paintStone(x, y, z, nx, ny, nz));
    const m = new THREE.Mesh(d, stoneMat);
    m.castShadow = true;
    group.add(m);
  }

  // ---- 水幕:拱洞里垂下来的瀑布,宽度刚好填满洞口
  const veil = makeWaterfall(span * 0.8, rise * 0.55);
  veil.position.set(0, 40, 0);
  group.add(veil);
  const veil2 = makeWaterfall(span * 0.5, rise * 0.5);
  veil2.position.set(0, 40, 22);
  group.add(veil2);

  // 水潭
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(span * 0.9, 64),
    new THREE.MeshStandardNodeMaterial({ color: 0x36a4c0, roughness: 0.08, transparent: true, opacity: 0.82, side: THREE.DoubleSide }),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.scale.set(1, 0.55, 1);
  pool.position.set(0, 1.5, 120);
  group.add(pool);

  // ---- 细节层:碎石 + 基座顶上的树
  const detail = new THREE.Group();
  const rockGeos = [0, 1, 2].map((v) => {
    const g = displace(new THREE.IcosahedronGeometry(1, 2), 700 + v * 11, 1.7, 0.3, 3);
    xform(g, S(1, 0.75, 1));
    return paint(g, rockPainter({ a: [0.8, 0.44, 0.29], b: [0.5, 0.26, 0.18], band: 4, seed: 40 + v }));
  });
  const lists: THREE.Matrix4[][] = [[], [], []];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < 160; i++) {
    const a = rand() * Math.PI * 2;
    const d = 330 + Math.pow(rand(), 0.8) * 1100;
    const r = 5 + Math.pow(rand(), 2.2) * 46;
    q.setFromEuler(new THREE.Euler(rand() * 6, rand() * 6, rand() * 6));
    m4.compose(new THREE.Vector3(Math.cos(a) * d, r * 0.2, Math.sin(a) * d * 0.62), q, new THREE.Vector3(r, r, r));
    lists[Math.floor(rand() * 3)].push(m4.clone());
  }
  lists.forEach((list, v) => {
    const im = new THREE.InstancedMesh(rockGeos[v], stoneMat, list.length);
    list.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.computeBoundingSphere();
    im.castShadow = true;
    detail.add(im);
  });
  const leafMat = vcMat({ roughness: 0.9 });
  const broad: THREE.Matrix4[] = [];
  const coni: THREE.Matrix4[] = [];
  const Yv = new THREE.Vector3(0, 1, 0);
  for (const s of [-1, 1]) {
    for (let k = 0; k < 26; k++) {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * 210;
      const sc = 2 + rand() * 2.4;
      q.setFromAxisAngle(Yv, rand() * 6.28);
      m4.compose(new THREE.Vector3(s * span + Math.cos(a) * d, base * 0.4 + 330 - d * d * 0.0035, Math.sin(a) * d * 1.3), q, new THREE.Vector3(sc, sc, sc));
      (rand() < 0.35 ? coni : broad).push(m4.clone());
    }
  }
  // 池边的树
  for (let k = 0; k < 40; k++) {
    const a = rand() * Math.PI * 2;
    const d = 520 + rand() * 520;
    const sc = 1.6 + rand() * 1.6;
    q.setFromAxisAngle(Yv, rand() * 6.28);
    m4.compose(new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d * 0.7 + 120), q, new THREE.Vector3(sc, sc, sc));
    broad.push(m4.clone());
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

  return {
    id: "arch",
    name: "天然拱门 / Great Arch",
    group,
    footprint: { inner: 900, outer: 1600 },
    view: { height: 420, back: 2500 },
    detail,
    detailDistance: 7000,
  };
}
