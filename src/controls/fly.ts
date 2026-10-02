import * as THREE from "three/webgpu";
import { PLANET_RADIUS } from "../config";
import type { Planet } from "../world/planet";
import type { Input, PadState } from "./input";

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/**
 * 球面自由飞行相机。
 *
 * "上"始终是脚下的行星法线;视角由(水平朝向 heading, 俯仰 pitch)描述,
 * 所以绕着行星飞行时地平线永远是水平的。位置用 float64 保存,
 * 渲染时相机固定在原点、世界整体相对移动(浮动原点)。
 */
export class FlyControls {
  readonly pos = new THREE.Vector3(0, 0, PLANET_RADIUS * 2.6);
  readonly heading = new THREE.Vector3(1, 0, 0);
  pitch = 0;
  speedMul = 1;
  altitude = 0;
  speed = 0;

  private readonly velocity = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly camUp = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();

  constructor(private readonly planet: Planet) {
    this.lookAt(new THREE.Vector3(0, 0, 0));
  }

  /** 传送到 pos,并朝向 target(行星坐标)。 */
  teleport(pos: THREE.Vector3, target: THREE.Vector3) {
    this.pos.copy(pos);
    this.velocity.set(0, 0, 0);
    this.lookAt(target);
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

  update(dt: number, input: Input, pad: PadState) {
    const up = this.up.copy(this.pos).normalize();

    // 位置变化后把 heading 重新投影到当前切平面
    this.heading.addScaledVector(up, -this.heading.dot(up));
    if (this.heading.lengthSq() < 1e-12) this.heading.set(0, 0, 1).addScaledVector(up, -up.z);
    this.heading.normalize();

    // ---- 视角
    const drag = input.consumeDrag();
    const k = input.keys;
    let yaw = pad.lookX * 2.2 * dt + drag.dx * 0.0028;
    let pitchDelta = pad.lookY * 1.6 * dt - drag.dy * 0.0028;
    if (k.has("ArrowLeft")) yaw -= 1.6 * dt;
    if (k.has("ArrowRight")) yaw += 1.6 * dt;
    if (k.has("ArrowUp")) pitchDelta += 1.2 * dt;
    if (k.has("ArrowDown")) pitchDelta -= 1.2 * dt;

    this.heading.applyAxisAngle(up, -yaw);
    this.pitch = clamp(this.pitch + pitchDelta, -1.5, 1.5);

    this.right.crossVectors(this.heading, up).normalize();
    this.fwd
      .copy(this.heading)
      .multiplyScalar(Math.cos(this.pitch))
      .addScaledVector(up, Math.sin(this.pitch));

    // ---- 速度:随离地高度缩放,贴地慢、高空快
    this.speedMul *= Math.exp(-input.consumeWheel() * 0.0012);
    this.speedMul = clamp(this.speedMul, 0.02, 50);

    const ground = Math.max(0, this.planet.heightAt(up));
    this.altitude = this.pos.length() - PLANET_RADIUS - ground;
    const boost = Math.max(k.has("ShiftLeft") || k.has("ShiftRight") ? 1 : 0, pad.boost);
    const slow = Math.max(k.has("KeyZ") ? 1 : 0, pad.slow);
    const base = clamp(this.altitude * 0.8, 6, 4e6);
    const speed = base * this.speedMul * (1 + 3 * boost) * (1 - 0.85 * slow);

    let moveX = pad.moveX;
    let moveY = pad.moveY;
    if (k.has("KeyW")) moveY += 1;
    if (k.has("KeyS")) moveY -= 1;
    if (k.has("KeyD")) moveX += 1;
    if (k.has("KeyA")) moveX -= 1;
    let vert = pad.rise - pad.fall;
    if (k.has("Space") || k.has("KeyE")) vert += 1;
    if (k.has("KeyC") || k.has("KeyQ") || k.has("ControlLeft")) vert -= 1;
    moveX = clamp(moveX, -1, 1);
    moveY = clamp(moveY, -1, 1);
    vert = clamp(vert, -1, 1);

    const target = this.tmp
      .set(0, 0, 0)
      .addScaledVector(this.fwd, moveY * speed)
      .addScaledVector(this.right, moveX * speed)
      .addScaledVector(up, vert * speed * 0.7);
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
    const up = this.up.copy(this.pos).normalize();
    this.right.crossVectors(this.heading, up).normalize();
    this.fwd
      .copy(this.heading)
      .multiplyScalar(Math.cos(this.pitch))
      .addScaledVector(up, Math.sin(this.pitch));
    this.camUp.crossVectors(this.right, this.fwd).normalize();
    this.tmp.copy(this.fwd).negate();
    this.basis.makeBasis(this.right, this.camUp, this.tmp);
    camera.position.set(0, 0, 0);
    camera.quaternion.setFromRotationMatrix(this.basis);
  }
}
