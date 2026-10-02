import * as THREE from "three/webgpu";
import { createNoise3 } from "../noise";
import { displace, fbm3, merge, paint, rngOf, ridged3, weld, T, xform, type RGB3 } from "../geo";
import { broadleaf, conifer } from "../vegetation";
import { makeWaterfall, rockPainter, std, vcMat, type Wonder } from "./common";

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 浮空岛:起伏的草地岛面 + 倒锥形的嶙峋岩底,岛上有神殿、湖、树,边缘垂下瀑布,周围漂着碎岩。 */
export function createFloatingIsle(): Wonder {
  const group = new THREE.Group();
  const isle = new THREE.Group();
  const H = 2300;
  isle.position.y = H;
  group.add(isle);

  const R = 920;
  const DEPTH = 1750;
  const noise = createNoise3(555);
  const rand = rngOf(21);

  // ---- 岛体:一张极坐标参数面,先走岛面(v<0.4),再沿岩底收到尖端
  const NU = 176;
  const NV = 150;
  const pos = new Float32Array(NU * (NV + 1) * 3);
  const idx: number[] = [];
  const split = 0.4;
  const surfaceH = (r: number, th: number) => {
    const x = Math.cos(th) * r;
    const z = Math.sin(th) * r;
    const hill = fbm3(noise, x * 0.0035, 3.3, z * 0.0035, 4) * 55;
    const lake = Math.exp(-(((x - 160) / 230) ** 2 + ((z + 120) / 190) ** 2)) * 38; // 湖盆
    const edge = smooth(0.82, 1, r / R) * 26; // 边缘微微隆起
    return 24 + hill - lake + edge;
  };
  for (let j = 0; j <= NV; j++) {
    const v = j / NV;
    for (let i = 0; i < NU; i++) {
      const th = (i / NU) * Math.PI * 2;
      let r: number;
      let y: number;
      if (v <= split) {
        r = R * (v / split);
        y = surfaceH(r, th);
      } else {
        const s = (v - split) / (1 - split);
        // 岩底:越往下越窄,外凸后收尖
        r = R * Math.pow(1 - s, 0.85) * (1 + 0.1 * Math.sin(s * 9));
        const jag = ridged3(noise, Math.cos(th) * 1.4 + s * 3, Math.sin(th) * 1.4, s * 2.6, 4);
        r *= 0.82 + 0.34 * jag;
        y = surfaceH(R, th) * 0.6 - DEPTH * Math.pow(s, 1.18) - 50 * Math.sin(s * Math.PI) * jag;
        // 悬挂的钟乳石状岩柱
        y -= 150 * Math.pow(jag, 3) * Math.sin(s * Math.PI) * (1 - s);
      }
      const k = (j * NU + i) * 3;
      pos[k] = Math.cos(th) * r;
      pos[k + 1] = y;
      pos[k + 2] = Math.sin(th) * r;
    }
  }
  for (let j = 0; j < NV; j++) {
    for (let i = 0; i < NU; i++) {
      const a = j * NU + i;
      const b = j * NU + ((i + 1) % NU);
      const c = (j + 1) * NU + i;
      const d = (j + 1) * NU + ((i + 1) % NU);
      idx.push(a, c, b, b, c, d);
    }
  }
  let body: THREE.BufferGeometry = new THREE.BufferGeometry();
  body.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  body.setIndex(idx);
  body = weld(body, 0.05);
  body = displace(body, 8, 0.012, 22, 4, (x, y, z, d) => (y < 5 ? d * 1.4 : d * 0.15));
  const paintUnder = rockPainter({ a: [0.58, 0.5, 0.4], b: [0.32, 0.27, 0.22], band: 0.05, seed: 91, moss: [0.2, 0.42, 0.16], mossMin: 0.88 });
  paint(body, (x, y, z, nx, ny, nz) => {
    const rock = paintUnder(x, y, z, nx, ny, nz);
    // 岛面:草地(带有点点花色),靠边缘渐变成岩石
    const rr = Math.hypot(x, z) / R;
    const top = smooth(-10, 14, y) * smooth(0.45, 0.85, ny);
    const n = fbm3(noise, x * 0.01, 1.1, z * 0.01, 3);
    const grass: RGB3 = [0.2 + 0.06 * n, 0.46 + 0.1 * n, 0.15 + 0.03 * n];
    const edge = smooth(0.88, 1.0, rr);
    const k = top * (1 - edge * 0.8);
    return [rock[0] * (1 - k) + grass[0] * k, rock[1] * (1 - k) + grass[1] * k, rock[2] * (1 - k) + grass[2] * k];
  });
  const bodyMesh = new THREE.Mesh(body, vcMat({ roughness: 0.97 }));
  bodyMesh.castShadow = true;
  isle.add(bodyMesh);

  // 湖面
  const lake = new THREE.Mesh(
    new THREE.CircleGeometry(250, 48),
    new THREE.MeshStandardNodeMaterial({ color: 0x3aa6c8, roughness: 0.06, transparent: true, opacity: 0.85 }),
  );
  lake.rotation.x = -Math.PI / 2;
  lake.position.set(160, 24 - 38 + 36, -120);
  isle.add(lake);

  // ---- 神殿:台基 + 柱廊 + 屋顶(合并成一个几何)
  const stone: RGB3 = [0.86, 0.84, 0.78];
  const trim: RGB3 = [0.78, 0.66, 0.34];
  const parts: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: RGB3) => {
    const g = new THREE.BoxGeometry(w, h, d);
    xform(g, T(x, y, z));
    paint(g, (_x, py, _z, _nx, ny) => [c[0] * (0.9 + 0.1 * ny), c[1] * (0.9 + 0.1 * ny), c[2] * (0.9 + 0.1 * ny)]);
    parts.push(g);
  };
  const cx = -300;
  const cz = 90;
  const gy = surfaceH(Math.hypot(cx, cz), Math.atan2(cz, cx)) - 2;
  for (let s = 0; s < 5; s++) box(150 - s * 12, 3.2, 100 - s * 10, cx, gy + s * 3.2 + 1.6, cz, stone); // 台阶
  const fy = gy + 16;
  box(120, 4, 78, cx, fy + 2, cz, stone);
  for (let i = 0; i < 6; i++) {
    for (const side of [-1, 1]) {
      const col = new THREE.CylinderGeometry(3.2, 3.8, 34, 14, 1);
      xform(col, T(cx - 50 + i * 20, fy + 4 + 17, cz + side * 31));
      paint(col, stone);
      parts.push(col);
      box(9, 3, 9, cx - 50 + i * 20, fy + 4 + 35.5, cz + side * 31, trim);
    }
  }
  box(128, 5, 84, cx, fy + 4 + 38.5, cz, stone);
  const roof = new THREE.ConeGeometry(78, 26, 4, 1);
  roof.rotateY(Math.PI / 4);
  xform(roof, T(cx, fy + 4 + 41 + 13, cz));
  paint(roof, [0.22, 0.42, 0.62]);
  parts.push(roof);
  const orb = new THREE.IcosahedronGeometry(5, 2);
  xform(orb, T(cx, fy + 4 + 41 + 30, cz));
  paint(orb, trim);
  parts.push(orb);
  // 残垣
  for (let k = 0; k < 14; k++) {
    const a = rand() * 6.28;
    const d = 160 + rand() * 180;
    box(10 + rand() * 12, 8 + rand() * 24, 10 + rand() * 12, cx + Math.cos(a) * d, gy + 6, cz + Math.sin(a) * d, [0.7, 0.68, 0.62]);
  }
  isle.add(new THREE.Mesh(merge(parts), vcMat({ roughness: 0.85 })));

  // ---- 细节层:岛上的树 + 垂下的发光晶簇
  const detail = new THREE.Group();
  const leafMat = vcMat({ roughness: 0.9 });
  const broad: THREE.Matrix4[] = [];
  const coni: THREE.Matrix4[] = [];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const Y = new THREE.Vector3(0, 1, 0);
  for (let k = 0; k < 220; k++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * R * 0.88;
    if (Math.hypot(Math.cos(a) * d - 160, Math.sin(a) * d + 120) < 270) continue; // 湖里不长树
    if (Math.hypot(Math.cos(a) * d - cx, Math.sin(a) * d - cz) < 130) continue; // 神殿里不长树
    const s = 2.6 + rand() * 2.8;
    q.setFromAxisAngle(Y, rand() * 6.28);
    const y = surfaceH(d, a) - 1;
    m4.compose(new THREE.Vector3(Math.cos(a) * d, y, Math.sin(a) * d), q, new THREE.Vector3(s, s * (0.9 + rand() * 0.3), s));
    (rand() < 0.4 ? coni : broad).push(m4.clone());
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
  const crystalMat = std(0x9be8ff, { emissive: 0x3fc4ff, emissiveIntensity: 1.6, roughness: 0.15, transparent: true, opacity: 0.9 });
  const crystalGeo = new THREE.ConeGeometry(1, 3, 6, 1);
  const crystals = new THREE.InstancedMesh(crystalGeo, crystalMat, 46);
  for (let k = 0; k < 46; k++) {
    const a = rand() * Math.PI * 2;
    const s = 0.2 + rand() * 0.75;
    const rr = R * (0.2 + 0.55 * (1 - s) * rand());
    const y = -DEPTH * (0.12 + 0.55 * rand());
    q.setFromEuler(new THREE.Euler(Math.PI + (rand() - 0.5) * 0.6, rand() * 6, (rand() - 0.5) * 0.6));
    const sc = 10 + rand() * 28;
    // 贴在岩底表面附近
    const f = 1 - (-y / DEPTH) * 0.92;
    m4.compose(new THREE.Vector3(Math.cos(a) * rr * f, y, Math.sin(a) * rr * f), q, new THREE.Vector3(sc, sc, sc));
    crystals.setMatrixAt(k, m4);
  }
  crystals.computeBoundingSphere();
  detail.add(crystals);
  isle.add(detail);

  // ---- 漂浮的碎岩(绕岛缓慢旋转)
  const debris = new THREE.Group();
  const debrisGeo = displace(new THREE.IcosahedronGeometry(1, 3), 61, 1.5, 0.35, 4);
  paint(debrisGeo, rockPainter({ a: [0.58, 0.5, 0.4], b: [0.32, 0.27, 0.22], band: 3, seed: 5, moss: [0.2, 0.42, 0.16], mossMin: 0.7 }));
  const debrisMesh = new THREE.InstancedMesh(debrisGeo, vcMat({ roughness: 1 }), 22);
  for (let k = 0; k < 22; k++) {
    const a = rand() * Math.PI * 2;
    const d = R * (1.15 + rand() * 0.9);
    const s = 14 + Math.pow(rand(), 2) * 60;
    q.setFromEuler(new THREE.Euler(rand() * 6, rand() * 6, rand() * 6));
    m4.compose(new THREE.Vector3(Math.cos(a) * d, (rand() - 0.55) * 700, Math.sin(a) * d), q, new THREE.Vector3(s, s * 0.7, s));
    debrisMesh.setMatrixAt(k, m4);
  }
  debrisMesh.computeBoundingSphere();
  debris.add(debrisMesh);
  isle.add(debris);

  // ---- 瀑布:从岛边缘一直垂到地面
  // 瀑布挂在岛上(随岛轻微起伏),底端伸到地面以下,所以起伏时不会露出缝
  const fall = makeWaterfall(110, H + 80);
  fall.position.set(R * 0.93, -H - 30, 0);
  fall.rotation.y = Math.PI / 2;
  isle.add(fall);
  const mist = new THREE.Mesh(
    new THREE.CircleGeometry(190, 40),
    new THREE.MeshStandardNodeMaterial({ color: 0xcfeeff, transparent: true, opacity: 0.35, roughness: 1, depthWrite: false, side: THREE.DoubleSide }),
  );
  mist.rotation.x = -Math.PI / 2;
  mist.position.set(R * 0.93 + 40, 2, 0);
  group.add(mist);
  const pond = new THREE.Mesh(
    new THREE.CircleGeometry(150, 40),
    new THREE.MeshStandardNodeMaterial({ color: 0x3a9fb8, roughness: 0.08, transparent: true, opacity: 0.88 }),
  );
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(R * 0.93 + 40, 1.4, 0);
  group.add(pond);

  return {
    id: "isle",
    name: "浮空岛 / Floating Isle",
    group,
    footprint: { inner: 200, outer: 520 },
    view: { height: 1800, back: 3600 },
    detail,
    detailDistance: 8000,
    update: (t) => {
      isle.position.y = H + Math.sin(t * 0.4) * 22;
      debris.rotation.y = t * 0.03;
    },
  };
}
