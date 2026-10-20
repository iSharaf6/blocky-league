import { Vector3, type Camera } from 'three';
import { clamp } from '../core/math';
import { BALL_OFS, PF } from '../game/replay';
import { PITCH_Y } from '../render/stadium';
import { SKILL_NAMES, type ChainKind } from '../sim/skills';
import type { SkillGrade, SkillMoveKind } from '../sim/types';
import { escHtml } from './text';
import './skill.css';

/** How long (s) a move's pop stays up (matches the CSS animation), and a PERFECT's ring flash. */
const POP_S = 1.1;
const RING_S = 0.45;
/** The timing ring starts this much wider than its zone (1 + RING_OPEN x) and closes onto it as the window runs out. */
const RING_OPEN = 0.7;
/** Head clearance (m) for the tell over a defender and the pop over the dribbler. */
const TELL_UP = 0.55;
const POP_UP = 0.95;
/** The top band (px) the score bar and pause button own: the tell and the pop stay below it. */
const TOP_CLEAR = 64;

/** A screen rectangle (px) the tell keeps off: the trainer's card over the dribbler. */
export type SkillAvoid = { l: number; t: number; r: number; b: number };

/** Do two boxes touch (within `pad` px)? */
const meets = (r: SkillAvoid, q: SkillAvoid, pad: number): boolean => !(r.r + pad < q.l || r.l - pad > q.r || r.b + pad < q.t || r.t - pad > q.b);

/** What the session hands over each frame: the open tell (sim/skills.ts skillWindow), or null. */
export interface SkillTellView {
  by: number;
  left: number;
}

/**
 * The SKILL moves on screen (sim/skills.ts): the tell over a defender winding up a challenge on the human's man (a
 * chunky "!" with the window draining under it and, while the player is still learning it, the button to press),
 * and each move's pop over the dribbler (PERFECT, the move's name, the chain: "SKILL ×3"), with a ring flash round
 * him on a PERFECT. Pitch-anchored DOM: placed every frame, its words only rewritten on an event.
 */
export class SkillHud {
  readonly root = document.createElement('div');
  private tell: HTMLDivElement;
  private key: HTMLElement;
  private fill: HTMLElement;
  private pop: HTMLDivElement;
  private ring: HTMLDivElement;
  private zone: HTMLDivElement;
  private flair: HTMLDivElement;
  private pips: HTMLElement[];
  private flairKey = -1;
  private v = new Vector3();
  private popT = 0;
  private popPlayer = -1;
  private ringT = 0;
  private ringPlayer = -1;
  private keyText = '';

  constructor() {
    this.root.className = 'skill-hud';
    this.root.innerHTML = `<div class="sk-ring" aria-hidden="true"></div>
      <div class="sk-zone" aria-hidden="true"><i class="sk-time"></i></div>
      <div class="sk-tell" aria-hidden="true"><kbd class="sk-key"></kbd><b>!</b><i class="sk-bar"><i></i></i></div>
      <div class="sk-pop" aria-live="polite"></div>
      <div class="sk-flair" aria-hidden="true"><b>SKILL</b><i></i><i></i><i></i></div>`;
    this.tell = this.root.querySelector('.sk-tell')!;
    this.key = this.root.querySelector('.sk-key')!;
    this.fill = this.root.querySelector('.sk-bar > i')!;
    this.pop = this.root.querySelector('.sk-pop')!;
    this.ring = this.root.querySelector('.sk-ring')!;
    this.zone = this.root.querySelector('.sk-zone')!;
    this.flair = this.root.querySelector('.sk-flair')!;
    this.pips = [...this.flair.querySelectorAll<HTMLElement>('i')];
  }

  /**
   * FLAIR (sim/skills.ts skillFlair) for keys and pads: `pips` whole ones lit, the chip up only while `show` (his man
   * on the ball in open play, and not on touch, where the SKILL button wears them).
   */
  setFlair(pips: number, show: boolean): void {
    const n = Math.max(0, Math.min(this.pips.length, Math.floor(pips + 1e-6)));
    const key = show ? n : -1;
    if (key === this.flairKey) return;
    this.flairKey = key;
    this.flair.classList.toggle('on', show);
    this.pips.forEach((el, i) => el.classList.toggle('full', i < n));
  }

