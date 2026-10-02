import * as THREE from "three/webgpu";
import {
  abs,
  attribute,
  float,
  floor,
  fract,
  length,
  max,
  min,
  mix,
  positionView,
  sin,
  smoothstep,
  step,
  uniform,
  vec3,
} from "three/tsl";
import { Facade } from "./builder";

/** 0 = 白天, 1 = 深夜。main.ts 每帧根据太阳位置更新。 */
export const uNight = uniform(0);

type N = ReturnType<typeof float>;

/** 浮点哈希 → [0,1) */
const hash3 = (x: N, y: N, z: N): N => fract(sin(x.mul(127.1).add(y.mul(311.7)).add(z.mul(74.7))).mul(43758.5453)) as N;

/** 1 当 a <= x <= b,否则 0 */
const band = (x: N, a: number, b: number): N => step(a, x).mul(step(x, b)) as N;

/** 类型选择掩码:type == k 时为 1 */
const isType = (t: N, k: Facade): N => float(1).sub(step(0.5, abs(t.sub(k)))) as N;

let cached: THREE.MeshStandardNodeMaterial | null = null;

/**
 * 城市合并几何体共用的材质。
 * 顶点颜色是"底色",外立面细节由 facA(u, v, width) / facB(type, rand) 在像素着色器里生成。
 */
