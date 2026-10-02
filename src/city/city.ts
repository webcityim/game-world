import * as THREE from "three/webgpu";
import { Anchor } from "../world/anchor";
import { Facade, GeometryBuilder, hex, jitter } from "./builder";
import { generateLayout, type Block, type CityLayout, type Lot } from "./layout";
import { cityMaterial } from "./material";
import { ChestSet, DoorSet, LampSet, NpcSet, TreeSet } from "./props";
import { Rng } from "./rng";
import { STYLES, type StyleDef, type StyleId } from "./styles";

export interface CityDef {
  id: string;
  name: string;
  style: StyleId;
  /** 城区半径(米) */
  radius: number;
  seed: number;
  walls?: boolean;
  /** 首都:中心广场留给 HTML 商铺,地标放到广场北侧 */
  capital?: boolean;
  npcs?: number;
}

export interface CityHooks {
  toast(msg: string): void;
  reward(amount: number): void;
  /** 传送到城市本地坐标 pos,看向 look */
  teleport(city: City, pos: THREE.Vector3, look: THREE.Vector3): void;
  night(): number;
}

/** 碰撞盒(城市本地):绕 Y 旋转的长方体,底部 y0,顶部 h。 */
interface Box {
  cx: number;
  cz: number;
  hw: number;
  hd: number;
  c: number;
  s: number;
  y0: number;
  h: number;
}

type TargetKind = "door" | "lamp" | "chest" | "special";

interface Target {
  kind: TargetKind;
  index: number;
  x: number;
  y: number;
  z: number;
}

interface Special {
  x: number;
  y: number;
  z: number;
  reach: number;
  label: () => string;
  act: () => void;
}

export interface Candidate {
  label: string;
  score: number;
  act: () => void;
}

/** 简单的二维空间哈希。 */
class Grid<T> {
  private readonly cells = new Map<number, T[]>();
  constructor(private readonly size: number) {}

  private key(i: number, j: number) {
    return (i + 32768) * 65536 + (j + 32768);
  }

  insert(x0: number, z0: number, x1: number, z1: number, item: T) {
    const i0 = Math.floor(x0 / this.size);
    const i1 = Math.floor(x1 / this.size);
    const j0 = Math.floor(z0 / this.size);
    const j1 = Math.floor(z1 / this.size);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = this.key(i, j);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(item);
      }
    }
  }

  query(x: number, z: number, r: number, cb: (item: T) => void) {
    const i0 = Math.floor((x - r) / this.size);
    const i1 = Math.floor((x + r) / this.size);
    const j0 = Math.floor((z - r) / this.size);
    const j1 = Math.floor((z + r) / this.size);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const list = this.cells.get(this.key(i, j));
        if (list) for (const it of list) cb(it);
      }
    }
  }
}

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

export class City {
  readonly anchor: Anchor;
  readonly style: StyleDef;
  readonly layout: CityLayout;
  /** 城市地面(含郊外田地)的半径 */
  readonly baseRadius: number;
  state: "idle" | "building" | "ready" = "idle";
  /** 生成进度 0..1 */
  progress = 0;

  private readonly detail = new THREE.Group();
  private readonly props = new THREE.Group();
  private propTrees: THREE.Object3D | null = null;
  private propSmall: THREE.Object3D[] = [];
  private readonly far: THREE.Points;
  private readonly farMat: THREE.PointsMaterial;
  private gen: Generator<number, void> | null = null;

  private readonly boxes = new Grid<Box>(32);
  private readonly targets = new Grid<Target>(16);
  private readonly specials: Special[] = [];
  private readonly blockGrid = new Grid<Block>(64);

  private trees!: TreeSet;
  private lamps!: LampSet;
  private doors!: DoorSet;
  private chests!: ChestSet;
  private npcs!: NpcSet;
  private readonly npcRng: Rng;
  private readonly animators: ((dt: number, t: number) => void)[] = [];

  /** 交互/碰撞时的玩家城市本地位置(由 update 外部传入) */
  private readonly localTmp = new THREE.Vector3();

