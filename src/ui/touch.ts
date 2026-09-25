import type { Input } from '../core/input';

export type TouchContext = 'attack' | 'defend' | 'setpiece';

const LABELS: Record<TouchContext, [string, string, string]> = {
  attack: ['PASS', 'SHOOT', 'THROUGH'],
  defend: ['SWITCH', 'TACKLE', 'PRESS'],
  setpiece: ['PASS', 'SHOOT', 'CROSS'],
};

/** Floating thumbstick on the left half, chunky action buttons on the right. */
export class TouchControls {
  readonly root: HTMLDivElement;
  private knob: HTMLDivElement;
  private base: HTMLDivElement;
  private stickId: number | null = null;
  private origin = { x: 0, y: 0 };
  private btns: HTMLButtonElement[] = [];
  private ctx: TouchContext = 'attack';

  constructor(private input: Input) {
    this.root = document.createElement('div');
    this.root.className = 'touch';
    this.root.innerHTML = `
      <div class="touch-stick-zone"></div>
      <div class="touch-base"><div class="touch-knob"></div></div>
      <div class="touch-btns">
        <button class="tb tb-through" data-k="through"><span>THROUGH</span></button>
        <button class="tb tb-shoot" data-k="shoot"><span>SHOOT</span></button>
        <button class="tb tb-pass" data-k="pass"><span>PASS</span></button>
        <button class="tb tb-sprint" data-k="sprint"><span>SPRINT</span></button>
      </div>`;
    this.base = this.root.querySelector('.touch-base')!;
    this.knob = this.root.querySelector('.touch-knob')!;
    const zone = this.root.querySelector<HTMLDivElement>('.touch-stick-zone')!;
    const t = input.touch;

    zone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      this.origin = { x: e.clientX, y: e.clientY };
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.base.classList.add('on');
      this.knob.style.transform = 'translate(-50%, -50%)';
      input.lastDevice = 'touch';
      e.preventDefault();
    });
    const move = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      const r = 56;
      let dx = e.clientX - this.origin.x;
      let dy = e.clientY - this.origin.y;
      const l = Math.hypot(dx, dy);
      if (l > r) {
        // Drag the base along so the stick never feels stuck.
        this.origin.x += (dx / l) * (l - r);
        this.origin.y += (dy / l) * (l - r);
        this.base.style.left = `${this.origin.x}px`;
        this.base.style.top = `${this.origin.y}px`;
        dx = (dx / l) * r;
        dy = (dy / l) * r;
      }
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      const mag = Math.min(1, Math.hypot(dx, dy) / r);
      const dead = mag < 0.16 ? 0 : (mag - 0.16) / 0.84;
      const a = Math.atan2(-dy, dx);
      t.sx = Math.cos(a) * dead;
      t.sy = Math.sin(a) * dead;
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      t.sx = t.sy = 0;
      this.base.classList.remove('on');
    };
    zone.addEventListener('pointermove', move);
    zone.addEventListener('pointerup', up);
    zone.addEventListener('pointercancel', up);

    this.root.querySelectorAll<HTMLButtonElement>('.tb').forEach((b) => {
      this.btns.push(b);
      const k = b.dataset.k as 'pass' | 'shoot' | 'through' | 'sprint';
      const set = (v: boolean) => {
        t[k] = v;
        b.classList.toggle('down', v);
      };
      b.addEventListener('pointerdown', (e) => {
        b.setPointerCapture(e.pointerId);
        set(true);
        input.lastDevice = 'touch';
        navigator.vibrate?.(8);
        e.preventDefault();
      });
      b.addEventListener('pointerup', () => set(false));
      b.addEventListener('pointercancel', () => set(false));
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }

  setEnabled(v: boolean): void {
    this.input.touch.enabled = v;
    this.root.classList.toggle('hidden', !v);
  }

  setContext(c: TouchContext): void {
    if (c === this.ctx) return;
    this.ctx = c;
    const [a, b, d] = LABELS[c];
    const by = (k: string) => this.btns.find((x) => x.dataset.k === k)!.querySelector('span')!;
    by('pass').textContent = a;
    by('shoot').textContent = b;
    by('through').textContent = d;
    this.root.dataset.ctx = c;
  }
}

export function isTouchDevice(): boolean {
  return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
}
