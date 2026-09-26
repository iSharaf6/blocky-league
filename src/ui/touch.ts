import type { Input } from '../core/input';

export type TouchContext = 'attack' | 'defend' | 'setpiece';

const LABELS: Record<TouchContext, [string, string, string]> = {
  attack: ['PASS', 'SHOOT', 'THROUGH'],
  defend: ['SWITCH', 'TACKLE', 'PRESS'],
  setpiece: ['PASS', 'SHOOT', 'CROSS'],
};

type BtnKey = 'pass' | 'shoot' | 'through' | 'sprint';

/**
 * Floating thumbstick on the left half, chunky action buttons on the right.
 *
 * The whole overlay also hides itself (CSS, see style.css "touch") while the HUD is dead-ball only — goal
 * celebrations, replays, half / full time and open menus — so it works even when nobody calls setVisible().
 * During a replay a full-screen tap skips it (the buttons that normally do that are hidden).
 */
export class TouchControls {
  readonly root: HTMLDivElement;
  private knob: HTMLDivElement;
  private base: HTMLDivElement;
  private stickId: number | null = null;
  private origin = { x: 0, y: 0 };
  private btns: HTMLButtonElement[] = [];
  private ctx: TouchContext = 'attack';
  private visible = true;
  private skipTimer = 0;
  /** Charge drawn on PASS / THROUGH (0..1 in 1/50 steps, -1 = none): style writes only when it changes. */
  private charge: Record<'pass' | 'through', number> = { pass: -1, through: -1 };

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
      </div>
      <div class="touch-skip" aria-hidden="true"></div>`;
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
      // Once the stick has been found, the idle base stops being drawn (it only covered players).
      this.root.classList.add('used');
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
      this.releaseStick();
    };
    zone.addEventListener('pointermove', move);
    zone.addEventListener('pointerup', up);
    zone.addEventListener('pointercancel', up);
    zone.addEventListener('lostpointercapture', up);

    this.root.querySelectorAll<HTMLButtonElement>('.tb').forEach((b) => {
      this.btns.push(b);
      const k = b.dataset.k as BtnKey;
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
      b.addEventListener('lostpointercapture', () => set(false));
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    });

    // Replays: a tap anywhere is a short PASS press, which the session reads as "skip".
    const skip = this.root.querySelector<HTMLDivElement>('.touch-skip')!;
    skip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      input.lastDevice = 'touch';
      t.pass = true;
      window.clearTimeout(this.skipTimer);
      this.skipTimer = window.setTimeout(() => {
        if (!this.btns.some((b) => b.dataset.k === 'pass' && b.classList.contains('down'))) t.pass = false;
      }, 120);
    });
  }

  private releaseStick(): void {
    this.stickId = null;
    this.input.touch.sx = this.input.touch.sy = 0;
    this.base.classList.remove('on');
  }

  /** Drop every held button and the stick (the overlay is going away mid-press). */
  private releaseAll(): void {
    const t = this.input.touch;
    t.pass = t.shoot = t.through = t.sprint = false;
    this.btns.forEach((b) => b.classList.remove('down'));
    if (this.stickId !== null) this.releaseStick();
  }

  setEnabled(v: boolean): void {
    this.input.touch.enabled = v;
    this.root.classList.toggle('hidden', !v);
    if (!v) this.releaseAll();
  }

  /**
   * Show or hide the controls without disabling touch input — e.g. off for goal celebrations, replays and
   * half / full time, back on for play. (The replay tap-to-skip layer keeps working while hidden.)
   */
  setVisible(v: boolean): void {
    if (v === this.visible) return;
    this.visible = v;
    this.root.classList.toggle('off', !v);
    if (!v) this.releaseAll();
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /**
   * Pass charge on the buttons (called every frame): PASS and THROUGH fill from the bottom while held, 0..1
   * (-1 = not charging). Nothing fills while defending, where those buttons are SWITCH and PRESS.
   */
  setCharge(pass: number, through: number): void {
    const def = this.ctx === 'defend';
    this.fill('pass', def ? -1 : pass);
    this.fill('through', def ? -1 : through);
  }

  private fill(k: 'pass' | 'through', v: number): void {
    const b = this.btns.find((x) => x.dataset.k === k);
    // Only while the button is actually held (a charge the sim still reports after release never lingers).
    const q = b && b.classList.contains('down') && v >= 0 ? Math.round(Math.min(1, v) * 50) / 50 : -1;
    if (!b || q === this.charge[k]) return;
    this.charge[k] = q;
    b.classList.toggle('charging', q >= 0);
    b.classList.toggle('full', q >= 1);
    b.style.setProperty('--charge', q >= 0 ? String(q) : '0');
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
