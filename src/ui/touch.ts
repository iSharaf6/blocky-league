import type { Input } from '../core/input';
import { pixelIcon } from './pixelIcons';

export type TouchContext = 'attack' | 'defend' | 'setpiece' | 'delivery';

/**
 * The three action buttons' labels by where they sit: the big one bottom right (data-k pass), the one left of it
 * (shoot) and the one above it (through). Without the ball PRESS is the big one under the thumb and SWITCH goes up top
 * (the owner: "the switch and press button should be switched when not with the ball"): see SENDS.
 */
const LABELS: Record<TouchContext, [string, string, string]> = {
  attack: ['PASS', 'SHOOT', 'THROUGH'],
  defend: ['PRESS', 'TACKLE', 'SWITCH'],
  setpiece: ['PASS', 'SHOOT', 'CROSS'],
  // His corner or wide free kick (sim/setPiece.ts): short to the nearest man, driven low to the ring, floated to it.
  delivery: ['SHORT', 'DRIVEN', 'CROSS'],
};

type BtnKey = 'pass' | 'shoot' | 'through' | 'skill';
/**
 * The buttons in the DOM (data-k). There is no SPRINT (2026-10-04, the owner: "sprinting button shoudlnt exist as
 * players should be sprinting automatcially": the stick sprints, sim/dribble.ts autoRun). KEEPER (shown while defending
 * near our own goal: setKeeper) sends the pad's SKILL, which without the ball is "keeper, come out" (sim/keeper.ts
 * keeperRush): held, he comes for it; let go, he is the AI's again.
 */
type DomKey = BtnKey | 'keeper';

/**
 * What a button sends by context (its own key unless listed): defending, the big bottom-right button is PRESS (the
 * sim's THROUGH held: the goal-side jockey, or a run at a loose ball) and the top one SWITCH (the sim's PASS). A press
 * keeps what it sent at its start until it's let go, so a context change under the thumb never swaps a held button.
 */
const SENDS: Record<TouchContext, Partial<Record<BtnKey, BtnKey>>> = {
  attack: {},
  defend: { pass: 'through', through: 'pass' },
  setpiece: {},
  delivery: {},
};

