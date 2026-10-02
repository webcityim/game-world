import * as THREE from "three/webgpu";

/**
 * HTML in Canvas:把真实的 DOM 页面渲染进 Canvas,再作为 three.js 贴图。
 *
 * 1. 原生路径(WICG "HTML-in-Canvas" 提案,目前需要 Chrome 的实验特性):
 *    <canvas layoutsubtree> 的直接子元素会被布局但不显示,
 *    在 `paint` 事件里用 ctx.drawElementImage(el, x, y) 把它画进 canvas。
 *    DOM 里的任何变化(时钟、hover、动画)都会自动触发新的 paint,
 *    所以页面是"活"的。该 API 仍在演进,下面的调用都做了特性检测。
 *
 * 2. 兜底路径(其他浏览器):把元素序列化进 SVG <foreignObject>,
 *    作为图片画到 canvas 上。只能得到静态快照,所以由 tick() 每秒重绘一次。
 *
 * 两种路径的产物都是同一个 <canvas>,three.js 的 CanvasTexture 不关心来源。
 * 页面离相机远时调用 setActive(false):把 canvas 从 DOM 摘掉、停止重绘,
 * 材质所在的 mesh 由调用方隐藏,几乎零开销。
 */

const probeCtx = (() => {
  if (typeof document === "undefined") return null;
  return document.createElement("canvas").getContext("2d") as unknown as Record<string, unknown> | null;
})();

/** 浏览器是否支持原生 HTML-in-Canvas。 */
export const HTML_IN_CANVAS_NATIVE = !!probeCtx && typeof probeCtx.drawElementImage === "function";

export interface HtmlTextureOptions {
  html: string;
  css: string;
  width: number;
  height: number;
  /** 页面激活期间每秒调用一次,用于更新实时内容(时钟等)。 */
  onTick?: (root: HTMLElement) => void;
}

let styleInjected = false;
function injectPageStyle(css: string) {
  if (styleInjected) return;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
  styleInjected = true;
}

export class HtmlTexture {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  readonly mode: "native" | "svg-fallback";
  active = false;

  private readonly root: HTMLElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly opts: HtmlTextureOptions;
  private lastTick = 0;
  private lastRaster = 0;
  private busy = false;

  constructor(opts: HtmlTextureOptions) {
    this.opts = opts;
    this.mode = HTML_IN_CANVAS_NATIVE ? "native" : "svg-fallback";

    this.canvas = document.createElement("canvas");
    this.canvas.width = opts.width;
    this.canvas.height = opts.height;
    this.ctx = this.canvas.getContext("2d")!;

    this.root = document.createElement("div");
    this.root.className = "shop-page";
    this.root.style.width = `${opts.width}px`;
    this.root.style.height = `${opts.height}px`;
    this.root.innerHTML = opts.html;

    if (this.mode === "native") {
      injectPageStyle(opts.css);
      this.canvas.setAttribute("layoutsubtree", "");
      this.canvas.style.cssText = `position:fixed;left:-30000px;top:0;width:${opts.width}px;height:${opts.height}px;pointer-events:none`;
      this.canvas.appendChild(this.root);
      this.canvas.addEventListener("paint", () => this.paintNative());
    }

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    // 先画一张占位图,避免第一次激活前贴图是纯黑
    this.ctx.fillStyle = "#1b1f2a";
    this.ctx.fillRect(0, 0, opts.width, opts.height);
  }

  private paintNative() {
    const ctx = this.ctx as unknown as {
      reset?: () => void;
      drawElementImage: (el: Element, x: number, y: number) => unknown;
    };
    try {
      ctx.reset?.();
      ctx.drawElementImage(this.root, 0, 0);
      this.texture.needsUpdate = true;
    } catch (err) {
      console.warn("[html-in-canvas] drawElementImage failed", err);
    }
  }

  private rasterFallback() {
    if (this.busy) return;
    this.busy = true;
    const { width, height, css } = this.opts;
    const xml = new XMLSerializer().serializeToString(this.root);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<foreignObject width="100%" height="100%">` +
      `<div xmlns="http://www.w3.org/1999/xhtml"><style>${css}</style>${xml}</div>` +
      `</foreignObject></svg>`;
    const img = new Image();
    img.onload = () => {
      this.ctx.clearRect(0, 0, width, height);
      this.ctx.drawImage(img, 0, 0);
      this.texture.needsUpdate = true;
      this.busy = false;
    };
    img.onerror = () => {
      this.busy = false;
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  /** 远距离时关闭:native 模式把 canvas 摘出 DOM,停止布局和重绘。 */
  setActive(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    if (this.mode === "native") {
      const host = document.getElementById("html-pages") ?? document.body;
      if (on) {
        host.appendChild(this.canvas);
        (this.canvas as unknown as { requestPaint?: () => void }).requestPaint?.();
      } else if (this.canvas.parentElement) {
        this.canvas.parentElement.removeChild(this.canvas);
      }
    } else if (on) {
      this.lastRaster = 0;
    }
  }

  /** 页面激活时每帧调用。 */
  tick(nowMs: number) {
    if (!this.active) return;
    if (nowMs - this.lastTick >= 1000) {
      this.lastTick = nowMs;
      this.opts.onTick?.(this.root);
    }
    if (this.mode === "svg-fallback" && nowMs - this.lastRaster >= 1000) {
      this.lastRaster = nowMs;
      this.rasterFallback();
    }
  }

  dispose() {
    this.setActive(false);
    this.texture.dispose();
  }
}
