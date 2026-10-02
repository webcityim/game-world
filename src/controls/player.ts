import * as THREE from "three/webgpu";
import { PLANET_RADIUS } from "../config";
import { GAMEPAD_THRESHOLD, type Input, type PadState } from "./input";

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/**
 * 碰撞与地面查询。由 main.ts 用"城市 + 地形"实现:
 * 在城市范围内按城市本地坐标做建筑碰撞,在野外按地形高度。
 */
export interface PhysicsWorld {
  /**
   * 解析碰撞并修改 pos(行星坐标,眼睛位置)。
   * @param eye 眼睛离脚底的高度
   * @param radius 水平碰撞半径
   * @param step 能直接迈上去的台阶高度
   * @returns clearance = 脚底离地高度(≥ 0)
   */
  resolve(pos: THREE.Vector3, eye: number, radius: number, step: number): { clearance: number };
  /** 把 pos 直接放到脚下地面(或屋顶)上 */
  drop(pos: THREE.Vector3, eye: number): void;
}

/**
 * 手柄飞行模式,逻辑移植自 WebGPU-Art/protea 的 control.mts:
 *
 *  - stable(稳定视角,默认):
 *      右摇杆 = 左右 / 上下平移,左摇杆 Y = 前后,左摇杆 X = 偏航,
 *      十字键 上下 = 俯仰,十字键 左右 = 翻滚
 *  - roll(Roll 模式,R3 进入,L3 退出):
 *      十字键 = 左右 / 上下平移,左摇杆 Y = 前后,
 *      右摇杆 = 偏航 / 俯仰,左摇杆 X = 翻滚
 *  - L1 / R1:加速(平移 x8,旋转 x4)
 *  - L2 / R2:增大 / 减小缩放 scale(移动速度与 scale 成反比)
 *  - B:翻滚回正(protea 是自由 6 自由度相机,这里加了"回到水平")
 */
export type PadMode = "stable" | "roll";

/** fly = 自由飞行;walk = 落地步行(重力、跳跃、建筑碰撞) */
export type MoveMode = "fly" | "walk";

export const EYE_HEIGHT = 1.7;
const WALK_SPEED = 4.2;
const RUN_SPEED = 9;
const GRAVITY = 22;
const JUMP_SPEED = 7.2;

/**
 * 球面玩家控制器。
 *
 * 基准姿态:"上"是脚下行星法线,视角由(水平朝向 heading, 俯仰 pitch)描述;
 * 飞行时可以叠加绕视线的翻滚 roll(protea 的 spin)。位置用 float64 保存,
 * 渲染时相机固定在原点、世界整体相对移动(浮动原点)。
 */
export class PlayerControls {
  readonly pos = new THREE.Vector3(0, 0, PLANET_RADIUS * 2.6);
  readonly heading = new THREE.Vector3(1, 0, 0);
  pitch = 0;
  /** 翻滚角(弧度),正值 = 画面顺时针转(protea 的 spin 方向) */
  roll = 0;
  /** protea 的 atomViewerScale:越大 → 移动越慢 */
  scale = 1;
  padMode: PadMode = "stable";
  mode: MoveMode = "fly";
  /** 脚底离地高度(米) */
  altitude = 0;
  speed = 0;
  grounded = false;
  world: PhysicsWorld | null = null;

  private flight: {
    t: number;
    duration: number;
    d0: THREE.Vector3;
    d1: THREE.Vector3;
    angle: number;
    r0: number;
    r1: number;
    bump: number;
    h0: THREE.Vector3;
    h1: THREE.Vector3;
    p0: number;
    p1: number;
    roll0: number;
    mode: MoveMode;
    pos: THREE.Vector3;
    target: THREE.Vector3;
  } | null = null;
  private leveling = false;
  private readonly velocity = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly camUp = new THREE.Vector3();
  private readonly camRight = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();

  constructor() {
    this.lookAt(new THREE.Vector3(0, 0, 0));
  }

  /** 视线方向(行星坐标,单位向量) */
  get forward(): THREE.Vector3 {
    return this.fwd;
  }

  /** 传送到 pos,并朝向 target(行星坐标);同时回正翻滚。 */
  teleport(pos: THREE.Vector3, target: THREE.Vector3, mode: MoveMode = this.mode) {
    this.flight = null;
    this.pos.copy(pos);
    this.velocity.set(0, 0, 0);
    this.roll = 0;
    this.leveling = false;
    this.mode = mode;
    this.lookAt(target);
  }

  /** 是否正在做预设位置之间的平滑飞行 */
  get flying(): boolean {
    return this.flight !== null;
  }

