// 全局常量。部分参数可以用 URL query 覆盖,便于调试:
//   ?radius=6371000  行星半径(米)
//   ?exag=2.5        地形垂直夸张倍数
//   ?seed=123        地形种子
const q = new URLSearchParams(typeof location === "undefined" ? "" : location.search);

const num = (key: string, fallback: number): number => {
  const raw = q.get(key);
  const v = raw === null ? NaN : Number(raw);
  return Number.isFinite(v) ? v : fallback;
};

/** 行星半径,单位米。默认取地球量级;"提瓦特尺寸"的具体比例待确认后改这里即可。 */
export const PLANET_RADIUS = num("radius", 6_371_000);
/** 地形垂直夸张。真实比例下山脉从轨道上几乎看不见,所以默认放大。 */
export const TERRAIN_EXAGGERATION = num("exag", 2.5);
export const SEED = num("seed", 20261002);

/** 每个地形块的网格段数(每边)。 */
export const GRID = 32;
/** 四叉树最大层级。层级 15 时块宽约 300m,顶点间距约 10m。 */
export const MAX_LEVEL = 15;
/** 距离 < 块宽 * SPLIT_FACTOR 时继续细分。 */
export const SPLIT_FACTOR = 2.4;
/** 每帧用于生成地形块的 CPU 时间预算(毫秒)。 */
export const BUILD_BUDGET_MS = 6;

/** 商铺页面:进入此距离(米)开始渲染 HTML 页面,超出 DEACTIVATE 后隐藏。 */
export const SHOP_ACTIVATE_DISTANCE = 140;
export const SHOP_DEACTIVATE_DISTANCE = 220;

/** 昼夜循环一圈的真实秒数。 */
export const DAY_LENGTH_SECONDS = 20 * 60;
