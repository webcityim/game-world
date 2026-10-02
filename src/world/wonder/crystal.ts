import * as THREE from "three/webgpu";
import { color, float, mix, normalView, positionView, pow, sin, time, abs, dot, normalize } from "three/tsl";
import { displace, merge, paint, rngOf, S, T, xform } from "../geo";
import { rockPainter, std, vcMat, type Wonder } from "./common";

/** 一根六棱水晶:棱柱 + 尖顶,平直的刻面法线(toNonIndexed 之后重算)。底边在 y=0,总高 1,半径 1。 */
function crystalGeometry(twist: number, tipRatio: number): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.86, 1, 1 - tipRatio, 6, 1, true);
  xform(body, T(0, (1 - tipRatio) / 2, 0));
  const tip = new THREE.ConeGeometry(0.86, tipRatio, 6, 1, true);
  xform(tip, T(0, 1 - tipRatio / 2, 0));
  // 让尖顶偏一点,更不规则
  const p = tip.getAttribute("position");
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 1 - 1e-3) p.setX(i, p.getX(i) + twist * 0.25);
  const g = merge([body, tip]);
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
}

/** 水晶尖塔:一簇发光的六棱水晶从岩丘中升起,主晶体高近两公里,周围漂浮着晶片,顶端射出光柱。 */
export function createCrystalSpire(): Wonder {
  const group = new THREE.Group();
  const rand = rngOf(99);

  // ---- 材质:半透明 + 菲涅尔(边缘更亮),整体缓慢脉动
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.86, side: THREE.DoubleSide, depthWrite: false });
  const view = normalize(positionView.negate());
  const fres = pow(float(1).sub(abs(dot(normalView, view))), 2.2);
  const pulse = sin(time.mul(1.3)).mul(0.5).add(0.5);
  const inner = mix(color(0x1ca6ff), color(0x7ef0ff), pulse.mul(0.5).add(0.25));
  mat.colorNode = mix(color(0x4cc8ff), color(0xffffff), fres.mul(0.6));
  mat.emissiveNode = mix(inner, color(0xcaf6ff), fres).mul(mix(float(0.55), float(1.1), pulse));
  const dark = std(0x2b3a4a, { roughness: 0.9 });
  void dark;

  // ---- 岩丘
  const mound = displace(new THREE.IcosahedronGeometry(1, 5), 17, 1.1, 0.16, 4);
  xform(mound, S(520, 170, 520));
  xform(mound, T(0, -10, 0));
  paint(mound, rockPainter({ a: [0.3, 0.32, 0.38], b: [0.14, 0.15, 0.2], band: 0.06, seed: 3, moss: [0.2, 0.34, 0.2], mossMin: 0.8 }));
  const moundMesh = new THREE.Mesh(mound, vcMat({ roughness: 0.95 }));
  moundMesh.castShadow = true;
  group.add(moundMesh);

  // ---- 水晶丛(实例化,三种形状)
  const shapes = [crystalGeometry(0.2, 0.2), crystalGeometry(-0.3, 0.26), crystalGeometry(0.5, 0.16)];
  const lists: THREE.Matrix4[][] = [[], [], []];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const place = (x: number, z: number, h: number, r: number, tiltDir: number, tilt: number, y = 0) => {
    const axis = new THREE.Vector3(Math.cos(tiltDir), 0, Math.sin(tiltDir)).cross(up).normalize().negate();
    q.setFromAxisAngle(axis, tilt);
    const qy = new THREE.Quaternion().setFromAxisAngle(up, rand() * 6.28);
    q.multiply(qy);
    m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(r, h, r));
    lists[Math.floor(rand() * 3)].push(m4.clone());
  };
  place(0, 0, 1900, 150, 0, 0.0, 20);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rand() * 0.3;
    const d = 150 + rand() * 120;
    place(Math.cos(a) * d, Math.sin(a) * d, 700 + rand() * 900, 55 + rand() * 40, a, 0.22 + rand() * 0.18, 5);
  }
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2;
    const d = 200 + rand() * 330;
    place(Math.cos(a) * d, Math.sin(a) * d, 90 + rand() * 360, 18 + rand() * 30, a, 0.3 + rand() * 0.5, 0);
  }
  lists.forEach((list, v) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(shapes[v], mat, list.length);
    list.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.computeBoundingSphere();
    im.renderOrder = 3;
    group.add(im);
  });

  // ---- 主晶体里的发光内核
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1, 2),
    new THREE.MeshBasicNodeMaterial({ color: 0xbff4ff, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  core.scale.set(46, 560, 46);
  core.position.y = 760;
  group.add(core);

  // ---- 光柱:从塔尖射向天空
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(14, 60, 2600, 16, 1, true),
    new THREE.MeshBasicNodeMaterial({ color: 0x9fe6ff, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
  );
  beam.position.y = 1920 + 1300;
  group.add(beam);

  // ---- 细节层:漂浮的晶片(绕塔旋转)+ 地面上的小晶簇
  const detail = new THREE.Group();
  const shardRing = new THREE.Group();
  const shardGeo = crystalGeometry(0.1, 0.3);
  const shards = new THREE.InstancedMesh(shardGeo, mat, 70);
  for (let i = 0; i < 70; i++) {
    const a = rand() * Math.PI * 2;
    const d = 260 + rand() * 520;
    const s = 8 + rand() * 30;
    q.setFromEuler(new THREE.Euler(rand() * 6, rand() * 6, rand() * 6));
    m4.compose(new THREE.Vector3(Math.cos(a) * d, 120 + rand() * 1500, Math.sin(a) * d), q, new THREE.Vector3(s * 0.5, s * 1.6, s * 0.5));
    shards.setMatrixAt(i, m4);
  }
  shards.computeBoundingSphere();
  shardRing.add(shards);
  detail.add(shardRing);
  const glowRock = displace(new THREE.IcosahedronGeometry(1, 2), 29, 1.8, 0.3, 3);
  paint(glowRock, [0.17, 0.2, 0.26]);
  const rocks = new THREE.InstancedMesh(glowRock, vcMat({ roughness: 1 }), 90);
  for (let i = 0; i < 90; i++) {
    const a = rand() * Math.PI * 2;
    const d = 380 + rand() * 520;
    const r = 5 + Math.pow(rand(), 2) * 38;
    q.setFromEuler(new THREE.Euler(rand() * 6, rand() * 6, 0));
    m4.compose(new THREE.Vector3(Math.cos(a) * d, r * 0.25, Math.sin(a) * d), q, new THREE.Vector3(r, r * 0.7, r));
    rocks.setMatrixAt(i, m4);
  }
  rocks.computeBoundingSphere();
  detail.add(rocks);
  group.add(detail);

  return {
    id: "crystal",
    name: "水晶尖塔 / Crystal Spire",
    group,
    footprint: { inner: 560, outer: 1200 },
    view: { height: 760, back: 2800 },
    detail,
    detailDistance: 6500,
    update: (t) => {
      shardRing.rotation.y = t * 0.06;
      core.scale.y = 560 + Math.sin(t * 1.3) * 40;
      (beam.material as THREE.MeshBasicNodeMaterial).opacity = 0.18 + Math.sin(t * 1.3) * 0.05;
    },
  };
}
