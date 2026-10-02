import { PATTERN_LABELS, patternSvg, tickPatterns, type PatternKind } from "./patterns";

// 商铺页面:都是真实的 HTML + CSS,尺寸 1024x640,由 HtmlTexture 渲染进 Canvas。

export const PAGE_WIDTH = 1024;
export const PAGE_HEIGHT = 640;

export const PAGE_CSS = `
.shop-page { box-sizing: border-box; overflow: hidden; font-family: "PingFang SC","Noto Sans SC","Microsoft YaHei",system-ui,sans-serif; color: #f4efe6; position: relative; }
.shop-page * { box-sizing: border-box; }
.shop-page header { display:flex; align-items:center; justify-content:space-between; padding: 26px 44px 16px; border-bottom: 2px solid rgba(255,255,255,.18); }
.shop-page h1 { margin:0; font-size: 50px; letter-spacing: 4px; }
.shop-page .tag { font-size: 21px; opacity:.75; margin-top: 6px; }
.shop-page nav { display:flex; gap: 18px; font-size: 21px; }
.shop-page nav a { padding: 6px 14px; border-radius: 999px; background: rgba(255,255,255,.12); color: inherit; text-decoration:none; }
.shop-page main { display:grid; grid-template-columns: 1fr 392px; gap: 28px; padding: 22px 44px; }
.shop-page ul.menu { list-style:none; margin:0; padding:0; font-size: 27px; }
.shop-page ul.menu li { display:flex; justify-content:space-between; padding: 11px 0; border-bottom: 1px dashed rgba(255,255,255,.25); }
.shop-page ul.menu li b { font-weight: 600; }
.shop-page ul.menu li span { opacity:.85; }
.shop-page .card { background: rgba(0,0,0,.30); border-radius: 18px; padding: 22px 22px 16px; }
.shop-page .card svg.pat { display:block; width:100%; height:auto; border-radius: 12px; background: rgba(0,0,0,.38); }
.shop-page .meta { font-size: 20px; opacity:.85; display:flex; justify-content:space-between; margin-top: 12px; }
.shop-page .meta .clock { font-variant-numeric: tabular-nums; letter-spacing: 1px; }
.shop-page .stat { margin-top: 18px; font-size: 22px; }
.shop-page .bar { height: 14px; border-radius: 7px; background: rgba(255,255,255,.18); overflow:hidden; margin-top: 8px; }
.shop-page .bar > i { display:block; height:100%; border-radius: 7px; background: var(--accent); }
.shop-page button { margin-top: 16px; font: inherit; font-size: 25px; padding: 10px 26px; border:0; border-radius: 14px; background: var(--accent); color:#1b1410; font-weight:700; }
.shop-page footer { position:absolute; left:0; right:0; bottom:0; padding: 14px 44px; font-size: 19px; opacity:.6; display:flex; justify-content:space-between; }
`;

export interface ShopDef {
  id: string;
  name: string;
  tagline: string;
  /** 页面主色(CSS)与建筑主色(three.js) */
  accentCss: string;
  wallColor: number;
  roofColor: number;
  html: string;
  /** 页面激活期间每秒调用一次 */
  onTick?: (root: HTMLElement) => void;
}

interface PageSpec {
  title: string;
  tagline: string;
  nav: string[];
  bg: string;
  accent: string;
  /** 图案的两种颜色 */
  colors: { a: string; b: string };
  pattern: PatternKind;
  menu: [string, string][];
  /** 菜单下方的一行统计(带进度条) */
  stat: { label: string; value: string; percent: number };
  button: string;
}

function page(s: PageSpec): string {
  const items = s.menu.map(([k, v]) => `<li><b>${k}</b><span>${v}</span></li>`).join("");
  return `
<div style="width:100%;height:100%;background:${s.bg};--accent:${s.accent}">
  <header>
    <div><h1>${s.title}</h1><div class="tag">${s.tagline}</div></div>
    <nav>${s.nav.map((n) => `<a>${n}</a>`).join("")}</nav>
  </header>
  <main>
    <div>
      <ul class="menu">${items}</ul>
      <div class="stat"><div style="display:flex;justify-content:space-between"><span>${s.stat.label}</span><span>${s.stat.value}</span></div>
        <div class="bar"><i style="width:${s.stat.percent}%"></i></div></div>
      <button>${s.button}</button>
    </div>
    <div class="card">
      ${patternSvg(s.pattern, s.colors)}
      <div class="meta"><span>${PATTERN_LABELS[s.pattern]}</span><span class="clock" data-clock>--:--:--</span></div>
    </div>
  </main>
  <footer><span>webcityim / game-world</span><span>HTML in Canvas</span></footer>
</div>`;
}

