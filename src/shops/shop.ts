import * as THREE from "three/webgpu";
import { SHOP_ACTIVATE_DISTANCE, SHOP_DEACTIVATE_DISTANCE } from "../config";
import { Anchor } from "../world/anchor";
import { HtmlTexture } from "./htmlTexture";
import { PAGE_CSS, PAGE_HEIGHT, PAGE_WIDTH, SHOPS, type ShopDef } from "./pages";

const lit = (hex: number, extra: Record<string, unknown> = {}) =>
  new THREE.MeshStandardNodeMaterial({ color: hex, roughness: 0.85, metalness: 0, ...extra });

function signTexture(def: ShopDef): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 160;
  const g = c.getContext("2d")!;
  g.fillStyle = "#1a1410";
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = def.accentCss;
  g.lineWidth = 8;
  g.strokeRect(8, 8, c.width - 16, c.height - 16);
  g.fillStyle = def.accentCss;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = "700 76px 'PingFang SC','Noto Sans SC','Microsoft YaHei',sans-serif";
  g.fillText(def.name, c.width / 2, 62);
  g.font = "400 34px system-ui,sans-serif";
  g.globalAlpha = 0.8;
  g.fillText(def.tagline, c.width / 2, 124);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * 一间商铺:建筑 + 常亮的招牌 + 可开关的"HTML 屏幕"。
 * 近处(< ACTIVATE)屏幕显示实时渲染的 HTML 页面;远处隐藏页面,只留一块熄灭的屏幕。
 */
class Shop {
  readonly group = new THREE.Group();
  readonly html: HtmlTexture;
  private readonly screenOn: THREE.Mesh;
  private readonly screenOff: THREE.Mesh;

  constructor(readonly def: ShopDef) {
    const W = 9;
    const D = 7;
    const H = 4.5;

    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), lit(def.wallColor));
    body.position.y = H / 2;
    this.group.add(body);

    const roof = new THREE.Mesh(new THREE.ConeGeometry(1, 2.6, 4), lit(def.roofColor, { roughness: 0.7 }));
    roof.rotation.y = Math.PI / 4;
    roof.scale.set((W / 2) * 1.35, 1, (D / 2) * 1.35);
    roof.position.y = H + 1.3;
    this.group.add(roof);

    const door = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.4, 0.12), lit(0x3a2418));
    door.position.set(-3.5, 1.2, D / 2 + 0.03);
    this.group.add(door);

    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 1.1),
      new THREE.MeshBasicMaterial({ map: signTexture(def), toneMapped: false }),
    );
    sign.position.set(0, H + 0.62, D / 2 + 0.25);
    this.group.add(sign);

    // 屏幕
    this.html = new HtmlTexture({
      html: def.html,
      css: PAGE_CSS,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      onTick: def.onTick,
    });
    const sw = 6.4;
    const sh = sw * (PAGE_HEIGHT / PAGE_WIDTH);
    const screenGeo = new THREE.PlaneGeometry(sw, sh);
    this.screenOn = new THREE.Mesh(
      screenGeo,
      new THREE.MeshBasicMaterial({ map: this.html.texture, toneMapped: false }),
    );
    this.screenOff = new THREE.Mesh(screenGeo, new THREE.MeshBasicMaterial({ color: 0x0d0f14 }));
    for (const s of [this.screenOn, this.screenOff]) {
      s.position.set(0.8, 2.45, D / 2 + 0.06);
      this.group.add(s);
    }
    this.screenOn.visible = false;
    this.screenOff.visible = true;
  }

  setActive(on: boolean) {
    this.html.setActive(on);
    this.screenOn.visible = on;
    this.screenOff.visible = !on;
  }
}

export interface ShopPlaza {
  anchor: Anchor;
  shops: { shop: Shop; worldPos: THREE.Vector3 }[];
  /** 每帧调用:按到相机的距离开关各家商铺的 HTML 页面。 */
  update(cam: THREE.Vector3, nowMs: number): void;
  readonly htmlMode: string;
  readonly activeCount: () => number;
}

/** 广场:地面圆盘、喷泉、路灯,以及 3 间围成弧形的商铺。 */
export function createShopPlaza(dir: THREE.Vector3, groundHeight: number, heading: number): ShopPlaza {
  const anchor = new Anchor(dir, groundHeight + 0.12, heading);
  const g = anchor.object;

  const floor = new THREE.Mesh(new THREE.CircleGeometry(46, 64), lit(0x9a9486, { roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  g.add(floor);

  const fountainBase = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.6, 0.9, 24), lit(0x8d8a82));
  fountainBase.position.y = 0.45;
  g.add(fountainBase);
  const fountainWater = new THREE.Mesh(
    new THREE.CylinderGeometry(3.7, 3.7, 0.12, 24),
    lit(0x3aa0e0, { emissive: 0x1a6aa8, emissiveIntensity: 0.6, roughness: 0.1 }),
  );
  fountainWater.position.y = 0.92;
  g.add(fountainWater);
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.45, 3, 10), lit(0x8d8a82));
  spire.position.y = 2.2;
  g.add(spire);

  const lampMat = lit(0xffe2a0, { emissive: 0xffc860, emissiveIntensity: 2.5 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 4, 8), lit(0x2a2a2e));
    post.position.set(Math.cos(a) * 15, 2, Math.sin(a) * 15);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.38, 10, 8), lampMat);
    bulb.position.set(Math.cos(a) * 15, 4.1, Math.sin(a) * 15);
    g.add(post, bulb);
  }

  const shops: ShopPlaza["shops"] = [];
  SHOPS.forEach((def, k) => {
    const shop = new Shop(def);
    const theta = (k - (SHOPS.length - 1) / 2) * 0.72;
    const x = Math.sin(theta) * 28;
    const z = -Math.cos(theta) * 28;
    shop.group.position.set(x, 0, z);
    shop.group.rotation.y = Math.atan2(-x, -z);
    g.add(shop.group);

    // 商铺的行星坐标(用于距离判断):先让锚点更新一次矩阵再取世界位置会依赖相机,
    // 这里直接用锚点的本地→行星变换手算。
    const local = new THREE.Vector3(x, 0, z);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), anchor.up);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading));
    const worldPos = local.applyQuaternion(q).add(anchor.pos);
    shops.push({ shop, worldPos });
  });

  return {
    anchor,
    shops,
    htmlMode: shops[0].shop.html.mode,
    update(cam, nowMs) {
      for (const s of shops) {
        const d = cam.distanceTo(s.worldPos);
        if (!s.shop.html.active && d < SHOP_ACTIVATE_DISTANCE) s.shop.setActive(true);
        else if (s.shop.html.active && d > SHOP_DEACTIVATE_DISTANCE) s.shop.setActive(false);
        s.shop.html.tick(nowMs);
      }
    },
    activeCount: () => shops.filter((s) => s.shop.html.active).length,
  };
}
