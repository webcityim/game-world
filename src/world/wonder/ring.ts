import * as THREE from "three/webgpu";
import { displace, merge, paint, rngOf, sweep, T, xform } from "../geo";
import { makePortal, std, vcMat, type Wonder } from "./common";

/** 天环:悬在空中的金色巨环,环身刻着符文,圆盘里是旋涡传送门;底下是台阶、立柱和方尖碑组成的祭坛。 */
export function createSkyRing(): Wonder {
  const group = new THREE.Group();
  const rand = rngOf(808);
  const goldMat = vcMat({ metalness: 0.85, roughness: 0.3, emissive: 0x6a4208, emissiveIntensity: 0.25 });
  const stoneMat = vcMat({ roughness: 0.85 });
  const runeMat = std(0x7fe9ff, { emissive: 0x39c9ff, emissiveIntensity: 2.2, roughness: 0.3 });

  const RR = 1400;
  const ringRoot = new THREE.Group();
  ringRoot.position.y = 1750;
  group.add(ringRoot);

  // ---- 环身:圆角方形截面的扫掠体,每 1/48 弧段有一道刻槽,内外侧有凸起的饰带
  const circle: THREE.Vector3[] = [];
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    circle.push(new THREE.Vector3(Math.cos(a) * RR, Math.sin(a) * RR, 0));
  }
  const closed = new THREE.CatmullRomCurve3(circle, true);
  const ringGeo = sweep(
    closed,
    384,
    28,
    (t, th) => {
      const c = Math.abs(Math.cos(th));
      const s = Math.abs(Math.sin(th));
      const sq = Math.pow(Math.pow(c, 5) + Math.pow(s, 5), -1 / 5);
      const seg = (t * 48) % 1;
      const groove = 1 - 0.1 * Math.exp(-Math.pow((seg - 0.5) / 0.018, 2)) - 0.06 * Math.exp(-Math.pow(seg / 0.03, 2));
      const band = 1 + 0.12 * Math.exp(-Math.pow((seg - 0.5) / 0.22, 2));
      return 70 * sq * groove * band;
    },
    false,
  );
  paint(ringGeo, (x, y, z, nx, ny, nz) => {
    const edge = 0.82 + 0.18 * Math.abs(nz);
    const wear = 0.9 + 0.1 * Math.sin(x * 0.03 + y * 0.05);
    return [0.95 * edge * wear, 0.74 * edge * wear, 0.3 * edge * wear];
  });
  const ringMesh = new THREE.Mesh(ringGeo, goldMat);
  ringMesh.castShadow = true;
  ringRoot.add(ringMesh);

  // 符文:环内侧发光的小方块
  const runes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), runeMat, 192);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < 192; i++) {
    const a = (i / 192) * Math.PI * 2;
    const r = RR - 66;
    q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);
    const h = i % 4 === 0 ? 30 : i % 2 === 0 ? 18 : 10;
    m4.compose(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0), q, new THREE.Vector3(h, 6, 24));
    runes.setMatrixAt(i, m4);
  }
  runes.computeBoundingSphere();
  ringRoot.add(runes);

  // 内圈细环(转得更快)
  const inner = new THREE.Mesh(
    new THREE.TorusGeometry(RR - 150, 12, 10, 160),
    std(0x9ff0ff, { emissive: 0x39c9ff, emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.3 }),
  );
  ringRoot.add(inner);

  const portal = makePortal(RR - 80);
  ringRoot.add(portal);

  // ---- 祭坛:台阶 + 立柱 + 方尖碑
  const stone: [number, number, number] = [0.62, 0.6, 0.55];
  const gold: [number, number, number] = [0.9, 0.7, 0.28];
  const parts: THREE.BufferGeometry[] = [];
  const goldParts: THREE.BufferGeometry[] = [];
  const box = (list: THREE.BufferGeometry[], w: number, h: number, d: number, x: number, y: number, z: number, c: [number, number, number]) => {
    const g = new THREE.BoxGeometry(w, h, d);
    xform(g, T(x, y, z));
    paint(g, (_x, py, _z, _nx, ny) => [c[0] * (0.88 + 0.12 * ny), c[1] * (0.88 + 0.12 * ny), c[2] * (0.88 + 0.12 * ny)]);
    list.push(g);
  };
  // 三层台基,每层带台阶
  box(parts, 1100, 70, 360, 0, 35, 0, stone);
  box(parts, 900, 60, 300, 0, 100, 0, stone);
  box(parts, 700, 50, 240, 0, 155, 0, stone);
  for (let s = 0; s < 9; s++) box(parts, 420 - s * 6, 9, 44, 0, 4.5 + s * 9, 200 + (9 - s) * 22, stone); // 正面大台阶
  box(goldParts, 720, 6, 250, 0, 183, 0, gold);
  // 两侧立柱(带凹槽 + 金色柱头)
  for (const s of [-1, 1]) {
    const col = new THREE.CylinderGeometry(42, 52, 340, 20, 6);
    xform(col, T(s * 330, 350, 0));
    paint(col, (x, y, z) => {
      const flute = 0.86 + 0.14 * Math.abs(Math.sin(Math.atan2(z, x - s * 330) * 10));
      return [stone[0] * flute, stone[1] * flute, stone[2] * flute];
    });
    parts.push(col);
    box(goldParts, 130, 24, 130, s * 330, 532, 0, gold);
    box(goldParts, 120, 20, 120, s * 330, 183 + 10, 0, gold);
    const cap = new THREE.ConeGeometry(36, 80, 4);
    cap.rotateY(Math.PI / 4);
    xform(cap, T(s * 330, 584, 0));
    paint(cap, gold);
    goldParts.push(cap);
  }
  // 周围的方尖碑
  const tipMat = std(0x9ff0ff, { emissive: 0x39c9ff, emissiveIntensity: 2.0 });
  const tips: THREE.Matrix4[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    const d = 700 + rand() * 120;
    const h = 90 + rand() * 120;
    const ob = new THREE.CylinderGeometry(9, 20, h, 4, 1);
    ob.rotateY(Math.PI / 4);
    xform(ob, T(Math.cos(a) * d, h / 2, Math.sin(a) * d * 0.6));
    paint(ob, stone);
    parts.push(ob);
    m4.compose(new THREE.Vector3(Math.cos(a) * d, h + 8, Math.sin(a) * d * 0.6), new THREE.Quaternion(), new THREE.Vector3(14, 22, 14));
    tips.push(m4.clone());
  }
  group.add(new THREE.Mesh(merge(parts), stoneMat));
  group.add(new THREE.Mesh(merge(goldParts), goldMat));
  const tipMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), tipMat, tips.length);
  tips.forEach((mm, i) => tipMesh.setMatrixAt(i, mm));
  tipMesh.computeBoundingSphere();
  group.add(tipMesh);

  // ---- 细节层:地面碎石 + 台基边的小灯柱
  const detail = new THREE.Group();
  const rockGeo = displace(new THREE.IcosahedronGeometry(1, 2), 14, 1.6, 0.3, 3);
  paint(rockGeo, [0.5, 0.48, 0.44]);
  const rocks = new THREE.InstancedMesh(rockGeo, stoneMat, 80);
  for (let i = 0; i < 80; i++) {
    const a = rand() * Math.PI * 2;
    const d = 560 + rand() * 600;
    const r = 4 + Math.pow(rand(), 2) * 26;
    q.setFromEuler(new THREE.Euler(rand() * 6, rand() * 6, 0));
    m4.compose(new THREE.Vector3(Math.cos(a) * d, r * 0.2, Math.sin(a) * d * 0.7), q, new THREE.Vector3(r, r * 0.7, r));
    rocks.setMatrixAt(i, m4);
  }
  rocks.computeBoundingSphere();
  detail.add(rocks);
  const lamps = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), runeMat, 22);
  for (let i = 0; i < 22; i++) {
    const x = -500 + (i % 11) * 100;
    const z = i < 11 ? 190 : -190;
    m4.compose(new THREE.Vector3(x, 205, z), new THREE.Quaternion(), new THREE.Vector3(7, 7, 7));
    lamps.setMatrixAt(i, m4);
  }
  lamps.computeBoundingSphere();
  detail.add(lamps);
  group.add(detail);

  return {
    id: "ring",
    name: "天环 / Sky Ring",
    group,
    footprint: { inner: 720, outer: 1300 },
    view: { height: 900, back: 3600 },
    detail,
    detailDistance: 6000,
    update: (t) => {
      ringRoot.rotation.y = t * 0.05;
      inner.rotation.z = t * 0.35;
      runeMat.emissiveIntensity = 2 + Math.sin(t * 1.7) * 0.6;
    },
  };
}