  /**
   * A move came off (the session, on 'skillMove'): the pop over `player`. PERFECT in green over the move's name; a
   * GOOD (it beat him) the name in teal; a plain or show-off move just the name, small; a chain of two or more gets
   * its "SKILL ×n" tag (a skill cut, a knock-on and a man dribbled past are links of their own: their name, and the chain).
   */
  show(player: number, grade: SkillGrade, move: SkillMoveKind | ChainKind, combo: number): void {
    const name = escHtml(SKILL_NAMES[move]);
    const chain = combo >= 2 ? `<em>SKILL ×${combo}</em>` : '';
    const link = move === 'cut' || move === 'knock' || move === 'past';
    let html: string;
    if (grade === 'perfect') html = `<b>PERFECT</b><span>${name}</span>${chain}`;
    else if (link) html = combo >= 2 ? `<b>SKILL ×${combo}</b><span>${name}</span>` : `<b>${name}</b>`;
    else if (grade === 'good') html = `<b>${name}</b>${chain}`;
    else html = `<span>${name}</span>${chain}`;
    const el = this.pop;
    el.dataset.grade = link ? 'chain' : grade;
    el.innerHTML = html;
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
    this.popT = POP_S;
    this.popPlayer = player;
    if (grade === 'perfect') {
      const r = this.ring;
      r.classList.remove('on');
      void r.offsetWidth;
      r.classList.add('on');
      this.ringT = RING_S;
      this.ringPlayer = player;
    }
  }

  /** A move's pop is up over the dribbler (the session keeps the trainer's card out of its way meanwhile). */
  get popping(): boolean {
    return this.popT > 0;
  }

  /** What hangs off the top edge of the HUD (the score bug with its live goal and chips, the event flag, the pause and
   * camera buttons, the chant, the quick-sub card): the tell and the pop never sit on it. */
  private topRects(): SkillAvoid[] {
    return [...(this.root.parentElement ?? document).querySelectorAll<HTMLElement>(
      '.scorebug, .sb-board.on, .sb-fun .bty.on, .sb-fun .fun-pill.on, .hud-toast.on, .hud-pause, .hud-cam, .pz-chant.on, .hud-qsub.on')]
      .map((el) => el.getBoundingClientRect()).filter((q) => q.width > 0 && q.height > 0 && q.top < window.innerHeight * 0.45)
      .map((q): SkillAvoid => ({ l: q.left, t: q.top, r: q.right, b: q.bottom }));
  }

  /** What sits at the foot of the screen (the minimap, the player chip, the touch buttons and the thumbstick), and the
   * HUD's own words that may be up over the play (the set-piece hint, the PERFECT word, the kick-off prompt). */
  private lowRects(): SkillAvoid[] {
    return [...document.querySelectorAll<HTMLElement>('#ui > .hud .hud-radar, #ui > .hud .hud-chip, #ui > .touch:not(.hidden) .tb, #ui > .touch:not(.hidden) .touch-base, #ui > .hud .hud-hint.on, #ui > .hud .hud-timing.on, #ui > .hud .hud-kick.on')]
      .filter((el) => getComputedStyle(el).visibility !== 'hidden')
      .map((el) => el.getBoundingClientRect()).filter((q) => q.width > 0 && q.height > 0)
      .map((q): SkillAvoid => ({ l: q.left, t: q.top, r: q.right, b: q.bottom }));
  }

  /** Where the tell sits this frame (null: not up): the pop keeps off it. */
  private tellBox: SkillAvoid | null = null;

  /** Everything off at once (a replay, a pause, a cut away from live play). */
  clear(): void {
    this.tell.classList.remove('on');
    this.zone.classList.remove('on');
    this.pop.classList.remove('on');
    this.ring.classList.remove('on');
    this.popT = this.ringT = 0;
  }

