// 键盘 / 鼠标 / 手柄输入汇总。手柄使用标准映射(Xbox / PS / Switch Pro 等):
//   左摇杆 = 移动,右摇杆 = 视角,RT/LT = 上升/下降,RB = 加速,LB = 减速,
//   Y 或 十字键右 = 下一个书签,十字键左 = 上一个书签。

export interface PadState {
  connected: boolean;
  id: string;
  moveX: number;
  moveY: number; // 向前为正
  lookX: number;
  lookY: number; // 抬头为正
  rise: number;
  fall: number;
  boost: number;
  slow: number;
  /** 本帧刚按下的按钮编号 */
  pressed: number[];
}

const DEADZONE = 0.14;

/** 去死区 + 立方曲线:小幅度精细、大幅度快速。 */
function shape(v: number): number {
  const a = Math.abs(v);
  if (a < DEADZONE) return 0;
  const t = (a - DEADZONE) / (1 - DEADZONE);
  return Math.sign(v) * (0.35 * t + 0.65 * t * t * t);
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
    const empty: PadState = {
      connected: false,
      id: "",
      moveX: 0,
      moveY: 0,
      lookX: 0,
      lookY: 0,
      rise: 0,
      fall: 0,
      boost: 0,
      slow: 0,
      pressed: [],
    };
    if (typeof navigator === "undefined" || !navigator.getGamepads) return empty;
    const pads = navigator.getGamepads();
    let pad: Gamepad | null = null;
    for (const p of pads) {
      if (p && p.connected) {
        pad = p;
        break;
      }
    }
    if (!pad) {
      this.prevButtons = [];
      return empty;
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
      moveX: shape(axis(0)),
      moveY: -shape(axis(1)),
      lookX: shape(axis(2)),
      lookY: -shape(axis(3)),
      rise: btn(7),
      fall: btn(6),
      boost: btn(5),
      slow: btn(4),
      pressed,
    };
  }
}
