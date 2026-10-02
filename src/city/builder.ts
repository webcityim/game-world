import * as THREE from "three/webgpu";

/**
 * 外立面类型。写入顶点属性 facB.x,由 material.ts 里的 TSL 着色器按类型画出细节:
 * 窗户、玻璃幕墙、木筋墙、瓦片、铺地、道路标线、草地。
 * 这样整座城市可以合并成很少的几个 mesh,细节全部在像素着色器里程序化生成。
 */
export const enum Facade {
  Plain = 0,
  Windows = 1,
  Glass = 2,
  Timber = 3,
  Tiles = 4,
  Paving = 5,
  Road = 6,
  Grass = 7,
  Wood = 8,
}

type RGB = readonly [number, number, number];

export function hex(c: number): RGB {
  return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
}

/** 颜色做一点亮度扰动,避免整条街一模一样。 */
export function jitter(c: RGB, amount: number, r: number): RGB {
  const k = 1 + (r * 2 - 1) * amount;
  return [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];
}

/**
 * 合并几何体构建器。所有坐标都在"城市本地坐标系"里:+Y 向上,XZ 是地面。
 * 通过 frame(cx, cz, rot) 设置当前建筑的局部坐标系,之后的形状都相对它摆放。
 * 每个面都有独立顶点(硬边法线),外加两个自定义属性:
 *   facA = (u, v, width)  面上的米制坐标与面宽,给着色器排窗户用
 *   facB = (type, rand)   外立面类型与该建筑的随机数
 */
