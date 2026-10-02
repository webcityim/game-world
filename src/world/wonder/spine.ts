import * as THREE from "three/webgpu";
import { displace, merge, paint, rngOf, sweep, S, RX, RY, T, xform, type RGB3 } from "../geo";
import { rockPainter, std, vcMat, type Wonder } from "./common";

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 龙脊:一具埋在大地里的远古巨兽骨架——肋骨、脊椎、折断的翼骨和头骨,眼窝里还燃着余烬。 */
export function createDragonSpine(): Wonder {
  const group = new THREE.Group();
  const rand = rngOf(4242);
  const bone = rockPainter({ a: [0.94, 0.9, 0.8], b: [0.7, 0.64, 0.52], band: 0.03, seed: 12, moss: [0.28, 0.4, 0.17], mossMin: 0.7 });
  const boneMat = vcMat({ roughness: 0.85 });
  const emberMat = std(0xff9a3c, { emissive: 0xff6a10, emissiveIntensity: 2.4, roughness: 0.6 });

  const paintBone = (g: THREE.BufferGeometry) =>
    paint(g, (x, y, z, nx, ny, nz) => {
      const c = bone(x, y, z, nx, ny, nz);
      // 靠近地面沾泥
      const dirt = 1 - smooth(0, 60, y);
      return [c[0] * (1 - dirt * 0.4) + 0.12 * dirt, c[1] * (1 - dirt * 0.45) + 0.08 * dirt, c[2] * (1 - dirt * 0.5) + 0.04 * dirt] as RGB3;
    });

  // ---- 肋骨:半圆弧 + 锥形截面 + 竹节状凸起(单位尺寸,实例化缩放)
  const arc: THREE.Vector3[] = [];
  for (let i = 0; i <= 14; i++) {
    const a = (i / 14) * Math.PI;
    arc.push(new THREE.Vector3(Math.cos(a), Math.sin(a) * 0.95, Math.sin(a * 2) * 0.05));
  }
  const ribGeo = (seed: number) => {
    const g = sweep(new THREE.CatmullRomCurve3(arc), 52, 12, (t, th) => (0.055 * (1 - Math.abs(t - 0.5) * 0.7) + 0.012 * Math.sin(t * 40 + seed)) * (1 + 0.1 * Math.cos(th * 2)), true);
    return displace(g, seed, 5, 0.01, 3);
  };
  const ribVariants = [1, 2, 3].map(ribGeo);

  const ribLists: THREE.Matrix4[][] = [[], [], []];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const N = 22;
  const spineY: number[] = [];
  for (let i = 0; i < N; i++) {
    const k = i / (N - 1);
    const z = -1500 + k * 3000;
    const r = 120 + Math.sin(k * Math.PI) * 360 * (1 - 0.5 * k);
    const y = Math.sin(k * 5) * 40;
    spineY.push(y + r * 0.92);
    // 左右肋骨有一点不对称、一部分折断倾倒
    const broken = rand() < 0.2;
    q.setFromEuler(new THREE.Euler(0, (rand() - 0.5) * 0.12, broken ? (rand() - 0.5) * 0.5 : 0));
    m4.compose(new THREE.Vector3(0, y, z), q, new THREE.Vector3(r, r * (broken ? 0.6 : 0.95), r));
    ribLists[i % 3].push(m4.clone());
  }
  ribLists.forEach((list, v) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(paintBone(ribVariants[v]), boneMat, list.length);
    list.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.computeBoundingSphere();
    im.castShadow = true;
    group.add(im);
  });

  // ---- 脊椎:每节是椭球 + 棘突 + 横突,沿脊线排列并逐渐缩小
  const vertebra = () => {
    const parts: THREE.BufferGeometry[] = [];
    const b = displace(new THREE.IcosahedronGeometry(1, 3), 33, 1.4, 0.12, 3);
    xform(b, S(72, 52, 92));
    parts.push(b);
    const spike = new THREE.ConeGeometry(18, 120, 6, 1);
    xform(spike, T(0, 100, 0));
    parts.push(spike);
    for (const s of [-1, 1]) {
      const t = new THREE.ConeGeometry(12, 90, 5, 1);
      t.rotateZ(-s * Math.PI / 2);
      xform(t, T(s * 85, 10, 0));
      parts.push(t);
    }
    return paintBone(merge(parts));
  };
  const vertGeo = vertebra();
  const vertMesh = new THREE.InstancedMesh(vertGeo, boneMat, N + 12);
  for (let i = 0; i < N; i++) {
    const k = i / (N - 1);
    const z = -1500 + k * 3000;
    const s = 0.8 + Math.sin(k * Math.PI) * 0.4;
    m4.compose(new THREE.Vector3(0, spineY[i] - 8, z), new THREE.Quaternion().setFromEuler(new THREE.Euler((rand() - 0.5) * 0.15, 0, (rand() - 0.5) * 0.1)), new THREE.Vector3(s, s, s));
    vertMesh.setMatrixAt(i, m4);
  }
  // 尾椎
  for (let i = 0; i < 12; i++) {
    const s = 0.7 * (1 - i / 14);
    m4.compose(new THREE.Vector3(Math.sin(i * 0.5) * 70, 40 + (spineY[0] - 80) * (1 - i / 12), -1500 - 110 - i * 130), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
    vertMesh.setMatrixAt(N + i, m4);
  }
  vertMesh.computeBoundingSphere();
  vertMesh.castShadow = true;
  group.add(vertMesh);

  // ---- 头骨
  const skull = new THREE.Group();
  skull.position.set(0, 90, 1900);
  const sk: THREE.BufferGeometry[] = [];
  // 颅骨
  const cran = displace(new THREE.IcosahedronGeometry(1, 4), 41, 1.1, 0.07, 4);
  xform(cran, S(270, 230, 360));
  xform(cran, T(0, 170, 0));
  sk.push(cran);
  // 吻部:渐收的方管
  const snout = sweep(
    new THREE.CatmullRomCurve3([new THREE.Vector3(0, 150, 150), new THREE.Vector3(0, 120, 480), new THREE.Vector3(0, 95, 800)]),
    28,
    20,
    (t, th) => {
      const c = Math.abs(Math.cos(th));
      const s = Math.abs(Math.sin(th));
      const sq = Math.pow(Math.pow(c, 3) + Math.pow(s, 3), -1 / 3);
      return (170 - 95 * t) * sq * (1 + 0.1 * Math.sin(t * 9));
    },
    true,
  );
  xform(snout, S(1, 0.62, 1));
  sk.push(displace(snout, 55, 0.03, 4, 3));
  // 下颌
  const jaw = sweep(
    new THREE.CatmullRomCurve3([new THREE.Vector3(0, 40, 80), new THREE.Vector3(0, 10, 440), new THREE.Vector3(0, 28, 780)]),
    28,
    14,
    (t) => 78 - 44 * t,
    true,
  );
  xform(jaw, S(1.3, 0.55, 1));
  sk.push(displace(jaw, 56, 0.03, 3, 3));
  // 眉骨
  for (const s of [-1, 1]) {
    const brow = new THREE.IcosahedronGeometry(1, 2);
    xform(brow, S(110, 40, 150));
    xform(brow, T(s * 150, 300, 150));
    sk.push(brow);
  }
  // 角:四根,向后弯曲
  const hornDefs: [number, number, number, number][] = [
    [160, 330, -60, 1],
    [-160, 330, -60, -1],
    [215, 250, -140, 1],
    [-215, 250, -140, -1],
  ];
  hornDefs.forEach(([x, y, z, s], i) => {
    const len = i < 2 ? 560 : 380;
    const g = sweep(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(x, y, z),
        new THREE.Vector3(x + s * len * 0.25, y + len * 0.38, z - len * 0.3),
        new THREE.Vector3(x + s * len * 0.5, y + len * 0.55, z - len * 0.85),
      ]),
      24,
      10,
      (t) => 46 * (1 - t) + 4,
      true,
    );
    sk.push(displace(g, 60 + i, 0.03, 3, 3));
  });
  const skullGeo = paintBone(merge(sk));
  const skullMesh = new THREE.Mesh(skullGeo, boneMat);
  skullMesh.castShadow = true;
  skull.add(skullMesh);
  // 牙齿:上下各一排
  const toothGeo = new THREE.ConeGeometry(1, 3.2, 6, 1);
  paintBone(toothGeo);
  const teeth = new THREE.InstancedMesh(toothGeo, boneMat, 36);
  for (let i = 0; i < 18; i++) {
    const z = 330 + i * 26;
    const s = 12 + (1 - Math.abs(i - 9) / 9) * 14 - i * 0.3;
    for (const side of [-1, 1]) {
      q.setFromEuler(new THREE.Euler(Math.PI, 0, 0));
      m4.compose(new THREE.Vector3(side * (92 - i * 1.7), 82 - i * 0.2, z), q, new THREE.Vector3(s * 0.7, s * 1.6, s * 0.7));
      teeth.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), m4);
    }
  }
  teeth.computeBoundingSphere();
  skull.add(teeth);
  // 眼窝里的余烬
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), emberMat);
    eye.scale.set(38, 44, 30);
    eye.position.set(s * 150, 205, 235);
    skull.add(eye);
  }
  group.add(skull);

  // ---- 折断的翼骨:一根粗长的臂骨 + 指骨,斜插在地里
  const wing: THREE.BufferGeometry[] = [];
  const arm = sweep(
    new THREE.CatmullRomCurve3([new THREE.Vector3(330, 90, 300), new THREE.Vector3(720, 420, 420), new THREE.Vector3(1150, 560, 760), new THREE.Vector3(1550, 360, 1010)]),
    52,
    14,
    (t) => 30 * (1 - t * 0.8) + 6 + 5 * Math.sin(t * 28),
    true,
  );
  wing.push(displace(arm, 80, 0.03, 3, 3));
  for (let i = 0; i < 4; i++) {
    const t0 = 0.55 + i * 0.1;
    const base = new THREE.CatmullRomCurve3([new THREE.Vector3(330, 90, 300), new THREE.Vector3(720, 420, 420), new THREE.Vector3(1150, 560, 760), new THREE.Vector3(1550, 360, 1010)]).getPointAt(t0);
    const l = 520 - i * 70;
    const g = sweep(
      new THREE.CatmullRomCurve3([base, base.clone().add(new THREE.Vector3(l * 0.3, -l * 0.35, -l * 0.35 + i * 70)), base.clone().add(new THREE.Vector3(l * 0.55, -l * 0.95, -l * 0.5 + i * 90))]),
      18,
      8,
      (t) => 13 * (1 - t) + 2.5,
      true,
    );
    wing.push(g);
  }
  const wingMesh = new THREE.Mesh(paintBone(merge(wing)), boneMat);
  wingMesh.castShadow = true;
  group.add(wingMesh);

  // ---- 土丘:骨架像是半埋着的
  const ground = displace(new THREE.IcosahedronGeometry(1, 4), 91, 1.2, 0.1, 3);
  xform(ground, S(560, 70, 1900));
  xform(ground, T(0, -42, 0));
  paint(ground, (x, y, z, _nx, ny) => {
    const g = 0.5 + 0.5 * ny;
    return [0.2 + 0.1 * (1 - g), 0.34 + 0.12 * g, 0.12 + 0.04 * g];
  });
  group.add(new THREE.Mesh(ground, vcMat()));
  void RX;
  void RY;

  // ---- 细节层:散落的碎骨
  const detail = new THREE.Group();
  const shard = displace(new THREE.IcosahedronGeometry(1, 2), 17, 1.6, 0.3, 3);
  paintBone(shard);
  const shards = new THREE.InstancedMesh(shard, boneMat, 90);
  for (let i = 0; i < 90; i++) {
    const a = rand() * Math.PI * 2;
    const d = 280 + rand() * 650;
    const r = 5 + Math.pow(rand(), 2) * 24;
    q.setFromEuler(new THREE.Euler(rand() * 6, rand() * 6, rand() * 6));
    m4.compose(new THREE.Vector3(Math.cos(a) * d * 0.7, r * 0.2, -200 + Math.sin(a) * d * 1.5), q, new THREE.Vector3(r * 1.6, r * 0.6, r));
    shards.setMatrixAt(i, m4);
  }
  shards.computeBoundingSphere();
  detail.add(shards);
  group.add(detail);

  group.scale.setScalar(0.5);

  return {
    id: "spine",
    name: "龙脊 / Dragon Spine",
    group,
    footprint: { inner: 650, outer: 1300 },
    view: { height: 380, back: 1900 },
    detail,
    detailDistance: 5000,
    update: (t) => {
      emberMat.emissiveIntensity = 2.2 + Math.sin(t * 2.1) * 0.7 + Math.sin(t * 5.3) * 0.25;
    },
  };
}
