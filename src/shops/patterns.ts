// 生成式图案(风格参考 WebGPU-Art/protea 里的吸引子、元胞自动机等 demo)。
// 全部输出为 SVG 片段:SVG 在原生 HTML-in-Canvas 和 foreignObject 兜底两条路径里都能渲染,
// 而 <canvas> 子元素在兜底路径里不会被序列化。

export const PATTERN_W = 348;
export const PATTERN_H = 210;

const n1 = (v: number) => v.toFixed(1);

export type PatternKind = "clifford" | "lorenz" | "rule30" | "spiro";

export interface PatternColors {
  /** 主色 */
  a: string;
  /** 辅色 */
  b: string;
}

/** Clifford 吸引子:点云,参数随时间缓慢漂移,图案会"呼吸"。 */
function clifford(t: number, c: PatternColors): string {
  const a = -1.4 + 0.1 * Math.sin(t * 0.31);
  const b = 1.6 + 0.1 * Math.sin(t * 0.23 + 1);
  const cc = 1.0 + 0.08 * Math.sin(t * 0.17 + 2);
  const d = 0.7 + 0.08 * Math.sin(t * 0.29 + 3);
  const total = 2600;
  const scale = PATTERN_H / 4.7;
  const cx = PATTERN_W / 2;
  const cy = PATTERN_H / 2;
  let x = 0.1;
  let y = 0.1;
  const layers = ["", "", ""];
  for (let i = 0; i < total + 30; i++) {
    const nx = Math.sin(a * y) + cc * Math.cos(a * x);
    const ny = Math.sin(b * x) + d * Math.cos(b * y);
    x = nx;
    y = ny;
    if (i < 30) continue;
    layers[i % 3] += `M${n1(cx + x * scale)} ${n1(cy + y * scale)}l.01 0`;
  }
  const w = [1.4, 1.1, 0.8];
  const o = [0.9, 0.6, 0.35];
  return layers
    .map(
      (p, i) =>
        `<path d="${p}" fill="none" stroke="${i === 2 ? c.b : c.a}" stroke-opacity="${o[i]}" stroke-width="${w[i]}" stroke-linecap="round"/>`,
    )
    .join("");
}

/** Lorenz 吸引子:绕垂直轴缓慢旋转的投影,末端有一个"光点"。 */
function lorenz(t: number, c: PatternColors): string {
  const steps = 3000;
  const dt = 0.005;
  const theta = t * 0.28;
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  const sx = 5.6;
  const sz = (PATTERN_H - 26) / 50;
  let x = 1;
  let y = 1;
  let z = 1;
  const segs = 3;
  const paths: string[] = Array(segs).fill("");
  let hx = 0;
  let hy = 0;
  for (let i = 0; i < steps + 300; i++) {
    const dx = 10 * (y - x);
    const dy = x * (28 - z) - y;
    const dz = x * y - (8 / 3) * z;
    x += dx * dt;
    y += dy * dt;
    z += dz * dt;
    if (i < 300) continue;
    const px = PATTERN_W / 2 + (x * ct + y * st) * sx;
    const py = PATTERN_H - 12 - z * sz;
    const seg = Math.min(segs - 1, Math.floor(((i - 300) / steps) * segs));
    paths[seg] += (paths[seg] === "" ? "M" : "L") + n1(px) + " " + n1(py);
    hx = px;
    hy = py;
  }
  const strokes = [c.b, c.a, c.a];
  const opac = [0.45, 0.75, 1];
  return (
    paths
      .map(
        (p, i) =>
          `<path d="${p}" fill="none" stroke="${strokes[i]}" stroke-opacity="${opac[i]}" stroke-width="1.2" stroke-linejoin="round"/>`,
      )
      .join("") + `<circle cx="${n1(hx)}" cy="${n1(hy)}" r="4" fill="#fff"/>`
  );
}

/** Rule 30 元胞自动机:预先算好很多行,按时间滚动窗口。 */
const RULE_COLS = 64;
const RULE_ROWS = 240;
const RULE_VIEW = 38;
const rule30Rows: Uint8Array[] = (() => {
  const rows: Uint8Array[] = [];
  let cur = new Uint8Array(RULE_COLS);
  cur[RULE_COLS >> 1] = 1;
  for (let r = 0; r < RULE_ROWS; r++) {
    rows.push(cur);
    const next = new Uint8Array(RULE_COLS);
    for (let i = 0; i < RULE_COLS; i++) {
      const l = cur[(i + RULE_COLS - 1) % RULE_COLS];
      const m = cur[i];
      const rr = cur[(i + 1) % RULE_COLS];
      // Rule 30:新状态 = l XOR (m OR r)
      next[i] = l ^ (m | rr);
    }
    cur = next;
  }
  return rows;
})();