export class GeometryBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private facA: number[] = [];
  private facB: number[] = [];
  private idx: number[] = [];

  private fx = 0;
  private fz = 0;
  private fc = 1;
  private fs = 0;
  private fy = 0;

  /** 当前建筑的随机数(写入 facB.y),用于窗户亮灯等变化 */
  rand = 0;

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  frame(cx: number, cz: number, rot: number, y = 0): this {
    this.fx = cx;
    this.fz = cz;
    this.fc = Math.cos(rot);
    this.fs = Math.sin(rot);
    this.fy = y;
    return this;
  }

  /**
   * 在当前坐标系基础上临时绕 Y 轴再转 delta 弧度(原点不变),执行 fn 后恢复。
   * 转 +90° 时,原坐标系里的点 (x, z) 在新坐标系中是 (-z, x)。
   */
  rotated(delta: number, fn: () => void) {
    const c = this.fc;
    const s = this.fs;
    const cd = Math.cos(delta);
    const sd = Math.sin(delta);
    this.fc = c * cd - s * sd;
    this.fs = s * cd + c * sd;
    fn();
    this.fc = c;
    this.fs = s;
  }

  private tx(x: number, z: number): [number, number] {
    return [this.fx + x * this.fc + z * this.fs, this.fz - x * this.fs + z * this.fc];
  }

  private tn(nx: number, nz: number): [number, number] {
    return [nx * this.fc + nz * this.fs, -nx * this.fs + nz * this.fc];
  }

  /**
   * 通用四边形(局部坐标,逆时针 = 正面)。uv 是每个角在面上的米制坐标。
   */
  quad(
    p: readonly (readonly [number, number, number])[],
    uv: readonly (readonly [number, number])[],
    width: number,
    color: RGB,
    type: Facade,
  ) {
    // 用叉积求法线(局部坐标),再旋转到城市坐标
    const ax = p[1][0] - p[0][0];
    const ay = p[1][1] - p[0][1];
    const az = p[1][2] - p[0][2];
    const bx = p[2][0] - p[0][0];
    const by = p[2][1] - p[0][1];
    const bz = p[2][2] - p[0][2];
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const [wnx, wnz] = this.tn(nx, nz);

    const base = this.vertexCount;
    for (let i = 0; i < 4; i++) {
      const [x, z] = this.tx(p[i][0], p[i][2]);
      this.pos.push(x, p[i][1] + this.fy, z);
      this.nor.push(wnx, ny, wnz);
      this.col.push(color[0], color[1], color[2]);
      this.facA.push(uv[i][0], uv[i][1], width);
      this.facB.push(type, this.rand);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  tri(
    p: readonly (readonly [number, number, number])[],
    uv: readonly (readonly [number, number])[],
    width: number,
    color: RGB,
    type: Facade,
  ) {
    const ax = p[1][0] - p[0][0];
    const ay = p[1][1] - p[0][1];
    const az = p[1][2] - p[0][2];
    const bx = p[2][0] - p[0][0];
    const by = p[2][1] - p[0][1];
    const bz = p[2][2] - p[0][2];
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const [wnx, wnz] = this.tn(nx, nz);
    const base = this.vertexCount;
    for (let i = 0; i < 3; i++) {
      const [x, z] = this.tx(p[i][0], p[i][2]);
      this.pos.push(x, p[i][1] + this.fy, z);
      this.nor.push(wnx, ny, wnz);
      this.col.push(color[0], color[1], color[2]);
      this.facA.push(uv[i][0], uv[i][1], width);
      this.facB.push(type, this.rand);
    }
    this.idx.push(base, base + 1, base + 2);
  }

  /**
   * 竖直墙面:从 (x0,z0) 到 (x1,z1),高度 y0..y1。站在墙外看,x0 在左。
   * v 从 vBase 开始计(通常 = 建筑底部),这样各层楼的窗户在上下几段墙上能对齐。
   */
  wall(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, color: RGB, type: Facade, vBase = 0) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const va = y0 - vBase;
    const vb = y1 - vBase;
    this.quad(
      [
        [x0, y0, z0],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z0],
      ],
      [
        [0, va],
        [len, va],
        [len, vb],
        [0, vb],
      ],
      len,
      color,
      type,
    );
  }

  /** 水平矩形(朝上),uv 用城市坐标,适合地面铺装。 */
  flat(x0: number, z0: number, x1: number, z1: number, y: number, color: RGB, type: Facade) {
    const c = [
      [x0, z1],
      [x1, z1],
      [x1, z0],
      [x0, z0],
    ] as const;
    const p = c.map(([x, z]) => [x, y, z] as const);
    const uv = c.map(([x, z]) => {
      const [wx, wz] = this.tx(x, z);
      return [wx, wz] as const;
    });
    this.quad(p, uv, Math.abs(x1 - x0), color, type);
  }

  /**
   * 道路:沿局部 X 方向,u = 沿路长度,v = 横向(-w/2..w/2)。
   * markW 写入着色器的"路宽",小于 9 m 时不画标线(路口用 0)。
   */
  road(x0: number, x1: number, zc: number, w: number, y: number, color: RGB, markW = w) {
    const h = w / 2;
    this.quad(
      [
        [x0, y, zc + h],
        [x1, y, zc + h],
        [x1, y, zc - h],
        [x0, y, zc - h],
      ],
      [
        [x0, h],
        [x1, h],
        [x1, -h],
        [x0, -h],
      ],
      markW,
      color,
      Facade.Road,
    );
  }

  /**
   * 立方体:中心 (cx, cz),宽 w(局部 X)、深 d(局部 Z),高度 y0..y1。
   * 墙面用 type,顶面用 topColor(null 表示不画顶)。
   */
  box(
    cx: number,
    cz: number,
    w: number,
    d: number,
    y0: number,
    y1: number,
    color: RGB,
    type: Facade = Facade.Plain,
    topColor: RGB | null = color,
    vBase = y0,
  ) {
    const x0 = cx - w / 2;
    const x1 = cx + w / 2;
    const z0 = cz - d / 2;
    const z1 = cz + d / 2;
    this.wall(x0, z1, x1, z1, y0, y1, color, type, vBase); // +Z
    this.wall(x1, z1, x1, z0, y0, y1, color, type, vBase); // +X
    this.wall(x1, z0, x0, z0, y0, y1, color, type, vBase); // -Z
    this.wall(x0, z0, x0, z1, y0, y1, color, type, vBase); // -X
    if (topColor) this.flat(x0, z0, x1, z1, y1, topColor, Facade.Plain);
  }

  /**
   * 双坡屋顶:屋脊沿局部 X。overhang 为出檐。
   * 两个坡面用瓦片纹理,两端山墙用 gableColor。
   */
  gable(cx: number, cz: number, w: number, d: number, y0: number, rise: number, overhang: number, roof: RGB, gableColor: RGB) {
    const x0 = cx - w / 2 - overhang;
    const x1 = cx + w / 2 + overhang;
    const z0 = cz - d / 2 - overhang;
    const z1 = cz + d / 2 + overhang;
    const ye = y0 - overhang * (rise / (d / 2));
    const yr = y0 + rise;
    const slope = Math.hypot(d / 2 + overhang, yr - ye);
    const L = x1 - x0;
    // 南坡(+Z)
    this.quad(
      [
        [x0, ye, z1],
        [x1, ye, z1],
        [x1, yr, cz],
        [x0, yr, cz],
      ],
      [
        [0, 0],
        [L, 0],
        [L, slope],
        [0, slope],
      ],
      L,
      roof,
      Facade.Tiles,
    );
    // 北坡(-Z)
    this.quad(
      [
        [x1, ye, z0],
        [x0, ye, z0],
        [x0, yr, cz],
        [x1, yr, cz],
      ],
      [
        [0, 0],
        [L, 0],
        [L, slope],
        [0, slope],
      ],
      L,
      roof,
      Facade.Tiles,
    );
    // 屋檐底面
    this.quad(
      [
        [x0, ye, z0],
        [x1, ye, z0],
        [x1, ye, z1],
        [x0, ye, z1],
      ],
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      1,
      roof,
      Facade.Plain,
    );
    // 山墙(三角形)
    const gx0 = cx - w / 2;
    const gx1 = cx + w / 2;
    const gz0 = cz - d / 2;
    const gz1 = cz + d / 2;
    this.tri(
      [
        [gx1, y0, gz1],
        [gx1, y0, gz0],
        [gx1, yr, cz],
      ],
      [
        [0, 0],
        [d, 0],
        [d / 2, rise],
      ],
      d,
      gableColor,
      Facade.Plain,
    );
    this.tri(
      [
        [gx0, y0, gz0],
        [gx0, y0, gz1],
        [gx0, yr, cz],
      ],
      [
        [0, 0],
        [d, 0],
        [d / 2, rise],
      ],
      d,
      gableColor,
      Facade.Plain,
    );
  }

  /**
   * 四坡屋顶。ridge = 屋脊长度占 (w - d) 的比例;w <= d 时退化成攒尖。
   * flare > 0 时檐口外翘(东方风格),用一圈更平的"檐裙"近似。
   */
  hip(cx: number, cz: number, w: number, d: number, y0: number, rise: number, overhang: number, roof: RGB, flare = 0) {
    const hw = w / 2 + overhang;
    const hd = d / 2 + overhang;
    const ridgeHalf = Math.max(0, hw - hd);
    const yr = y0 + rise;

    let ex = hw;
    let ez = hd;
    let ey = y0;
    if (flare > 0) {
      // 檐裙:从 (hw+flare, y0+flare*0.35) 向内上升到 (hw, y0+...)
      const fx = hw + flare;
      const fz = hd + flare;
      const fy = y0 - flare * 0.05;
      const iy = y0 + flare * 0.3;
      const ring = (sx: number, sz: number, y: number) =>
        [
          [cx - sx, y, cz + sz],
          [cx + sx, y, cz + sz],
          [cx + sx, y, cz - sz],
          [cx - sx, y, cz - sz],
        ] as const;
      const outer = ring(fx, fz, fy);
      const inner = ring(hw, hd, iy);
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        const len = Math.hypot(outer[j][0] - outer[i][0], outer[j][2] - outer[i][2]);
        this.quad([outer[i], outer[j], inner[j], inner[i]], [
          [0, 0],
          [len, 0],
          [len, flare],
          [0, flare],
        ], len, roof, Facade.Tiles);
        // 底面
        this.quad([outer[j], outer[i], [outer[i][0], fy - 0.25, outer[i][2]], [outer[j][0], fy - 0.25, outer[j][2]]], [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ], 1, roof, Facade.Plain);
      }
      // 檐裙底面(从街上抬头能看到)
      const by = fy - 0.25;
      this.quad(
        [
          [cx - fx, by, cz - fz],
          [cx + fx, by, cz - fz],
          [cx + fx, by, cz + fz],
          [cx - fx, by, cz + fz],
        ],
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
        1,
        roof,
        Facade.Plain,
      );
      ey = iy;
      ex = hw;
      ez = hd;
    }

    const A = [cx - ex, ey, cz + ez] as const;
    const B = [cx + ex, ey, cz + ez] as const;
    const C = [cx + ex, ey, cz - ez] as const;
    const D = [cx - ex, ey, cz - ez] as const;
    const R1 = [cx - ridgeHalf, yr, cz] as const;
    const R2 = [cx + ridgeHalf, yr, cz] as const;
    const sz = Math.hypot(ez, yr - ey);
    const sx = Math.hypot(ex - ridgeHalf, yr - ey);
    // 前后两个梯形坡
    this.quad([A, B, R2, R1], [
      [0, 0],
      [2 * ex, 0],
      [ex + ridgeHalf, sz],
      [ex - ridgeHalf, sz],
    ], 2 * ex, roof, Facade.Tiles);
    this.quad([C, D, R1, R2], [
      [0, 0],
      [2 * ex, 0],
      [ex + ridgeHalf, sz],
      [ex - ridgeHalf, sz],
    ], 2 * ex, roof, Facade.Tiles);
    // 两端三角坡
    this.tri([B, C, R2], [
      [0, 0],
      [2 * ez, 0],
      [ez, sx],
    ], 2 * ez, roof, Facade.Tiles);
    this.tri([D, A, R1], [
      [0, 0],
      [2 * ez, 0],
      [ez, sx],
    ], 2 * ez, roof, Facade.Tiles);
    if (flare <= 0) {
      // 出檐底面
      this.quad([D, C, B, A], [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ], 1, roof, Facade.Plain);
    }
  }

  /** 竖直棱柱/圆柱(segments 段)。 */
  cylinder(cx: number, cz: number, r0: number, r1: number, y0: number, y1: number, segs: number, color: RGB, type: Facade = Facade.Plain, cap = true) {
    const circ = 2 * Math.PI * r0;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      const u0 = (i / segs) * circ;
      const u1 = ((i + 1) / segs) * circ;
      this.quad(
        [
          [cx + Math.cos(a1) * r0, y0, cz + Math.sin(a1) * r0],
          [cx + Math.cos(a0) * r0, y0, cz + Math.sin(a0) * r0],
          [cx + Math.cos(a0) * r1, y1, cz + Math.sin(a0) * r1],
          [cx + Math.cos(a1) * r1, y1, cz + Math.sin(a1) * r1],
        ],
        [
          [u1, 0],
          [u0, 0],
          [u0, y1 - y0],
          [u1, y1 - y0],
        ],
        circ / segs,
        color,
        type,
      );
      if (cap && r1 > 0.001) {
        this.tri(
          [
            [cx + Math.cos(a1) * r1, y1, cz + Math.sin(a1) * r1],
            [cx + Math.cos(a0) * r1, y1, cz + Math.sin(a0) * r1],
            [cx, y1, cz],
          ],
          [
            [0, 0],
            [1, 0],
            [0, 1],
          ],
          1,
          color,
          Facade.Plain,
        );
      }
    }
  }

  /** 圆锥(尖顶)。 */
  cone(cx: number, cz: number, r: number, y0: number, h: number, segs: number, color: RGB, type: Facade = Facade.Tiles) {
    const slant = Math.hypot(r, h);
    const circ = 2 * Math.PI * r;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      this.tri(
        [
          [cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r],
          [cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r],
          [cx, y0 + h, cz],
        ],
        [
          [0, 0],
          [circ / segs, 0],
          [circ / segs / 2, slant],
        ],
        circ / segs,
        color,
        type,
      );
    }
  }

  /** 半球穹顶。 */
  dome(cx: number, cz: number, r: number, y0: number, segs: number, rings: number, color: RGB, stretch = 1) {
    for (let j = 0; j < rings; j++) {
      const b0 = (j / rings) * (Math.PI / 2);
      const b1 = ((j + 1) / rings) * (Math.PI / 2);
      const r0 = Math.cos(b0) * r;
      const r1 = Math.cos(b1) * r;
      const h0 = y0 + Math.sin(b0) * r * stretch;
      const h1 = y0 + Math.sin(b1) * r * stretch;
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * Math.PI * 2;
        const a1 = ((i + 1) / segs) * Math.PI * 2;
        const p = [
          [cx + Math.cos(a1) * r0, h0, cz + Math.sin(a1) * r0],
          [cx + Math.cos(a0) * r0, h0, cz + Math.sin(a0) * r0],
          [cx + Math.cos(a0) * r1, h1, cz + Math.sin(a0) * r1],
          [cx + Math.cos(a1) * r1, h1, cz + Math.sin(a1) * r1],
        ] as const;
        const uv = [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ] as const;
        if (j === rings - 1) this.tri([p[0], p[1], p[2]], [uv[0], uv[1], uv[2]], 1, color, Facade.Plain);
        else this.quad(p, uv, 1, color, Facade.Plain);
      }
    }
  }

  /** 生成 BufferGeometry;顶点数超过 65535 时自动用 32 位索引。 */
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute("facA", new THREE.Float32BufferAttribute(this.facA, 3));
    g.setAttribute("facB", new THREE.Float32BufferAttribute(this.facB, 2));
    const n = this.vertexCount;
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}