export function cityMaterial(): THREE.MeshStandardNodeMaterial {
  if (cached) return cached;

  const base = attribute("color", "vec3");
  const facA = attribute("facA", "vec3");
  const facB = attribute("facB", "vec2");
  const u = float(facA.x);
  const v = float(facA.y);
  const w = float(facA.z);
  const type = float(facB.x);
  const rnd = float(facB.y);

  // 远处淡化细节,避免几米宽的窗户在几公里外闪烁
  const dist = length(positionView);
  const detail = float(1).sub(smoothstep(500, 1400, dist));

  // ---------------------------------------------------------------- 窗户(Windows / Timber)
  const fh = 3.2;
  const nCols = max(float(1), floor(w.div(3.2).add(0.5)));
  const sp = w.div(nCols);
  const cu = fract(u.div(sp));
  const cellX = floor(u.div(sp));
  const cv = fract(v.div(fh));
  const cellY = floor(v.div(fh));
  const ground = float(1).sub(step(1, cellY)); // 一楼
  const winX = mix(band(cu as N, 0.3, 0.7), band(cu as N, 0.14, 0.86), ground);
  const winY = mix(band(cv as N, 0.3, 0.8), band(cv as N, 0.1, 0.75), ground);
  const wide = step(2.4, w);
  const winMask = winX.mul(winY).mul(wide).mul(step(0.2, v));
  const frameX = mix(band(cu as N, 0.26, 0.74), band(cu as N, 0.11, 0.89), ground);
  const frameY = mix(band(cv as N, 0.26, 0.84), band(cv as N, 0.07, 0.78), ground);
  const frameMask = frameX.mul(frameY).mul(wide).mul(step(0.2, v)).sub(winMask);
  const winRand = hash3(cellX as N, cellY as N, rnd.mul(97.0) as N);
  const glass = mix(vec3(0.1, 0.13, 0.17), vec3(0.22, 0.28, 0.33), winRand);
  const winLit = step(0.52, winRand).mul(winMask);

  // 木筋墙:楼层横梁 + 竖梁 + 部分格子的斜撑
  const beamH = float(1).sub(band(cv as N, 0.06, 0.95));
  const beamV = float(1).sub(band(cu as N, 0.05, 0.95));
  const diag = band(abs(cu.sub(cv)) as N, 0, 0.05).mul(step(0.55, winRand)).mul(float(1).sub(ground));
  const timberWin = band(cu as N, 0.36, 0.64).mul(band(cv as N, 0.34, 0.74)).mul(wide).mul(step(0.2, v));
  const beams = max(max(beamH, beamV), diag).mul(step(1.0, v)).mul(float(1).sub(timberWin));
  const timberLit = step(0.52, winRand).mul(timberWin);

  // ---------------------------------------------------------------- 玻璃幕墙
  const gu = fract(u.div(1.6));
  const gv = fract(v.div(3.6));
  const mullion = max(float(1).sub(band(gu as N, 0.04, 0.96)), float(1).sub(band(gv as N, 0.07, 1.0)));
  const gRand = hash3(floor(u.div(1.6)) as N, floor(v.div(3.6)) as N, rnd.mul(53.0) as N);
  const glassCol = mix(base.mul(0.55), base.mul(0.85), gRand);
  // 玻璃幕墙夜间:按"办公室"(4.8 m × 一层)随机亮灯,约 1/3 亮着
  const glassLit = step(0.66, hash3(floor(u.div(4.8)) as N, floor(v.div(3.6)) as N, rnd.mul(31.0) as N)).mul(
    float(1).sub(mullion),
  );

  // ---------------------------------------------------------------- 瓦片
  const tRow = floor(v.div(0.42));
  const tu = fract(u.div(0.55).add(tRow.mul(0.5)));
  const tileLine = float(1).sub(band(fract(v.div(0.42)) as N, 0.16, 1.0));
  const tileSeam = float(1).sub(band(tu as N, 0.04, 1.0));
  const tileVar = hash3(floor(u.div(0.55).add(tRow.mul(0.5))) as N, tRow as N, rnd as N);
  const tiles = base.mul(float(0.88).add(tileVar.mul(0.22))).mul(float(1).sub(tileLine.mul(0.35))).mul(float(1).sub(tileSeam.mul(0.15)));

  // ---------------------------------------------------------------- 石板铺地
  const pRow = floor(v.div(0.7));
  const pu = u.div(1.1).add(pRow.mul(0.5));
  const grout = max(float(1).sub(band(fract(pu) as N, 0.04, 1.0)), float(1).sub(band(fract(v.div(0.7)) as N, 0.06, 1.0)));
  const stoneVar = hash3(floor(pu) as N, pRow as N, float(3) as N);
  const paving = base.mul(float(0.86).add(stoneVar.mul(0.24))).mul(float(1).sub(grout.mul(0.3)));

  // ---------------------------------------------------------------- 道路
  const halfW = w.mul(0.5);
  const dash = band(abs(v) as N, 0, 0.12).mul(step(fract(u.div(6.0)), 0.5)).mul(step(9.0, w));
  const edge = band(abs(v).sub(halfW) as N, -0.45, -0.3).mul(step(9.0, w));
  const asphaltVar = hash3(floor(u.mul(0.5)) as N, floor(v.mul(0.5)) as N, float(7) as N);
  const roadBase = base.mul(float(0.94).add(asphaltVar.mul(0.1)));
  const roadMark = max(dash, edge).mul(detail);
  const road = mix(roadBase, vec3(0.86, 0.82, 0.68), roadMark);

  // ---------------------------------------------------------------- 草地 / 木板
  const grassVar = hash3(floor(u.mul(0.4)) as N, floor(v.mul(0.4)) as N, float(11) as N);
  const grass = base.mul(float(0.85).add(grassVar.mul(0.3)));
  const plank = float(1).sub(band(fract(v.div(0.24)) as N, 0.08, 1.0));
  const wood = base.mul(float(1).sub(plank.mul(0.35))).mul(float(0.9).add(hash3(floor(v.div(0.24)) as N, float(1) as N, rnd as N).mul(0.2)));

  // ---------------------------------------------------------------- 组合
  const tWin = isType(type, Facade.Windows);
  const tGlass = isType(type, Facade.Glass);
  const tTimber = isType(type, Facade.Timber);
  const tTiles = isType(type, Facade.Tiles);
  const tPave = isType(type, Facade.Paving);
  const tRoad = isType(type, Facade.Road);
  const tGrass = isType(type, Facade.Grass);
  const tWood = isType(type, Facade.Wood);

  // 窗户墙
  const winWall = mix(mix(base, base.mul(0.72), frameMask), glass, winMask);
  const winWallFar = mix(base, vec3(0.16, 0.2, 0.25), 0.22);
  // 木筋墙
  const timberWall = mix(mix(base, vec3(0.24, 0.15, 0.09), beams), glass, timberWin);
  const timberFar = mix(base, vec3(0.24, 0.15, 0.09), 0.25);
  // 玻璃幕墙
  const glassWall = mix(glassCol, vec3(0.62, 0.64, 0.66), mullion);
  const glassFar = base.mul(0.68);

  let color = base as unknown as N;
  color = mix(color, mix(winWallFar, winWall, detail), tWin) as N;
  color = mix(color, mix(timberFar, timberWall, detail), tTimber) as N;
  color = mix(color, mix(glassFar, glassWall, detail), tGlass) as N;
  color = mix(color, mix(base.mul(0.95), tiles, detail), tTiles) as N;
  color = mix(color, mix(base, paving, detail), tPave) as N;
  color = mix(color, road, tRoad) as N;
  color = mix(color, mix(base, grass, detail), tGrass) as N;
  color = mix(color, mix(base, wood, detail), tWood) as N;

  // 粗糙度:玻璃光滑,其余粗糙
  const glassiness = max(winMask.mul(tWin), max(timberWin.mul(tTimber), tGlass.mul(float(1).sub(mullion))));
  const rough = mix(float(0.88), float(0.18), glassiness.mul(detail));

  // 夜间灯光:近处按窗格亮,远处按平均亮度
  const warm = vec3(1.0, 0.72, 0.38);
  const cool = vec3(0.8, 0.9, 1.0);
  const winGlow = mix(float(0.13), winLit, detail).mul(tWin);
  const timberGlow = mix(float(0.06), timberLit, detail).mul(tTimber);
  const glassGlow = mix(float(0.12), glassLit, detail).mul(tGlass);
  const emissive = warm
    .mul(winGlow.add(timberGlow))
    .mul(1.6)
    .add(cool.mul(glassGlow.mul(0.55)))
    .mul(uNight);

  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 });
  mat.colorNode = color;
  mat.roughnessNode = rough;
  mat.metalnessNode = min(float(0.35), tGlass.mul(0.35));
  mat.emissiveNode = emissive;
  cached = mat;
  return mat;
}