/** 每秒:更新时钟 + 重绘图案(图案随时间变化)。 */
const liveTick = (root: HTMLElement) => {
  const el = root.querySelector<HTMLElement>("[data-clock]");
  if (el) el.textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  tickPatterns(root, performance.now() / 1000);
};

export const SHOPS: ShopDef[] = [
  {
    id: "tea",
    name: "云岫茶馆",
    tagline: "Cloud Peak Tea House",
    accentCss: "#e8b04a",
    wallColor: 0xb8956a,
    roofColor: 0x6b3b2a,
    onTick: liveTick,
    html: page({
      title: "云岫茶馆",
      tagline: "Cloud Peak Tea House · 山脉脚下第一盏灯",
      nav: ["菜单", "预约", "关于"],
      bg: "linear-gradient(160deg,#4b2e1e,#2a1a12)",
      accent: "#e8b04a",
      colors: { a: "#ffd27a", b: "#ff9a5c" },
      pattern: "clifford",
      menu: [
        ["雾顶绿茶", "12 摩拉"],
        ["河谷红茶", "10 摩拉"],
        ["晶花乌龙", "18 摩拉"],
        ["世界树蜜茶", "26 摩拉"],
      ],
      stat: { label: "今日座位 已预约 17 / 25", value: "营业中", percent: 68 },
      button: "立即预约",
    }),
  },
  {
    id: "smith",
    name: "熔岩铁匠铺",
    tagline: "Magma Smithy",
    accentCss: "#ff7a3d",
    wallColor: 0x8a8d92,
    roofColor: 0x3a3d44,
    onTick: liveTick,
    html: page({
      title: "熔岩铁匠铺",
      tagline: "Magma Smithy · 用山脉的骨头打铁",
      nav: ["武器", "修理", "订制"],
      bg: "linear-gradient(160deg,#2b2f38,#14161b)",
      accent: "#ff7a3d",
      colors: { a: "#ff8a4d", b: "#ffd36e" },
      pattern: "lorenz",
      menu: [
        ["晶铁长剑", "480 摩拉"],
        ["浮空岛合金盾", "620 摩拉"],
        ["天环弓", "910 摩拉"],
        ["修理 / 淬火", "40 摩拉"],
      ],
      stat: { label: "炉温 1 840 °C", value: "稳定", percent: 84 },
      button: "下单订制",
    }),
  },
  {
    id: "radio",
    name: "风语电台",
    tagline: "Whisper Radio & Weather",
    accentCss: "#6fd0ff",
    wallColor: 0x7aa5b8,
    roofColor: 0x2f4b63,
    onTick: liveTick,
    html: page({
      title: "风语电台",
      tagline: "Whisper Radio · 全球天气与航路广播",
      nav: ["天气", "航路", "留言"],
      bg: "linear-gradient(160deg,#173247,#0b1823)",
      accent: "#6fd0ff",
      colors: { a: "#8fe3ff", b: "#3a8fc4" },
      pattern: "rule30",
      menu: [
        ["世界树航线", "通畅"],
        ["浮空岛航线", "中度颠簸"],
        ["水晶尖塔", "磁场干扰"],
        ["天环", "通畅"],
      ],
      stat: { label: "高空风 西北 11 m/s", value: "能见度良好", percent: 55 },
      button: "收听广播",
    }),
  },
  {
    id: "atelier",
    name: "万花镜工坊",
    tagline: "Kaleidoscope Atelier",
    accentCss: "#c58bff",
    wallColor: 0x9a86b8,
    roofColor: 0x3d2f58,
    onTick: liveTick,
    html: page({
      title: "万花镜工坊",
      tagline: "Kaleidoscope Atelier · 把数学烧进玻璃",
      nav: ["作品", "定制", "展览"],
      bg: "linear-gradient(160deg,#2c2046,#120c22)",
      accent: "#c58bff",
      colors: { a: "#d9a8ff", b: "#7fd6ff" },
      pattern: "spiro",
      menu: [
        ["内摆线花窗", "320 摩拉"],
        ["洛伦兹吊坠", "180 摩拉"],
        ["元胞自动机挂毯", "540 摩拉"],
        ["定制图案", "面议"],
      ],
      stat: { label: "本周展览 席位 31 / 40", value: "开放中", percent: 77 },
      button: "预订展位",
    }),
  },
];
