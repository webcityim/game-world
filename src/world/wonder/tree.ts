import * as THREE from "three/webgpu";
import { createNoise3 } from "../noise";
import { displace, fbm3, merge, paint, rngOf, sweep, T, xform, type RGB3 } from "../geo";
import { std, vcMat, type Wonder } from "./common";

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 世界树:树干有树皮纹理和板根,根系入地,粗枝撑起上千米宽的冠层,枝头挂着发光的果实。 */
export function createWorldTree(): Wonder {
  const group = new THREE.Group();
  const bark = createNoise3(31);
  const barkPaint = (x: number, y: number, z: number): RGB3 => {
    const n = fbm3(bark, x * 0.03, y * 0.012, z * 0.03, 4);
    const crack = Math.pow(Math.abs(Math.sin(Math.atan2(z, x) * 14 + n * 6)), 0.6);
    const base: RGB3 = [0.3 + 0.1 * n, 0.19 + 0.06 * n, 0.12 + 0.04 * n];
    const k = 0.55 + 0.45 * crack;
    // 靠近地面长苔藓
    const moss = 1 - smooth(0, 360, y + n * 120);
    return [base[0] * k * (1 - moss * 0.5) + 0.05 * moss, base[1] * k + 0.17 * moss, base[2] * k * (1 - moss * 0.4)];
  };

  // ---- 树干:带板根和竖向树皮脊的扫掠体
  const trunkCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -40, 0), new THREE.Vector3(14, 900, -10), new THREE.Vector3(-10, 1700, 14), new THREE.Vector3(0, 2500, 0)]);
  const trunkGeo = sweep(
    trunkCurve,
    110,
    72,
    (t, th) => {
      const y = t * 2540;
      const base = 105 + 120 * Math.exp(-y / 520) + 28 * smooth(0.82, 1, t);
      const butt = 1 + 0.55 * Math.exp(-y / 330) * Math.pow(0.5 + 0.5 * Math.cos(th * 7), 1.6);
      const ridge = 1 + 0.045 * Math.sin(th * 13 + y * 0.006) + 0.03 * Math.sin(th * 29 - y * 0.011);
      return base * butt * ridge;
    },
    true,
  );
  const trunk = displace(trunkGeo, 5, 0.018, 6, 3);
  paint(trunk, (x, y, z) => barkPaint(x, y, z));
  group.add(new THREE.Mesh(trunk, vcMat({ roughness: 1 })));

  // ---- 根系:9 条粗根贴地蜿蜒,末端钻进土里
  const rand = rngOf(9);
  const roots: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rand() * 0.4;
    const len = 520 + rand() * 520;
    const pts = [0, 0.25, 0.55, 1].map((k, j) => {
      const r = 120 + len * k;
      const wob = (rand() - 0.5) * 80 * k;
      return new THREE.Vector3(Math.cos(a) * r - Math.sin(a) * wob, j === 0 ? 150 : 70 * (1 - k) + 18 - 90 * k * k, Math.sin(a) * r + Math.cos(a) * wob);
    });
    const g = sweep(new THREE.CatmullRomCurve3(pts), 36, 14, (t) => 78 * Math.pow(1 - t, 0.9) + 9, true);
    roots.push(paint(displace(g, 40 + i, 0.03, 5, 3), (x, y, z) => barkPaint(x, y + 150, z)));
  }
  group.add(new THREE.Mesh(merge(roots), vcMat({ roughness: 1 })));

  // ---- 粗枝:从树冠底部向四周伸展并上翘
  const branchEnds: THREE.Vector3[] = [];
  const branches: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rand() * 0.5;
    const reach = 780 + rand() * 520;
    const h0 = 2050 + rand() * 350;
    const pts = [
      new THREE.Vector3(0, h0 - 60, 0),
      new THREE.Vector3(Math.cos(a) * reach * 0.3, h0 + 100, Math.sin(a) * reach * 0.3),
      new THREE.Vector3(Math.cos(a) * reach * 0.65, h0 + 280 + rand() * 120, Math.sin(a) * reach * 0.65),
      new THREE.Vector3(Math.cos(a) * reach, h0 + 480 + rand() * 260, Math.sin(a) * reach),
    ];
    branchEnds.push(pts[3].clone());
    const g = sweep(new THREE.CatmullRomCurve3(pts), 40, 16, (t) => 62 * Math.pow(1 - t, 0.8) + 8, true);
    branches.push(paint(displace(g, 70 + i, 0.03, 4, 3), (x, y, z) => barkPaint(x, y - 1300, z)));
    // 次级枝
    for (let k = 0; k < 3; k++) {
      const s = 0.45 + k * 0.17;
      const base = new THREE.CatmullRomCurve3(pts).getPointAt(s);
      const a2 = a + (rand() - 0.5) * 1.4;
      const l2 = 240 + rand() * 260;
      const p2 = [
        base,
        base.clone().add(new THREE.Vector3(Math.cos(a2) * l2 * 0.4, 70, Math.sin(a2) * l2 * 0.4)),
        base.clone().add(new THREE.Vector3(Math.cos(a2) * l2, 190 + rand() * 120, Math.sin(a2) * l2)),
      ];
      branchEnds.push(p2[2].clone());
      const g2 = sweep(new THREE.CatmullRomCurve3(p2), 20, 10, (t) => 24 * (1 - t) + 4, true);
      branches.push(paint(g2, (x, y, z) => barkPaint(x, y - 1300, z)));
    }
  }
  group.add(new THREE.Mesh(merge(branches), vcMat({ roughness: 1 })));

  // ---- 冠层:大团树叶(中模),按枝头分布,多个位移变体
  const leafVariants = [0, 1, 2].map((v) =>
    paint(displace(new THREE.IcosahedronGeometry(1, 3), 100 + v * 13, 1.7, 0.28, 4), (x, y, z, _nx, ny) => {
      const lit = 0.5 + 0.5 * ny;
      const tip = smooth(0.2, 1, y);
      return [0.1 + 0.18 * tip * lit + 0.04, 0.3 + 0.28 * lit + 0.1 * tip, 0.07 + 0.06 * lit] as RGB3;
    }),
  );
  const leafMat = vcMat({ roughness: 0.85, emissive: 0x0e4a1c, emissiveIntensity: 0.35 });
  const canopy = new THREE.Group();
  const perVariant: THREE.Matrix4[][] = [[], [], []];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pushBlob = (p: THREE.Vector3, r: number) => {
    q.setFromEuler(new THREE.Euler(rand() * 6, rand() * 6, rand() * 6));
    m4.compose(p, q, new THREE.Vector3(r * (0.9 + rand() * 0.3), r * (0.7 + rand() * 0.25), r * (0.9 + rand() * 0.3)));
    perVariant[Math.floor(rand() * 3)].push(m4.clone());
  };
  for (const e of branchEnds) {
    const n = 3 + Math.floor(rand() * 2);
    for (let k = 0; k < n; k++) {
      pushBlob(e.clone().add(new THREE.Vector3((rand() - 0.5) * 420, (rand() - 0.2) * 300, (rand() - 0.5) * 420)), 260 + rand() * 240);
    }
  }
  for (let k = 0; k < 14; k++) {
    const a = rand() * Math.PI * 2;
    pushBlob(new THREE.Vector3(Math.cos(a) * rand() * 500, 2900 + rand() * 520, Math.sin(a) * rand() * 500), 360 + rand() * 260);
  }
  perVariant.forEach((list, v) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(leafVariants[v], leafMat, list.length);
    list.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.computeBoundingSphere();
    canopy.add(im);
  });
  group.add(canopy);

  // ---- 细节层:小叶丛、垂挂的藤蔓、发光果实
  const detail = new THREE.Group();
  const smallLeaf = paint(displace(new THREE.IcosahedronGeometry(1, 2), 200, 2.2, 0.3, 3), (_x, y) => [0.14 + 0.15 * smooth(-1, 1, y), 0.4 + 0.2 * smooth(-1, 1, y), 0.09]);
  const clumps: THREE.Matrix4[] = [];
  for (const e of branchEnds) {
    for (let k = 0; k < 14; k++) {
      const a = rand() * Math.PI * 2;
      const d = 180 + rand() * 520;
      const r = 36 + rand() * 60;
      q.setFromEuler(new THREE.Euler(rand() * 6, rand() * 6, 0));
      m4.compose(new THREE.Vector3(e.x + Math.cos(a) * d, e.y + (rand() - 0.35) * 300, e.z + Math.sin(a) * d), q, new THREE.Vector3(r, r * 0.8, r));
      clumps.push(m4.clone());
    }
  }
  const clumpMesh = new THREE.InstancedMesh(smallLeaf, leafMat, clumps.length);
  clumps.forEach((mm, i) => clumpMesh.setMatrixAt(i, mm));
  clumpMesh.computeBoundingSphere();
  detail.add(clumpMesh);

  const vines: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 38; i++) {
    const e = branchEnds[Math.floor(rand() * branchEnds.length)];
    const top = e.clone().add(new THREE.Vector3((rand() - 0.5) * 360, -20, (rand() - 0.5) * 360));
    const len = 160 + rand() * 520;
    const pts = [top, top.clone().add(new THREE.Vector3((rand() - 0.5) * 30, -len * 0.4, (rand() - 0.5) * 30)), top.clone().add(new THREE.Vector3((rand() - 0.5) * 50, -len, (rand() - 0.5) * 50))];
    vines.push(paint(sweep(new THREE.CatmullRomCurve3(pts), 14, 5, (t) => 3.2 * (1 - t * 0.7), true), [0.18, 0.34, 0.12]));
  }
  detail.add(new THREE.Mesh(merge(vines), vcMat({ roughness: 0.9 })));

  const fruitMat = std(0xffd45c, { emissive: 0xffb92e, emissiveIntensity: 2.4 });
  const fruit = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), fruitMat, 120);
  for (let i = 0; i < 120; i++) {
    const e = branchEnds[Math.floor(rand() * branchEnds.length)];
    const r = 11 + rand() * 12;
    m4.compose(new THREE.Vector3(e.x + (rand() - 0.5) * 520, e.y - 60 - rand() * 340, e.z + (rand() - 0.5) * 520), new THREE.Quaternion(), new THREE.Vector3(r, r * 1.25, r));
    fruit.setMatrixAt(i, m4);
  }
  fruit.computeBoundingSphere();
  detail.add(fruit);
  group.add(detail);

  // 地面:根部苔藓土丘
  const mound = paint(displace(new THREE.IcosahedronGeometry(1, 4), 300, 0.9, 0.12, 3), (_x, y) => [0.14 + 0.05 * y, 0.3 + 0.08 * y, 0.1]);
  xform(mound, new THREE.Matrix4().makeScale(900, 130, 900));
  xform(mound, T(0, -70, 0));
  group.add(new THREE.Mesh(mound, vcMat()));

  return {
    id: "tree",
    name: "世界树 / World Tree",
    group,
    footprint: { inner: 520, outer: 1100 },
    view: { height: 1300, back: 4200 },
    detail,
    detailDistance: 9000,
    update: (t) => {
      fruitMat.emissiveIntensity = 2.1 + Math.sin(t * 1.4) * 0.5;
    },
  };
}
