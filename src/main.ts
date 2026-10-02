import * as THREE from "three/webgpu";
import "./style.css";
import { DAY_LENGTH_SECONDS, GRID, MAX_LEVEL, PLANET_RADIUS, TERRAIN_EXAGGERATION } from "./config";
import { City, type CityDef, type CityHooks } from "./city/city";
import { uNight } from "./city/material";
import { Input } from "./controls/input";
import { EYE_HEIGHT, PlayerControls, type PhysicsWorld } from "./controls/player";
import { createShopPlaza, SHOP_SIZE } from "./shops/shop";
import { HTML_IN_CANVAS_NATIVE } from "./shops/htmlTexture";
import { PAGE_CSS, PAGE_HEIGHT, PAGE_WIDTH } from "./shops/pages";
import { bindPanel, createMenu } from "./ui/menu";
import { closeOverlay, isOverlayOpen, openOverlay, setPrompt, toast } from "./ui/ui";
import { Anchor, pickSites, type SiteSpec } from "./world/anchor";
import { Planet } from "./world/planet";
import { Terrain } from "./world/terrain";
import {
  createCrystalSpire,
  createDragonSpine,
  createFloatingIsle,
  createGreatArch,
  createSkyRing,
  createStoneForest,
  createWorldTree,
  type Wonder,
} from "./world/wonders";

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function fmtDist(m: number): string {
  if (m >= 100_000) return `${(m / 1000).toFixed(0)} km`;
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${m.toFixed(m < 10 ? 1 : 0)} m`;
}

interface Poi {
  name: string;
  pos: THREE.Vector3;
  look: THREE.Vector3;
  mode: "fly" | "walk";
  group: "轨道" | "城市" | "奇观";
}

/** 在 up 处取一个任意的单位切向量。 */
function tangentAt(up: THREE.Vector3): THREE.Vector3 {
  const t = new THREE.Vector3().crossVectors(up, new THREE.Vector3(0, 1, 0));
  if (t.lengthSq() < 1e-8) t.crossVectors(up, new THREE.Vector3(1, 0, 0));
  return t.normalize();
}

/** 城市定义:首都 + 四种风格各一座 + 一个村庄 */
const CITY_DEFS: CityDef[] = [
  { id: "windhaven", name: "风岚城", style: "meadow", radius: 560, seed: 1101, walls: true, capital: true, npcs: 170 },
  { id: "bluetile", name: "青瓦镇", style: "orient", radius: 460, seed: 2203, npcs: 110 },
  { id: "goldsand", name: "金沙城", style: "desert", radius: 420, seed: 3307, npcs: 110 },
  { id: "neonspire", name: "霓虹都", style: "neo", radius: 720, seed: 4409, npcs: 140 },
  { id: "wheatwave", name: "麦浪村", style: "meadow", radius: 230, seed: 5501, npcs: 40 },
];

async function main() {
  const boot = document.getElementById("boot")!;
  const hud = document.getElementById("hud")!;
  const help = document.getElementById("help")!;
  const helpMode = document.getElementById("help-mode")!;
  const appEl = document.getElementById("app")!;
  const params = new URLSearchParams(location.search);

  // ------------------------------------------------------------ 渲染器(WebGPU,不支持时自动回落 WebGL2)
  // ?webgl 强制使用 WebGL2 后端(排查 WebGPU 驱动问题、无头浏览器截图时用)
  const forceWebGL = params.has("webgl");
  const renderer = new THREE.WebGPURenderer({ antialias: true, logarithmicDepthBuffer: true, forceWebGL });
  // 动态分辨率:帧率持续偏低就降渲染分辨率,恢复后再升回来。?dpr=1 可固定分辨率
  const baseDpr = Number(params.get("dpr")) || Math.min(window.devicePixelRatio, 2);
  const adaptiveRes = !params.has("dpr");
  let dpr = baseDpr;
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = !params.has("noshadow");
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  appEl.appendChild(renderer.domElement);
  await renderer.init();
  const backendName = (renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend
    ? "WebGPU"
    : "WebGL2 (fallback)";

  const scene = new THREE.Scene();
  const spaceColor = new THREE.Color(0x01020a);
  const skyColor = new THREE.Color(0x7db8f0);
  const duskColor = new THREE.Color(0xe08a5a);
  const nightSky = new THREE.Color(0x0a1022);
  const background = new THREE.Color().copy(spaceColor);
  scene.background = background;
  const fog = new THREE.FogExp2(0x7db8f0, 0);
  scene.fog = fog;

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.3, 3e8);

  boot.textContent = "正在选址 …";
  await new Promise((r) => setTimeout(r, 0));

  // ------------------------------------------------------------ 地形与选址
  const terrain = new Terrain();
  const R = PLANET_RADIUS;
  const flatAround = (radius: number, maxDiff: number) => (p: THREE.Vector3, h0: number) => {
    const a = radius / R;
    const t1 = tangentAt(p);
    const t2 = new THREE.Vector3().crossVectors(p, t1).normalize();
    for (let k = 0; k < 12; k++) {
      const ang = (k / 12) * Math.PI * 2;
      const q = p.clone().addScaledVector(t1, Math.cos(ang) * a).addScaledVector(t2, Math.sin(ang) * a).normalize();
      const h = terrain.height(q.x, q.y, q.z, 4e5);
      if (h < 4 || Math.abs(h - h0) > maxDiff) return false;
    }
    return true;
  };
  const lush = (p: THREE.Vector3) => terrain.biome(p.x, p.y, p.z) < 0.05;
  const arid = (p: THREE.Vector3) => terrain.biome(p.x, p.y, p.z) > 0.22 && Math.abs(p.y) < 0.3;

  // 顺序:首都 → 4 个奇观(首都 8~25 km 外,城里抬头就能看到) → 其他城市
  const specs: SiteSpec[] = [
    { minH: 20, maxH: 260, maxSlope: 0.08, accept: (p, h) => lush(p) && flatAround(1800, 160)(p, h) },
    // 前 3 个奇观落在首都盆地里(4~9 km),其余 4 个在盆地外围的山麓 / 山腰(10~30 km)
    ...[0, 1, 2].map(() => ({ minH: 20, maxH: 400, maxSlope: 0.15, nearIndex: 0, minAngle: 0.0007, maxAngle: 0.0014, sepAngle: 0.0007 })),
    ...[0, 1, 2, 3].map(() => ({ minH: 20, maxH: 400, maxSlope: 0.15, nearIndex: 0, minAngle: 0.0017, maxAngle: 0.0048, sepAngle: 0.0012 })),
    { minH: 20, maxH: 500, maxSlope: 0.1, nearIndex: 0, minAngle: 0.006, maxAngle: 0.04, sepAngle: 0.004, accept: (p, h) => lush(p) && flatAround(1500, 180)(p, h) },
    { minH: 20, maxH: 400, maxSlope: 0.1, sepAngle: 0.004, accept: (p, h) => arid(p) && flatAround(1400, 180)(p, h) },
    { minH: 20, maxH: 300, maxSlope: 0.08, nearIndex: 0, minAngle: 0.006, maxAngle: 0.05, sepAngle: 0.004, accept: (p, h) => flatAround(1900, 160)(p, h) },
    { minH: 20, maxH: 300, maxSlope: 0.1, nearIndex: 0, minAngle: 0.0035, maxAngle: 0.008, sepAngle: 0.002, accept: (p, h) => flatAround(900, 160)(p, h) },
  ];
  const sites = pickSites(terrain, specs);
  const capDir = sites[0];
  const wonderDirs = sites.slice(1, 8);
  const cityDirs = [capDir, ...sites.slice(8)];

  const wonders: Wonder[] = [
    createWorldTree(),
    createStoneForest(),
    createGreatArch(),
    createFloatingIsle(),
    createCrystalSpire(),
    createSkyRing(),
    createDragonSpine(),
  ];

  // 设计地貌:首都在盆地里,四周群山环绕,一条河从北面的山里蜿蜒流过、汇入南边的湖
  terrain.addMassif(capDir, 0.35, 9000, 22000, 80000, 1250, 0.6);
  terrain.addRiver(capDir, 0.35, 3900, 30000, 300, 1);
  // 青瓦镇(第二座城)也放进山里
  if (sites[8]) terrain.addMassif(sites[8], -0.6, 5000, 14000, 50000, 1000, 0.3);

  // 先读出所有地点的原始海拔,再统一压平(压平会改变 height())
  const groundOf = (d: THREE.Vector3) => Math.max(8, terrain.height(d.x, d.y, d.z, 1e6));
  const cityGrounds = cityDirs.map(groundOf);
  const wonderGrounds = wonderDirs.map(groundOf);

  // ------------------------------------------------------------ 城市
  let mora = 0;
  let night = 0;
  const controls = new PlayerControls();
  const hooks: CityHooks = {
    toast: (m) => toast(m),
    reward: (n) => {
      mora += n;
    },
    teleport: (city, local, look) => {
      const p = city.toPlanet(local, new THREE.Vector3());
      const l = city.toPlanet(look, new THREE.Vector3());
      controls.teleport(p, l, "walk");
    },
    night: () => night,
  };
  const cities = CITY_DEFS.map((def, i) => {
    const heading = [0.35, -0.6, 0.15, 0.9, -0.25][i] ?? 0;
    const c = new City(def, cityDirs[i], cityGrounds[i], heading, hooks);
    terrain.addFlatZone(cityDirs[i], c.baseRadius + 40, c.baseRadius + 900, cityGrounds[i] - 0.05);
    return c;
  });
  wonderDirs.forEach((d, i) => terrain.addFlatZone(d, wonders[i].footprint.inner, wonders[i].footprint.outer, wonderGrounds[i]));
  const capital = cities[0];
  cities.forEach((c) => scene.add(c.anchor.object));

  boot.textContent = "正在生成首都 风岚城 …";
  await new Promise((r) => setTimeout(r, 0));
  capital.buildNow();

  // ------------------------------------------------------------ 首都广场的 HTML 商铺
  const PLAZA_LIFT = 0.17; // 广场铺装顶面 0.15 m,商铺地面略高一点
  const plaza = createShopPlaza(capDir, cityGrounds[0] + PLAZA_LIFT, capital.anchor.heading);
  scene.add(plaza.anchor.object);
  for (const s of plaza.shops) {
    capital.addCollider(s.x, s.z, SHOP_SIZE.w / 2, SHOP_SIZE.d / 2, s.rot, SHOP_SIZE.h);
    const front = SHOP_SIZE.d / 2 + 1.4;
    const p = new THREE.Vector3(s.x + Math.sin(s.rot) * front, 1.6 + PLAZA_LIFT, s.z + Math.cos(s.rot) * front);
    const def = s.shop.def;
    capital.addSpecial(p, 4.5, () => `进入「${def.name}」`, () => {
      openOverlay(def.html, PAGE_CSS, PAGE_WIDTH, PAGE_HEIGHT, def.onTick);
    });
  }
  capital.addCollider(0, 0, 4.6, 4.6, 0, 1.0);

  // ------------------------------------------------------------ 行星与奇观
  const planet = new Planet(terrain, params.has("veg") ? Number(params.get("veg")) : 1);
  scene.add(planet.group);

  const wonderAnchors = wonders.map((w, i) => {
    const a = new Anchor(wonderDirs[i], wonderGrounds[i], i * 1.3);
    a.object.add(w.group);
    w.group.traverse((o) => (o.castShadow = true));
    scene.add(a.object);
    return a;
  });

  // ------------------------------------------------------------ 天空 / 光照
  const sun = new THREE.DirectionalLight(0xfff1dc, 3.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -140;
  sc.right = 140;
  sc.top = 140;
  sc.bottom = -140;
  sc.near = 10;
  sc.far = 1600;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xbcd8ff, 0x6a5a40, 0.9);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0x8aa4cc, 0.05);
  scene.add(ambient);
  const sunDir = new THREE.Vector3();
  // ?time=0..1:一天中的时刻(0 = 首都正午, 0.5 = 午夜)
  const time0 = Number(params.get("time") ?? "0.92");
  let timeOffset = (Number.isFinite(time0) ? time0 : 0.92) * Math.PI * 2;
  const sunPhase0 = Math.atan2(capDir.z, capDir.x);

  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(PLANET_RADIUS * 1.02, 96, 48),
    new THREE.MeshBasicMaterial({ color: 0x5aa0ff, transparent: true, opacity: 0.3, side: THREE.BackSide, depthWrite: false }),
  );
  halo.material.fog = false;
  halo.renderOrder = 2;
  scene.add(halo);

  const starCount = 3000;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const y = Math.random() * 2 - 1;
    const r = Math.sqrt(1 - y * y);
    const a = Math.random() * Math.PI * 2;
    starPos[i * 3] = Math.cos(a) * r * 1e8;
    starPos[i * 3 + 1] = y * 1e8;
    starPos[i * 3 + 2] = Math.sin(a) * r * 1e8;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, depthWrite: false });
  starMat.fog = false;
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  scene.add(stars);

  // ------------------------------------------------------------ 物理:城市内按建筑碰撞,野外按地形
  const L = new THREE.Vector3();
  const T = new THREE.Vector3();
  const cityAt = (pos: THREE.Vector3): City | null => {
    for (const c of cities) {
      if (c.state !== "ready") continue;
      if (pos.distanceTo(c.anchor.pos) > c.baseRadius + 4000) continue;
      c.toLocal(pos, L);
      if (Math.hypot(L.x, L.z) < c.baseRadius && L.y < 4000) return c;
    }
    return null;
  };
  const physics: PhysicsWorld = {
    resolve(pos, eye, radius, step) {
      const city = cityAt(pos);
      if (city) {
        city.toLocal(pos, L);
        const g = city.collide(L, radius, eye, step);
        let feet = L.y - eye;
        if (feet < g) {
          L.y = g + eye;
          feet = g;
        }
        city.toPlanet(L, pos);
        return { clearance: feet - g };
      }
      const up = T.copy(pos).normalize();
      const gh = R + Math.max(0, planet.heightAt(up));
      if (pos.length() - eye < gh) pos.setLength(gh + eye);
      return { clearance: Math.max(0, pos.length() - eye - gh) };
    },
    drop(pos, eye) {
      const city = cityAt(pos);
      if (city) {
        city.toLocal(pos, L);
        L.y = city.groundAt(L.x, L.z, Infinity) + eye;
        city.toPlanet(L, pos);
        return;
      }
      const up = T.copy(pos).normalize();
      pos.setLength(R + Math.max(0, planet.heightAt(up)) + eye);
    },
  };

  // ------------------------------------------------------------ 玩家 / 书签
  const input = new Input(renderer.domElement);
  controls.world = physics;

  const pois: Poi[] = [];
  const addCityPoi = (c: City, kind: "street" | "aerial") => {
    const v = kind === "street" ? c.streetView() : c.aerialView();
    pois.push({
      name: `${c.name} · ${kind === "street" ? "街头" : "鸟瞰"}`,
      pos: c.toPlanet(v.pos, new THREE.Vector3()),
      look: c.toPlanet(v.look, new THREE.Vector3()),
      mode: kind === "street" ? "walk" : "fly",
      group: "城市",
    });
  };
  pois.push({ name: "轨道 / Orbit", pos: capDir.clone().multiplyScalar(R * 2.6), look: new THREE.Vector3(), mode: "fly", group: "轨道" });
  addCityPoi(capital, "aerial");
  addCityPoi(capital, "street");
  for (const c of cities.slice(1)) addCityPoi(c, "aerial");
  wonders.forEach((w, i) => {
    const a = wonderAnchors[i];
    // 机位放在奇观朝向首都(盆地)的一侧:那边地势低、视野开阔,不会钻进山里
    const toCap = capDir.clone().addScaledVector(a.up, -capDir.dot(a.up));
    const t = toCap.lengthSq() > 1e-12 ? toCap.normalize() : tangentAt(a.up);
    const pos = a.pos.clone().addScaledVector(a.up, w.view.height).addScaledVector(t, w.view.back);
    // 保证机位在地面之上
    const pu = pos.clone().normalize();
    const floor = R + Math.max(0, planet.heightAt(pu)) + 80;
    if (pos.length() < floor) pos.setLength(floor);
    pois.push({
      name: w.name,
      look: a.pos.clone().addScaledVector(a.up, w.view.height * 0.7),
      pos,
      mode: "fly",
      group: "奇观",
    });
  });

  let poiIndex = 0;
  // 信息面板 / 说明:都可以折叠(菜单里的按钮或 I / H 键),状态会记住;窄屏默认收起
  const wide = window.innerWidth >= 1000;
  const toggleHud = bindPanel(hud, "hud-on", wide);
  const toggleHelp = bindPanel(help, "help-on", wide);
  let menu: ReturnType<typeof createMenu> | null = null;
  /** smooth = true 时沿弧线平滑飞过去;初始进入和 ?poi= 用瞬移 */
  const goto = (i: number, smooth = true) => {
    poiIndex = ((i % pois.length) + pois.length) % pois.length;
    const p = pois[poiIndex];
    if (smooth) {
      if (isOverlayOpen()) closeOverlay();
      controls.flyTo(p.pos, p.look, p.mode);
      toast(`飞往:${p.name}`, 1800);
    } else controls.teleport(p.pos, p.look, p.mode);
    menu?.setActive(p.name);
  };
  const cycleTime = () => {
    timeOffset += Math.PI / 4;
    toast("时间快进 3 小时", 1200);
  };
  menu = createMenu(
    pois.map((p, i) => ({ label: p.name, group: p.group, onClick: () => goto(i) })),
    [
      { label: "飞行 / 步行", onClick: () => controls.setMode(controls.mode === "fly" ? "walk" : "fly") },
      { label: "快进 3 小时", onClick: cycleTime },
      { label: "信息 I", onClick: toggleHud },
      { label: "说明 H", onClick: toggleHelp },
    ],
  );
  const startPoi = Number(params.get("poi") ?? "2") - 1;
  goto(Number.isFinite(startPoi) ? startPoi : 1, false);

  // ------------------------------------------------------------ 主循环
  window.addEventListener("resize", () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  const camDir = new THREE.Vector3();
  const localP = new THREE.Vector3();
  const localF = new THREE.Vector3();
  let last = performance.now();
  let hudTimer = 0;
  let fps = 60;
  let slowT = 0;
  let fastT = 0;
  let frameNo = 0;

  renderer.setAnimationLoop(() => {
    // 用 performance.now() 而不是回调参数:某些环境(无头浏览器、后台标签)回调时间戳与真实时间不一致
    const nowMs = performance.now();
    const dt = Math.min(0.1, Math.max(0.0001, (nowMs - last) / 1000));
    last = nowMs;
    fps += (1 / dt - fps) * 0.05;
    if (adaptiveRes && nowMs > 8000) {
      if (fps < 38) {
        slowT += dt;
        fastT = 0;
      } else if (fps > 56) {
        fastT += dt;
        slowT = 0;
      } else slowT = fastT = 0;
      if (slowT > 1.5 && dpr > 0.55) {
        dpr = Math.max(0.55, dpr * 0.8);
        renderer.setPixelRatio(dpr);
        slowT = 0;
      } else if (fastT > 6 && dpr < baseDpr) {
        dpr = Math.min(baseDpr, dpr * 1.15);
        renderer.setPixelRatio(dpr);
        fastT = 0;
      }
    }
    const t = nowMs / 1000;

    // ---- 输入
    const pad = input.poll();
    let interact = pad.pressed.includes(0);
    let toggleMode = pad.pressed.includes(9);
    for (const code of input.consumeKeyPresses()) {
      const m = /^Digit(\d)$/.exec(code);
      if (m) {
        const idx = m[1] === "0" ? 9 : Number(m[1]) - 1;
        if (idx < pois.length) goto(idx);
      } else if (code === "KeyL") controls.levelHorizon();
      else if (code === "KeyF" || code === "Enter") interact = true;
      else if (code === "KeyG") toggleMode = true;
      else if (code === "KeyH") toggleHelp();
      else if (code === "KeyI") toggleHud();
      else if (code === "KeyM") menu?.toggle();
      else if (code === "KeyT") cycleTime();
      else if (code === "Escape" && isOverlayOpen()) closeOverlay();
    }

    if (isOverlayOpen()) {
      if (pad.pressed.includes(1)) closeOverlay();
      interact = false;
      toggleMode = false;
    } else {
      for (const b of pad.pressed) {
        if (b === 3) goto(poiIndex + 1); // Y / △
        else if (b === 2) goto(poiIndex - 1); // X / □
        else if (b === 8) goto(0); // Select
      }
      if (toggleMode) {
        controls.setMode(controls.mode === "fly" ? "walk" : "fly");
        toast(controls.mode === "walk" ? "步行模式:左摇杆移动,B 跳跃" : "飞行模式", 1600);
      }
      if (controls.flying) {
        // 任意摇杆 / 移动键 / 拖动视角 = 打断飞行,交还控制
        const ax = pad.axes;
        const stick = Math.max(Math.abs(ax.leftX), Math.abs(ax.leftY), Math.abs(ax.rightX), Math.abs(ax.rightY));
        const keys = ["KeyW", "KeyA", "KeyS", "KeyD", "Space", "KeyC"].some((k) => input.keys.has(k));
        if (stick > 0.6 || keys) controls.cancelFlight();
      }
      if (!controls.stepFlight(dt)) controls.update(dt, input, pad);
    }
    controls.applyTo(camera);
    const cam = controls.pos;

    // ---- 昼夜
    const a = sunPhase0 + timeOffset + (t / DAY_LENGTH_SECONDS) * Math.PI * 2;
    sunDir.set(Math.cos(a) * 0.93, 0.37, Math.sin(a) * 0.93).normalize();
    camDir.copy(cam).normalize();
    const sunUp = camDir.dot(sunDir);
    const day = smooth(-0.12, 0.25, sunUp);
    night = 1 - day;
    uNight.value = night;

    // ---- 世界(浮动原点:全部相对相机摆放)
    planet.update(cam);
    plaza.anchor.update(cam);
    plaza.update(cam, nowMs);
    let nearest: City = capital;
    let nearestDist = Infinity;
    for (const c of cities) {
      const d = c.update(cam, dt, t, night, c === capital ? 4 : 6);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = c;
      }
    }
    // 奇观:远处整体隐藏,中等距离只画主体,靠近了才显示细节层
    wonders.forEach((w, i) => {
      const d = cam.distanceTo(wonderAnchors[i].pos);
      const show = d < 300_000;
      w.group.visible = show;
      if (!show) return;
      if (w.detail) w.detail.visible = d < (w.detailDistance ?? Infinity);
      w.setDistance?.(d);
      w.update?.(t);
      wonderAnchors[i].update(cam);
    });

    // ---- 交互:在附近城市里找视线前方的可交互物
    let best: { label: string; score: number; act: () => void } | null = null;
    if (!isOverlayOpen()) {
      for (const c of cities) {
        if (c.state !== "ready" || cam.distanceTo(c.anchor.pos) > c.baseRadius + 200) continue;
        c.toLocal(cam, localP);
        c.anchor.dirToLocal(controls.forward, localF);
        const cand = c.findTarget(localP, localF, controls.mode === "walk" ? 3.2 : 4.5);
        if (cand && (!best || cand.score < best.score)) best = cand;
      }
    }
    setPrompt(best ? best.label : null, pad.connected);
    if (interact && best) best.act();

    // ---- 光照
    const altitude = cam.length() - PLANET_RADIUS;
    sun.position.copy(sunDir).multiplyScalar(600);
    sun.target.position.set(0, 0, 0);
    sun.intensity = 3.0 * smooth(-0.05, 0.2, sunUp);
    // 不要在运行时切换 sun.castShadow:three 的节点光照会按它重建 / 初始化阴影贴图,
    // 中途打开会在 WebGPU 下抛 "Cannot read properties of null (reading 'depthTexture')"。
    // 改为暂停阴影贴图的更新(省掉高空和夜里的渲染开销)。
    // 阴影贴图隔帧更新:近处才需要,而且每帧重画一遍全部建筑太贵
    const wantShadow = controls.altitude < 1500 && sunUp > 0;
    sun.shadow.autoUpdate = false;
    sun.shadow.needsUpdate = wantShadow && frameNo++ % 2 === 0;
    hemi.position.copy(camDir);
    hemi.intensity = 0.15 + 0.85 * day;
    ambient.intensity = 0.06 + 0.1 * night;

    // 天空色:白天蓝、黄昏偏橙、夜里深蓝;高空渐变成太空黑
    const dusk = smooth(0.25, 0.0, Math.abs(sunUp - 0.05)) * (1 - night * 0.6);
    const sky = new THREE.Color().copy(nightSky).lerp(skyColor, day).lerp(duskColor, dusk * 0.55);
    const skyAmount = 1 - smooth(15_000, 120_000, altitude);
    background.copy(spaceColor).lerp(sky, skyAmount);
    fog.color.copy(sky);
    fog.density = skyAmount > 0.01 ? (1 / (22_000 + altitude * 6)) * skyAmount : 0;
    starMat.opacity = 1 - skyAmount * day;

    halo.position.copy(cam).negate();
    halo.visible = altitude > 130_000;
    halo.material.opacity = 0.35 * (0.25 + 0.75 * day) * smooth(130_000, 400_000, altitude);

    renderer.render(scene, camera);

    // ---- HUD
    hudTimer += dt;
    if (hudTimer > 0.15 && !hud.classList.contains("hidden")) {
      hudTimer = 0;
      const s = planet.stats;
      const cs = nearest.stats;
      const hours = ((((a - sunPhase0) / (Math.PI * 2)) * 24 + 12) % 24 + 24) % 24;
      const status =
        nearest.state === "ready" ? `${cs.lots} 栋建筑 · ${cs.npcs} 位行人 · 宝箱 ${cs.opened}/${cs.chests}` : `生成中 ${(nearest.progress * 100).toFixed(0)}%`;
      helpMode.textContent = controls.mode === "walk" ? "当前:步行" : `当前:飞行(${controls.padMode === "roll" ? "Roll 模式" : "稳定视角"})`;
      hud.textContent = [
        `模式 Mode    ${controls.mode === "walk" ? "步行 Walk" : "飞行 Fly"}${controls.mode === "fly" ? ` · ${controls.padMode === "roll" ? "Roll" : "Stable"} · scale ${controls.scale.toFixed(2)}` : ""}`,
        `离地 Alt     ${fmtDist(controls.altitude)}  · 速度 ${fmtDist(controls.speed)}/s`,
        `城市 City    ${nearest.name} ${fmtDist(nearestDist)} · ${status}`,
        `时间 Time    ${String(Math.floor(hours)).padStart(2, "0")}:${String(Math.floor((hours % 1) * 60)).padStart(2, "0")} (T 快进) · 摩拉 ${mora}`,
        `地形块 Chunks ${s.active} / ${s.built} · LOD ${s.maxLevel}/${MAX_LEVEL}`,
        `渲染 Backend ${backendName} · ${fps.toFixed(0)} fps · 分辨率 x${dpr.toFixed(2)}`,
        `HTML-in-Canvas ${HTML_IN_CANVAS_NATIVE ? "native" : "SVG fallback"} · 活跃页面 ${plaza.activeCount()}/${plaza.shops.length}`,
        `手柄 Gamepad ${pad.connected ? pad.id.slice(0, 32) : "未连接(按任意键唤醒)"}`,
        `书签 Bookmark ${poiIndex + 1}/${pois.length} ${pois[poiIndex].name}`,
        `行星 R=${(PLANET_RADIUS / 1000).toFixed(0)}km · 夸张 x${TERRAIN_EXAGGERATION} · 网格 ${GRID}`,
      ].join("\n");
    }
  });

  boot.classList.add("hidden");

  // 调试入口
  (window as unknown as Record<string, unknown>).world = {
    renderer,
    scene,
    camera,
    planet,
    controls,
    pois,
    goto,
    plaza,
    cities,
    setTime: (v: number) => {
      timeOffset = v * Math.PI * 2 - (performance.now() / 1000 / DAY_LENGTH_SECONDS) * Math.PI * 2;
    },
    EYE_HEIGHT,
  };
}

main().catch((err) => {
  console.error(err);
  const boot = document.getElementById("boot");
  if (boot) {
    boot.classList.remove("hidden");
    boot.textContent = `初始化失败 / Init failed\n\n${err instanceof Error ? err.message : String(err)}`;
  }
});
