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
  /** 细节层:只有相机离奇观 detailDistance 米以内才显示(远处只画主体轮廓) */
  detail?: THREE.Object3D;
  detailDistance?: number;
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
  const fruitMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(18, 8, 6), fruit, 90);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 90; i++) {
    const a = rand() * Math.PI * 2;
    const b = Math.acos(2 * rand() - 1);
    const d = 900 + rand() * 500;
    m4.makeTranslation(Math.sin(b) * Math.cos(a) * d, Math.cos(b) * d * 0.6, Math.sin(b) * Math.sin(a) * d);
    fruitMesh.setMatrixAt(i, m4);
  }
  canopy.add(fruitMesh);
  group.add(canopy);

  return {
    id: "tree",
    name: "世界树 / World Tree",
    group,
    footprint: { inner: 380, outer: 900 },
    view: { height: 1200, back: 4200 },
    detail: fruitMesh,
    detailDistance: 9000,
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
  const treeMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 7), std(0x1f6b2d), 26);
  const tm = new THREE.Matrix4();
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * 780;
    const h = 60 + rand() * 120;
    const r = 22 + rand() * 20;
    tm.compose(new THREE.Vector3(Math.cos(a) * d, 45 + h / 2, Math.sin(a) * d), new THREE.Quaternion(), new THREE.Vector3(r, h, r));
    treeMesh.setMatrixAt(i, tm);
  }
  isle.add(treeMesh);

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
    detail: treeMesh,
    detailDistance: 7000,
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

/** 石林:喀斯特石柱群,每根顶上长着一小撮树。 */
export function createStoneForest(): Wonder {
  const group = new THREE.Group();
  const rock = std(0x8a8172, { roughness: 1 });
  const grass = std(0x3f8f3f);
  const N = 58;
  const pillars = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.62, 1, 1, 9, 1), rock, N);
  const caps = new THREE.InstancedMesh(new THREE.ConeGeometry(0.7, 0.35, 9), grass, N);
  const trees = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 6), std(0x1f6b2d), N * 2);
  const rand = rng(314);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let ti = 0;
  for (let i = 0; i < N; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * 1000;
    const h = 120 + Math.pow(rand(), 1.6) * 640;
    const r = 28 + rand() * 46 + h * 0.04;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    m.compose(new THREE.Vector3(x, h / 2 - 40, z), q, new THREE.Vector3(r, h + 80, r));
    pillars.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(x, h + 6, z), q, new THREE.Vector3(r * 0.9, r * 0.9, r * 0.9));
    caps.setMatrixAt(i, m);
    for (let k = 0; k < 2; k++) {
      const th = 14 + rand() * 22;
      m.compose(
        new THREE.Vector3(x + (rand() - 0.5) * r * 0.9, h + 14 + th / 2, z + (rand() - 0.5) * r * 0.9),
        q,
        new THREE.Vector3(5 + rand() * 6, th, 5 + rand() * 6),
      );
      trees.setMatrixAt(ti++, m);
    }
  }
  group.add(pillars, caps);
  const detail = new THREE.Group();
  detail.add(trees);
  group.add(detail);

  return {
    id: "forest",
    name: "石林 / Stone Forest",
    group,
    footprint: { inner: 750, outer: 1500 },
    view: { height: 520, back: 2400 },
    detail,
    detailDistance: 8000,
  };
}

