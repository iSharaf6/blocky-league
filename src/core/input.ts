/** Screen-space controls: stick (sx right, sy up) plus the four action buttons. */
export interface Controls {
  sx: number;
  sy: number;
  sprint: boolean;
  pass: boolean;
  shoot: boolean;
  through: boolean;
}

export interface TouchState extends Controls {
  enabled: boolean;
}

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1], ArrowUp: [0, 1],
  KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};

const PASS_KEYS = ['Space', 'KeyJ', 'KeyZ'];
const SHOOT_KEYS = ['KeyK', 'KeyX'];
const THROUGH_KEYS = ['KeyL', 'KeyC'];
const SPRINT_KEYS = ['ShiftLeft', 'ShiftRight', 'KeyI'];

export class Input {
  private keys = new Set<string>();
  readonly touch: TouchState = { enabled: false, sx: 0, sy: 0, sprint: false, pass: false, shoot: false, through: false };
  private listeners: ((code: string) => void)[] = [];
  lastDevice: 'keyboard' | 'touch' | 'gamepad' =
    typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? 'touch' : 'keyboard';

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (MOVE_KEYS[e.code] || e.code === 'Space') e.preventDefault();
      this.keys.add(e.code);
      this.lastDevice = 'keyboard';
      for (const l of this.listeners) l(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  onKey(fn: (code: string) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private any(codes: string[]): boolean {
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  read(): Controls {
    let sx = 0;
    let sy = 0;
    for (const [code, [dx, dy]] of Object.entries(MOVE_KEYS)) {
      if (this.keys.has(code)) {
        sx += dx;
        sy += dy;
      }
    }
    const l = Math.hypot(sx, sy);
    if (l > 1) {
      sx /= l;
      sy /= l;
    }
    const out: Controls = {
      sx, sy,
      sprint: this.any(SPRINT_KEYS),
      pass: this.any(PASS_KEYS),
      shoot: this.any(SHOOT_KEYS),
      through: this.any(THROUGH_KEYS),
    };
    // Gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      const ax = gp.axes[0] ?? 0;
      const ay = gp.axes[1] ?? 0;
      const gl = Math.hypot(ax, ay);
      if (gl > 0.18) {
        const k = Math.min(1, (gl - 0.18) / 0.72) / gl;
        out.sx = ax * k;
        out.sy = -ay * k;
        this.lastDevice = 'gamepad';
      }
      const b = (i: number) => !!gp.buttons[i]?.pressed;
      if (b(0) || b(1) || b(2) || b(5) || b(7)) this.lastDevice = 'gamepad';
      out.pass ||= b(0);
      out.shoot ||= b(1);
      out.through ||= b(2) || b(3);
      out.sprint ||= b(5) || b(7) || (gp.buttons[7]?.value ?? 0) > 0.3;
      if (b(12)) out.sy = 1;
      if (b(13)) out.sy = -1;
      if (b(14)) out.sx = -1;
      if (b(15)) out.sx = 1;
    }
    const t = this.touch;
    if (t.enabled) {
      if (Math.hypot(t.sx, t.sy) > 0.05) {
        out.sx = t.sx;
        out.sy = t.sy;
      }
      out.pass ||= t.pass;
      out.shoot ||= t.shoot;
      out.through ||= t.through;
      out.sprint ||= t.sprint;
    }
    return out;
  }

  gamepadPause(): boolean {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) if (gp?.buttons[9]?.pressed) return true;
    return false;
  }
}
