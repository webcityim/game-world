// 商铺页面:都是真实的 HTML + CSS,尺寸 1024x640,由 HtmlTexture 渲染进 Canvas。

export const PAGE_WIDTH = 1024;
export const PAGE_HEIGHT = 640;

export const PAGE_CSS = `
.shop-page { box-sizing: border-box; overflow: hidden; font-family: "PingFang SC","Noto Sans SC","Microsoft YaHei",system-ui,sans-serif; color: #f4efe6; position: relative; }
.shop-page * { box-sizing: border-box; }
.shop-page header { display:flex; align-items:center; justify-content:space-between; padding: 28px 44px 18px; border-bottom: 2px solid rgba(255,255,255,.18); }
.shop-page h1 { margin:0; font-size: 52px; letter-spacing: 4px; }
.shop-page .tag { font-size: 22px; opacity:.75; margin-top: 6px; }
.shop-page nav { display:flex; gap: 22px; font-size: 22px; }
.shop-page nav a { padding: 6px 14px; border-radius: 999px; background: rgba(255,255,255,.12); color: inherit; text-decoration:none; }
.shop-page main { display:grid; grid-template-columns: 1.3fr 1fr; gap: 32px; padding: 26px 44px; }
.shop-page ul.menu { list-style:none; margin:0; padding:0; font-size: 28px; }
.shop-page ul.menu li { display:flex; justify-content:space-between; padding: 12px 0; border-bottom: 1px dashed rgba(255,255,255,.25); }
.shop-page ul.menu li b { font-weight: 600; }
.shop-page .card { background: rgba(0,0,0,.28); border-radius: 18px; padding: 22px 26px; }
.shop-page .card h2 { margin: 0 0 12px; font-size: 26px; opacity:.85; }
.shop-page .clock { font-size: 64px; font-variant-numeric: tabular-nums; letter-spacing: 2px; }
.shop-page .bar { height: 18px; border-radius: 9px; background: rgba(255,255,255,.18); overflow:hidden; margin: 10px 0 16px; }
.shop-page .bar > i { display:block; height:100%; border-radius: 9px; background: var(--accent); }
.shop-page .meta { font-size: 22px; opacity:.8; display:flex; justify-content:space-between; }
.shop-page button { margin-top: 14px; font: inherit; font-size: 26px; padding: 12px 26px; border:0; border-radius: 14px; background: var(--accent); color:#1b1410; font-weight:700; }
.shop-page footer { position:absolute; left:0; right:0; bottom:0; padding: 14px 44px; font-size: 20px; opacity:.6; display:flex; justify-content:space-between; }
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

const clockTick = (root: HTMLElement) => {
  const el = root.querySelector<HTMLElement>("[data-clock]");
  if (el) el.textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false });
};

export const SHOPS: ShopDef[] = [
  {
    id: "tea",
    name: "云岫茶馆",
    tagline: "Cloud Peak Tea House",
    accentCss: "#e8b04a",
    wallColor: 0xb8956a,
    roofColor: 0x6b3b2a,
    onTick: clockTick,
    html: `
<div style="width:100%;height:100%;background:linear-gradient(160deg,#4b2e1e,#2a1a12);--accent:#e8b04a">
  <header>
    <div><h1>云岫茶馆</h1><div class="tag">Cloud Peak Tea House · 山脉脚下第一盏灯</div></div>
    <nav><a>菜单</a><a>预约</a><a>关于</a></nav>
  </header>
  <main>
    <ul class="menu">
      <li><b>雾顶绿茶</b><span>12 摩拉</span></li>
      <li><b>河谷红茶</b><span>10 摩拉</span></li>
      <li><b>晶花乌龙</b><span>18 摩拉</span></li>
      <li><b>世界树蜜茶</b><span>26 摩拉</span></li>
    </ul>
    <div>
      <div class="card"><h2>当前时间</h2><div class="clock" data-clock>--:--:--</div></div>
      <div class="card" style="margin-top:16px"><h2>今日座位</h2>
        <div class="bar"><i style="width:68%"></i></div>
        <div class="meta"><span>已预约 17 / 25</span><span>营业中</span></div>
        <button>立即预约</button>
      </div>
    </div>
  </main>
  <footer><span>webcityim / game-world</span><span>HTML in Canvas</span></footer>
</div>`,
  },
  {
    id: "smith",
    name: "熔岩铁匠铺",
    tagline: "Magma Smithy",
    accentCss: "#ff7a3d",
    wallColor: 0x8a8d92,
    roofColor: 0x3a3d44,
    onTick: clockTick,
    html: `
<div style="width:100%;height:100%;background:linear-gradient(160deg,#2b2f38,#14161b);--accent:#ff7a3d">
  <header>
    <div><h1>熔岩铁匠铺</h1><div class="tag">Magma Smithy · 用山脉的骨头打铁</div></div>
    <nav><a>武器</a><a>修理</a><a>订制</a></nav>
  </header>
  <main>
    <ul class="menu">
      <li><b>晶铁长剑</b><span>480 摩拉</span></li>
      <li><b>浮空岛合金盾</b><span>620 摩拉</span></li>
      <li><b>天环弓</b><span>910 摩拉</span></li>
      <li><b>修理 / 淬火</b><span>40 摩拉</span></li>
    </ul>
    <div>
      <div class="card"><h2>炉温</h2>
        <div class="bar"><i style="width:84%"></i></div>
        <div class="meta"><span>1 840 °C</span><span>稳定</span></div>
      </div>
      <div class="card" style="margin-top:16px"><h2>当前时间</h2><div class="clock" data-clock>--:--:--</div>
        <button>下单订制</button>
      </div>
    </div>
  </main>
  <footer><span>webcityim / game-world</span><span>HTML in Canvas</span></footer>
</div>`,
  },
  {
    id: "radio",
    name: "风语电台",
    tagline: "Whisper Radio & Weather",
    accentCss: "#6fd0ff",
    wallColor: 0x7aa5b8,
    roofColor: 0x2f4b63,
    onTick: clockTick,
    html: `
<div style="width:100%;height:100%;background:linear-gradient(160deg,#173247,#0b1823);--accent:#6fd0ff">
  <header>
    <div><h1>风语电台</h1><div class="tag">Whisper Radio · 全球天气与航路广播</div></div>
    <nav><a>天气</a><a>航路</a><a>留言</a></nav>
  </header>
  <main>
    <div>
      <div class="card"><h2>世界时钟</h2><div class="clock" data-clock>--:--:--</div></div>
      <div class="card" style="margin-top:16px"><h2>高空风</h2>
        <div class="bar"><i style="width:55%"></i></div>
        <div class="meta"><span>西北风 11 m/s</span><span>能见度良好</span></div>
      </div>
    </div>
    <ul class="menu">
      <li><b>世界树航线</b><span>通畅</span></li>
      <li><b>浮空岛航线</b><span>中度颠簸</span></li>
      <li><b>水晶尖塔</b><span>磁场干扰</span></li>
      <li><b>天环</b><span>通畅</span></li>
    </ul>
  </main>
  <footer><span>webcityim / game-world</span><span>HTML in Canvas</span></footer>
</div>`,
  },
];