/** 天然拱门:一座跨度一公里多的巨型石拱,拱下挂着一道水帘。 */
export function createGreatArch(): Wonder {
  const group = new THREE.Group();
  const rock = std(0xb06d4a, { roughness: 1 });
  const rand = rng(2718);
  const span = 780;
  const segs = 26;
  const arch = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), rock, segs);
  const m = new THREE.Matrix4();
  for (let i = 0; i < segs; i++) {
    const a = (i / (segs - 1)) * Math.PI;
    const thick = 150 + Math.sin(a) * 80 + rand() * 40;
    const x = Math.cos(a) * span;
    const y = Math.sin(a) * span * 0.78 + 330;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, a + Math.PI / 2));
    m.compose(new THREE.Vector3(x, y, 0), q, new THREE.Vector3(thick * 1.2, 150 + rand() * 40, 420 + rand() * 120));
    arch.setMatrixAt(i, m);
  }
  group.add(arch);

  // 两侧基座
  for (const s of [-1, 1]) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(230, 330, 360, 10), rock);
    base.position.set(s * span, 160, 0);
    group.add(base);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(200, 12, 8), std(0x3f8f3f));
    cap.scale.set(1, 0.45, 1);
    cap.position.set(s * span, 360, 0);
    group.add(cap);
  }

  // 水帘
  const veil = new THREE.Mesh(
    new THREE.PlaneGeometry(span * 1.5, span * 0.95),
    std(0x9fdcff, { transparent: true, opacity: 0.32, emissive: 0x5cc0ff, emissiveIntensity: 0.6, side: THREE.DoubleSide, depthWrite: false }),
  );
  veil.position.set(0, span * 0.45 + 40, 0);
  group.add(veil);

  const detail = new THREE.Group();
  const rubble = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), rock, 60);
  for (let i = 0; i < 60; i++) {
    const a = rand() * Math.PI * 2;
    const d = 200 + rand() * 900;
    const r = 8 + rand() * 30;
    m.compose(new THREE.Vector3(Math.cos(a) * d, r * 0.4, Math.sin(a) * d * 0.5), new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * 3, rand() * 3, 0)), new THREE.Vector3(r, r * 0.7, r));
    rubble.setMatrixAt(i, m);
  }
  detail.add(rubble);
  group.add(detail);

  return {
    id: "arch",
    name: "天然拱门 / Great Arch",
    group,
    footprint: { inner: 800, outer: 1500 },
    view: { height: 420, back: 2500 },
    detail,
    detailDistance: 6000,
  };
}

/** 龙脊:一具横卧大地的远古巨兽骨架,眼眶里还亮着光。 */
export function createDragonSpine(): Wonder {
  const group = new THREE.Group();
  const bone = std(0xe8e0cc, { roughness: 0.8 });
  const glow = std(0xff9a3c, { emissive: 0xff6a10, emissiveIntensity: 2.4 });
  const N = 22;
  const ribs = new THREE.InstancedMesh(new THREE.TorusGeometry(1, 0.075, 8, 28, Math.PI), bone, N);
  const vert = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), bone, N);
  const m = new THREE.Matrix4();
  for (let i = 0; i < N; i++) {
    const k = i / (N - 1);
    const z = -1500 + k * 3000;
    const r = 120 + Math.sin(k * Math.PI) * 360 * (1 - 0.55 * k);
    const y = Math.sin(k * 5) * 40;
    m.compose(new THREE.Vector3(0, y, z), new THREE.Quaternion(), new THREE.Vector3(r, r * 0.9, r));
    ribs.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(0, y + r * 0.92 - 10, z), new THREE.Quaternion(), new THREE.Vector3(70, 55, 90));
    vert.setMatrixAt(i, m);
  }
  group.add(ribs, vert);

  // 头骨
  const skull = new THREE.Group();
  skull.position.set(0, 120, 1750);
  const cranium = new THREE.Mesh(new THREE.SphereGeometry(260, 16, 12), bone);
  cranium.scale.set(1, 0.85, 1.35);
  skull.add(cranium);
  const jaw = new THREE.Mesh(new THREE.ConeGeometry(180, 520, 8), bone);
  jaw.rotation.x = Math.PI / 2;
  jaw.position.set(0, -50, 380);
  skull.add(jaw);
  for (const s of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(55, 520, 8), bone);
    horn.position.set(s * 190, 230, -120);
    horn.rotation.set(-0.7, 0, -s * 0.5);
    skull.add(horn);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(42, 10, 8), glow);
    eye.position.set(s * 135, 40, 210);
    skull.add(eye);
  }
  group.add(skull);
  group.scale.setScalar(0.5); // 整体缩小一半,让地基圆能罩住

  // 尾椎:越来越小
  const tail = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), bone, 14);
  for (let i = 0; i < 14; i++) {
    const r = 70 * (1 - i / 16);
    m.compose(new THREE.Vector3(Math.sin(i * 0.5) * 60, r * 0.5, -1500 - i * 120), new THREE.Quaternion(), new THREE.Vector3(r, r * 0.8, r * 1.3));
    tail.setMatrixAt(i, m);
  }
  group.add(tail);

  return {
    id: "spine",
    name: "龙脊 / Dragon Spine",
    group,
    footprint: { inner: 650, outer: 1300 },
    view: { height: 380, back: 1900 },
    update: (t) => {
      glow.emissiveIntensity = 2.2 + Math.sin(t * 2.1) * 0.7;
    },
  };
}
