import * as THREE from "three/webgpu";
import type { RoadEdge, RoadNode } from "./layout";
import { Rng } from "./rng";
import type { TreeKind } from "./styles";

const M = new THREE.Matrix4();
const M2 = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const P = new THREE.Vector3();
const S = new THREE.Vector3();
const C = new THREE.Color();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

const std = (opts: THREE.MeshStandardNodeMaterialParameters = {}) =>
  new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0, ...opts });

function setTRS(m: THREE.Matrix4, x: number, y: number, z: number, rotY: number, sx: number, sy: number, sz: number) {
  Q.setFromAxisAngle(Y_AXIS, rotY);
  P.set(x, y, z);
  S.set(sx, sy, sz);
  return m.compose(P, Q, S);
}

// ====================================================================== 树

interface TreeItem {
  x: number;
  z: number;
  kind: number;
  h: number;
  r: number;
  color: number;
}

export class TreeSet {
  readonly items: TreeItem[] = [];
  constructor(private readonly kinds: TreeKind[]) {}

  add(x: number, z: number, rng: Rng, kind = rng.int(0, this.kinds.length - 1)) {
    const k = this.kinds[kind];
    this.items.push({
      x,
      z,
      kind,
      h: rng.range(k.trunkH[0], k.trunkH[1]),
      r: rng.range(k.crownR[0], k.crownR[1]),
      color: k.colors[rng.int(0, k.colors.length - 1)],
    });
  }

  build(): THREE.Group {
    const g = new THREE.Group();
    this.kinds.forEach((k, ki) => {
      const list = this.items.filter((t) => t.kind === ki);
      if (list.length === 0) return;
      const trunkGeo = new THREE.CylinderGeometry(k.crown === "palm" ? 0.16 : 0.13, 0.24, 1, 6).translate(0, 0.5, 0);
      let crownGeo: THREE.BufferGeometry;
      let ky = 1;
      if (k.crown === "cone") {
        crownGeo = new THREE.ConeGeometry(1, 2.4, 7).translate(0, 0.9, 0);
      } else if (k.crown === "palm") {
        crownGeo = new THREE.OctahedronGeometry(1, 0);
        ky = 0.32;
      } else {
        crownGeo = new THREE.IcosahedronGeometry(1, 1);
        ky = 0.85;
      }
      const trunks = new THREE.InstancedMesh(trunkGeo, std({ color: k.trunk }), list.length);
      const crowns = new THREE.InstancedMesh(crownGeo, std({ flatShading: true }), list.length);
      list.forEach((t, i) => {
        trunks.setMatrixAt(i, setTRS(M, t.x, 0, t.z, 0, 1, t.h, 1));
        const yaw = (t.x * 0.37 + t.z * 0.73) % 6.28;
        crowns.setMatrixAt(i, setTRS(M, t.x, t.h + t.r * ky * 0.55, t.z, yaw, t.r, t.r * ky, t.r));
        crowns.setColorAt(i, C.setHex(t.color));
      });
      trunks.computeBoundingSphere();
      crowns.computeBoundingSphere();
      g.add(trunks, crowns);
    });
    return g;
  }
}

// ====================================================================== 路灯(可开关)

export class LampSet {
  readonly items: { x: number; z: number; rot: number; on: boolean }[] = [];
  private heads?: THREE.InstancedMesh;
  private lastNight = -1;

  constructor(
    private readonly height: number,
    private readonly headColor: number,
    private readonly postColor: number,
    private readonly variant: "classic" | "lantern" | "modern",
  ) {}

  add(x: number, z: number, rot: number) {
    this.items.push({ x, z, rot, on: true });
  }