  constructor(
    readonly def: CityDef,
    dir: THREE.Vector3,
    readonly groundHeight: number,
    heading: number,
    private readonly hooks: CityHooks,
  ) {
    this.style = STYLES[def.style];
    this.anchor = new Anchor(dir, groundHeight, heading);
    this.layout = generateLayout({ ...this.style.layout, radius: def.radius }, def.seed);
    this.baseRadius = def.radius * 1.12 + 340;
    this.npcRng = new Rng(def.seed ^ 0x5eed);

    for (const b of this.layout.blocks) this.blockGrid.insert(b.x0, b.z0, b.x1, b.z1, b);

    this.anchor.object.add(this.detail);
    this.detail.visible = false;

    // 远景夜灯:每个地块一个点,夜里从轨道上能看到城市的光
    const lots = this.layout.lots;
    const step = Math.max(1, Math.floor(lots.length / 2500));
    const pts: number[] = [];
    const rng = new Rng(def.seed ^ 0xfa7);
    for (let i = 0; i < lots.length; i += step) pts.push(lots[i].x, rng.range(4, 12), lots[i].z);
    for (const n of this.layout.nodes.values()) pts.push(n.x, 5, n.z);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    this.farMat = new THREE.PointsMaterial({
      color: def.style === "neo" ? 0xbfe4ff : 0xffc878,
      size: 2,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.farMat.fog = false;
    this.far = new THREE.Points(g, this.farMat);
    this.far.frustumCulled = false;
    this.anchor.object.add(this.far);
  }

  get name() {
    return this.def.name;
  }

  /** 地标在城市本地坐标中的位置与朝向(正门朝 -Z) */
  get landmarkOrigin(): { x: number; z: number } {
    // 首都:教堂(进深约 50 m,正门在 -20 m、后殿到 +30 m)放在广场北半边,不越出广场
    return this.def.capital ? { x: 0, z: this.layout.plazaHalf * 0.5 } : { x: 0, z: 0 };
  }

  toLocal(p: THREE.Vector3, out: THREE.Vector3) {
    return this.anchor.toLocal(p, out);
  }

  toPlanet(local: THREE.Vector3, out: THREE.Vector3) {
    return this.anchor.toPlanet(local, out);
  }

  /** 某个本地点是否在城市地面范围内 */
  contains(local: THREE.Vector3, margin = 0): boolean {
    return Math.hypot(local.x, local.z) < this.baseRadius + margin && local.y > -200 && local.y < 3000;
  }

  addSpecial(local: THREE.Vector3, reach: number, label: () => string, act: () => void) {
    this.specials.push({ x: local.x, y: local.y, z: local.z, reach, label, act });
  }

  // ==================================================================== 生成

  /** 立刻生成全部(启动时用于首都)。 */
  buildNow() {
    if (this.state === "ready") return;
    if (!this.gen) this.gen = this.steps();
    while (!this.gen.next().done) {
      /* 跑完 */
    }
    this.gen = null;
  }

  private *steps(): Generator<number, void> {
    this.state = "building";
    const L = this.layout;
    const st = this.style;
    const rng = new Rng(this.def.seed);
    const b = new GeometryBuilder();
    b.frame(0, 0, 0);

    this.trees = new TreeSet(st.trees);
    this.lamps = new LampSet(st.lampH, st.lampHead, st.lampPost, st.id === "orient" ? "lantern" : st.id === "neo" ? "modern" : "classic");
    this.doors = new DoorSet(st.door);
    this.chests = new ChestSet();
    this.npcs = new NpcSet(L.edges, L.nodes, st.clothes, st.greetings.length);

    // ---- 地面圆盘 + 外缘裙边
    this.groundDisc(b, rng);
    yield 0.05;

    // ---- 道路与路口
    const roadC = hex(st.road);
    for (const n of L.nodes.values()) {
      b.frame(n.x, n.z, 0);
      b.road(-n.wx / 2, n.wx / 2, 0, n.wz, 0.03, roadC, 0);
    }
    for (const e of L.edges) {
      const na = L.nodes.get(e.a)!;
      const nb = L.nodes.get(e.b)!;
      if (e.alongX) {
        b.frame(0, e.az, 0);
        b.road(Math.min(e.ax, e.bx) + na.wx / 2, Math.max(e.ax, e.bx) - nb.wx / 2, 0, e.w, 0.03, roadC);
      } else {
        // 沿 Z 的路:坐标系转 90°,本地 X 对应城市 -Z
        b.frame(e.ax, 0, Math.PI / 2);
        b.road(-(Math.max(e.az, e.bz) - nb.wz / 2), -(Math.min(e.az, e.bz) + na.wz / 2), 0, e.w, 0.03, roadC);
      }
      // 路灯:两侧交错,每 ~26 m 一盏
      const len = Math.hypot(e.bx - e.ax, e.bz - e.az);
      const dx = (e.bx - e.ax) / len;
      const dz = (e.bz - e.az) / len;
      const off = e.w / 2 + 0.6;
      const start = Math.max(na.wx, na.wz) / 2 + 4;
      for (let s = start, k = 0; s < len - start + 0.1; s += 26, k++) {
        const side = k % 2 === 0 ? 1 : -1;
        const x = e.ax + dx * s - dz * side * off;
        const z = e.az + dz * s + dx * side * off;
        this.addLamp(x, z, Math.atan2(dz * side, -dx * side));
        // 大道两侧种行道树
        if (e.w >= st.layout.avenue - 0.1) {
          for (const sd of [-1, 1]) {
            const tx = e.ax + dx * (s + 13) - dz * sd * (e.w / 2 + 1.7);
            const tz = e.az + dz * (s + 13) + dx * sd * (e.w / 2 + 1.7);
            if (s + 13 < len - start) this.addTree(tx, tz, rng, 0);
          }
        }
      }
    }
    // 出城大路(四个方向延伸到郊外)
    this.outerRoads(b, roadC);
    yield 0.15;

    // ---- 街区
    const sidewalk = hex(st.sidewalk);
    const grass = hex(st.grass);
    const plazaC = hex(st.plaza);
    b.frame(0, 0, 0);
    for (const blk of L.blocks) {
      if (blk.kind === "plaza") continue;
      b.rand = rng.next();
      b.box((blk.x0 + blk.x1) / 2, (blk.z0 + blk.z1) / 2, blk.x1 - blk.x0, blk.z1 - blk.z0, 0, 0.15, jitter(sidewalk, 0.03, 0.5), Facade.Plain, null);
      if (blk.kind === "park") {
        this.park(b, blk, rng);
      } else {
        b.flat(blk.x0, blk.z0, blk.x1, blk.z1, 0.15, sidewalk, Facade.Paving);
        if (blk.courtyard) {
          const c = blk.courtyard;
          b.flat(c.x0, c.z0, c.x1, c.z1, 0.16, grass, Facade.Grass);
          const n = rng.int(1, 4);
          for (let k = 0; k < n; k++) this.addTree(rng.range(c.x0 + 2, c.x1 - 2), rng.range(c.z0 + 2, c.z1 - 2), rng);
          if (rng.chance(0.06)) this.addChest(rng.range(c.x0 + 1, c.x1 - 1), rng.range(c.z0 + 1, c.z1 - 1), rng.range(0, 6.28), rng);
        }
      }
    }
    // 中心广场
    const ph = L.plazaHalf;
    b.box(0, 0, ph * 2, ph * 2, 0, 0.15, plazaC, Facade.Plain, null);
    b.flat(-ph, -ph, ph, ph, 0.15, plazaC, Facade.Paving);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.addTree(sx * (ph - 5), sz * (ph - 5), rng, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.addLamp(sx * (ph - 9), sz * (ph - 9), 0);
    this.addChest(-(ph - 8), ph - 14, Math.PI / 2, rng);
    if (!this.def.capital) this.plazaStalls(b, rng, ph);
    yield 0.25;

    // ---- 建筑
    const lots = L.lots;
    for (let i = 0; i < lots.length; i++) {
      this.building(b, lots[i], rng);
      if (i % 120 === 119) yield 0.25 + 0.55 * (i / lots.length);
    }

    // ---- 地标
    this.landmark(b, rng);
    yield 0.85;

    // ---- 城墙 / 郊外
    if (this.def.walls) this.walls(b, rng);
    this.outskirts(b, rng);
    yield 0.92;

    // ---- 合并 & 实例化物体
    this.npcs.spawn(this.def.npcs ?? 90, this.npcRng);
    const mesh = new THREE.Mesh(b.build(), cityMaterial());
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    this.detail.add(mesh);
    const trees = this.trees.build();
    const lamps = this.lamps.build();
    const doors = this.doors.build();
    const chests = this.chests.build();
    const npcs = this.npcs.build(this.npcRng);
    // 树 / 路灯 / 宝箱 / 行人 / 门属于"小物件层":离城区较远时整体隐藏,省掉大量绘制调用
    this.props.add(trees, lamps, chests, npcs);
    if (doors) this.props.add(doors);
    this.propTrees = trees;
    this.propSmall = [lamps, chests, npcs, ...(doors ? [doors] : [])];
    this.detail.add(this.props);
    for (const o of [trees, lamps, chests, npcs]) o.traverse((c) => (c.castShadow = true));
    this.state = "ready";
    this.progress = 1;
  }

  private groundDisc(b: GeometryBuilder, rng: Rng) {
    const R = this.baseRadius;
    const segs = 96;
    const ground = hex(this.style.ground);
    b.frame(0, 0, 0);
    b.rand = rng.next();
    // 扇形三角(本地 uv 用城市坐标,草地纹理)
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      const p0 = [Math.cos(a0) * R, 0, Math.sin(a0) * R] as const;
      const p1 = [Math.cos(a1) * R, 0, Math.sin(a1) * R] as const;
      b.tri([p1, p0, [0, 0, 0]], [
        [p1[0], p1[2]],
        [p0[0], p0[2]],
        [0, 0],
      ], 1, ground, Facade.Grass);
      // 外缘向下的裙边,遮住平面与球面之间的细缝
      b.quad([
        [p1[0], -2, p1[2]],
        [p0[0], -2, p0[2]],
        [p0[0], 0, p0[2]],
        [p1[0], 0, p1[2]],
      ], [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ], 1, jitter(ground, 0.1, 0.2), Facade.Plain);
    }
  }

  private outerRoads(b: GeometryBuilder, roadC: readonly [number, number, number]) {
    const L = this.layout;
    const end = this.baseRadius - 10;
    const w = this.style.layout.avenue;
    // 四个方向:frame 旋转后本地 +X 分别指向城市 +X / -Z / -X / +Z
    const dirs: [number, (n: { x: number; z: number }) => number | null][] = [
      [0, (n) => (n.z === 0 && n.x > 0 ? n.x : null)],
      [Math.PI / 2, (n) => (n.x === 0 && n.z < 0 ? -n.z : null)],
      [Math.PI, (n) => (n.z === 0 && n.x < 0 ? -n.x : null)],
      [-Math.PI / 2, (n) => (n.x === 0 && n.z > 0 ? n.z : null)],
    ];
    for (const [rot, reach] of dirs) {
      let maxR = 0;
      for (const n of L.nodes.values()) {
        const r = reach(n);
        if (r !== null) maxR = Math.max(maxR, r);
      }
      b.frame(0, 0, rot);
      b.road(maxR + w / 2, end, 0, w * 0.8, 0.025, roadC);
    }
    b.frame(0, 0, 0);
  }

  private park(b: GeometryBuilder, blk: Block, rng: Rng) {
    const st = this.style;
    const grass = hex(st.grass);
    const path = hex(st.sidewalk);
    const sw = st.layout.sidewalk;
    const x0 = blk.x0 + sw;
    const x1 = blk.x1 - sw;
    const z0 = blk.z0 + sw;
    const z1 = blk.z1 - sw;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    b.frame(0, 0, 0);
    b.flat(blk.x0, blk.z0, blk.x1, blk.z1, 0.15, path, Facade.Paving);
    b.flat(x0, z0, x1, z1, 0.16, grass, Facade.Grass);
    // 十字小路
    b.flat(cx - 1.5, z0, cx + 1.5, z1, 0.17, path, Facade.Paving);
    b.flat(x0, cz - 1.5, x1, cz + 1.5, 0.17, path, Facade.Paving);
    // 中央水池
    b.cylinder(cx, cz, 4, 4, 0.15, 0.6, 16, hex(0x9a958c), Facade.Plain, false);
    b.cylinder(cx, cz, 3.6, 3.6, 0.15, 0.5, 16, hex(0x3a7aa8), Facade.Plain, true);
    this.addBox(cx, cz, 4, 4, 0, 0, 0.6);
    // 长椅
    for (const [bx, bz, r] of [
      [cx + 6, cz + 2.6, 0],
      [cx - 6, cz - 2.6, Math.PI],
      [cx + 2.6, cz - 6, Math.PI / 2],
    ] as const) {
      this.bench(b, bx, bz, r);
    }
    const n = rng.int(8, 16);
    for (let k = 0; k < n; k++) {
      const x = rng.range(x0 + 2, x1 - 2);
      const z = rng.range(z0 + 2, z1 - 2);
      if (Math.abs(x - cx) < 3 || Math.abs(z - cz) < 3) continue;
      this.addTree(x, z, rng);
    }
    if (rng.chance(0.6)) this.addChest(rng.range(x0 + 2, cx - 3), rng.range(cz + 3, z1 - 2), rng.range(0, 6.28), rng);
  }

  private bench(b: GeometryBuilder, x: number, z: number, rot: number) {
    b.frame(x, z, rot);
    b.rand = 0.3;
    const wood = hex(0x8a5a3a);
    b.box(0, 0, 2.0, 0.5, 0.55, 0.62, wood, Facade.Wood);
    b.box(0, -0.22, 2.0, 0.08, 0.62, 1.05, wood, Facade.Wood);
    b.box(-0.85, 0, 0.08, 0.5, 0.15, 0.55, hex(0x2a2a2e));
    b.box(0.85, 0, 0.08, 0.5, 0.15, 0.55, hex(0x2a2a2e));
    b.frame(0, 0, 0);
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    this.pushBox({ cx: x, cz: z, hw: 1.0, hd: 0.3, c, s, y0: 0, h: 0.62 });
  }

  /** 非首都城市的广场:几个集市摊位 */
  private plazaStalls(b: GeometryBuilder, rng: Rng, ph: number) {
    const fabric = [0xb83a2a, 0x2a6a9a, 0xd8a83a, 0x3a8a5a, 0x8a3a7a];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.3;
      const r = ph * 0.78;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      // 地标占据中心,摊位只放在外圈
      b.frame(x, z, -a + Math.PI / 2);
      b.rand = rng.next();
      b.box(0, 0, 2.8, 1.4, 0.15, 1.05, hex(0x8a5a3a), Facade.Wood);
      for (const sx of [-1.3, 1.3]) for (const sz of [-0.8, 0.8]) b.box(sx, sz, 0.1, 0.1, 0.15, 2.5, hex(0x5a3a2a));
      b.gable(0, 0, 3.0, 1.8, 2.5, 0.5, 0.15, hex(fabric[k % fabric.length]), hex(fabric[k % fabric.length]));
      b.frame(0, 0, 0);
      this.pushBox({ cx: x, cz: z, hw: 1.4, hd: 0.9, c: Math.cos(-a + Math.PI / 2), s: Math.sin(-a + Math.PI / 2), y0: 0, h: 3 });
    }
  }

  private building(b: GeometryBuilder, lot: Lot, rng: Rng) {
    b.frame(lot.x, lot.z, lot.rot);
    b.rand = rng.next();
    const res = this.style.building(b, lot, rng);
    b.frame(0, 0, 0);
    const c = Math.cos(lot.rot);
    const s = Math.sin(lot.rot);
    const toCity = (lx: number, lz: number): [number, number] => [lot.x + lx * c + lz * s, lot.z - lx * s + lz * c];
    const [bx, bz] = toCity(res.box.cx, res.box.cz);
    this.pushBox({ cx: bx, cz: bz, hw: res.box.hw, hd: res.box.hd, c, s, y0: 0, h: res.box.h });
    if (res.door) {
      const d = res.door;
      // 铰链在门洞左侧(从门外看),门板贴在墙外 6 cm
      const [hx, hz] = toCity(d.x - d.w / 2, d.z + 0.06);
      const idx = this.doors.add(hx, hz, lot.rot, d.w, d.h, d.y ?? 0);
      const [mx, mz] = toCity(d.x, d.z + 0.5);
      this.addTarget({ kind: "door", index: idx, x: mx, y: 1.3 + (d.y ?? 0), z: mz });
    }
  }

  private landmark(b: GeometryBuilder, rng: Rng) {
    const o = this.landmarkOrigin;
    b.frame(o.x, o.z, 0);
    b.rand = rng.next();
    const res = this.style.landmark(b, rng);
    b.frame(0, 0, 0);
    for (const bx of res.boxes) this.pushBox({ cx: o.x + bx.cx, cz: o.z + bx.cz, hw: bx.hw, hd: bx.hd, c: 1, s: 0, y0: 0, h: bx.h });
    for (const sp of res.specials) {
      const x = o.x + sp.x;
      const z = o.z + sp.z;
      if (sp.kind === "bell") this.bell(x, z, o);
      else if (sp.kind === "gong") this.gong(x, z);
      else if (sp.kind === "fountain") this.fountain(x, z);
      else if (sp.kind === "elevator" && res.deck) this.elevator(x, sp.y, z, o.x + res.deck.x, res.deck.y, o.z + res.deck.z);
    }
  }

  // ---------------------------------------------------------------- 地标交互

  private bell(x: number, z: number, o: { x: number; z: number }) {
    // 钟挂在钟楼钟层(约 33 m),门口放一根拉绳作为交互点
    const tz = z + 5.5;
    const bell = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 1.5, 2.0, 16, 1, true).translate(0, -1.4, 0),
      new THREE.MeshStandardNodeMaterial({ color: 0xc9a24a, metalness: 0.85, roughness: 0.3, side: THREE.DoubleSide }),
    );
    // 钟层在 31~38 m 之间,钟的顶部挂在 37.6 m
    bell.position.set(o.x, 37.6, tz);
    this.detail.add(bell);
    let swing = 0;
    this.animators.push((dt, t) => {
      swing = Math.max(0, swing - dt * 0.25);
      bell.rotation.x = Math.sin(t * 3.2) * 0.55 * swing;
    });
    this.addSpecial(new THREE.Vector3(x, 1.4, z), 4, () => "敲钟", () => {
      swing = 1;
      this.hooks.toast(`当——当——  钟声回荡在${this.name}上空`);
    });
  }

  private gong(x: number, z: number) {
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 0.1, 24).rotateX(Math.PI / 2).translate(0, -1.3, 0),
      new THREE.MeshStandardNodeMaterial({ color: 0xb8862a, metalness: 0.9, roughness: 0.35 }),
    );
    disc.position.set(x, 3.2, z);
    this.detail.add(disc);
    let swing = 0;
    this.animators.push((dt, t) => {
      swing = Math.max(0, swing - dt * 0.4);
      disc.rotation.x = Math.sin(t * 7) * 0.25 * swing;
    });
    this.addSpecial(new THREE.Vector3(x, 1.6, z), 4, () => "敲锣(点亮全城灯笼)", () => {
      swing = 1;
      const anyOff = this.lamps.items.some((l) => !l.on);
      this.lamps.setAll(anyOff || !this.lamps.items[0]?.on, this.hooks.night());
      this.hooks.toast(anyOff ? "咚——! 全城灯笼都亮了" : "咚——! 灯笼熄灭了");
    });
  }

  private fountain(x: number, z: number) {
    const mat = new THREE.MeshStandardNodeMaterial({
      color: 0x9fdcff,
      emissive: 0x3a8ac0,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.7,
      roughness: 0.1,
    });
    const jets = new THREE.Group();
    // 中心水柱从柱顶(2.6 m)喷出,8 道小水柱从池沿(0.7 m)向中心斜喷
    const center = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.35, 1, 10).translate(0, 0.5, 0), mat);
    center.position.y = 2.6;
    jets.add(center);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const j = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.14, 1, 6).translate(0, 0.5, 0), mat);
      j.position.set(Math.cos(a) * 3.6, 0.7, Math.sin(a) * 3.6);
      // 让 +Y 向 (-cos a, -sin a) 倾斜:Rz 控制 x 分量,Rx 控制 z 分量
      j.rotation.set(-Math.sin(a) * 0.5, 0, Math.cos(a) * 0.5);
      j.scale.set(1, 2.2, 1);
      jets.add(j);
    }
    jets.position.set(x, 0, z);
    this.detail.add(jets);
    let on = 1;
    let level = 1;
    this.animators.push((dt, t) => {
      level += (on - level) * (1 - Math.exp(-dt * 3));
      center.scale.set(1, Math.max(0.001, level * (5.5 + Math.sin(t * 2.3) * 0.8)), 1);
      jets.visible = level > 0.02;
      for (let k = 1; k < jets.children.length; k++) jets.children[k].scale.y = Math.max(0.001, level * (2.2 + Math.sin(t * 3 + k) * 0.3));
    });
    this.addSpecial(new THREE.Vector3(x, 1.2, z - 6), 6, () => (on ? "关闭喷泉" : "打开喷泉"), () => {
      on = on ? 0 : 1;
      this.hooks.toast(on ? "喷泉重新涌出清水" : "喷泉安静了下来");
    });
  }

  private elevator(x: number, y: number, z: number, dx: number, dy: number, dz: number) {
    const deck = new THREE.Vector3(dx, dy, dz);
    // 向下俯瞰城市
    const look = new THREE.Vector3(dx, dy - 220, dz - 360);
    this.addSpecial(new THREE.Vector3(x, y, z), 4, () => "乘电梯到观景台", () => {
      this.hooks.toast("电梯上行中…… 欢迎来到观景台");
      this.hooks.teleport(this, deck, look);
    });
    // 观景台上也放一个"下楼"的交互点
    const back = new THREE.Vector3(x, y, z - 6);
    this.addSpecial(new THREE.Vector3(dx, dy, dz + 4), 4, () => "乘电梯回到地面", () => {
      this.hooks.teleport(this, back, new THREE.Vector3(x, y, z - 60));
    });
  }

  // ---------------------------------------------------------------- 城墙与郊外

  private walls(b: GeometryBuilder, rng: Rng) {
    const Rw = this.def.radius * 1.04 + 14;
    const segs = 40;
    const stone = hex(0xa8a090);
    const roof = hex(0x4a5868);
    const gateHalf = this.style.layout.avenue * 0.6;
    // 顶点错开半段,让四条主轴线正好穿过某一段的中点(城门)
    const pts: [number, number][] = [];
    for (let i = 0; i < segs; i++) {
      const a = ((i - 0.5) / segs) * Math.PI * 2;
      pts.push([Math.cos(a) * Rw, Math.sin(a) * Rw]);
    }
    for (let i = 0; i < segs; i++) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[(i + 1) % segs];
      const mx = (x0 + x1) / 2;
      const mz = (z0 + z1) / 2;
      const len = Math.hypot(x1 - x0, z1 - z0);
      const dx = (x1 - x0) / len;
      const dz = (z1 - z0) / len;
      const rot = Math.atan2(-dz, dx);
      b.rand = rng.next();
      // 城门:四条主轴线(x = 0 或 z = 0)穿过的那一段留出门洞
      const crossesAxis = z0 * z1 < 0 || x0 * x1 < 0;
      b.frame(mx, mz, rot);
      if (crossesAxis) {
        // 门两侧各一段墙,中间门楼
        const side = (len - gateHalf * 2) / 2;
        b.box(-len / 2 + side / 2, 0, side, 2.6, 0, 9, stone, Facade.Plain);
        b.box(len / 2 - side / 2, 0, side, 2.6, 0, 9, stone, Facade.Plain);
        b.box(0, 0, gateHalf * 2 + 1, 3.4, 6.5, 11, stone, Facade.Windows, stone, 0);
        b.gable(0, 0, gateHalf * 2 + 1, 3.4, 11, 2.2, 0.4, roof, stone);
        for (const sx of [-1, 1]) {
          b.cylinder(sx * (gateHalf + 2.2), 0, 3, 3, 0, 14, 10, stone, Facade.Windows);
          b.cone(sx * (gateHalf + 2.2), 0, 3.6, 14, 6, 10, roof);
        }
        b.frame(0, 0, 0);
        const c = Math.cos(rot);
        const s = Math.sin(rot);
        for (const sgn of [-1, 1]) {
          const lx = sgn * (len / 2 - side / 2);
          this.pushBox({ cx: mx + lx * c, cz: mz - lx * s, hw: side / 2 + 0.5, hd: 1.3, c, s, y0: 0, h: 9 });
        }
        this.pushBox({ cx: mx, cz: mz, hw: gateHalf + 0.5, hd: 1.7, c, s, y0: 6.5, h: 13.2 });
        for (const sx of [-1, 1]) {
          const lx = sx * (gateHalf + 2.2);
          this.pushBox({ cx: mx + lx * c, cz: mz - lx * s, hw: 3, hd: 3, c: 1, s: 0, y0: 0, h: 20 });
        }
        continue;
      }
      b.box(0, 0, len + 0.4, 2.6, 0, 9, stone, Facade.Plain);
      // 垛口
      for (let u = -len / 2 + 1; u < len / 2 - 0.5; u += 2.2) b.box(u, 1.0, 1.1, 0.6, 9, 10, stone, Facade.Plain);
      b.frame(0, 0, 0);
      this.pushBox({ cx: mx, cz: mz, hw: len / 2 + 0.2, hd: 1.3, c: Math.cos(rot), s: Math.sin(rot), y0: 0, h: 10 });
      if (i % 4 === 2) {
        const [tx, tz] = pts[i];
        b.cylinder(tx, tz, 3.2, 3.2, 0, 13, 10, stone, Facade.Windows);
        b.cone(tx, tz, 3.8, 13, 7, 10, roof);
        this.pushBox({ cx: tx, cz: tz, hw: 3.2, hd: 3.2, c: 1, s: 0, y0: 0, h: 20 });
      }
    }
  }

  /** 郊外:田地、风车、树林(不同风格换不同作物和树)。 */
  private outskirts(b: GeometryBuilder, rng: Rng) {
    const st = this.style;
    const r0 = this.def.radius * 1.12 + 30;
    const r1 = this.baseRadius - 25;
    const roadClear = st.layout.avenue;
    const fieldColors: Record<StyleId, number[]> = {
      meadow: [0xd8c060, 0x8aac48, 0x9a7a52, 0xc8b050],
      orient: [0x7ab05a, 0x5a9a6a, 0x8ac070],
      desert: [0x9aa04a, 0xc8a860],
      neo: [0x7aa048, 0x6a9a52],
    };
    const colors = fieldColors[st.id];
    // 风车(只有草原风)
    const mills: [number, number][] = [];
    if (st.id === "meadow") {
      for (let k = 0; k < 4; k++) {
        const a = rng.range(0, Math.PI * 2);
        const r = rng.range(r0 + 30, r1 - 40);
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        if (Math.abs(x) < roadClear + 10 || Math.abs(z) < roadClear + 10) continue;
        mills.push([x, z]);
        this.windmill(b, x, z, rng);
      }
    }
    // 田地
    const fieldCount = st.id === "neo" ? 0 : st.id === "desert" ? 24 : 70;
    for (let k = 0; k < fieldCount; k++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(r0 + 10, r1 - 30);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const w = rng.range(30, 70);
      const d = rng.range(25, 55);
      const rot = a + rng.range(-0.3, 0.3);
      const half = Math.hypot(w, d) / 2;
      if (Math.abs(x) < roadClear + half || Math.abs(z) < roadClear + half) continue;
      if (mills.some(([mx, mz]) => Math.hypot(mx - x, mz - z) < half + 12)) continue;
      b.frame(x, z, rot);
      b.rand = rng.next();
      const col = hex(colors[k % colors.length]);
      // 用 Wood 外立面的条纹画垄沟:条纹间距 0.24(着色器单位),v 乘 0.3 → 垄距约 0.8 m
      b.quad([
        [-w / 2, 0.04, d / 2],
        [w / 2, 0.04, d / 2],
        [w / 2, 0.04, -d / 2],
        [-w / 2, 0.04, -d / 2],
      ], [
        [0, d * 0.3],
        [w, d * 0.3],
        [w, 0],
        [0, 0],
      ], w, col, Facade.Wood);
      b.frame(0, 0, 0);
    }
    // 树林:成簇分布
    const clusters = st.id === "desert" ? 10 : 22;
    for (let k = 0; k < clusters; k++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(r0, r1 - 20);
      const cx = Math.cos(a) * r;
      const cz = Math.sin(a) * r;
      if (Math.abs(cx) < roadClear + 20 || Math.abs(cz) < roadClear + 20) continue;
      const n = rng.int(6, st.id === "desert" ? 10 : 22);
      for (let i = 0; i < n; i++) {
        const tx = cx + rng.range(-25, 25);
        const tz = cz + rng.range(-25, 25);
        if (Math.hypot(tx, tz) > r1) continue;
        this.addTree(tx, tz, rng);
      }
    }
    if (st.id === "desert") {
      // 绿洲水池
      for (let k = 0; k < 3; k++) {
        const a = rng.range(0, Math.PI * 2);
        const r = rng.range(r0 + 40, r1 - 60);
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        b.frame(0, 0, 0);
        b.cylinder(x, z, 14, 14, 0, 0.08, 20, hex(0x2a7aa0), Facade.Plain, true);
        for (let i = 0; i < 8; i++) {
          const aa = (i / 8) * Math.PI * 2;
          this.addTree(x + Math.cos(aa) * 17, z + Math.sin(aa) * 17, rng, 0);
        }
      }
    }
  }

  private windmill(b: GeometryBuilder, x: number, z: number, rng: Rng) {
    b.frame(0, 0, 0);
    b.rand = rng.next();
    const wall = hex(0xe8e0d0);
    b.cylinder(x, z, 4.2, 2.8, 0, 15, 12, wall, Facade.Windows);
    b.cone(x, z, 3.4, 15, 4.5, 12, hex(0x7a4a32));
    this.pushBox({ cx: x, cz: z, hw: 3.6, hd: 3.6, c: 1, s: 0, y0: 0, h: 19 });
    // 风车叶片是独立对象,会转
    const hub = new THREE.Group();
    const face = Math.atan2(-x, -z); // 朝向城市中心
    hub.position.set(x + Math.sin(face) * 3.4, 15.5, z + Math.cos(face) * 3.4);
    hub.rotation.y = face;
    const sailMat = new THREE.MeshStandardNodeMaterial({ color: 0xf0e8d8, roughness: 0.9, side: THREE.DoubleSide });
    const armMat = new THREE.MeshStandardNodeMaterial({ color: 0x5a3a2a, roughness: 0.8 });
    const rotor = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      const arm = new THREE.Group();
      arm.rotation.z = (k / 4) * Math.PI * 2;
      const spar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 11, 0.3).translate(0, 5.5, 0), armMat);
      const sail = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 8).translate(1.35, 6.5, 0.1), sailMat);
      arm.add(spar, sail);
      rotor.add(arm);
    }
    hub.add(rotor);
    this.detail.add(hub);
    let speed = 0.6;
    this.animators.push((dt) => {
      rotor.rotation.z -= speed * dt;
    });
    const doorX = x + Math.sin(face) * 3.9;
    const doorZ = z + Math.cos(face) * 3.9;
    this.addSpecial(new THREE.Vector3(doorX, 1.5, doorZ), 4, () => (speed > 1 ? "让风车慢下来" : "让风车转快点"), () => {
      speed = speed > 1 ? 0.6 : 2.4;
      this.hooks.toast(speed > 1 ? "风车呼呼地转了起来" : "风车慢了下来");
    });
  }

  // ---------------------------------------------------------------- 物体登记

  private pushBox(box: Box) {
    // 包围盒(考虑旋转)
    const ex = Math.abs(box.hw * box.c) + Math.abs(box.hd * box.s);
    const ez = Math.abs(box.hw * box.s) + Math.abs(box.hd * box.c);
    this.boxes.insert(box.cx - ex, box.cz - ez, box.cx + ex, box.cz + ez, box);
  }

  private addBox(cx: number, cz: number, hw: number, hd: number, rot: number, y0: number, h: number) {
    this.pushBox({ cx, cz, hw, hd, c: Math.cos(rot), s: Math.sin(rot), y0, h });
  }

  /** 外部物体(例如首都广场的商铺)登记碰撞盒,坐标为城市本地。 */
  addCollider(cx: number, cz: number, hw: number, hd: number, rot: number, h: number) {
    this.addBox(cx, cz, hw, hd, rot, 0, h);
  }

  private addTarget(t: Target) {
    this.targets.insert(t.x, t.z, t.x, t.z, t);
  }

  private addTree(x: number, z: number, rng: Rng, kind?: number) {
    this.trees.add(x, z, rng, kind);
    this.addBox(x, z, 0.3, 0.3, 0, 0, 3);
  }

  private addLamp(x: number, z: number, rot: number) {
    this.lamps.add(x, z, rot);
    const idx = this.lamps.items.length - 1;
    this.addBox(x, z, 0.14, 0.14, 0, 0, this.style.lampH);
    this.addTarget({ kind: "lamp", index: idx, x, y: 1.4, z });
  }

  private addChest(x: number, z: number, rot: number, rng: Rng) {
    this.chests.add(x, z, rot, Math.round(rng.range(40, 320) / 10) * 10);
    const idx = this.chests.items.length - 1;
    this.addBox(x, z, 0.47, 0.32, rot, 0, 0.8);
    this.addTarget({ kind: "chest", index: idx, x, y: 0.6, z });
  }

  // ==================================================================== 运行时

  /**
   * 每帧调用。cam 为相机的行星坐标。
   * @returns 相机到城市中心的距离(米)
   */
  update(cam: THREE.Vector3, dt: number, t: number, night: number, budgetMs: number): number {
    this.anchor.update(cam);
    const dist = cam.distanceTo(this.anchor.pos);

    if (this.state !== "ready" && dist < 70_000) {
      if (!this.gen) this.gen = this.steps();
      const t0 = performance.now();
      while (performance.now() - t0 < budgetMs) {
        const r = this.gen.next();
        if (r.done) {
          this.gen = null;
          break;
        }
        this.progress = r.value;
      }
    }

    this.detail.visible = this.state === "ready" && dist < 45_000;
    // 小物件分级:行人 / 路灯 / 宝箱 / 门只在城区内部画,树稍远一点,鸟瞰时全部隐藏
    this.props.visible = dist < this.baseRadius + 1000;
    if (this.propTrees) {
      this.propTrees.visible = dist < this.baseRadius + 1000;
      const small = dist < this.baseRadius * 0.75;
      for (const o of this.propSmall) o.visible = small;
    }
    const farFade = Math.min(1, Math.max(0, (dist - 3000) / 6000));
    this.farMat.opacity = night * farFade;
    this.far.visible = this.farMat.opacity > 0.01;

    if (this.state === "ready") {
      if (dist < 6000) {
        this.npcs.update(dt, this.npcRng);
        for (const a of this.animators) a(dt, t);
      }
      this.doors.update(dt);
      this.chests.update(dt);
      this.lamps.update(night);
    }
    return dist;
  }

  /** 城市本地坐标下的地面高度:人行道/广场 0.15,道路 0;站在矮物体或屋顶上时取其顶面。 */
  groundAt(x: number, z: number, feet: number, step = 0.55): number {
    let g = 0;
    this.blockGrid.query(x, z, 0, (blk) => {
      if (x >= blk.x0 && x <= blk.x1 && z >= blk.z0 && z <= blk.z1) g = 0.15;
    });
    const ph = this.layout.plazaHalf;
    if (Math.abs(x) < ph && Math.abs(z) < ph) g = 0.15;
    this.boxes.query(x, z, 0, (bx) => {
      if (bx.y0 > 0.01) return;
      const dx = x - bx.cx;
      const dz = z - bx.cz;
      const lx = dx * bx.c - dz * bx.s;
      const lz = dx * bx.s + dz * bx.c;
      if (Math.abs(lx) <= bx.hw && Math.abs(lz) <= bx.hd && bx.h <= feet + step) g = Math.max(g, bx.h);
    });
    return g;
  }

  /**
   * 碰撞:把城市本地坐标 p(眼睛位置)推出建筑。
   * @param eye 眼睛离脚底的高度
   * @returns 脚下的地面高度
   */
  collide(p: THREE.Vector3, radius: number, eye: number, step: number): number {
    const feet = p.y - eye;
    const head = p.y + 0.15;
    this.boxes.query(p.x, p.z, radius, (bx) => {
      if (bx.h <= feet + step || bx.y0 >= head) return;
      const dx = p.x - bx.cx;
      const dz = p.z - bx.cz;
      let lx = dx * bx.c - dz * bx.s;
      let lz = dx * bx.s + dz * bx.c;
      const ex = bx.hw + radius - Math.abs(lx);
      const ez = bx.hd + radius - Math.abs(lz);
      if (ex <= 0 || ez <= 0) return;
      // 刚好比屋顶低一点(从上方落下)时,站到屋顶上
      const ey = bx.h - feet;
      if (ey < Math.min(ex, ez) && ey < 1.2) {
        p.y += ey;
        return;
      }
      if (ex < ez) lx += Math.sign(lx || 1) * ex;
      else lz += Math.sign(lz || 1) * ez;
      p.x = bx.cx + lx * bx.c + lz * bx.s;
      p.z = bx.cz - lx * bx.s + lz * bx.c;
    });
    return this.groundAt(p.x, p.z, p.y - eye, step);
  }

  /** 找视线前方最合适的可交互物。p / fwd 都是城市本地坐标。 */
  findTarget(p: THREE.Vector3, fwd: THREE.Vector3, maxDist: number): Candidate | null {
    if (this.state !== "ready") return null;
    let best: Candidate | null = null;
    const consider = (x: number, y: number, z: number, reach: number, label: string, act: () => void) => {
      tmpV.set(x - p.x, (y - p.y) * 0.6, z - p.z);
      const d = tmpV.length();
      if (d > reach) return;
      const facing = d < 0.8 ? 1 : tmpV2.copy(tmpV).normalize().dot(fwd);
      if (facing < 0.5) return;
      const score = d * (1.8 - facing);
      if (!best || score < best.score) best = { label, score, act };
    };

    this.targets.query(p.x, p.z, maxDist, (t) => {
      if (t.kind === "door") {
        const open = this.doors.isOpen(t.index);
        consider(t.x, t.y, t.z, maxDist, open ? "关门" : "开门", () => this.doors.toggle(t.index));
      } else if (t.kind === "lamp") {
        const on = this.lamps.items[t.index].on;
        consider(t.x, t.y, t.z, maxDist * 0.8, on ? "关掉路灯" : "点亮路灯", () => this.lamps.toggle(t.index, this.hooks.night()));
      } else if (t.kind === "chest") {
        if (this.chests.items[t.index].opened) return;
        consider(t.x, t.y, t.z, maxDist, "打开宝箱", () => {
          const r = this.chests.open(t.index);
          if (r > 0) {
            this.hooks.reward(r);
            this.hooks.toast(`宝箱里有 ${r} 摩拉!`);
          }
        });
      }
    });

    const npcs = this.npcs.items;
    for (let i = 0; i < npcs.length; i++) {
      const n = npcs[i];
      if (Math.abs(n.x - p.x) > maxDist || Math.abs(n.z - p.z) > maxDist) continue;
      consider(n.x, 1.4, n.z, maxDist, "交谈", () => {
        const line = this.npcs.talkTo(i, p.x, p.z);
        this.hooks.toast(`行人:「${this.style.greetings[line]}」`);
      });
    }

    for (const s of this.specials) consider(s.x, s.y, s.z, s.reach, s.label(), s.act);
    return best;
  }

  /** 统计信息(HUD 用) */
  get stats() {
    return {
      lots: this.layout.lots.length,
      npcs: this.npcs?.items.length ?? 0,
      chests: this.chests?.items.length ?? 0,
      opened: this.chests?.items.filter((c) => c.opened).length ?? 0,
    };
  }

  /** 用于书签:城市本地坐标里的一个街景视角 */
  streetView(): { pos: THREE.Vector3; look: THREE.Vector3 } {
    const ph = this.layout.plazaHalf;
    if (this.def.capital) {
      // 商铺围在广场中心的 -Z 一侧、正门朝中心;站在喷泉南边看过去
      return { pos: new THREE.Vector3(2, 1.8, -9), look: new THREE.Vector3(0, 2.6, -28) };
    }
    return { pos: new THREE.Vector3(ph * 0.55, 1.8, -ph * 1.05), look: new THREE.Vector3(0, 12, 0) };
  }

  aerialView(): { pos: THREE.Vector3; look: THREE.Vector3 } {
    const R = this.def.radius;
    return { pos: new THREE.Vector3(R * 0.55, R * 0.45, -R * 0.95), look: new THREE.Vector3(0, 0, 0) };
  }
}
