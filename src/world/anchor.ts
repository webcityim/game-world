import * as THREE from "three/webgpu";
import { PLANET_RADIUS } from "../config";
import type { Terrain } from "./terrain";

/**
 * 锚点:挂在行星表面某个方向上的对象(商铺广场、奇观)。
 * 本地坐标系的 +Y 指向行星外侧。位置用 float64 保存,每帧减去相机位置后再交给渲染器。
 */
export class Anchor {
  readonly object = new THREE.Group();
  readonly pos = new THREE.Vector3();
  readonly up = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();

  constructor(
    readonly dir: THREE.Vector3,
    readonly height: number,
    heading = 0,
  ) {
    this.up.copy(dir).normalize();
    this.pos.copy(this.up).multiplyScalar(PLANET_RADIUS + height);
    this.quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.up);
    this.quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading));
  }

  update(cam: THREE.Vector3) {
    this.object.position.copy(this.pos).sub(cam);
    this.object.quaternion.copy(this.quat);
  }
}

export interface SiteSpec {
  minH: number;
  maxH: number;
  /** 以 200m 为尺度采样得到的最大坡度(高差/距离) */
  maxSlope: number;
  /** 与第 nearIndex 个已选地点的角距离范围(弧度) */
  nearIndex?: number;
  minAngle?: number;
  maxAngle?: number;
  /** 与所有已选地点的最小角距离(弧度),默认 0.01 */
  sepAngle?: number;
}

/**
 * 在行星上按顺序挑选地点:沿斐波那契螺旋(打乱顺序,保证确定性)扫描,
 * 找到满足海拔 / 坡度 / 距离条件的第一个点。必须在地形块生成之前调用,
 * 之后再用 Terrain.addFlatZone 把这些点压平。
 */
export function pickSites(terrain: Terrain, specs: SiteSpec[]): THREE.Vector3[] {
  const N = 60000;
  const chosen: THREE.Vector3[] = [];
  const p = new THREE.Vector3();
  const R = PLANET_RADIUS;
  const eps = 200 / R;

  const h = (x: number, y: number, z: number) => terrain.height(x, y, z, 4e5);

  for (const wanted of specs) {
    let found: THREE.Vector3 | null = null;
    // 条件太苛刻找不到时逐步放宽坡度和海拔上限,保证应用总能启动
    for (let relax = 0; relax < 4 && !found; relax++) {
    const spec: SiteSpec = {
      ...wanted,
      maxSlope: wanted.maxSlope * (1 + relax),
      maxH: wanted.maxH * (1 + relax * 2),
      maxAngle: wanted.maxAngle === undefined ? undefined : wanted.maxAngle * (1 + relax),
    };
    for (let n = 0; n < N && !found; n++) {
      const k = (n * 7919) % N;
      const y = 1 - (2 * (k + 0.5)) / N;
      if (Math.abs(y) > 0.75) continue;
      const r = Math.sqrt(1 - y * y);
      const phi = k * 2.399963229728653;
      p.set(Math.cos(phi) * r, y, Math.sin(phi) * r);

      const h0 = h(p.x, p.y, p.z);
      if (h0 < spec.minH || h0 > spec.maxH) continue;

      let ok = true;
      const sep = spec.sepAngle ?? 0.01;
      for (const c of chosen) {
        if (Math.acos(Math.min(1, p.dot(c))) < sep) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      if (spec.nearIndex !== undefined) {
        const a = Math.acos(Math.min(1, p.dot(chosen[spec.nearIndex])));
        if (a < (spec.minAngle ?? 0) || a > (spec.maxAngle ?? Math.PI)) continue;
      }

      // 坡度:沿两个切线方向各采一对点
      const t1 = new THREE.Vector3(-p.z, 0, p.x).normalize();
      const t2 = new THREE.Vector3().crossVectors(p, t1).normalize();
      let maxSlope = 0;
      for (const t of [t1, t2]) {
        const a = h(p.x + t.x * eps, p.y + t.y * eps, p.z + t.z * eps);
        const b = h(p.x - t.x * eps, p.y - t.y * eps, p.z - t.z * eps);
        maxSlope = Math.max(maxSlope, Math.abs(a - b) / 400);
      }
      if (maxSlope > spec.maxSlope) continue;

      found = p.clone();
    }
    }
    if (!found) throw new Error("pickSites: no site satisfies spec " + JSON.stringify(wanted));
    chosen.push(found);
  }
  return chosen;
}
