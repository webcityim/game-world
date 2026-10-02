// 键盘 / 鼠标 / 手柄输入汇总。
//
// 手柄逻辑参考 WebGPU-Art/protea 的 src/gamepad.ts + src/control.mts:
// 直接暴露四个摇杆轴和全部标准按钮(含 L3/R3、十字键),
// 由 FlyControls 按"稳定视角 / Roll 模式"两套映射解释。

export interface PadAxes {
  leftX: number;
  leftY: number;
  rightX: number;
  rightY: number;
}

export interface PadState {
  connected: boolean;
  id: string;
  axes: PadAxes;
  /** 按钮的模拟值 0..1 */
  l1: number;
  r1: number;
  l2: number;
  r2: number;
  l3: number;
  r3: number;
  up: number;
  down: number;
  left: number;
  right: number;
  /** 本帧刚按下的按钮编号(标准映射:0=A/×,1=B/○,2=X/□,3=Y/△,8=Select,9=Start) */
  pressed: number[];
}

/** 摇杆死区。protea 默认 0.016,多数手柄会漂移,所以默认更大;可用 ?threshold= 覆盖。 */
export const GAMEPAD_THRESHOLD = (() => {
  const raw = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("threshold");
  const v = raw === null ? NaN : Number(raw);
  return Number.isFinite(v) ? v : 0.08;
})();

export function emptyPad(): PadState {
  return {
    connected: false,
    id: "",
    axes: { leftX: 0, leftY: 0, rightX: 0, rightY: 0 },
    l1: 0,
    r1: 0,
    l2: 0,
    r2: 0,
    l3: 0,
    r3: 0,
    up: 0,
    down: 0,
    left: 0,
    right: 0,
    pressed: [],
  };
}

export class Input {
  readonly keys = new Set<string>();
  private dragDX = 0;
  private dragDY = 0;
  private wheel = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private prevButtons: boolean[] = [];
  private readonly keyPressed: string[] = [];

  constructor(target: HTMLElement) {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.keyPressed.push(e.code);
      if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());

    target.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      target.setPointerCapture(e.pointerId);
    });
    target.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      this.dragDX += e.clientX - this.lastX;
      this.dragDY += e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    const stop = () => (this.dragging = false);
    target.addEventListener("pointerup", stop);
    target.addEventListener("pointercancel", stop);
    target.addEventListener(
      "wheel",
      (e) => {
        this.wheel += e.deltaY;
        e.preventDefault();
      },
      { passive: false },
    );
  }

  /** 取走本帧累积的鼠标拖拽量(像素)。 */
  consumeDrag(): { dx: number; dy: number } {
    const r = { dx: this.dragDX, dy: this.dragDY };
    this.dragDX = 0;
    this.dragDY = 0;
    return r;
  }

  consumeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  /** 取走本帧新按下的键(用于书签等一次性动作)。 */
  consumeKeyPresses(): string[] {
    return this.keyPressed.splice(0, this.keyPressed.length);
  }

  poll(): PadState {
    if (typeof navigator === "undefined" || !navigator.getGamepads) return emptyPad();
    let pad: Gamepad | null = null;
    for (const p of navigator.getGamepads()) {
      if (p && p.connected) {
        pad = p;
        break;
      }
    }
    if (!pad) {
      this.prevButtons = [];
      return emptyPad();
    }

    const pressed: number[] = [];
    pad.buttons.forEach((b, i) => {
      if (b.pressed && !this.prevButtons[i]) pressed.push(i);
    });
    this.prevButtons = pad.buttons.map((b) => b.pressed);

    const axis = (i: number) => (i < pad!.axes.length ? pad!.axes[i] : 0);
    const btn = (i: number) => (i < pad!.buttons.length ? pad!.buttons[i].value : 0);

    return {
      connected: true,
      id: pad.id,
      axes: { leftX: axis(0), leftY: axis(1), rightX: axis(2), rightY: axis(3) },
      l1: btn(4),
      r1: btn(5),
      l2: btn(6),
      r2: btn(7),
      l3: btn(10),
      r3: btn(11),
      up: btn(12),
      down: btn(13),
      left: btn(14),
      right: btn(15),
      pressed,
    };
  }
}