/** How long (ms) a power button tap stays down at least, so a tap shorter than a frame still reaches the sim as a press. */
const POWER_TAP_MS = 70;
/** FAKE SHOT: how long (ms) PASS and SHOOT stay down together once the thumb has slid from SHOOT onto PASS. */
const FAKE_SHOT_MS = 90;

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
  /**
   * AUTO SPRINT (Settings > Controls, default on; main.ts sets it from the save), for keys and a gamepad: the stick
   * pushed sprints without the SPRINT key (Pad.autoSprint, sim/dribble.ts autoRun). On touch it is always on: there is
   * no SPRINT button (the session: MatchSession.autoSprint).
   */
  static autoSprint = true;
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
  /** Called the moment the bolt (power-up) button goes down; input.touch.power stays true for at least POWER_TAP_MS. */
  onPower: (() => void) | null = null;
  private powerTimer = 0;
  private powerHeld = false;
  private fakeTimer = 0;
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
        <button class="tb tb-keeper" data-k="keeper" aria-label="Keeper, come out"><span>KEEPER</span></button>
        <button class="tb tb-power" data-k="power" aria-label="Use power-up"><span>${pixelIcon('bolt', '#fff', 3)}</span></button>
        <button class="tb tb-skill" data-k="skill" aria-label="Skill move"><span>SKILL</span><i class="tb-pips" aria-hidden="true"><i></i><i></i><i></i></i></button>
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

    // The bolt button (blitz only, see setBlitz): a press, latched for a few frames; release waits for the finger and the latch.
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
      const own = b.dataset.k as DomKey;
      // (What this press sends: fixed at the press, see SENDS. KEEPER is the pad's SKILL with the ball not ours.)
      let sent: BtnKey = own === 'keeper' ? 'skill' : own;
      const up = () => {
        t[sent] = false;
        b.classList.remove('down');
      };
      b.addEventListener('pointerdown', (e) => {
        b.setPointerCapture(e.pointerId);
        sent = own === 'keeper' ? 'skill' : SENDS[this.ctx][own] ?? own;
        t[sent] = true;
        b.classList.add('down');
        this.onPress?.(sent);
        input.lastDevice = 'touch';
        e.preventDefault();
      });
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      // FAKE SHOT (sim/skills.ts fakeShot): the thumb slid off a held SHOOT onto PASS is PASS pressed with SHOOT still
      // down, which the sim reads as the shot called off for a feint; both are then let go.
      if (own === 'shoot') {
        b.addEventListener('pointermove', (e) => {
          if (sent !== 'shoot' || !t.shoot || this.fakeTimer || this.ctx !== 'attack') return;
          const pass = this.btns.find((x) => x.dataset.k === 'pass');
          const r = pass?.getBoundingClientRect();
          if (!pass || !r || e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
          t.pass = true;
          pass.classList.add('down');
          this.onPress?.('pass');
          this.fakeTimer = window.setTimeout(() => {
            this.fakeTimer = 0;
            t.pass = false;
            pass.classList.remove('down');
            up();
          }, FAKE_SHOT_MS);
        });
      }
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
    t.pass = t.shoot = t.through = t.sprint = t.power = t.skill = false;
    window.clearTimeout(this.skipTimer);
    this.skipTimer = 0;
    window.clearTimeout(this.powerTimer);
    this.powerTimer = 0;
    this.powerHeld = false;
    window.clearTimeout(this.fakeTimer);
    this.fakeTimer = 0;
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

  /** Blitz mode shows the bolt button (it is hidden in classic football). */
  setBlitz(on: boolean): void {
    this.root.classList.toggle('blitz', on);
    if (!on) this.setPowerHeld(null);
  }

  /**
   * The SKILL button (sim/skills.ts): shown while his man has the ball in open play ('on'), and lit up while a
   * defender's tell is open over him ('cue': tap now for a PERFECT); 'off' hides it (it never crowds the other buttons).
   */
  setSkill(state: 'off' | 'on' | 'cue', flair = -1): void {
    // FLAIR (sim/skills.ts): the pips he has to spend, on the button; with none left its label dims (a plain move).
    const n = flair < 0 ? -1 : Math.floor(flair + 1e-6);
    if (n !== this.skillPips) {
      this.skillPips = n;
      const sk = this.btns.find((x) => x.dataset.k === 'skill');
      sk?.classList.toggle('empty', n === 0);
      sk?.querySelectorAll('.tb-pips > i').forEach((el, i) => el.classList.toggle('full', i < n));
    }
    if (state === this.skillState) return;
    this.skillState = state;
    this.root.classList.toggle('skill-on', state !== 'off');
    this.root.classList.toggle('skill-cue', state === 'cue');
  }

  private skillState: 'off' | 'on' | 'cue' = 'off';

  /**
   * The KEEPER button: shown while the other side has the ball (or it is loose) near enough our goal for him to come
   * for it (the session: sim/keeper.ts RUSH_RANGE), in the corner of the cluster SKILL has with the ball. Hidden, a
   * hold on it is let go.
   */
  setKeeper(on: boolean): void {
    if (on === this.keeperOn) return;
    this.keeperOn = on;
    this.root.classList.toggle('keeper-on', on);
    if (!on) {
      const b = this.btns.find((x) => x.dataset.k === 'keeper');
      if (b?.classList.contains('down')) {
        b.classList.remove('down');
        this.input.touch.skill = false;
      }
    }
  }

  private keeperOn = false;

  /**
   * TACKLE lit: their carrier's ball is in his man's reach, so a tap now goes in at once (the session: sim/dribble.ts
   * STAND_REACH). The button says when it will work, whoever the two players are.
   */
  setTackleReady(on: boolean): void {
    if (on === this.tackleReady) return;
    this.tackleReady = on;
    this.root.classList.toggle('tackle-ready', on);
  }

  private tackleReady = false;
  private skillPips = -1;

  /** The power-up in hand (blitz): the bolt button lights up; null greys it out. */
  setPowerHeld(kind: string | null): void {
    const pw = this.root.querySelector<HTMLButtonElement>('.tb-power');
    if (!pw) return;
    pw.classList.toggle('has', !!kind);
    pw.dataset.kind = kind ?? '';
  }

  /**
   * Pass charge on the buttons (called every frame): PASS and THROUGH fill from the bottom while held, 0..1
   * (-1 = not charging). Nothing fills while defending, where those buttons are PRESS and SWITCH.
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

  /** The labels in force (for tests and the HOW TO PLAY screen): the big, the left and the top button. */
  get labels(): readonly [string, string, string] {
    return LABELS[this.ctx];
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
