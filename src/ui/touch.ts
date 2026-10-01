import type { Input } from '../core/input';

export type TouchContext = 'attack' | 'defend' | 'setpiece';

const LABELS: Record<TouchContext, [string, string, string]> = {
  attack: ['PASS', 'SHOOT', 'THROUGH'],
  defend: ['SWITCH', 'TACKLE', 'PRESS'],
  setpiece: ['PASS', 'SHOOT', 'CROSS'],
};

type BtnKey = 'pass' | 'shoot' | 'through' | 'sprint';

/** How long (ms) a ⚡ tap stays down at least, so a tap shorter than a frame still reaches the sim as a press. */
const POWER_TAP_MS = 70;

/** Settings > Controls > THUMBSTICK: under the thumb wherever it lands, or anchored bottom-left. */
export type StickMode = 'floating' | 'fixed';

/** Fixed stick: a touch this far (px) from its centre still takes it; further out is ignored. */
const FIXED_REACH = 150;

/**
 * Thumbstick on the left half (floating: it appears under the thumb; fixed: anchored bottom-left with its
 * base always drawn, see TouchControls.stickMode), chunky action buttons on the right.
 *
 * The whole overlay also hides itself (CSS, see style.css "touch") while the HUD is dead-ball only — goal
 * celebrations, replays, half / full time and open menus — so it works even when nobody calls setVisible().
 * During a replay a full-screen tap skips it (the buttons that normally do that are hidden).
 */
export class TouchControls {
  /** The stick style for new overlays (main.ts sets it from the save; setStickMode changes a live one). */
  static stickMode: StickMode = 'floating';
  readonly root: HTMLDivElement;
  private mode: StickMode = TouchControls.stickMode;
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
  /** Called the moment a button goes down (the session latches it: a tap shorter than a frame still counts). */
  onPress: ((k: BtnKey) => void) | null = null;
  /** Called the moment the ⚡ (power-up) button goes down; input.touch.power stays true for at least POWER_TAP_MS. */
  onPower: (() => void) | null = null;
  private powerTimer = 0;
  private powerHeld = false;
  private readonly blur = () => this.releaseAll();
  private readonly visibility = () => {
    if (document.hidden) this.releaseAll();
  };

  constructor(private input: Input) {
    window.addEventListener('blur', this.blur);
    document.addEventListener('visibilitychange', this.visibility);
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
        <button class="tb tb-power" data-k="power" aria-label="Use power-up"><span>⚡</span></button>
      </div>
      <div class="touch-skip" aria-hidden="true"></div>`;
    this.base = this.root.querySelector('.touch-base')!;
    this.knob = this.root.querySelector('.touch-knob')!;
    this.root.classList.toggle('fixed', this.mode === 'fixed');
    const zone = this.root.querySelector<HTMLDivElement>('.touch-stick-zone')!;
    const t = input.touch;

    zone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      if (this.mode === 'fixed') {
        // Fixed: the stick stays put; the thumb has to land on (or near) it.
        const r = this.base.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        if (!r.width || Math.hypot(e.clientX - cx, e.clientY - cy) > FIXED_REACH) return;
        this.origin = { x: cx, y: cy };
      } else {
        this.origin = { x: e.clientX, y: e.clientY };
        this.base.style.left = `${e.clientX}px`;
        this.base.style.top = `${e.clientY}px`;
      }
      this.stickId = e.pointerId;
      zone.setPointerCapture(e.pointerId);
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
      if (l > r && this.mode === 'fixed') {
        dx = (dx / l) * r;
        dy = (dy / l) * r;
      } else if (l > r) {
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

    // ⚡ (blitz only, see setBlitz): a press, latched for a few frames; release waits for the finger and the latch.
    const pw = this.root.querySelector<HTMLButtonElement>('.tb-power')!;
    const powerUp = () => {
      this.powerHeld = false;
      if (this.powerTimer) return;
      t.power = false;
      pw.classList.remove('down');
    };
    pw.addEventListener('pointerdown', (e) => {
      pw.setPointerCapture(e.pointerId);
      this.powerHeld = true;
      t.power = true;
      pw.classList.add('down');
      this.onPower?.();
      input.lastDevice = 'touch';
      navigator.vibrate?.(8);
      window.clearTimeout(this.powerTimer);
      this.powerTimer = window.setTimeout(() => {
        this.powerTimer = 0;
        if (!this.powerHeld) powerUp();
      }, POWER_TAP_MS);
      e.preventDefault();
    });
    pw.addEventListener('pointerup', powerUp);
    pw.addEventListener('pointercancel', powerUp);
    pw.addEventListener('lostpointercapture', powerUp);
    pw.addEventListener('contextmenu', (e) => e.preventDefault());

    this.root.querySelectorAll<HTMLButtonElement>('.tb:not(.tb-power)').forEach((b) => {
      this.btns.push(b);
      const k = b.dataset.k as BtnKey;
      const set = (v: boolean) => {
        t[k] = v;
        b.classList.toggle('down', v);
      };
      b.addEventListener('pointerdown', (e) => {
        b.setPointerCapture(e.pointerId);
        set(true);
        this.onPress?.(k);
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
    if (this.mode === 'fixed') this.knob.style.transform = 'translate(-50%, -50%)';
  }

  /** Floating or fixed stick (Settings, also mid-match from the pause menu). */
  setStickMode(mode: StickMode): void {
    if (this.stickId !== null) this.releaseStick();
    this.mode = mode;
    this.root.classList.toggle('fixed', mode === 'fixed');
    if (mode === 'fixed') {
      // CSS anchors it; clear where the last floating touch left it.
      this.base.style.left = this.base.style.top = '';
      this.knob.style.transform = 'translate(-50%, -50%)';
    }
  }

  get stick(): StickMode {
    return this.mode;
  }

  /** Drop every held button and the stick (the overlay is going away mid-press). */
  private releaseAll(): void {
    const t = this.input.touch;
    t.pass = t.shoot = t.through = t.sprint = t.power = false;
    window.clearTimeout(this.skipTimer);
    this.skipTimer = 0;
    window.clearTimeout(this.powerTimer);
    this.powerTimer = 0;
    this.powerHeld = false;
    this.btns.forEach((b) => b.classList.remove('down'));
    this.root.querySelector('.tb-power')?.classList.remove('down');
    this.releaseStick();
  }

  /** A new match shares Input; leave no held control or timer behind when this overlay is removed. */
  dispose(): void {
    this.releaseAll();
    this.input.touch.enabled = false;
    window.removeEventListener('blur', this.blur);
    document.removeEventListener('visibilitychange', this.visibility);
    this.root.remove();
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

  /** Blitz mode shows the ⚡ button (it is hidden in classic football). */
  setBlitz(on: boolean): void {
    this.root.classList.toggle('blitz', on);
    if (!on) this.setPowerHeld(null);
  }

  /** The power-up in hand (blitz): the ⚡ button lights up and names it; null greys it out. */
  setPowerHeld(kind: string | null): void {
    const pw = this.root.querySelector<HTMLButtonElement>('.tb-power');
    if (!pw) return;
    pw.classList.toggle('has', !!kind);
    pw.dataset.kind = kind ?? '';
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
