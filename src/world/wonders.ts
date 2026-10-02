import * as THREE from "three/webgpu";

/**
 * 奇观。每个奇观是一个以"地面为原点、+Y 向上"的 Group,由 Anchor 挂到行星表面。
 * 尺寸故意做得很夸张(几公里),用来测试大尺度渲染。
 */
export interface Wonder {
  id: string;
  name: string;
  group: THREE.Group;
  /** 平整地基的半径(米):内圈完全平整 / 外圈过渡 */
  footprint: { inner: number; outer: number };
  /** 到达该奇观时相机离地高度和后退距离 */
  view: { height: number; back: number };
  update?: (t: number) => void;
}

const std = (hex: number, extra: Record<string, unknown> = {}) =>
  new THREE.MeshStandardNodeMaterial({ color: hex, roughness: 0.9, metalness: 0, ...extra });

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createWorldTree(): Wonder {
  const group = new THREE.Group();
  const bark = std(0x5b3d24);
  const leaf = std(0x2f8f3a, { emissive: 0x16602a, emissiveIntensity: 0.35 });
  const fruit = std(0xffd45c, { emissive: 0xffb92e, emissiveIntensity: 2.2 });

  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(90, 230, 2400, 14), bark);
  trunk.position.y = 1200;
  group.add(trunk);

  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const root = new THREE.Mesh(new THREE.ConeGeometry(75, 620, 8), bark);
    root.position.set(Math.cos(a) * 250, 180, Math.sin(a) * 250);
    root.rotation.z = Math.cos(a) * 0.9;
    root.rotation.x = -Math.sin(a) * 0.9;
    group.add(root);
  }

  const rand = rng(7);
  const canopy = new THREE.Group();
  canopy.position.y = 2700;
  for (let i = 0; i < 9; i++) {
    const r = 650 + rand() * 450;
    const s = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 2), leaf);
    const a = rand() * Math.PI * 2;
    const d = i === 0 ? 0 : 500 + rand() * 700;
    s.position.set(Math.cos(a) * d, (rand() - 0.3) * 500, Math.sin(a) * d);
    canopy.add(s);
  }
  for (let i = 0; i < 90; i++) {
    const a = rand() * Math.PI * 2;
    const b = Math.acos(2 * rand() - 1);
    const d = 900 + rand() * 500;
    const f = new THREE.Mesh(new THREE.SphereGeometry(18, 8, 6), fruit);
    f.position.set(Math.sin(b) * Math.cos(a) * d, Math.cos(b) * d * 0.6, Math.sin(b) * Math.sin(a) * d);
    canopy.add(f);
  }
  group.add(canopy);

  return {
    id: "tree",
    name: "世界树 / World Tree",
    group,
    footprint: { inner: 380, outer: 900 },
    view: { height: 1200, back: 4200 },
    update: (t) => {
      canopy.rotation.y = t * 0.01;
    },
  };
}

export function createFloatingIsle(): Wonder {
  const group = new THREE.Group();
  const isle = new THREE.Group();
  isle.position.y = 2200;
  group.add(isle);

  const top = new THREE.Mesh(new THREE.CylinderGeometry(900, 860, 90, 28), std(0x3c8a3f));
  isle.add(top);
  const underside = new THREE.Mesh(new THREE.ConeGeometry(860, 1700, 20), std(0x6d6258));
  underside.rotation.x = Math.PI;
  underside.position.y = -90 / 2 - 1700 / 2;
  isle.add(underside);

  const rand = rng(21);
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * 780;
    const h = 60 + rand() * 120;
    const tree = new THREE.Mesh(new THREE.ConeGeometry(22 + rand() * 20, h, 7), std(0x1f6b2d));
    tree.position.set(Math.cos(a) * d, 45 + h / 2, Math.sin(a) * d);
    isle.add(tree);
  }

  // 瀑布:从岛边缘垂到地面
  const fall = new THREE.Mesh(
    new THREE.CylinderGeometry(55, 38, 2150, 12, 1, true),
    std(0x9fdcff, { transparent: true, opacity: 0.55, emissive: 0x5cc0ff, emissiveIntensity: 0.9, side: THREE.DoubleSide }),
  );
  fall.position.set(820, 2200 - 1075, 0);
  group.add(fall);

  return {
    id: "isle",
    name: "浮空岛 / Floating Isle",
    group,
    footprint: { inner: 120, outer: 380 },
    view: { height: 1800, back: 3600 },
    update: (t) => {
      isle.position.y = 2200 + Math.sin(t * 0.4) * 25;
      isle.rotation.y = t * 0.02;
    },
  };
}

export function createCrystalSpire(): Wonder {
  const group = new THREE.Group();
  const mat = std(0x7ee8ff, {
    roughness: 0.08,
    metalness: 0.1,
    emissive: 0x2ab8ff,
    emissiveIntensity: 1.1,
    transparent: true,
    opacity: 0.88,
  });

  const main = new THREE.Mesh(new THREE.ConeGeometry(170, 1900, 6), mat);
  main.position.y = 950;
  group.add(main);

  const rand = rng(99);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rand() * 0.3;
    const h = 350 + rand() * 1100;
    const c = new THREE.Mesh(new THREE.ConeGeometry(55 + rand() * 70, h, 6), mat);
    const d = 160 + rand() * 260;
    c.position.set(Math.cos(a) * d, h / 2 - 20, Math.sin(a) * d);
    // 向外倾斜
    c.rotation.z = Math.cos(a) * 0.35;
    c.rotation.x = -Math.sin(a) * 0.35;
    group.add(c);
  }

  return {
    id: "crystal",
    name: "水晶尖塔 / Crystal Spire",
    group,
    footprint: { inner: 200, outer: 520 },
    view: { height: 700, back: 2600 },
    update: (t) => {
      mat.emissiveIntensity = 1.0 + Math.sin(t * 1.3) * 0.25;
    },
  };
}

export function createSkyRing(): Wonder {
  const group = new THREE.Group();
  const gold = std(0xe3b04b, { metalness: 0.8, roughness: 0.3, emissive: 0x8a5a10, emissiveIntensity: 0.4 });

  const ringRoot = new THREE.Group();
  ringRoot.position.y = 1750;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1400, 70, 16, 128), gold);
  ringRoot.add(ring);
  const portal = new THREE.Mesh(
    new THREE.CircleGeometry(1330, 64),
    std(0xa07bff, {
      transparent: true,
      opacity: 0.22,
      emissive: 0x7a4dff,
      emissiveIntensity: 1.4,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  ringRoot.add(portal);
  group.add(ringRoot);

  const plinth = new THREE.Mesh(new THREE.BoxGeometry(900, 320, 260), std(0x8b8576));
  plinth.position.y = 160;
  group.add(plinth);
  for (const s of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(45, 55, 340, 10), gold);
    pillar.position.set(s * 330, 480, 0);
    group.add(pillar);
  }

  return {
    id: "ring",
    name: "天环 / Sky Ring",
    group,
    footprint: { inner: 260, outer: 600 },
    view: { height: 900, back: 3600 },
    update: (t) => {
      ringRoot.rotation.y = t * 0.05;
    },
  };
}
