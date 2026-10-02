import * as THREE from "three/webgpu";
import { PLANET_RADIUS } from "../config";
import type { Planet } from "../world/planet";
import { GAMEPAD_THRESHOLD, type Input, type PadState } from "./input";

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/**
 * 手柄模式,逻辑移植自 WebGPU-Art/protea 的 control.mts:
 *
 *  - stable(稳定视角,默认):
 *      右摇杆 = 左右 / 上下平移,左摇杆 Y = 前后,左摇杆 X = 偏航,
 *      十字键 上下 = 俯仰,十字键 左右 = 翻滚
 *  - roll(Roll 模式,R3 进入,L3 退出):
 *      十字键 = 左右 / 上下平移,左摇杆 Y = 前后,
 *      右摇杆 = 偏航 / 俯仰,左摇杆 X = 翻滚
 *  - L1 / R1:加速(平移 x8,旋转 x4)
 *  - L2 / R2:增大 / 减小缩放 scale(移动速度与 scale 成反比,与 protea 的 `speedy / scale` 一致)
 *  - A:翻滚回正(protea 是自由 6 自由度相机,这里加了"回到水平"以便在行星上辨认方向)
 */
export type PadMode = "stable" | "roll";

/**
 * 球面自由飞行相机。
 *
 * 基准姿态:"上"是脚下行星法线,视角由(水平朝向 heading, 俯仰 pitch)描述;
 * 在此之上叠加绕视线的翻滚 roll(protea 的 spin)。位置用 float64 保存,
 * 渲染时相机固定在原点、世界整体相对移动(浮动原点)。
 */
export class FlyControls {
  readonly pos = new THREE.Vector3(0, 0, PLANET_RADIUS * 2.6);
  readonly heading = new THREE.Vector3(1, 0, 0);
  pitch = 0;
  /** 翻滚角(弧度),正值 = 画面顺时针转(protea 的 spin 方向) */
  roll = 0;
  /** protea 的 atomViewerScale:越大 → 看得越"近"、移动越慢 */
  scale = 1;
  mode: PadMode = "stable";
  altitude = 0;
  speed = 0;

  private leveling = false;
  private readonly velocity = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly camUp = new THREE.Vector3();
  private readonly camRight = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();

  constructor(private readonly planet: Planet) {
    this.lookAt(new THREE.Vector3(0, 0, 0));
  }

  /** 传送到 pos,并朝向 target(行星坐标);同时回正翻滚。 */
  teleport(pos: THREE.Vector3, target: THREE.Vector3) {
    this.pos.copy(pos);
    this.velocity.set(0, 0, 0);
    this.roll = 0;
    this.leveling = false;
    this.lookAt(target);
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

    // ---- 手柄模式切换(protea:R3 进入 faster fly / roll,L3 回到 stable)
    if (this.mode === "roll" && pad.l3 > 0.5) this.mode = "stable";
    else if (this.mode === "stable" && pad.r3 > 0.5) this.mode = "roll";
    if (pad.pressed.includes(0)) this.leveling = true;

    const k = input.keys;
    const gate = (x: number) => (Math.abs(x) > GAMEPAD_THRESHOLD ? x : 0);
    const a = pad.axes;
    const keyBoost = k.has("ShiftLeft") || k.has("ShiftRight");
    const speedy = pad.l1 > 0.5 || pad.r1 > 0.5 || keyBoost ? 8 : 1;
    const faster = speedy > 4 ? 4 : 1;

    // ---- 六个自由度输入:右 / 上 / 前 平移,偏航(右转为正)/ 俯仰(抬头为正)/ 翻滚(顺时针为正)
    let mx: number;
    let my: number;
    let mz: number;
    let yaw: number;
    let pit: number;
    let spin: number;
    if (this.mode === "roll") {
      mx = gate(pad.right - pad.left);
      my = gate(pad.up - pad.down);
      mz = -gate(a.leftY);
      yaw = gate(a.rightX) * 1.0 * faster;
      pit = -gate(a.rightY) * 1.0 * faster;
      spin = gate(a.leftX) * 2.0 * faster;
    } else {
      mx = gate(a.rightX);
      my = -gate(a.rightY);
      mz = -gate(a.leftY);
      yaw = gate(a.leftX) * 1.0 * faster;
      pit = gate(pad.up - pad.down) * 1.0 * faster;
      spin = gate(pad.right - pad.left) * 2.0 * faster;
    }

    // ---- 键鼠(和手柄叠加)
    const drag = input.consumeDrag();
    yaw += drag.dx * 0.0028 / dt;
    pit += -drag.dy * 0.0028 / dt;
    if (k.has("ArrowLeft")) yaw -= 1.6;
    if (k.has("ArrowRight")) yaw += 1.6;
    if (k.has("ArrowUp")) pit += 1.2;
    if (k.has("ArrowDown")) pit -= 1.2;
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

    // ---- 旋转
    this.heading.applyAxisAngle(up, -yaw * dt);
    this.pitch = clamp(this.pitch + pit * dt, -1.5, 1.5);
    this.roll += spin * dt;
    if (this.leveling) {
      this.roll *= Math.exp(-dt * 6);
      if (Math.abs(this.roll) < 0.002) {
        this.roll = 0;
        this.leveling = false;
      }
    }
    this.roll = ((((this.roll + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;

    // ---- 缩放:L2 增大 / R2 减小(protea 用 changeScaleBy(±0.01 * speedy)),滚轮同理
    const scaleDir = (pad.l2 > 0.5 ? 1 : 0) - (pad.r2 > 0.5 ? 1 : 0);
    if (scaleDir !== 0) this.scale *= Math.exp(scaleDir * 1.0 * (speedy > 4 ? 3 : 1) * dt);
    this.scale *= Math.exp(input.consumeWheel() * 0.0012);
    this.scale = clamp(this.scale, 0.02, 50);

    // ---- 速度:随离地高度缩放,贴地慢、高空快;除以 scale,乘以 speedy(protea 的 ss = speedy / scale)
    const ground = Math.max(0, this.planet.heightAt(up));
    this.altitude = this.pos.length() - PLANET_RADIUS - ground;
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

    // ---- 地面碰撞(也不能潜入海面以下)
    const len = this.pos.length();
    const newUp = this.tmp.copy(this.pos).divideScalar(len);
    const floor = PLANET_RADIUS + Math.max(0, this.planet.heightAt(newUp)) + 2;
    if (len < floor) {
      this.pos.setLength(floor);
      const vUp = this.velocity.dot(newUp);
      if (vUp < 0) this.velocity.addScaledVector(newUp, -vUp);
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
