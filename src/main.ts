import * as THREE from "three/webgpu";
import "./style.css";
import { DAY_LENGTH_SECONDS, GRID, MAX_LEVEL, PLANET_RADIUS, TERRAIN_EXAGGERATION } from "./config";
import { FlyControls } from "./controls/fly";
import { Input } from "./controls/input";
import { createShopPlaza } from "./shops/shop";
import { HTML_IN_CANVAS_NATIVE } from "./shops/htmlTexture";
import { Anchor, pickSites } from "./world/anchor";
import { Planet } from "./world/planet";
import { Terrain } from "./world/terrain";
import {
  createCrystalSpire,
  createFloatingIsle,
  createSkyRing,
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
  return `${m.toFixed(0)} m`;
}

interface Poi {
  name: string;
  target: THREE.Vector3;
  viewPos: THREE.Vector3;
}

/** 在 up 处取一个任意的单位切向量。 */
function tangentAt(up: THREE.Vector3): THREE.Vector3 {
  const t = new THREE.Vector3().crossVectors(up, new THREE.Vector3(0, 1, 0));
  if (t.lengthSq() < 1e-8) t.crossVectors(up, new THREE.Vector3(1, 0, 0));
  return t.normalize();
}

async function main() {
  const boot = document.getElementById("boot")!;
  const hud = document.getElementById("hud")!;
  const appEl = document.getElementById("app")!;

  // ------------------------------------------------------------ 渲染器(WebGPU,不支持时自动回落 WebGL2)
  const renderer = new THREE.WebGPURenderer({ antialias: true, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  appEl.appendChild(renderer.domElement);
  await renderer.init();
  const backendName = (renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend
    ? "WebGPU"
    : "WebGL2 (fallback)";

  const scene = new THREE.Scene();
  const spaceColor = new THREE.Color(0x01020a);
  const skyColor = new THREE.Color(0x6fb2ff);
  const background = new THREE.Color().copy(spaceColor);
  scene.background = background;

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 3e8);

  // ------------------------------------------------------------ 世界
  const terrain = new Terrain();

  // 选址必须在任何地形块生成之前,然后把地基压平
  const sites = pickSites(terrain, [
    { minH: 30, maxH: 220, maxSlope: 0.12 }, // 商铺广场
    { minH: 30, maxH: 260, maxSlope: 0.15, nearIndex: 0, minAngle: 0.012, maxAngle: 0.1 },
    { minH: 30, maxH: 260, maxSlope: 0.15, nearIndex: 0, minAngle: 0.012, maxAngle: 0.1 },
    { minH: 30, maxH: 260, maxSlope: 0.15, nearIndex: 0, minAngle: 0.012, maxAngle: 0.1 },
    { minH: 30, maxH: 260, maxSlope: 0.15, nearIndex: 0, minAngle: 0.012, maxAngle: 0.1 },
  ]);
  const [plazaDir, ...wonderDirs] = sites;

  const wonders: Wonder[] = [createWorldTree(), createFloatingIsle(), createCrystalSpire(), createSkyRing()];

  const groundOf = (d: THREE.Vector3) => terrain.height(d.x, d.y, d.z, 1e6);
  const plazaGround = groundOf(plazaDir);
  terrain.addFlatZone(plazaDir, 120, 280, plazaGround);
  const wonderGrounds = wonderDirs.map((d, i) => {
    const h = groundOf(d);
    terrain.addFlatZone(d, wonders[i].footprint.inner, wonders[i].footprint.outer, h);
    return h;
  });

  const planet = new Planet(terrain);
  scene.add(planet.group);

  const plaza = createShopPlaza(plazaDir, plazaGround, 0.4);
  scene.add(plaza.anchor.object);

  const wonderAnchors = wonders.map((w, i) => {
    const a = new Anchor(wonderDirs[i], wonderGrounds[i], i * 1.3);
    a.object.add(w.group);
    scene.add(a.object);
    return a;
  });

  // ------------------------------------------------------------ 天空 / 光照
  const sun = new THREE.DirectionalLight(0xfff1dc, 3.4);
  scene.add(sun);
  const ambient = new THREE.AmbientLight(0x8aa4cc, 0.3);
  scene.add(ambient);
  const sunDir = new THREE.Vector3();
  const sunPhase0 = Math.atan2(plazaDir.z, plazaDir.x);

  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(PLANET_RADIUS * 1.02, 96, 48),
    new THREE.MeshBasicMaterial({
      color: 0x5aa0ff,
      transparent: true,
      opacity: 0.3,
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
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
  const starMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 2,
    sizeAttenuation: false,
    transparent: true,
    depthWrite: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  scene.add(stars);

  // ------------------------------------------------------------ 相机 / 书签
  const input = new Input(renderer.domElement);
  const controls = new FlyControls(planet);

  const plazaUp = plaza.anchor.up;
  const plazaTan = tangentAt(plazaUp);
  const pois: Poi[] = [
    {
      name: "轨道 / Orbit",
      target: new THREE.Vector3(0, 0, 0),
      viewPos: plazaDir.clone().multiplyScalar(PLANET_RADIUS * 2.6),
    },
    {
      name: "商铺广场 / Shop Plaza",
      target: plaza.anchor.pos.clone().addScaledVector(plazaUp, 3),
      viewPos: plaza.anchor.pos.clone().addScaledVector(plazaUp, 32).addScaledVector(plazaTan, 78),
    },
  ];
  wonders.forEach((w, i) => {
    const a = wonderAnchors[i];
    const t = tangentAt(a.up);
    pois.push({
      name: w.name,
      target: a.pos.clone().addScaledVector(a.up, w.view.height * 0.7),
      viewPos: a.pos.clone().addScaledVector(a.up, w.view.height).addScaledVector(t, w.view.back),
    });
  });

  let poiIndex = 0;
  const goto = (i: number) => {
    poiIndex = ((i % pois.length) + pois.length) % pois.length;
    const p = pois[poiIndex];
    controls.teleport(p.viewPos, p.target);
  };
  goto(0);

  // ------------------------------------------------------------ 主循环
  window.addEventListener("resize", () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  const camDir = new THREE.Vector3();
  let last = performance.now();
  let hudTimer = 0;
  let fps = 60;
  let padName = "";

  renderer.setAnimationLoop((nowMs: number) => {
    const dt = Math.min(0.1, Math.max(0.0001, (nowMs - last) / 1000));
    last = nowMs;
    fps += (1 / dt - fps) * 0.05;
    const t = nowMs / 1000;

    // 输入
    const pad = input.poll();
    padName = pad.connected ? pad.id : "";
    for (const code of input.consumeKeyPresses()) {
      const m = /^Digit(\d)$/.exec(code);
      if (m) {
        const idx = Number(m[1]) - 1;
        if (idx >= 0 && idx < pois.length) goto(idx);
      }
    }
    for (const b of pad.pressed) {
      if (b === 3 || b === 15) goto(poiIndex + 1);
      else if (b === 14) goto(poiIndex - 1);
    }

    controls.update(dt, input, pad);
    controls.applyTo(camera);
    const cam = controls.pos;

    // 世界(浮动原点:全部相对相机摆放)
    planet.update(cam);
    plaza.anchor.update(cam);
    plaza.update(cam, nowMs);
    wonders.forEach((w, i) => {
      w.update?.(t);
      wonderAnchors[i].update(cam);
    });

    // 昼夜
    const a = sunPhase0 + (t / DAY_LENGTH_SECONDS) * Math.PI * 2;
    sunDir.set(Math.cos(a) * 0.93, 0.37, Math.sin(a) * 0.93).normalize();
    sun.position.copy(sunDir).multiplyScalar(1e4);

    camDir.copy(cam).normalize();
    const altitudeAboveSea = cam.length() - PLANET_RADIUS;
    const day = smooth(-0.12, 0.25, camDir.dot(sunDir));
    const skyAmount = (1 - smooth(15_000, 120_000, altitudeAboveSea)) * day;
    background.copy(spaceColor).lerp(skyColor, skyAmount);
    ambient.intensity = 0.07 + 0.4 * day;
    starMat.opacity = 1 - skyAmount;

    halo.position.copy(cam).negate();
    halo.visible = altitudeAboveSea > 130_000;
    (halo.material as THREE.MeshBasicMaterial).opacity =
      0.35 * (0.25 + 0.75 * day) * smooth(130_000, 400_000, altitudeAboveSea);

    renderer.render(scene, camera);

    // HUD
    hudTimer += dt;
    if (hudTimer > 0.15) {
      hudTimer = 0;
      let nearest = pois[0];
      let nd = Infinity;
      for (const p of pois.slice(1)) {
        const d = cam.distanceTo(p.target);
        if (d < nd) {
          nd = d;
          nearest = p;
        }
      }
      const s = planet.stats;
      hud.textContent = [
        `高度 Alt     ${fmtDist(controls.altitude)}`,
        `速度 Speed   ${fmtDist(controls.speed)}/s  (x${controls.speedMul.toFixed(2)})`,
        `最近 Nearest ${nearest.name}  ${fmtDist(nd)}`,
        `地形块 Chunks ${s.active} 活跃 / ${s.built} 缓存 · LOD ${s.maxLevel}/${MAX_LEVEL}`,
        `渲染 Backend ${backendName} · ${fps.toFixed(0)} fps`,
        `HTML-in-Canvas ${HTML_IN_CANVAS_NATIVE ? "native" : "SVG fallback"} · 活跃页面 ${plaza.activeCount()}/${plaza.shops.length}`,
        `手柄 Gamepad ${padName || "未连接(按任意键唤醒)"}`,
        `书签 Bookmark ${poiIndex + 1}/${pois.length} ${pois[poiIndex].name}`,
        `行星 R=${(PLANET_RADIUS / 1000).toFixed(0)}km · 夸张 x${TERRAIN_EXAGGERATION} · 网格 ${GRID}`,
      ].join("\n");
    }
  });

  boot.classList.add("hidden");

  // 调试入口
  (window as unknown as Record<string, unknown>).world = { renderer, scene, camera, planet, controls, pois, goto, plaza };
}

main().catch((err) => {
  console.error(err);
  const boot = document.getElementById("boot");
  if (boot) {
    boot.classList.remove("hidden");
    boot.textContent = `初始化失败 / Init failed\n\n${err instanceof Error ? err.message : String(err)}`;
  }
});