  /**
   * 平滑飞向 pos 并朝向 target:沿球面弧线(方向球面插值 + 高度抬升),
   * 视线朝向缓动过渡,距离越远耗时越长。到达后切换到 mode。
   */
  flyTo(pos: THREE.Vector3, target: THREE.Vector3, mode: MoveMode) {
    // 先借 lookAt 算出目的地的朝向 / 俯仰
    const savePos = this.pos.clone();
    const saveHeading = this.heading.clone();
    const savePitch = this.pitch;
    this.pos.copy(pos);
    this.lookAt(target);
    const toHeading = this.heading.clone();
    const toPitch = this.pitch;
    this.pos.copy(savePos);
    this.heading.copy(saveHeading);
    this.pitch = savePitch;

    const r0 = savePos.length();
    const r1 = pos.length();
    const d0 = savePos.clone().normalize();
    const d1 = pos.clone().normalize();
    const angle = Math.acos(clamp(d0.dot(d1), -1, 1));
    const dist = angle * Math.max(r0, r1);
    const duration = clamp(1.4 + Math.log10(Math.max(dist, 10) / 50) * 1.15, 1.6, 6);
    // 弧线最高点:远距离升到高空,近距离只略微抬起
    const bump = Math.min(dist * 0.28, PLANET_RADIUS * 0.6);
    this.velocity.set(0, 0, 0);
    this.leveling = false;
    this.mode = "fly";
    this.flight = {
      t: 0,
      duration,
      d0,
      d1,
      angle,
      r0,
      r1,
      bump,
      h0: saveHeading.clone().addScaledVector(d0, -saveHeading.dot(d0)).normalize(),
      h1: toHeading,
      p0: savePitch,
      p1: toPitch,
      roll0: this.roll,
      mode,
      pos: pos.clone(),
      target: target.clone(),
    };
  }

  cancelFlight() {
    this.flight = null;
  }

  /** 推进平滑飞行;返回 true 表示本帧由飞行接管(调用方应跳过 update)。 */
  stepFlight(dt: number): boolean {
    const f = this.flight;
    if (!f) return false;
    f.t = Math.min(1, f.t + dt / f.duration);
    const k = f.t;
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; // easeInOutCubic
    const sinA = Math.sin(f.angle);
    let dir: THREE.Vector3;
    if (sinA < 1e-6) dir = this.tmp.copy(f.d1);
    else {
      const a = Math.sin((1 - e) * f.angle) / sinA;
      const b = Math.sin(e * f.angle) / sinA;
      dir = this.tmp.copy(f.d0).multiplyScalar(a).addScaledVector(f.d1, b);
    }
    dir.normalize();
    const r = f.r0 + (f.r1 - f.r0) * e + f.bump * Math.sin(Math.PI * e);
    this.pos.copy(dir).multiplyScalar(r);
    // 朝向:水平朝向在球面上线性混合后投影到切平面,俯仰 / 翻滚线性缓动
    this.heading.copy(f.h0).lerp(f.h1, e);
    this.heading.addScaledVector(dir, -this.heading.dot(dir));
    if (this.heading.lengthSq() < 1e-10) this.heading.copy(f.h1);
    this.heading.normalize();
    this.pitch = f.p0 + (f.p1 - f.p0) * e;
    this.roll = f.roll0 * (1 - e);
    this.speed = 0;
    if (f.t >= 1) {
      this.flight = null;
      this.teleport(f.pos, f.target, f.mode);
      if (f.mode === "walk" && this.world) this.world.drop(this.pos, EYE_HEIGHT);
    }
    return true;
  }

  setMode(mode: MoveMode) {
    this.flight = null;
    if (mode === this.mode) return;
    this.mode = mode;
    this.velocity.set(0, 0, 0);
    if (mode === "walk") {
      this.leveling = true;
      // 离地很高时直接落到脚下(否则要掉好几分钟)
      if (this.altitude > 40 && this.world) this.world.drop(this.pos, EYE_HEIGHT);
      this.pitch = clamp(this.pitch, -1.2, 1.2);
    }
  }

  levelHorizon() {
    this.leveling = true;
  }

  lookAt(target: THREE.Vector3) {
    const up = this.up.copy(this.pos).normalize();
    const f = this.tmp.copy(target).sub(this.pos).normalize();
    this.pitch = Math.asin(clamp(f.dot(up), -1, 1));
    this.heading.copy(f).addScaledVector(up, -f.dot(up));
    if (this.heading.lengthSq() < 1e-12) {
      // 正对天顶 / 脚下时随便取一个切线方向
      this.heading.set(1, 0, 0).addScaledVector(up, -up.x);
      if (this.heading.lengthSq() < 1e-12) this.heading.set(0, 0, 1);
    }
    this.heading.normalize();
    this.updateBasis();
  }

