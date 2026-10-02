// 屏幕上的 DOM UI:交互提示、消息气泡、商铺页面浮层。

const $ = (id: string) => document.getElementById(id)!;

let toastTimer = 0;

/** 准星下方的交互提示;null 隐藏。 */
export function setPrompt(label: string | null, padConnected: boolean) {
  const el = $("prompt");
  if (!label) {
    el.classList.remove("show");
    return;
  }
  const key = padConnected ? "Ⓐ" : "F";
  el.innerHTML = `<kbd>${key}</kbd>${label}`;
  el.classList.add("show");
}

/** 屏幕上方的消息,几秒后消失。 */
export function toast(msg: string, ms = 3200) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("show"), ms);
}

// ---------------------------------------------------------------- 商铺页面浮层

let overlayTick: ((root: HTMLElement) => void) | null = null;
let overlayTimer = 0;
let styleInjected = false;

export function isOverlayOpen(): boolean {
  return $("overlay").classList.contains("show");
}

/** 以真实 DOM 打开一个商铺页面(和墙上 HTML-in-Canvas 屏幕是同一份 HTML)。 */
export function openOverlay(html: string, css: string, width: number, height: number, onTick?: (root: HTMLElement) => void) {
  if (!styleInjected) {
    const s = document.createElement("style");
    s.textContent = css;
    document.head.appendChild(s);
    styleInjected = true;
  }
  const el = $("overlay");
  const page = $("overlay-page");
  page.innerHTML = "";
  const root = document.createElement("div");
  root.className = "shop-page";
  root.style.width = `${width}px`;
  root.style.height = `${height}px`;
  root.innerHTML = html;
  page.appendChild(root);
  // 外框按缩放后的尺寸占位,页面本身按原尺寸排版再整体缩放
  const fit = () => {
    const k = Math.min((window.innerWidth - 48) / width, (window.innerHeight - 100) / height, 1.4);
    page.style.width = `${width * k}px`;
    page.style.height = `${height * k}px`;
    root.style.transformOrigin = "0 0";
    root.style.transform = `scale(${k})`;
  };
  fit();
  window.addEventListener("resize", fit);
  overlayTick = onTick ?? null;
  overlayTick?.(root);
  window.clearInterval(overlayTimer);
  overlayTimer = window.setInterval(() => overlayTick?.(root), 1000);
  el.classList.add("show");
  el.onclick = (e) => {
    if (e.target === el) closeOverlay();
  };
}

export function closeOverlay() {
  $("overlay").classList.remove("show");
  window.clearInterval(overlayTimer);
  overlayTick = null;
}