  /**
   * Once a frame. `tell`: the open window (or null); `teachKey`: the button to show on it while he's learning the
   * counter (null: just the "!"); `head`: the drawn head height (m). `hidden`: nothing is drawn (cinematic, paused).
   * `avoid`: a card on screen the tell mustn't sit on (it goes beside the defender, or under him, instead).
   */
  update(frame: Float32Array, camera: Camera, head: number, tell: SkillTellView | null, teachKey: string | null, hidden: boolean, dt: number,
    avoid: SkillAvoid | null = null, man = -1): void {
    this.root.hidden = hidden;
    if (hidden) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const at = (i: number, up: number) => {
      const o = i * PF;
      this.v.set(frame[o], frame[o + 2] + head + up + PITCH_Y, frame[o + 1]).project(camera);
      return { x: ((this.v.x + 1) / 2) * w, y: ((1 - this.v.y) / 2) * h, ok: this.v.z > -1 && this.v.z < 1 };
    };
    const feet = (i: number) => {
      const o = i * PF;
      this.v.set(frame[o], PITCH_Y, frame[o + 1]).project(camera);
      return { x: ((this.v.x + 1) / 2) * w, y: ((1 - this.v.y) / 2) * h };
    };
    // The tell: over the defender, the bar draining as the window closes.
    if (tell && tell.by >= 0 && tell.by < 22) {
      const p = at(tell.by, TELL_UP);
      const on = p.ok && p.x > -40 && p.x < w + 40 && p.y > -40 && p.y < h + 40;
      this.tell.classList.toggle('on', on);
      const k = teachKey ?? '';
      if (k !== this.keyText) {
        this.keyText = k;
        this.key.textContent = k;
        this.tell.classList.toggle('teach', !!k);
      }
      if (on) {
        // Over his head; beside him (away from the card) or under his feet when a card is there. (Never up under the
        // score bar: it slides down over him instead.)
        const tw = this.tell.offsetWidth || 34;
        const th = this.tell.offsetHeight || 46;
        const box = (x: number, y: number): SkillAvoid => {
          const cx = clamp(x, 24, w - 24);
          const cy = clamp(y, TOP_CLEAR + th, h - 30);
          return { l: cx - tw / 2, t: cy - th, r: cx + tw / 2, b: cy };
        };
        const clear = (r: SkillAvoid) => !avoid || !meets(r, avoid, 6);
        // Never on what hangs off the top edge (the score bug with its live goal and chips, the event flag, the pause
        // and camera buttons, the chant), and never over our man or the ball beside the defender.
        const tops = this.topRects();
        const keep: { x: number; y: number }[] = [];
        const look = (x: number, y: number, z: number) => {
          this.v.set(x, y + PITCH_Y, z).project(camera);
          if (this.v.z > -1 && this.v.z < 1) keep.push({ x: ((this.v.x + 1) / 2) * w, y: ((1 - this.v.y) / 2) * h });
        };
        look(frame[BALL_OFS], frame[BALL_OFS + 1], frame[BALL_OFS + 2]);
        if (man >= 0 && man < 22) for (const y of [0.2, 0.9, 1.6]) look(frame[man * PF], y + frame[man * PF + 2], frame[man * PF + 1]);
        const onPlay = (r: SkillAvoid) => keep.some((q) => q.x >= r.l - 4 && q.x <= r.r + 4 && q.y >= r.t - 4 && q.y <= r.b + 4);
        const lows = this.lowRects();
        const free = (r: SkillAvoid) => clear(r) && !onPlay(r) && !tops.some((q) => meets(r, q, 4)) && !lows.some((q) => meets(r, q, 4));
        const side = avoid && (avoid.l + avoid.r) / 2 > p.x ? -1 : 1;
        const f = feet(tell.by);
        const opts = [box(p.x, p.y), box(p.x + side * (tw + 20), p.y + th * 0.6), box(p.x - side * (tw + 20), p.y + th * 0.6), box(f.x, f.y + th + 8)];
        const pick = opts.find(free) ?? opts.find((r) => !onPlay(r) && !tops.some((q) => meets(r, q, 4))) ?? opts.find((r) => !onPlay(r)) ?? opts[0];
        // (Nowhere clear: it stays, nearly see-through, rather than hide the play.)
        this.tell.classList.toggle('under', onPlay(pick));
        this.tellBox = pick;
        this.tell.style.transform = `translate(${Math.round(pick.l)}px,${Math.round(pick.t)}px)`;
        this.fill.style.transform = `scaleX(${clamp(tell.left, 0, 1).toFixed(3)})`;
        // The timing ring: a zone under his feet, the ring closing in on it as the window runs out (red for its last third).
        const left = clamp(tell.left, 0, 1);
        this.zone.style.transform = `translate(${Math.round(f.x)}px,${Math.round(f.y)}px)`;
        this.zone.style.setProperty('--k', (1 + left * RING_OPEN).toFixed(3));
        this.zone.classList.toggle('last', left < 0.34);
      }
      this.zone.classList.toggle('on', on);
    } else {
      this.tell.classList.remove('on');
      this.zone.classList.remove('on');
    }
    if (!this.tell.classList.contains('on')) this.tellBox = null;
    // The pop rides over the dribbler as it rises and fades: under whatever hangs off the top edge, and under his
    // boots instead when the top would push it down onto him (or the ball). Nowhere clear: nearly see-through.
    if (this.popT > 0) {
      this.popT -= dt;
      if (this.popT <= 0) this.pop.classList.remove('on');
      else if (this.popPlayer >= 0 && this.popPlayer < 22) {
        const p = at(this.popPlayer, POP_UP);
        const pw = this.pop.offsetWidth || 120;
        const ph = this.pop.offsetHeight || 40;
        // (Kept its own half width plus its swell from the frame's edges.)
        const cx = clamp(p.x, pw * 0.6 + 8, w - pw * 0.6 - 8);
        // (Its `top` is its bottom edge: the CSS lifts it by its own height.)
        let floor = TOP_CLEAR;
        // (20 px under it: the pop rises 16 px and swells as it plays.)
        for (const q of this.topRects()) if (q.r > cx - pw / 2 - 12 && q.l < cx + pw / 2 + 12) floor = Math.max(floor, q.b + 20);
        const keep: { x: number; y: number }[] = [];
        const o = this.popPlayer * PF;
        for (const y of [0.2, 0.9, 1.6]) {
          this.v.set(frame[o], y + frame[o + 2] + PITCH_Y, frame[o + 1]).project(camera);
          if (this.v.z > -1 && this.v.z < 1) keep.push({ x: ((this.v.x + 1) / 2) * w, y: ((1 - this.v.y) / 2) * h });
        }
        this.v.set(frame[BALL_OFS], frame[BALL_OFS + 1] + PITCH_Y, frame[BALL_OFS + 2]).project(camera);
        if (this.v.z > -1 && this.v.z < 1) keep.push({ x: ((this.v.x + 1) / 2) * w, y: ((1 - this.v.y) / 2) * h });
        // (12 px round it: the pop rises 16 px and swells a touch as it plays.)
        const covers = (bottom: number) => keep.some((q) => q.x >= cx - pw / 2 - 12 && q.x <= cx + pw / 2 + 12 && q.y >= bottom - ph - 18 && q.y <= bottom + 12);
        // Under his boots only where nothing sits at the foot of the screen (the minimap, the chip, the touch controls).
        const lows = this.lowRects();
        // (Its box as it plays: 18 px of rise above, the swell round it.)
        const boxAt = (bottom: number): SkillAvoid => ({ l: cx - pw / 2 - 8, t: bottom - ph - 18, r: cx + pw / 2 + 8, b: bottom + 4 });
        const tellAt = this.tellBox;
        const clean = (bottom: number) => !covers(bottom) && !lows.some((q) => meets(boxAt(bottom), q, 0)) && !(tellAt && meets(boxAt(bottom), tellAt, 4));
        const f = feet(this.popPlayer);
        const pick = [clamp(p.y, floor + ph, h - 120), clamp(f.y + ph + 10, floor + ph, h - 6)].find(clean);
        if (pick === undefined) {
          // Nowhere clear of him, the ball, the controls and the tell: the flourish gives way (the tell and the play come first).
          this.popT = 0;
          this.pop.classList.remove('on', 'under');
        } else {
          this.pop.style.left = `${Math.round(cx)}px`;
          this.pop.style.top = `${Math.round(pick)}px`;
        }
      }
    }
    if (this.ringT > 0) {
      this.ringT -= dt;
      if (this.ringT <= 0) this.ring.classList.remove('on');
      else if (this.ringPlayer >= 0 && this.ringPlayer < 22) {
        const f = feet(this.ringPlayer);
        this.ring.style.left = `${Math.round(f.x)}px`;
        this.ring.style.top = `${Math.round(f.y)}px`;
      }
    }
  }
}