  /** 由 heading / pitch / roll 算出带翻滚的相机基向量。 */
  private updateBasis() {
    const up = this.up;
    this.right.crossVectors(this.heading, up).normalize();
    this.fwd
      .copy(this.heading)
      .multiplyScalar(Math.cos(this.pitch))
      .addScaledVector(up, Math.sin(this.pitch));
    const levelUp = this.tmp.crossVectors(this.right, this.fwd).normalize();
    const cr = Math.cos(this.roll);
    const sr = Math.sin(this.roll);
    // roll > 0:相机的"上"向左倾,画面看起来顺时针转
    this.camUp.copy(levelUp).multiplyScalar(cr).addScaledVector(this.right, -sr);
    this.camRight.copy(this.right).multiplyScalar(cr).addScaledVector(levelUp, sr);
  }

  update(dt: number, input: Input, pad: PadState) {
    const up = this.up.copy(this.pos).normalize();

    // 位置变化后把 heading 重新投影到当前切平面
    this.heading.addScaledVector(up, -this.heading.dot(up));
    if (this.heading.lengthSq() < 1e-12) this.heading.set(0, 0, 1).addScaledVector(up, -up.z);
    this.heading.normalize();

    if (pad.pressed.includes(1) && this.mode === "fly") this.leveling = true;

    if (this.mode === "walk") this.updateWalk(dt, input, pad);
    else this.updateFly(dt, input, pad);

    if (this.leveling) {
      this.roll *= Math.exp(-dt * 6);
      if (Math.abs(this.roll) < 0.002) {
        this.roll = 0;
        this.leveling = false;
      }
    }
    this.roll = ((((this.roll + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  }

  // ------------------------------------------------------------------ 飞行

  private updateFly(dt: number, input: Input, pad: PadState) {
    const up = this.up;
    // ---- 手柄模式切换(protea:R3 进入 Roll,L3 回到 stable)
    if (this.padMode === "roll" && pad.l3 > 0.5) this.padMode = "stable";
    else if (this.padMode === "stable" && pad.r3 > 0.5) this.padMode = "roll";

    const k = input.keys;
    const gate = (x: number) => (Math.abs(x) > GAMEPAD_THRESHOLD ? x : 0);
    const a = pad.axes;
    const keyBoost = k.has("ShiftLeft") || k.has("ShiftRight");
    const speedy = pad.l1 > 0.5 || pad.r1 > 0.5 || keyBoost ? 8 : 1;
    const faster = speedy > 4 ? 4 : 1;

    // 六个自由度:右 / 上 / 前 平移,偏航(右转为正)/ 俯仰(抬头为正)/ 翻滚(顺时针为正)
    let mx: number;
    let my: number;
    let mz: number;
    let yaw: number;
    let pit: number;
    let spin: number;
    if (this.padMode === "roll") {
      mx = gate(pad.right - pad.left);
      my = gate(pad.up - pad.down);
      mz = -gate(a.leftY);
      yaw = gate(a.rightX) * faster;
      pit = -gate(a.rightY) * faster;
      spin = gate(a.leftX) * 2.0 * faster;
    } else {
      mx = gate(a.rightX);
      my = -gate(a.rightY);
      mz = -gate(a.leftY);
      yaw = gate(a.leftX) * faster;
      pit = gate(pad.up - pad.down) * faster;
      spin = gate(pad.right - pad.left) * 2.0 * faster;
    }

    const look = this.keyboardLook(dt, input);
    yaw += look.yaw;
    pit += look.pitch;
    if (k.has("KeyE")) spin += 2;
    if (k.has("KeyQ")) spin -= 2;
    if (k.has("KeyW")) mz += 1;
    if (k.has("KeyS")) mz -= 1;
    if (k.has("KeyD")) mx += 1;
    if (k.has("KeyA")) mx -= 1;
    if (k.has("Space")) my += 1;
    if (k.has("KeyC") || k.has("ControlLeft")) my -= 1;
    mx = clamp(mx, -1, 1);
    my = clamp(my, -1, 1);
    mz = clamp(mz, -1, 1);

    this.heading.applyAxisAngle(up, -yaw * dt);
    this.pitch = clamp(this.pitch + pit * dt, -1.5, 1.5);
    this.roll += spin * dt;

    // 缩放:L2 增大 / R2 减小(protea 用 changeScaleBy(±0.01 * speedy)),滚轮同理
    const scaleDir = (pad.l2 > 0.5 ? 1 : 0) - (pad.r2 > 0.5 ? 1 : 0);
    if (scaleDir !== 0) this.scale *= Math.exp(scaleDir * (speedy > 4 ? 3 : 1) * dt);
    this.scale *= Math.exp(input.consumeWheel() * 0.0012);
    this.scale = clamp(this.scale, 0.02, 50);

    // 速度随离地高度缩放:贴地慢、高空快;除以 scale,乘以 speedy(protea 的 ss = speedy / scale)
    const slow = k.has("KeyZ") ? 0.15 : 1;
    const speed = (clamp(this.altitude * 0.8, 6, 4e6) * speedy * slow) / this.scale;

    this.updateBasis();
    const target = this.tmp
      .set(0, 0, 0)
      .addScaledVector(this.fwd, mz * speed)
      .addScaledVector(this.camRight, mx * speed)
      .addScaledVector(this.camUp, my * speed);
    this.velocity.lerp(target, 1 - Math.exp(-dt * 5));
    this.pos.addScaledVector(this.velocity, dt);
    this.speed = this.velocity.length();

    this.collide(1.0, 0.6, 0.3);
  }

  // ------------------------------------------------------------------ 步行

  private updateWalk(dt: number, input: Input, pad: PadState) {
    const up = this.up;
    const k = input.keys;
    const gate = (x: number) => (Math.abs(x) > GAMEPAD_THRESHOLD ? x : 0);
    const a = pad.axes;

    // 步行用常见的 FPS 映射:左摇杆移动,右摇杆视角
    let yaw = gate(a.rightX) * 2.4;
    let pit = -gate(a.rightY) * 1.8;
    const look = this.keyboardLook(dt, input);
    yaw += look.yaw;
    pit += look.pitch;
    this.heading.applyAxisAngle(up, -yaw * dt);
    this.pitch = clamp(this.pitch + pit * dt, -1.45, 1.45);
    input.consumeWheel();

    let mx = gate(a.leftX);
    let mz = -gate(a.leftY);
    if (k.has("KeyW")) mz += 1;
    if (k.has("KeyS")) mz -= 1;
    if (k.has("KeyD")) mx += 1;
    if (k.has("KeyA")) mx -= 1;
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    const run = pad.l1 > 0.5 || pad.r1 > 0.5 || k.has("ShiftLeft") || k.has("ShiftRight");
    const speed = run ? RUN_SPEED : WALK_SPEED;

    this.right.crossVectors(this.heading, up).normalize();
    // 水平速度(切平面内)平滑跟随输入,竖直速度受重力
    const vUp = this.velocity.dot(up);
    const horiz = this.tmp.copy(this.velocity).addScaledVector(up, -vUp);
    const want = new THREE.Vector3().addScaledVector(this.heading, mz * speed).addScaledVector(this.right, mx * speed);
    horiz.lerp(want, 1 - Math.exp(-dt * (this.grounded ? 12 : 2.5)));
    let vy = vUp - GRAVITY * dt;
    const jump = pad.pressed.includes(1) || input.keys.has("Space");
    if (jump && this.grounded) vy = JUMP_SPEED;
    this.velocity.copy(horiz).addScaledVector(up, vy);
    this.pos.addScaledVector(this.velocity, dt);
    this.speed = horiz.length();

    this.updateBasis();
    this.collide(EYE_HEIGHT, 0.35, 0.55);
  }

  private keyboardLook(dt: number, input: Input) {
    const k = input.keys;
    const drag = input.consumeDrag();
    let yaw = (drag.dx * 0.0028) / dt;
    let pitch = (-drag.dy * 0.0028) / dt;
    if (k.has("ArrowLeft")) yaw -= 1.6;
    if (k.has("ArrowRight")) yaw += 1.6;
    if (k.has("ArrowUp")) pitch += 1.2;
    if (k.has("ArrowDown")) pitch -= 1.2;
    return { yaw, pitch };
  }

  /** 与城市建筑 / 地形碰撞,并更新离地高度与是否着地。 */
  private collide(eye: number, radius: number, step: number) {
    if (!this.world) return;
    const before = this.tmp.copy(this.pos);
    const { clearance } = this.world.resolve(this.pos, eye, radius, step);
    this.altitude = clearance;
    this.grounded = clearance < 0.06;
    // 被推开的方向上去掉速度分量(撞墙不反弹,落地不再下坠)
    const push = before.sub(this.pos).negate();
    const pl = push.length();
    if (pl > 1e-6) {
      push.divideScalar(pl);
      const vn = this.velocity.dot(push);
      if (vn < 0) this.velocity.addScaledVector(push, -vn);
    }
  }

  /** 把姿态写入相机。相机永远在原点(浮动原点)。 */
  applyTo(camera: THREE.PerspectiveCamera) {
    this.up.copy(this.pos).normalize();
    this.updateBasis();
    this.tmp.copy(this.fwd).negate();
    this.basis.makeBasis(this.camRight, this.camUp, this.tmp);
    camera.position.set(0, 0, 0);
    camera.quaternion.setFromRotationMatrix(this.basis);
  }
}