function rule30(t: number, c: PatternColors): string {
  const start = Math.floor(t * 3) % (RULE_ROWS - RULE_VIEW);
  const cw = PATTERN_W / RULE_COLS;
  const ch = PATTERN_H / RULE_VIEW;
  let rects = "";
  for (let r = 0; r < RULE_VIEW; r++) {
    const row = rule30Rows[start + r];
    let i = 0;
    while (i < RULE_COLS) {
      if (!row[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j < RULE_COLS && row[j]) j++;
      // 越新的行越亮
      const k = r / RULE_VIEW;
      const fill = k > 0.66 ? c.a : c.b;
      const op = 0.35 + 0.65 * k;
      rects += `<rect x="${n1(i * cw)}" y="${n1(r * ch)}" width="${n1((j - i) * cw - 0.4)}" height="${n1(ch - 0.4)}" fill="${fill}" fill-opacity="${op.toFixed(2)}"/>`;
      i = j;
    }
  }
  return rects;
}

/** 万花尺(内摆线):三层叠加,各自旋转,像一朵缓慢转动的花窗。 */
function spiro(t: number, c: PatternColors): string {
  const cx = PATTERN_W / 2;
  const cy = PATTERN_H / 2;
  const configs = [
    { R: 5, r: 3, d: 5, rot: t * 0.2, color: c.a, op: 0.95, size: 0.44 },
    { R: 7, r: 4, d: 6, rot: -t * 0.15 + 1, color: c.b, op: 0.7, size: 0.4 },
    { R: 8, r: 3, d: 4, rot: t * 0.1 + 2, color: c.a, op: 0.45, size: 0.5 },
  ];
  let out = "";
  for (const cfg of configs) {
    const { R, r, d } = cfg;
    const k = (R - r) / r;
    const maxT = 2 * Math.PI * (r / gcd(R, r));
    const pts = 720;
    const norm = (R - r + d) / (PATTERN_H * cfg.size);
    let p = "";
    const cr = Math.cos(cfg.rot);
    const sr = Math.sin(cfg.rot);
    for (let i = 0; i <= pts; i++) {
      const a = (i / pts) * maxT;
      const x0 = (R - r) * Math.cos(a) + d * Math.cos(k * a);
      const y0 = (R - r) * Math.sin(a) - d * Math.sin(k * a);
      const x = (x0 * cr - y0 * sr) / norm;
      const y = (x0 * sr + y0 * cr) / norm;
      p += (i === 0 ? "M" : "L") + n1(cx + x) + " " + n1(cy + y);
    }
    out += `<path d="${p}Z" fill="none" stroke="${cfg.color}" stroke-opacity="${cfg.op}" stroke-width="1.3" stroke-linejoin="round"/>`;
  }
  return out;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

const RENDERERS: Record<PatternKind, (t: number, c: PatternColors) => string> = {
  clifford,
  lorenz,
  rule30,
  spiro,
};

export const PATTERN_LABELS: Record<PatternKind, string> = {
  clifford: "Clifford attractor",
  lorenz: "Lorenz attractor",
  rule30: "Rule 30 automaton",
  spiro: "Hypotrochoid",
};

/** 渲染某个图案的 SVG 内部片段(放进 <svg viewBox="0 0 W H"> 里)。 */
export function renderPattern(kind: PatternKind, t: number, colors: PatternColors): string {
  return RENDERERS[kind](t, colors);
}

/** 完整的 <svg> 元素字符串,带 data 属性,方便 onTick 找到并重绘。 */
export function patternSvg(kind: PatternKind, colors: PatternColors, t = 0): string {
  return (
    `<svg class="pat" data-pattern="${kind}" data-a="${colors.a}" data-b="${colors.b}" ` +
    `viewBox="0 0 ${PATTERN_W} ${PATTERN_H}" width="${PATTERN_W}" height="${PATTERN_H}">` +
    renderPattern(kind, t, colors) +
    `</svg>`
  );
}

/** 重绘 root 内所有图案。 */
export function tickPatterns(root: HTMLElement, t: number) {
  root.querySelectorAll<SVGElement>("svg[data-pattern]").forEach((el) => {
    const kind = el.getAttribute("data-pattern") as PatternKind;
    const colors = { a: el.getAttribute("data-a") ?? "#fff", b: el.getAttribute("data-b") ?? "#888" };
    el.innerHTML = renderPattern(kind, t, colors);
  });
}