  build(): THREE.Group {
    const g = new THREE.Group();
    const n = this.items.length;
    if (n === 0) return g;
    const H = this.height;
    const postGeo = new THREE.CylinderGeometry(0.07, 0.11, 1, 6).translate(0, 0.5, 0);
    const posts = new THREE.InstancedMesh(postGeo, std({ color: this.postColor, metalness: 0.4, roughness: 0.5 }), n);
    let headGeo: THREE.BufferGeometry;
    if (this.variant === "lantern") headGeo = new THREE.SphereGeometry(0.32, 10, 8).scale(1, 1.3, 1);
    else if (this.variant === "modern") headGeo = new THREE.BoxGeometry(0.35, 0.12, 1.4).translate(0, 0, 0.6);
    else headGeo = new THREE.CylinderGeometry(0.18, 0.32, 0.5, 6);
    this.heads = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicNodeMaterial({ color: 0xffffff }), n);
    this.items.forEach((l, i) => {
      posts.setMatrixAt(i, setTRS(M, l.x, 0, l.z, l.rot, 1, H, 1));
      this.heads!.setMatrixAt(i, setTRS(M, l.x, H + 0.15, l.z, l.rot, 1, 1, 1));
    });
    posts.computeBoundingSphere();
    this.heads.computeBoundingSphere();
    this.refresh(0);
    g.add(posts, this.heads);
    return g;
  }

  private colorFor(on: boolean, night: number): THREE.Color {
    if (!on) return C.setHex(0x2a2a2e);
    C.setHex(this.headColor);
    // 白天灯也亮着,但暗一些
    return C.multiplyScalar(0.55 + 0.45 * night);
  }

  refresh(night: number) {
    if (!this.heads) return;
    this.items.forEach((l, i) => this.heads!.setColorAt(i, this.colorFor(l.on, night)));
    if (this.heads.instanceColor) this.heads.instanceColor.needsUpdate = true;
    this.lastNight = night;
  }

  toggle(i: number, night: number) {
    const l = this.items[i];
    l.on = !l.on;
    if (!this.heads) return;
    this.heads.setColorAt(i, this.colorFor(l.on, night));
    if (this.heads.instanceColor) this.heads.instanceColor.needsUpdate = true;
  }

  setAll(on: boolean, night: number) {
    for (const l of this.items) l.on = on;
    this.refresh(night);
  }

  update(night: number) {
    if (Math.abs(night - this.lastNight) > 0.05) this.refresh(night);
  }
}

// ====================================================================== 门(可开关,带动画)

export class DoorSet {
  readonly items: { x: number; y: number; z: number; rot: number; w: number; h: number; angle: number; target: number }[] = [];
  private mesh?: THREE.InstancedMesh;
  private readonly moving = new Set<number>();

  constructor(private readonly color: number) {}

  /** (x, z) 是铰链位置(城市本地),y 是门槛高度,rot 是门外法线方向的朝向角。 */
  add(x: number, z: number, rot: number, w: number, h: number, y = 0): number {
    this.items.push({ x, y, z, rot, w, h, angle: 0, target: 0 });
    return this.items.length - 1;
  }

  build(): THREE.InstancedMesh | null {
    if (this.items.length === 0) return null;
    const geo = new THREE.BoxGeometry(1, 1, 0.08).translate(0.5, 0.5, 0);
    this.mesh = new THREE.InstancedMesh(geo, std({ color: this.color, roughness: 0.6 }), this.items.length);
    this.items.forEach((_, i) => this.write(i));
    this.mesh.computeBoundingSphere();
    return this.mesh;
  }

  private write(i: number) {
    const d = this.items[i];
    this.mesh!.setMatrixAt(i, setTRS(M, d.x, d.y + 0.02, d.z, d.rot + d.angle, d.w, d.h, 1));
  }

  toggle(i: number): boolean {
    const d = this.items[i];
    d.target = d.target > 0 ? 0 : 1.75;
    this.moving.add(i);
    return d.target > 0;
  }

  isOpen(i: number) {
    return this.items[i].target > 0;
  }

