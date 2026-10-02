import * as THREE from "three/webgpu";
import { createNoise3, type Noise3 } from "./noise";

/**
 * 程序化几何的小工具:合并、上色、噪声位移、扫掠管。
 * (three/addons 的 BufferGeometryUtils 在本地验证环境里没有,这里自带最小实现。)
 */

export type RGB3 = [number, number, number];

const _c = new THREE.Color();

/** 给几何加上顶点色(统一色,或者按顶点位置计算)。 */
export function paint(
  geo: THREE.BufferGeometry,
  color: THREE.ColorRepresentation | RGB3 | number[] | ((x: number, y: number, z: number, nx: number, ny: number, nz: number) => RGB3),
): THREE.BufferGeometry {
  const pos = geo.getAttribute("position");
  const nor = geo.getAttribute("normal");
  const col = new Float32Array(pos.count * 3);
  if (typeof color === "function") {
    for (let i = 0; i < pos.count; i++) {
      const c = color(pos.getX(i), pos.getY(i), pos.getZ(i), nor ? nor.getX(i) : 0, nor ? nor.getY(i) : 1, nor ? nor.getZ(i) : 0);
      col[i * 3] = c[0];
      col[i * 3 + 1] = c[1];
      col[i * 3 + 2] = c[2];
    }
  } else if (Array.isArray(color)) {
    for (let i = 0; i < pos.count; i++) {
      col[i * 3] = color[0];
      col[i * 3 + 1] = color[1];
      col[i * 3 + 2] = color[2];
    }
  } else {
    _c.set(color);
    for (let i = 0; i < pos.count; i++) {
      col[i * 3] = _c.r;
      col[i * 3 + 1] = _c.g;
      col[i * 3 + 2] = _c.b;
    }
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return geo;
}

/** 合并若干几何(都要有 position / normal / color;没有 color 的补白色)。丢弃 uv。 */
export function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let vCount = 0;
  let iCount = 0;
  for (const g of geos) {
    vCount += g.getAttribute("position").count;
    iCount += g.index ? g.index.count : g.getAttribute("position").count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const col = new Float32Array(vCount * 3).fill(1);
  const idx = new Uint32Array(iCount);
  let vo = 0;
  let io = 0;
  for (const g of geos) {
    const p = g.getAttribute("position");
    const n = g.getAttribute("normal");
    const c = g.getAttribute("color");
    for (let i = 0; i < p.count; i++) {
      pos[(vo + i) * 3] = p.getX(i);
      pos[(vo + i) * 3 + 1] = p.getY(i);
      pos[(vo + i) * 3 + 2] = p.getZ(i);
      if (n) {
        nor[(vo + i) * 3] = n.getX(i);
        nor[(vo + i) * 3 + 1] = n.getY(i);
        nor[(vo + i) * 3 + 2] = n.getZ(i);
      }
      if (c) {
        col[(vo + i) * 3] = c.getX(i);
        col[(vo + i) * 3 + 1] = c.getY(i);
        col[(vo + i) * 3 + 2] = c.getZ(i);
      }
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + vo;
    else for (let i = 0; i < p.count; i++) idx[io++] = vo + i;
    vo += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setAttribute("color", new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(vCount > 65535 ? idx : new Uint16Array(idx), 1));
  return out;
}

/** 合并位置重合的顶点(参数化几何的接缝),这样位移后不会裂开,法线也连续。 */
export function weld(geo: THREE.BufferGeometry, precision = 1e-3): THREE.BufferGeometry {
  const pos = geo.getAttribute("position");
  const col = geo.getAttribute("color");
  const map = new Map<string, number>();
  const remap = new Uint32Array(pos.count);
  const keep: number[] = [];
  const k = 1 / precision;
  for (let i = 0; i < pos.count; i++) {
    const key = `${Math.round(pos.getX(i) * k)},${Math.round(pos.getY(i) * k)},${Math.round(pos.getZ(i) * k)}`;
    let j = map.get(key);
    if (j === undefined) {
      j = keep.length;
      map.set(key, j);
      keep.push(i);
    }
    remap[i] = j;
  }
  const npos = new Float32Array(keep.length * 3);
  const ncol = col ? new Float32Array(keep.length * 3) : null;
  keep.forEach((src, j) => {
    npos[j * 3] = pos.getX(src);
    npos[j * 3 + 1] = pos.getY(src);
    npos[j * 3 + 2] = pos.getZ(src);
    if (ncol && col) {
      ncol[j * 3] = col.getX(src);
      ncol[j * 3 + 1] = col.getY(src);
      ncol[j * 3 + 2] = col.getZ(src);
    }
  });
  const index = geo.index;
  const nidx: number[] = [];
  const count = index ? index.count : pos.count;
  for (let i = 0; i < count; i += 3) {
    const a = remap[index ? index.getX(i) : i];
    const b = remap[index ? index.getX(i + 1) : i + 1];
    const c = remap[index ? index.getX(i + 2) : i + 2];
    if (a !== b && b !== c && a !== c) nidx.push(a, b, c);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(npos, 3));
  if (ncol) out.setAttribute("color", new THREE.BufferAttribute(ncol, 3));
  out.setIndex(nidx);
  out.computeVertexNormals();
  return out;
}

export function fbm3(n: Noise3, x: number, y: number, z: number, octaves: number, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * n(x * f, y * f, z * f);
    norm += amp;
    amp *= gain;
    f *= 2.03;
  }
  return sum / norm;
}

export function ridged3(n: Noise3, x: number, y: number, z: number, octaves: number, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    const r = 1 - Math.abs(n(x * f, y * f, z * f));
    sum += amp * r * r;
    norm += amp;
    amp *= gain;
    f *= 2.07;
  }
  return sum / norm;
}

/**
 * 沿法线方向做 fbm 位移(先 weld 再位移,保证无裂缝),然后重算法线。
 * freq 是每米的频率;amp 为米。fn 可以对位移量再做调制(例如只位移侧面)。
 */
export function displace(
  geo: THREE.BufferGeometry,
  seed: number,
  freq: number,
  amp: number,
  octaves = 4,
  fn?: (x: number, y: number, z: number, d: number) => number,
): THREE.BufferGeometry {
  const g = weld(geo);
  const n = createNoise3(seed);
  const pos = g.getAttribute("position");
  const nor = g.getAttribute("normal");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    let d = fbm3(n, x * freq, y * freq, z * freq, octaves) * amp;
    if (fn) d = fn(x, y, z, d);
    pos.setXYZ(i, x + nor.getX(i) * d, y + nor.getY(i) * d, z + nor.getZ(i) * d);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * 沿一条曲线扫掠出管状几何,半径随进度变化(用于树根、肋骨、角、藤蔓)。
 * radius(t, theta) 可以带角度,做出树皮纹理 / 棱角。
 */
export function sweep(
  curve: THREE.Curve<THREE.Vector3>,
  segments: number,
  radial: number,
  radius: (t: number, theta: number) => number,
  capEnds = true,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const frames = curve.computeFrenetFrames(segments, false);
  const P = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, P);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    for (let j = 0; j < radial; j++) {
      const th = (j / radial) * Math.PI * 2;
      const r = radius(t, th);
      pos.push(
        P.x + r * (Math.cos(th) * N.x + Math.sin(th) * B.x),
        P.y + r * (Math.cos(th) * N.y + Math.sin(th) * B.y),
        P.z + r * (Math.cos(th) * N.z + Math.sin(th) * B.z),
      );
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j;
      const b = i * radial + ((j + 1) % radial);
      const c = (i + 1) * radial + j;
      const d = (i + 1) * radial + ((j + 1) % radial);
      idx.push(a, b, c, b, d, c);
    }
  }
  if (capEnds) {
    for (const end of [0, segments]) {
      const t = end / segments;
      curve.getPointAt(t, P);
      const ci = pos.length / 3;
      pos.push(P.x, P.y, P.z);
      for (let j = 0; j < radial; j++) {
        const a = end * radial + j;
        const b = end * radial + ((j + 1) % radial);
        if (end === 0) idx.push(ci, b, a);
        else idx.push(ci, a, b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function xform(geo: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry {
  geo.applyMatrix4(m);
  return geo;
}

export const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
export const S = (x: number, y: number, z: number) => new THREE.Matrix4().makeScale(x, y, z);
export const RX = (a: number) => new THREE.Matrix4().makeRotationX(a);
export const RY = (a: number) => new THREE.Matrix4().makeRotationY(a);
export const RZ = (a: number) => new THREE.Matrix4().makeRotationZ(a);

export function rngOf(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const mixc = (a: RGB3, b: RGB3, t: number): RGB3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const hexRGB = (hex: number): RGB3 => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
