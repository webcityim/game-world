import * as THREE from "three/webgpu";
import { atan2, color, float, length, mix, smoothstep, sin, time, uv } from "three/tsl";
import { createNoise3 } from "../noise";
import { fbm3, mixc, type RGB3 } from "../geo";

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
  /** 每帧传入相机到奇观的距离,用来切换主体的精细 / 粗糙模型 */
  setDistance?: (d: number) => void;
  /** 细节层:只有相机离奇观 detailDistance 米以内才显示(远处只画主体轮廓) */
  detail?: THREE.Object3D;
  detailDistance?: number;
}

/** 顶点色材质(几何自带颜色)。 */
export const vcMat = (extra: Record<string, unknown> = {}) =>
  new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, ...extra });

export const std = (hex: number, extra: Record<string, unknown> = {}) =>
  new THREE.MeshStandardNodeMaterial({ color: hex, roughness: 0.9, metalness: 0, ...extra });

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface RockStyle {
  /** 岩层配色(浅 / 深) */
  a: RGB3;
  b: RGB3;
  /** 每米的岩层频率 */
  band: number;
  seed: number;
  /** 朝上的表面长苔藓 / 草 */
  moss?: RGB3;
  mossMin?: number;
  /** 底部变暗的高度(米) */
  darkenBelow?: number;
}

/** 岩石着色:水平岩层 + 噪声斑驳 + 向上的面长苔藓。返回给 paint 用的函数。 */
export function rockPainter(st: RockStyle) {
  const n = createNoise3(st.seed);
  const n2 = createNoise3(st.seed + 99);
  return (x: number, y: number, z: number, _nx: number, ny: number, _nz?: number): RGB3 => {
    const wob = fbm3(n, x * 0.02, y * 0.02, z * 0.02, 3);
    const band = 0.5 + 0.5 * Math.sin(y * st.band + wob * 5);
    const fine = 0.5 + 0.5 * Math.sin(y * st.band * 4.3 + wob * 9 + x * 0.01);
    let c = mixc(st.a, st.b, band * 0.75 + fine * 0.25);
    const spec = 0.88 + 0.24 * fbm3(n2, x * 0.07, y * 0.07, z * 0.07, 3);
    c = [c[0] * spec, c[1] * spec, c[2] * spec];
    if (st.moss) {
      const m = smooth(st.mossMin ?? 0.55, 0.85, ny + 0.15 * wob);
      c = mixc(c, st.moss, m);
    }
    if (st.darkenBelow) {
      const d = 1 - 0.35 * (1 - smooth(0, st.darkenBelow, y));
      c = [c[0] * d, c[1] * d, c[2] * d];
    }
    return c;
  };
}

/** 瀑布:竖直平面,水纹自上而下流动,底部泛白沫。宽 w,高 h,原点在底边中点。 */
export function makeWaterfall(w: number, h: number): THREE.Mesh {
  const mat = new THREE.MeshStandardNodeMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 0.25, metalness: 0 });
  const u = uv();
  const streak = sin(u.x.mul(w * 0.55).add(sin(u.y.mul(h * 0.012).add(time.mul(0.45))).mul(2.2)))
    .mul(0.5)
    .add(0.5);
  const pulse = sin(u.y.mul(h * 0.05).add(time.mul(7)).add(u.x.mul(17))).mul(0.5).add(0.5);
  const foam = smoothstep(0.1, 0.0, u.y);
  const edge = smoothstep(0.0, 0.12, u.x).mul(smoothstep(1.0, 0.88, u.x));
  const body = mix(color(0x4aa8ee), color(0xffffff), streak.mul(pulse).mul(0.85).add(foam));
  mat.colorNode = body;
  mat.emissiveNode = body.mul(0.35);
  mat.opacityNode = streak.mul(pulse).mul(0.5).add(0.32).add(foam.mul(0.4)).mul(edge);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h, 1, 1), mat);
  m.geometry.translate(0, h / 2, 0);
  return m;
}

/** 传送门:圆盘上的旋涡,紫 / 青渐变,边缘羽化。 */
export function makePortal(radius: number): THREE.Mesh {
  const mat = new THREE.MeshStandardNodeMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 0.5, metalness: 0 });
  const p = uv().sub(0.5).mul(2);
  const r = length(p);
  const a = atan2(p.y, p.x);
  const swirl = sin(a.mul(5).add(r.mul(11)).sub(time.mul(1.4))).mul(0.5).add(0.5);
  const swirl2 = sin(a.mul(3).sub(r.mul(7)).add(time.mul(0.9))).mul(0.5).add(0.5);
  const col = mix(mix(color(0x6a3df0), color(0x35c8ff), swirl), color(0xffffff), swirl2.mul(0.35).mul(smoothstep(0.7, 0.0, r)));
  mat.colorNode = col;
  mat.emissiveNode = col.mul(0.9);
  mat.opacityNode = smoothstep(1.0, 0.82, r).mul(float(0.3).add(swirl.mul(0.3)).add(smoothstep(0.35, 0.0, r).mul(0.2)));
  return new THREE.Mesh(new THREE.CircleGeometry(radius, 96), mat);
}