  update(dt: number) {
    if (!this.mesh || this.moving.size === 0) return;
    for (const i of this.moving) {
      const d = this.items[i];
      const k = 1 - Math.exp(-dt * 7);
      d.angle += (d.target - d.angle) * k;
      if (Math.abs(d.target - d.angle) < 0.002) {
        d.angle = d.target;
        this.moving.delete(i);
      }
      this.write(i);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ====================================================================== 宝箱

export class ChestSet {
  readonly items: { x: number; z: number; rot: number; open: number; opened: boolean; reward: number }[] = [];
  private lids?: THREE.InstancedMesh;
  private readonly moving = new Set<number>();

  add(x: number, z: number, rot: number, reward: number) {
    this.items.push({ x, z, rot, open: 0, opened: false, reward });
  }

  build(): THREE.Group {
    const g = new THREE.Group();
    const n = this.items.length;
    if (n === 0) return g;
    const baseGeo = new THREE.BoxGeometry(0.9, 0.5, 0.6).translate(0, 0.25, 0);
    const lidGeo = new THREE.BoxGeometry(0.94, 0.22, 0.64).translate(0, 0.11, 0.32);
    const bandGeo = new THREE.BoxGeometry(0.96, 0.08, 0.66).translate(0, 0.42, 0);
    const base = new THREE.InstancedMesh(baseGeo, std({ color: 0x7a4a28 }), n);
    const band = new THREE.InstancedMesh(bandGeo, std({ color: 0xd8a83a, metalness: 0.8, roughness: 0.3 }), n);
    this.lids = new THREE.InstancedMesh(lidGeo, std({ color: 0x8a5530, emissive: 0x000000 }), n);
    this.items.forEach((c, i) => {
      base.setMatrixAt(i, setTRS(M, c.x, 0.15, c.z, c.rot, 1, 1, 1));
      band.setMatrixAt(i, setTRS(M, c.x, 0.15, c.z, c.rot, 1, 1, 1));
      this.write(i);
    });
    base.computeBoundingSphere();
    band.computeBoundingSphere();
    this.lids.computeBoundingSphere();
    g.add(base, band, this.lids);
    return g;
  }

  private write(i: number) {
    const c = this.items[i];
    // T(位置) · Ry(朝向) · T(后沿铰链) · Rx(-开盖角)
    setTRS(M, c.x, 0.15, c.z, c.rot, 1, 1, 1);
    M2.makeTranslation(0, 0.5, -0.32);
    M.multiply(M2);
    M2.makeRotationX(-c.open);
    M.multiply(M2);
    this.lids!.setMatrixAt(i, M);
  }

  open(i: number): number {
    const c = this.items[i];
    if (c.opened) return 0;
    c.opened = true;
    this.moving.add(i);
    return c.reward;
  }

  update(dt: number) {
    if (!this.lids || this.moving.size === 0) return;
    for (const i of this.moving) {
      const c = this.items[i];
      c.open += (1.9 - c.open) * (1 - Math.exp(-dt * 5));
      if (Math.abs(1.9 - c.open) < 0.003) {
        c.open = 1.9;
        this.moving.delete(i);
      }
      this.write(i);
    }
    this.lids.instanceMatrix.needsUpdate = true;
  }
}

// ====================================================================== 行人

interface Npc {
  x: number;
  z: number;
  yaw: number;
  edge: number;
  /** true = 从 a 走向 b */
  fwd: boolean;
  side: number;
  speed: number;
  phase: number;
  /** 当前目标点 */
  tx: number;
  tz: number;
  /** 目标是否为该边的终点(否则是起点,即刚拐弯) */
  toEnd: boolean;
  /** >0 时停下和玩家说话 */
  talk: number;
  faceX: number;
  faceZ: number;
  line: number;
}

export class NpcSet {
  readonly items: Npc[] = [];
  private body?: THREE.InstancedMesh;
  private head?: THREE.InstancedMesh;

  constructor(
    private readonly edges: RoadEdge[],
    private readonly nodes: Map<string, RoadNode>,
    private readonly clothes: number[],
    private readonly lineCount: number,
  ) {}

  private endpoints(e: RoadEdge, fwd: boolean, side: number) {
    const ax = fwd ? e.ax : e.bx;
    const az = fwd ? e.az : e.bz;
    const bx = fwd ? e.bx : e.ax;
    const bz = fwd ? e.bz : e.az;
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const dx = (bx - ax) / len;
    const dz = (bz - az) / len;
    const na = this.nodes.get(fwd ? e.a : e.b)!;
    const nb = this.nodes.get(fwd ? e.b : e.a)!;
    const ha = (e.alongX ? na.wx : na.wz) / 2 + 1.2;
    const hb = (e.alongX ? nb.wx : nb.wz) / 2 + 1.2;
    const off = e.w / 2 + 1.3;
    const px = -dz * side * off;
    const pz = dx * side * off;
    return {
      sx: ax + dx * ha + px,
      sz: az + dz * ha + pz,
      ex: bx - dx * hb + px,
      ez: bz - dz * hb + pz,
    };
  }

  spawn(count: number, rng: Rng) {
    if (this.edges.length === 0) return;
    for (let k = 0; k < count; k++) {
      const edge = rng.int(0, this.edges.length - 1);
      const fwd = rng.chance(0.5);
      const side = rng.chance(0.5) ? 1 : -1;
      const p = this.endpoints(this.edges[edge], fwd, side);
      const s = rng.next();
      this.items.push({
        x: p.sx + (p.ex - p.sx) * s,
        z: p.sz + (p.ez - p.sz) * s,
        yaw: 0,
        edge,
        fwd,
        side,
        speed: rng.range(1.0, 1.6),
        phase: rng.range(0, 6.28),
        tx: p.ex,
        tz: p.ez,
        toEnd: true,
        talk: 0,
        faceX: 0,
        faceZ: 0,
        line: rng.int(0, Math.max(0, this.lineCount - 1)),
      });
    }
  }

  build(rng: Rng): THREE.Group {
    const g = new THREE.Group();
    const n = this.items.length;
    if (n === 0) return g;
    const bodyGeo = new THREE.CapsuleGeometry(0.26, 0.85, 2, 6).translate(0, 0.26 + 0.425, 0);
    const headGeo = new THREE.SphereGeometry(0.2, 7, 5).translate(0, 1.6, 0);
    this.body = new THREE.InstancedMesh(bodyGeo, std({ roughness: 0.9 }), n);
    this.head = new THREE.InstancedMesh(headGeo, std({ roughness: 0.7 }), n);
    const skins = [0xf0c8a0, 0xd8a878, 0xb07850, 0x8a5a3a, 0xf4d4b8];
    this.items.forEach((_, i) => {
      this.body!.setColorAt(i, C.setHex(this.clothes[rng.int(0, this.clothes.length - 1)]));
      this.head!.setColorAt(i, C.setHex(skins[rng.int(0, skins.length - 1)]));
    });
    this.body.frustumCulled = false;
    this.head.frustumCulled = false;
    this.write();
    g.add(this.body, this.head);
    return g;
  }

  private nextEdge(n: Npc, rng: Rng) {
    const e = this.edges[n.edge];
    const nodeKey = n.fwd ? e.b : e.a;
    const node = this.nodes.get(nodeKey)!;
    const options = node.edges.filter((i) => i !== n.edge);
    const next = options.length > 0 && !rng.chance(0.04) ? options[rng.int(0, options.length - 1)] : n.edge;
    const ne = this.edges[next];
    n.edge = next;
    // 从当前节点出发:若节点是该边的 a 端则正向,否则反向
    n.fwd = ne.a === nodeKey;
    if (rng.chance(0.15)) n.side = -n.side;
    const p = this.endpoints(ne, n.fwd, n.side);
    n.tx = p.sx;
    n.tz = p.sz;
    n.toEnd = false;
  }

  talkTo(i: number, px: number, pz: number): number {
    const n = this.items[i];
    n.talk = 4.5;
    n.faceX = px;
    n.faceZ = pz;
    return n.line;
  }

  update(dt: number, rng: Rng) {
    if (!this.body) return;
    for (const n of this.items) {
      if (n.talk > 0) {
        n.talk -= dt;
        const want = Math.atan2(n.faceX - n.x, n.faceZ - n.z);
        n.yaw += angleDiff(want, n.yaw) * (1 - Math.exp(-dt * 6));
        continue;
      }
      const dx = n.tx - n.x;
      const dz = n.tz - n.z;
      const d = Math.hypot(dx, dz);
      const step = n.speed * dt;
      if (d <= step) {
        n.x = n.tx;
        n.z = n.tz;
        if (n.toEnd) {
          this.nextEdge(n, rng);
        } else {
          const p = this.endpoints(this.edges[n.edge], n.fwd, n.side);
          n.tx = p.ex;
          n.tz = p.ez;
          n.toEnd = true;
        }
        continue;
      }
      n.x += (dx / d) * step;
      n.z += (dz / d) * step;
      n.phase += dt * n.speed * 5.5;
      const want = Math.atan2(dx, dz);
      n.yaw += angleDiff(want, n.yaw) * (1 - Math.exp(-dt * 8));
    }
    this.write();
  }

  private write() {
    this.items.forEach((n, i) => {
      const bob = n.talk > 0 ? 0 : Math.abs(Math.sin(n.phase)) * 0.06;
      setTRS(M, n.x, 0.15 + bob, n.z, n.yaw, 1, 1, 1);
      this.body!.setMatrixAt(i, M);
      this.head!.setMatrixAt(i, M);
    });
    this.body!.instanceMatrix.needsUpdate = true;
    this.head!.instanceMatrix.needsUpdate = true;
  }
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
