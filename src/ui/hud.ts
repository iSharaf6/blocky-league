import { BALL_OFS, PF } from '../game/replay';
import { BOX_DEPTH, BOX_W, CENTER_R, GOAL_DEPTH, GOAL_H, GOAL_W, HALF_L, HALF_W } from '../sim/constants';
import type { Match } from '../sim/match';
import type { Kit, MatchEvent, TeamDef } from '../sim/types';
import { crestSvg } from './crest';
import { cssHex } from '../render/palette';
import { Commentator, pitchNames, speak, stopSpeech, surname, type CommentaryLine } from './commentary';

/** Screen position (CSS px, viewport origin) of a world point, or null when it is behind the camera. */
export type Projector = (x: number, y: number, z: number) => { x: number; y: number } | null;

type Rect = { l: number; t: number; r: number; b: number };

/** Overlap area of two rects (after growing `b` by `pad` px on every side). */
function overlapArea(a: Rect, b: Rect, pad = 0): number {
  const x = Math.min(a.r, b.r + pad) - Math.max(a.l, b.l - pad);
  const y = Math.min(a.b, b.b + pad) - Math.max(a.t, b.t - pad);
  return x > 0 && y > 0 ? x * y : 0;
}

/** Distance from a point to a rect (0 inside). */
function distTo(p: { x: number; y: number }, r: Rect): number {
  return Math.hypot(Math.max(r.l - p.x, 0, p.x - r.r), Math.max(r.t - p.y, 0, p.y - r.b));
}

/** Seconds a commentary line stays up (goals and other big moments a little longer). */
const LINE_S = 3;
const BIG_LINE_S = 4;
/** A showing line can be replaced by an equal-priority one after this long; a higher priority cuts in at once. */
const LINE_MIN_S = 1.5;
/** Queued lines go stale: commentary must never lag behind play. */
const PENDING_MAX_S = 2.5;

/** Timed finishing verdicts (the sim's 'timing' event), and how long one stays up (matches the CSS animation). */
export type TimingGrade = 'perfect' | 'good' | 'early' | 'late';
const TIMING_S = 0.8;

export interface HudTeam {
  short: string;
  name: string;
  color: number;
  color2: number;
  kit?: Kit;
}

/** In-match overlay: score bug, radar, banners, player chip, hints. */
export class Hud {
  readonly root: HTMLDivElement;
  private score: HTMLDivElement;
  private clock: HTMLDivElement;
  private banner: HTMLDivElement;
  private bannerTimer = 0;
  private hint: HTMLDivElement;
  private tip: HTMLDivElement;
  private chip: HTMLDivElement;
  private chipName: HTMLSpanElement;
  private chipNum: HTMLSpanElement;
  private stamina: HTMLDivElement;
  private replay: HTMLDivElement;
  private radar: HTMLCanvasElement;
  private radarT = 0;
  private radarHidden = false;
  /** Canvas backing size is re-derived from its CSS box (x devicePixelRatio) whenever that changes. */
  private radarDirty = true;
  private radarObs: ResizeObserver | null = null;
  private cards: [HTMLDivElement, HTMLDivElement];
  /** Radar dot colours per side; dark kits get a light rim so they read on the dark-green minimap. */
  private dotFill: [string, string];
  private dotEdge: [string, string];
  /** Bookings per side: one key per player currently on a yellow, and per player sent off. */
  private booked: [{ yellow: (number | string)[]; red: (number | string)[] }, { yellow: (number | string)[]; red: (number | string)[] }] = [
    { yellow: [], red: [] },
    { yellow: [], red: [] },
  ];
  /** Legacy card(side, 'yellow') immediately followed by card(side, 'red') = one second-yellow booking. */
  private justYellow: [string | null, string | null] = [null, null];
  private anon = 0;
  private toast: HTMLDivElement;
  private toastTimer = 0;
  /** Timed-finish verdict over the shooter (see timing()). */
  private timingEl: HTMLDivElement;
  private timingT = 0;
  private timingPlayer = -1;
  private readonly humanSide: number;
  /** Commentary ticker. */
  private cm: HTMLDivElement;
  private cmTag: HTMLElement;
  private cmText: HTMLElement;
  private readonly commentator = new Commentator();
  private cmTextOn = true;
  private cmVoice = false;
  private cmLine: CommentaryLine | null = null;
  private cmLeft = 0;
  private cmAge = 0;
  private cmPending: { line: CommentaryLine; age: number } | null = null;
  private cmPlaceT = 0;
  private cmSlot = '';
  /** Left edge (px) and box of the ticker as last placed. */
  private cmX = -1;
  private cmBox: Rect | null = null;
  private cmLastShown = -99;
  private clockS = 0;
  /** The match the session forwards events from (names for the booking chips). */
  private m: Match | null = null;
  private readonly teamColor: [string, string];
  private project: Projector | null = null;
  private lastFrame: Float32Array | null = null;
  private hintLow = false;
  private hintSlot = '';
  private hintT = 0;
  /** Seconds left of a hint blackout (card close-ups): set-piece hints stay hidden whatever the session asks. */
  private hintHold = 0;
  /** The hint the session last asked for (it comes back when a blackout ends). */
  private hintWant = '';
  /** A hint the player has already acted on (hidden until the session wants a different one). */
  private hintDone = '';
  private btnDown = false;
  /** Nowhere clear for the ticker (a set piece where every free band would cover the goal): hidden meanwhile. */
  private cmBlocked = false;
  /** The banner up now is a booking (compact plate in the top band / under the score bug). */
  private bannerCard = false;
  onPause: (() => void) | null = null;

  constructor(teams: [HudTeam, HudTeam], humanSide: number) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    const [h, a] = teams;
    this.root.innerHTML = `
      <div class="scorebug">
        <div class="sb-team">${h.kit ? crestSvg(h.name, h.short, h.kit, 2) : `<i class="crest" style="--a:${cssHex(h.color)};--b:${cssHex(h.color2)}"></i>`}<b>${h.short}</b></div>
        <div class="sb-score">0<span>-</span>0</div>
        <div class="sb-team"><b>${a.short}</b>${a.kit ? crestSvg(a.name, a.short, a.kit, 2) : `<i class="crest" style="--a:${cssHex(a.color)};--b:${cssHex(a.color2)}"></i>`}</div>
        <div class="sb-clock">00:00</div>
        <div class="sb-cards h"></div>
        <div class="sb-cards a"></div>
      </div>
      <button class="hud-pause" aria-label="Pause">II</button>
      <div class="hud-banner"></div>
      <div class="hud-toast"></div>
      <div class="hud-timing" aria-live="polite"></div>
      <div class="hud-hint"></div>
      <div class="hud-tip"></div>
      <div class="hud-cm" role="status" aria-live="polite"><b class="cm-tag"></b><span class="cm-text"></span></div>
      <div class="hud-chip"><span class="chip-num"></span><span class="chip-name"></span><div class="chip-stam"><div></div></div></div>
      <div class="hud-replay"><b>REPLAY</b><span class="rp-key">PRESS ANY BUTTON TO SKIP</span><span class="rp-tap">TAP TO SKIP</span></div>
      <canvas class="hud-radar" width="240" height="150" aria-hidden="true"></canvas>`;
    this.score = this.root.querySelector('.sb-score')!;
    this.clock = this.root.querySelector('.sb-clock')!;
    this.banner = this.root.querySelector('.hud-banner')!;
    this.hint = this.root.querySelector('.hud-hint')!;
    this.tip = this.root.querySelector('.hud-tip')!;
    this.chip = this.root.querySelector('.hud-chip')!;
    this.chipName = this.root.querySelector('.chip-name')!;
    this.chipNum = this.root.querySelector('.chip-num')!;
    this.stamina = this.root.querySelector('.chip-stam div')!;
    this.replay = this.root.querySelector('.hud-replay')!;
    this.radar = this.root.querySelector('.hud-radar')!;
    this.toast = this.root.querySelector('.hud-toast')!;
    this.timingEl = this.root.querySelector('.hud-timing')!;
    this.humanSide = humanSide;
    this.cm = this.root.querySelector('.hud-cm')!;
    this.cmTag = this.root.querySelector('.cm-tag')!;
    this.cmText = this.root.querySelector('.cm-text')!;
    this.teamColor = [cssHex(h.color), cssHex(a.color)];
    this.cards = [this.root.querySelector('.sb-cards.h')!, this.root.querySelector('.sb-cards.a')!];
    const lum = (c: number) => (0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255)) / 255;
    this.dotFill = [cssHex(h.color), cssHex(a.color)];
    this.dotEdge = [h.color, a.color].map((c) => (lum(c) < 0.35 ? 'rgba(251,251,244,0.95)' : 'rgba(20,20,26,0.9)')) as [string, string];
    if (typeof ResizeObserver !== 'undefined') {
      this.radarObs = new ResizeObserver(() => (this.radarDirty = true));
      this.radarObs.observe(this.radar);
    }
    this.root.querySelector('.hud-pause')!.addEventListener('click', () => this.onPause?.());
    if (humanSide < 0) this.chip.style.display = 'none';
  }

  setScore(h: number, a: number): void {
    this.score.innerHTML = `${h}<span>-</span>${a}`;
    this.score.classList.remove('pop');
    void this.score.offsetWidth;
    this.score.classList.add('pop');
  }

  /** Game clock in seconds, plus added-time minutes (0 = none). */
  setClock(seconds: number, extra: number): void {
    const mm = Math.floor(seconds / 60);
    const ss = seconds % 60;
    this.clock.innerHTML = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}${extra ? `<em>+${extra}</em>` : ''}`;
  }

  /** Big chunky centre text. Bookings (kind "card") are a compact plate up top instead (see placeBanner). */
  show(title: string, sub = '', kind = '', seconds = 2.2): void {
    this.banner.className = `hud-banner on ${kind}`;
    const letters = [...title].map((ch, i) => `<i style="animation-delay:${i * 45}ms">${ch === ' ' ? '&nbsp;' : ch}</i>`).join('');
    this.banner.innerHTML = `<div class="bn-title">${letters}</div>${sub ? `<div class="bn-sub">${sub}</div>` : ''}`;
    this.bannerTimer = seconds;
    this.bannerCard = /(^|\s)card(\s|$)/.test(kind);
    const st = this.banner.style;
    st.left = st.top = st.width = '';
    if (this.bannerCard) {
      // The card says it all: the FOUL! flag goes, and no set-piece hint pops up over the close-up.
      this.toast.classList.remove('on');
      this.toastTimer = 0;
      this.suppressHints(seconds);
      this.placeBanner();
      if (this.cmLine) this.placeTicker();
    }
  }

  /**
   * The pre-match title card ("HOM v AWA" + club names): gone at once (a quick 0.1 s fade) when the fly-in is
   * skipped. The session calls it when a button cuts the intro short; setLive(true) (play is on) does it too.
   */
  hideIntro(): void {
    if (!this.banner.classList.contains('intro') || !this.banner.classList.contains('on')) return;
    this.bannerTimer = 0;
    this.banner.classList.add('skip');
    this.banner.classList.remove('on');
  }

  /**
   * Booking plate: in the top band beside the score bug when it fits there (landscape), else right under the
   * top cluster, centred (portrait). Either way the top ~20% of the screen, never across the players the
   * card close-up frames in the middle of the lens.
   */
  private placeBanner(): void {
    if (!this.bannerCard) return;
    const b = this.banner;
    const st = b.style;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const g = W < 480 ? 8 : 12;
    const sb = this.rectOf('.scorebug', false);
    if (!sb) return;
    const pause = this.rectOf('.hud-pause', false);
    const bl = sb.r + g;
    const br = (pause ? pause.l : W) - g;
    if (br - bl >= 300) {
      st.left = `${Math.round(bl)}px`;
      st.width = `${Math.round(br - bl)}px`;
      st.top = `${Math.round(sb.t)}px`;
      if (b.offsetHeight <= Math.max(H * 0.2 - sb.t, 64)) return;
    }
    let top = sb.b;
    for (const sel of ['.so-track', '.hud-toast.on']) {
      const r = this.rectOf(sel, false);
      if (r && r.t < H * 0.4) top = Math.max(top, r.b);
    }
    let right = W - g;
    // Portrait minimap up in the top-right corner: the plate sits beside it rather than under it.
    const radar = !this.radarHidden && !this.root.classList.contains('dead') ? this.rectOf('.hud-radar') : null;
    if (radar && radar.t < H * 0.4) {
      if (radar.l > W / 2 && radar.l - 8 - g >= 240) right = radar.l - 8;
      else top = Math.max(top, radar.b);
    }
    st.left = `${g}px`;
    st.width = `${Math.round(right - g)}px`;
    st.top = `${Math.round(top + 8)}px`;
  }

  /** The booking plate's box while it is up (the ticker keeps clear of it). */
  private cardBannerRect(): Rect | null {
    return this.bannerCard && this.bannerTimer > 0 ? this.rectOf('.hud-banner.card', false) : null;
  }

  /**
   * Event flag ("CORNER", "FOUL!"): hangs off the bottom of the score bug (under any booking chips or the
   * shootout tracker), at the top edge where it never covers players in the box.
   */
  toastMsg(text: string, seconds = 1.4): void {
    this.toast.textContent = text;
    this.placeToast();
    this.toast.classList.remove('on');
    void this.toast.offsetWidth;
    this.toast.classList.add('on');
    this.toastTimer = seconds;
  }

  /** Under the score bug (and its booking chips / the shootout tracker); below the portrait minimap if they'd meet. */
  private placeToast(): void {
    const sb = this.rectOf('.scorebug', false);
    if (!sb) return;
    let top = sb.b;
    const so = this.rectOf('.so-track', false);
    if (so) top = Math.max(top, so.b);
    top += 8;
    const w = this.toast.offsetWidth;
    const h = this.toast.offsetHeight;
    const radar = this.rectOf('.hud-radar', false);
    if (radar && radar.t < window.innerHeight * 0.4 && radar.l < sb.l + w && radar.b > top && radar.t < top + h) top = radar.b + 8;
    this.toast.style.left = `${Math.round(sb.l)}px`;
    this.toast.style.top = `${Math.round(top)}px`;
  }

  /**
   * Timed finishing verdict: PERFECT (green), GOOD (teal), EARLY / LATE (red, tagged WILD), a chunky pixel word
   * over the shooter's head for TIMING_S. It keeps off the goal mouth in shot, the touch controls and the top
   * cluster: over his head, else under his feet, else top centre under the score bug (re-checked each frame,
   * as the camera follows the ball towards goal). `player` = the shooter's index (omitted: top centre).
   */
  timing(grade: TimingGrade, player = -1): void {
    const el = this.timingEl;
    const wild = grade === 'early' || grade === 'late';
    el.dataset.grade = grade;
    el.innerHTML = `<b>${grade.toUpperCase()}</b>${wild ? '<em>WILD</em>' : ''}`;
    el.setAttribute('aria-label', wild ? `${grade}: wild shot` : `${grade} timing`);
    this.timingPlayer = player;
    this.timingT = TIMING_S;
    this.placeTiming();
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
  }

  /** Where the timing word goes: the first clear spot of over the shooter / under him / top centre. */
  private placeTiming(): void {
    const el = this.timingEl;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const w = el.offsetWidth || 160;
    const h = el.offsetHeight || 40;
    const g = W < 480 ? 8 : 12;
    const box = (cx: number, t: number): Rect => {
      const l = Math.max(g, Math.min(W - g - w, cx - w / 2));
      const tt = Math.max(g, Math.min(H - g - h, t));
      return { l, t: tt, r: l + w, b: tt + h };
    };
    const opts: Rect[] = [];
    const f = this.lastFrame;
    const P = this.project;
    if (f && P && this.timingPlayer >= 0 && this.timingPlayer < 22) {
      const o = this.timingPlayer * PF;
      let head: { x: number; y: number } | null = null;
      let feet: { x: number; y: number } | null = null;
      try {
        head = P(f[o], (f[o + 2] || 0) + 2.9, f[o + 1]);
        feet = P(f[o], 0, f[o + 1]);
      } catch {
        head = feet = null;
      }
      if (head && head.x > 0 && head.x < W && head.y > 0 && head.y < H) opts.push(box(head.x, head.y - h - 6));
      if (feet && feet.x > 0 && feet.x < W && feet.y > 0 && feet.y < H) opts.push(box(feet.x, feet.y + 14));
    }
    const topY = this.hintTopY(W / 2 - w / 2, W / 2 + w / 2);
    opts.push(box(W / 2, topY));
    const goals = this.goalRects();
    const solid = [
      '#ui > .touch:not(.hidden) .touch-btns', '#ui > .touch:not(.hidden) .touch-base', '.scorebug', '.hud-pause', '.hud-toast.on',
      '.hud-tip.on', '.hud-hint.on', '.hud-cm.on:not(.blocked)', '.hud-radar',
    ]
      .map((sel) => this.rectOf(sel, false))
      .filter((q): q is Rect => !!q);
    const cost = (r: Rect) =>
      goals.reduce((c, gr) => c + overlapArea(r, gr, 10) * 4, 0) + solid.reduce((c, q) => c + overlapArea(r, q, 4), 0);
    let pick = opts.find((r) => cost(r) === 0);
    if (!pick) pick = [...opts].sort((a, b) => cost(a) - cost(b))[0];
    el.style.left = `${Math.round(pick.l)}px`;
    el.style.top = `${Math.round(pick.t)}px`;
  }

  setHint(text: string): void {
    this.hintWant = text;
    // The player acted on this hint (see buttons()): it stays down until the session asks for another one.
    if (!text) this.hintDone = '';
    if (text && text === this.hintDone) text = '';
    if (this.hintHold > 0) text = '';
    const on = text.length > 0;
    // Off: keep the old words while it fades out (an empty box shrinking looks broken).
    if (on && this.hint.textContent !== text) this.hint.textContent = text;
    if (on && !this.hint.classList.contains('on')) {
      // Decide the slot before it fades in, so it never flashes over the taker or the goal first.
      this.hintT = 0;
      this.placeHint(true);
    }
    this.hint.classList.toggle('on', on);
  }

  /**
   * The action buttons (PASS / SHOOT / THROUGH, any device), every frame. Pressing one while a set-piece hint
   * is up means the player is taking the kick: the hint goes at once, rather than lingering through the run-up
   * and the wait for the box runners into open play.
   */
  buttons(down: boolean): void {
    if (down && !this.btnDown && this.hint.classList.contains('on') && this.hintWant) {
      this.hintDone = this.hintWant;
      this.setHint(this.hintWant);
    }
    this.btnDown = down;
  }

  /**
   * Keep set-piece hints hidden for `seconds` (the render side calls this for the card close-up; every booking
   * banner does it too), whatever setHint is asked meanwhile. The last asked-for hint returns afterwards.
   */
  suppressHints(seconds: number): void {
    this.hintHold = Math.max(this.hintHold, seconds);
    this.setHint(this.hintWant);
  }

  /** Where the camera puts world points on screen; enables keep-clear placement of the ticker and hints. */
  setProjector(fn: Projector | null): void {
    this.project = fn;
  }

  /** Text ticker and spoken commentary switches (Settings). Turning speech off stops it mid-sentence. */
  setCommentary(text: boolean, voice: boolean): void {
    this.cmTextOn = text;
    if (this.cmVoice && !voice) stopSpeech();
    this.cmVoice = voice;
    if (!text) this.hideLine();
  }

  /** Commentary hook: the session forwards every match event here (before its own handling). */
  commentary(e: MatchEvent, m: Match): void {
    this.m = m;
    try {
      // Timed finishing: the verdict on the human's second SHOOT tap (the session forwards every event here).
      if (e.type === 'timing') {
        const p = m.players[e.player];
        if (!p || this.humanSide < 0 || p.side === this.humanSide) this.timing(e.grade, e.player);
        return;
      }
      if (e.type === 'card') {
        // Normally this runs before the session's card() call; if not, name the chip once it exists.
        const side = m.players[e.player]?.side;
        if (side !== undefined) queueMicrotask(() => this.unnamed[side] && this.drawCards(side));
      }
      if (!this.cmTextOn && !this.cmVoice) return;
      if (this.root.classList.contains('replaying')) return;
      const line = this.commentator.line(e, m);
      if (!line) return;
      // Colour lines only when the ticker has been quiet a while, and not every time.
      if (line.priority === 1 && (this.clockS - this.cmLastShown < 6 || this.cmLine || Math.random() < 0.45)) return;
      if (!this.cmLine || line.priority > this.cmLine.priority || this.cmAge >= LINE_MIN_S) this.showLine(line);
      else if (!this.cmPending || line.priority >= this.cmPending.line.priority) this.cmPending = { line, age: 0 };
    } catch {
      // Commentary must never break the match loop.
    }
  }

  /** The line on the ticker right now (tests / debugging). */
  get commentaryText(): string {
    return this.cmLine ? this.cmText.textContent ?? '' : '';
  }

  private showLine(line: CommentaryLine): void {
    // One thing at a time: while the booking plate is up the line waits (it follows the plate).
    if (this.bannerCard && this.bannerTimer > 0) {
      this.cmPending = { line, age: 0 };
      return;
    }
    this.cmLine = line;
    this.cmAge = 0;
    this.cmLeft = line.priority >= 5 || line.tone === 'goal' ? BIG_LINE_S : LINE_S;
    this.cmLastShown = this.clockS;
    if (this.cmVoice) speak(line.text, line.priority >= 5);
    if (!this.cmTextOn) return;
    this.cmTag.textContent = line.tag;
    this.cmText.textContent = line.text;
    this.cm.dataset.tone = line.tone;
    this.cm.style.setProperty('--cm', line.side === -1 ? 'var(--cream-2)' : this.teamColor[line.side]);
    this.cmSlot = '';
    this.placeTicker();
    this.cm.classList.remove('on');
    void this.cm.offsetWidth;
    this.cm.classList.add('on');
  }

  private hideLine(): void {
    this.cmLine = null;
    this.cmPending = null;
    this.cm.classList.remove('on');
  }

  private rectOf(sel: string, visible = true): Rect | null {
    const el = this.root.querySelector<HTMLElement>(sel) ?? document.querySelector<HTMLElement>(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    if (visible) {
      let n: HTMLElement | null = el;
      while (n && n !== document.body) {
        const cs = getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.2) return null;
        n = n.parentElement;
      }
    }
    return { l: r.left, t: r.top, r: r.right, b: r.bottom };
  }

  private ballOnScreen(): { x: number; y: number } | null {
    const f = this.lastFrame;
    if (!f || !this.project) return null;
    try {
      return this.project(f[BALL_OFS], f[BALL_OFS + 1], f[BALL_OFS + 2]);
    } catch {
      return null;
    }
  }

  /**
   * Screen boxes of the goal mouths in shot (posts, bar, net and the keeper's patch in front of the line),
   * clipped to the viewport. A set piece's captions must never sit over the goal being aimed at.
   */
  private goalRects(): Rect[] {
    const P = this.project;
    if (!P) return [];
    const W = window.innerWidth;
    const H = window.innerHeight;
    const out: Rect[] = [];
    const zs = [-(GOAL_W / 2 + 0.6), GOAL_W / 2 + 0.6];
    for (const g of [-1, 1]) {
      let l = Infinity;
      let t = Infinity;
      let r = -Infinity;
      let b = -Infinity;
      let inShot = true;
      for (const x of [g * (HALF_L + GOAL_DEPTH), g * (HALF_L - 2.4)]) {
        for (const z of zs) {
          for (const y of [0, GOAL_H + 0.5]) {
            let p: { x: number; y: number } | null = null;
            try {
              p = P(x, y, z);
            } catch {
              p = null;
            }
            if (!p) {
              inShot = false; // part of it is behind the lens: the goal we're looking away from
              continue;
            }
            l = Math.min(l, p.x);
            r = Math.max(r, p.x);
            t = Math.min(t, p.y);
            b = Math.max(b, p.y);
          }
        }
      }
      if (!inShot) continue;
      const c = { l: Math.max(0, l), t: Math.max(0, t), r: Math.min(W, r), b: Math.min(H, b) };
      if (c.r - c.l > 4 && c.b - c.t > 4) out.push(c);
    }
    return out;
  }

  /** A dead-ball moment (ours or theirs): restarts, the shootout, or our set-piece hint is up. */
  private setPiece(): boolean {
    const ph = this.m?.phase;
    return this.hint.classList.contains('on') || ph === 'restart' || ph === 'shootout';
  }

  private setTickerBlocked(on: boolean): void {
    if (on === this.cmBlocked) return;
    this.cmBlocked = on;
    this.cm.classList.toggle('blocked', on);
  }

  /**
   * Put the ticker where it covers nothing: the top band beside the score bug (landscape), or under the top
   * HUD cluster (portrait); the lower third instead whenever the ball is up there, and the bottom corners
   * beside the minimap as a last resort. The goal mouth in shot is always keep-clear (corners, crosses, shots:
   * live play as much as dead balls), as are the touch buttons and the thumbstick (counted even while they
   * are faded out for a dead ball: they come back mid-line). With no clear band left the ticker hides until
   * there is one (only a goal celebration, where the goal mouth no longer matters, ignores the goal).
   */
  private placeTicker(): void {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const g = W < 480 ? 8 : 12;
    const sb = this.rectOf('.scorebug', false);
    const pause = this.rectOf('.hud-pause', false);
    if (!sb) return;
    const h = this.cm.offsetHeight || 34;
    const card = this.cardBannerRect();
    const bands: { k: string; l: number; r: number; t: number }[] = [];
    // 1) Top band between the score bug and the pause button (unless the booking plate is up there).
    const bl = sb.r + g;
    const br = (pause ? pause.l : W) - g;
    const topRow = this.rectOf('.scorebug .sb-clock', false) ?? sb;
    if (br - bl >= 300 && !(card && card.t < sb.b)) bands.push({ k: 'top', l: bl, r: br, t: topRow.t });
    // 2) Under the top cluster (score bug + chips, shootout tracker, flag, radar in portrait, hint, tip, plate).
    const setPiece = this.setPiece();
    let under = sb.b;
    for (const sel of ['.so-track', '.hud-toast.on', '.hud-hint.on:not(.low)', '.hud-tip.on', '.hud-radar', '.hud-banner.on.goal .bn-sub']) {
      // By class, not opacity: a widget fading in counts at once, and the minimap counts even while faded
      // out (it comes back mid-line) except at a dead ball, where it stays off until the kick is taken.
      // display:none (the shootout's minimap) never counts.
      if (sel === '.hud-radar' && setPiece && this.radarHidden) continue;
      const r = this.rectOf(sel, false);
      if (r && r.t < H * 0.45) under = Math.max(under, r.b);
    }
    if (card && card.t < H * 0.45) under = Math.max(under, card.b);
    bands.push({ k: 'under', l: g, r: W - g, t: under + 8 });
    // 3) Lower third: above the minimap, clear of the player chip, a low hint and the touch buttons.
    let low = H - Math.max(g, 12);
    let ll = g;
    let lr = W - g;
    // The minimap counts even while faded out: it comes back as soon as play moves off the near touchline.
    const radar = this.rectOf('.hud-radar', false);
    if (radar && radar.t > H * 0.5) low = Math.min(low, radar.t - 8);
    const hint = this.rectOf('.hud-hint.on.low');
    if (hint) low = Math.min(low, hint.t - 8);
    const chip = this.rectOf('.hud-chip');
    if (chip && chip.t > H * 0.5) ll = Math.max(ll, chip.r + g);
    // The thumbstick on touch screens (by layout, not opacity: faded out at a dead ball, back for play).
    const stick = this.rectOf('#ui > .touch:not(.hidden) .touch-base', false);
    if (stick && stick.b > low - h - 4 && stick.l < W / 2) ll = Math.max(ll, stick.r + g);
    const btns = this.rectOf('#ui > .touch:not(.hidden) .touch-btns', false);
    if (btns) lr = Math.min(lr, btns.l - g);
    if (lr - ll >= 220) bands.push({ k: 'low', l: ll, r: lr, t: low - h });
    else if (stick || btns) {
      // Portrait phones: no room between the controls, so full width just above all of them.
      let t = low;
      if (stick && stick.t > H * 0.4) t = Math.min(t, stick.t - 8);
      if (btns) t = Math.min(t, btns.t - 8);
      if (chip && chip.t > H * 0.5) t = Math.min(t, chip.t - 8);
      bands.push({ k: 'low', l: g, r: W - g, t: t - h });
    }
    // 4) Last resort (landscape, minimap bottom centre): the bottom strip either side of the minimap, under the
    // lower third, where a side-on broadcast shot rarely has a goal mouth.
    if (radar && radar.t > H * 0.5 && !hint) {
      const fl = Math.max(ll, g);
      const fr = Math.min(lr, W - g);
      const ft = H - Math.max(g, 12) - h;
      if (ft > low - h + 4) {
        if (radar.l - g - fl >= 220) bands.push({ k: 'footL', l: fl, r: radar.l - g, t: ft });
        if (fr - (radar.r + g) >= 220) bands.push({ k: 'footR', l: radar.r + g, r: fr, t: ft });
      }
    }
    // Where the line would actually sit in each band: its natural width, centred (up top: after the score
    // bug), or pushed to either end of the band when that keeps it off the goal and the ball.
    this.cm.style.maxWidth = `${Math.round(W - g * 2)}px`;
    const natural = this.cm.offsetWidth;
    const goals = this.celebrating() ? [] : this.goalRects();
    const ball = this.ballOnScreen();
    // The touch controls: never under the caption, whichever band it is in.
    const solid = [btns, stick].filter((q): q is Rect => !!q);
    // `pad` px round the goal mouth: a little margin, as the broadcast camera pans the goal across the screen
    // between two placements.
    const covers = (r: Rect, pad = 6) => goals.some((gr) => overlapArea(r, gr, pad) > 0) || solid.some((q) => overlapArea(r, q, 4) > 0);
    const near = (r: Rect) => !!ball && distTo(ball, r) <= 80;
    const boxes = new Map<string, Rect>();
    const boxOf = (b: { k: string; l: number; r: number; t: number }): Rect => {
      const got = boxes.get(b.k);
      if (got) return got;
      const w = Math.min(natural, b.r - b.l);
      const at = (left: number): Rect => ({ l: left, r: left + w, t: b.t, b: b.t + h });
      const opts = b.k === 'top' || b.k === 'footL' ? [at(b.l), at(b.r - w)]
        : b.k === 'footR' ? [at(b.r - w), at(b.l)]
          : [at(b.l + (b.r - b.l - w) / 2), at(b.l), at(b.r - w)];
      // Where it sits now, while that stays well clear (no sliding back and forth along the band).
      const now = b.k === this.cmSlot && this.cmX >= b.l - 1 && this.cmX + w <= b.r + 1 ? at(this.cmX) : null;
      const box = (now && !covers(now, 16) && !near(now) ? now : null)
        ?? opts.find((r) => !covers(r, 40) && !near(r))
        ?? opts.find((r) => !covers(r, 14) && !near(r))
        ?? opts.find((r) => !covers(r) && !near(r))
        ?? opts.find((r) => !covers(r))
        ?? opts[0];
      boxes.set(b.k, box);
      return box;
    };
    const onGoal = (b: { k: string; l: number; r: number; t: number }) => covers(boxOf(b));
    // No projector: in portrait set pieces the goal is somewhere up top, so stay out of the way.
    if (setPiece && !this.project && H > W) {
      this.setTickerBlocked(true);
      return;
    }
    const clear = (b: { k: string; l: number; r: number; t: number }) => (ball ? distTo(ball, boxOf(b)) : Infinity);
    const usable = bands.filter((b) => !onGoal(b));
    // The bottom corners only when every band above them covers the goal or sits on the ball.
    const main = usable.filter((b) => !b.k.startsWith('foot'));
    const pool = main.some((b) => clear(b) > 80) ? main : usable;
    // Under the cluster only when the top band is out (portrait, or the plate / the goal took it).
    const pref = pool.filter((b) => b.k !== 'under' || !pool.some((x) => x.k === 'top'));
    if (!pref.length) {
      this.setTickerBlocked(true);
      return;
    }
    // First band that keeps ~80 px clear of the ball (the players around it) and off the goal mouth, else the
    // first clear of the ball, else the farthest from it.
    let pick = pref.find((b) => clear(b) > 80 && !onGoal(b)) ?? pref.find((b) => clear(b) > 80);
    if (!pick) pick = [...pref].sort((a, b) => clear(b) - clear(a))[0];
    if (!pick) return;
    // A dead ball with the only band left sitting on the taker: better no caption than one over him.
    if (setPiece && clear(pick) < 50) {
      this.setTickerBlocked(true);
      return;
    }
    // Stay put unless the ball (or the goal) really is in the way (no jitter between two bands).
    const cur = pref.find((b) => b.k === this.cmSlot);
    if (cur && cur !== pick && clear(cur) > 40 && (!onGoal(cur) || onGoal(pick))) pick = cur;
    const width = pick.r - pick.l;
    this.cm.style.maxWidth = `${Math.round(width)}px`;
    const box = boxOf(pick);
    this.cm.style.left = `${Math.round(box.l)}px`;
    this.cm.style.top = `${Math.round(pick.t)}px`;
    this.cm.dataset.slot = pick.k;
    this.cmSlot = pick.k;
    this.cmX = Math.round(box.l);
    this.cmBox = { l: Math.round(box.l), t: Math.round(pick.t), r: Math.round(box.l) + (box.r - box.l), b: Math.round(pick.t) + h };
    this.setTickerBlocked(false);
  }

  /**
   * The one time the goal mouth needn't stay clear of the ticker: the celebration after a goal (the camera is
   * on the scorer; the HUD is dead then) and half / full time. The ball going in is still kept clear.
   */
  private celebrating(): boolean {
    const ph = this.m?.phase;
    return (ph === 'goal' && this.root.classList.contains('dead')) || ph === 'halftime' || ph === 'fulltime';
  }

  /** The goal mouth has panned under the placed ticker (or within a few px of it): time to move. */
  private tickerNearGoal(): boolean {
    const box = this.cmBox;
    if (!box || this.cmBlocked || !this.project || this.celebrating()) return false;
    return this.goalRects().some((gr) => overlapArea(box, gr, 12) > 0);
  }

  /** Top of the hint's upper slot: under whatever hangs off the top edge across its width. */
  private hintTopY(l: number, r: number): number {
    const W = window.innerWidth;
    const H = window.innerHeight;
    let y = 0;
    const take = (q: Rect | null) => {
      if (q && q.t < H * 0.4 && q.r > l && q.l < r) y = Math.max(y, q.b);
    };
    for (const sel of ['.scorebug', '.so-track', '.hud-toast.on', '.hud-pause']) take(this.rectOf(sel, false));
    // The minimap only while it shows (it is off for set pieces).
    if (!this.radarHidden && !this.root.classList.contains('dead')) take(this.rectOf('.hud-radar'));
    // Landscape: a little lower than the top row, which belongs to the ticker and the event flag.
    return Math.round(Math.max(y + 10, W > H ? H * 0.16 : 0));
  }

  /**
   * Set-piece hint. Slots, in order of preference: top centre (under the top cluster), the top corners
   * (narrower, when the screen is wide enough), the bottom band (clear of the player chip, the resting
   * thumbstick, the touch buttons and the minimap; full width above the controls on portrait phones) and its
   * two halves. It takes the one that covers least of what matters: the goal mouth being aimed at first, then
   * the taker (the ball) and, with him up in the far part of the lens (a far-side corner), his delivery.
   */
  private placeHint(force = false): void {
    const H = window.innerHeight;
    const W = window.innerWidth;
    const el = this.hint;
    const st = el.style;
    const g = 12;
    // Size at a given width: the text wraps to fit.
    const size = (maxW: number) => {
      st.maxWidth = `${Math.round(maxW)}px`;
      return { w: el.offsetWidth, h: el.offsetHeight };
    };
    type Slot = { k: string; low: boolean; r: Rect; maxW: number; bottom: number };
    const slots: Slot[] = [];
    const topSlot = (k: string, maxW: number, align: 'c' | 'l' | 'r') => {
      const a = size(maxW);
      const l = align === 'c' ? (W - a.w) / 2 : align === 'l' ? g : W - g - a.w;
      const t = this.hintTopY(l, l + a.w);
      slots.push({ k, low: false, r: { l, r: l + a.w, t, b: t + a.h }, maxW, bottom: 0 });
    };
    const goals = this.goalRects();
    topSlot('top', W - g * 2, 'c');
    const half = W / 2 - g * 1.5;
    if (half >= 280) {
      topSlot('topL', half, 'l');
      topSlot('topR', half, 'r');
    }
    // Narrower corner slots that fit beside a goal mouth up in the top half of the lens.
    for (const gr of goals) {
      if (gr.t > H * 0.5) continue;
      const left = gr.l - 8 - g * 2;
      const right = W - gr.r - 8 - g * 2;
      if (left >= 160 && left < half) topSlot('topLg', left, 'l');
      if (right >= 160 && right < half) topSlot('topRg', right, 'r');
    }
    let ll = g;
    let lr = W - g;
    let bottom = 14;
    const chip = this.rectOf('.hud-chip');
    if (chip && chip.t > H * 0.5) bottom = Math.max(bottom, H - chip.t + 8);
    const stick = this.rectOf('#ui > .touch:not(.hidden) .touch-base');
    if (stick && stick.t > H * 0.4 && stick.l < W / 2) ll = Math.max(ll, stick.r + 10);
    const btns = this.rectOf('#ui > .touch:not(.hidden) .touch-btns');
    if (btns) lr = Math.min(lr, btns.l - 10);
    if (lr - ll < 240) {
      // Portrait phone: no room between the controls, so above all of them, full width.
      ll = g;
      lr = W - g;
      if (stick) bottom = Math.max(bottom, H - stick.t + 8);
      if (btns) bottom = Math.max(bottom, H - btns.t + 8);
    }
    // The minimap only while it shows (by class: it may still be fading out as the set piece begins).
    const radar = this.radarHidden || this.root.classList.contains('dead') ? null : this.rectOf('.hud-radar', false);
    const lowSlot = (k: string, l: number, maxW: number, right: boolean) => {
      const a = size(maxW);
      const x = right ? l + maxW - a.w : l;
      let bt = bottom;
      if (radar && radar.t > H * 0.5 && radar.l < x + a.w && radar.r > x) bt = Math.max(bt, H - radar.t + 8);
      slots.push({ k, low: true, r: { l: x, r: x + a.w, t: H - bt - a.h, b: H - bt }, maxW, bottom: bt });
    };
    lowSlot('low', ll, lr - ll, false);
    const lowHalf = (lr - ll) / 2 - g / 2;
    if (lowHalf >= 280) {
      lowSlot('lowL', ll, lowHalf, false);
      lowSlot('lowR', lr - lowHalf, lowHalf, true);
    }
    const ball = this.ballOnScreen();
    // Controls a tall corner slot could run into (the landscape phone's button column starts high).
    const solid = [btns, stick, chip].filter((q): q is Rect => !!q);
    const cost = (s: Slot, i: number) => {
      let c = i * 60; // a small bias down the preference list
      for (const gr of goals) c += overlapArea(s.r, gr, 8) * 4;
      for (const q of solid) c += overlapArea(s.r, q, 6) * 8;
      if (ball) {
        const d = distTo(ball, s.r);
        if (d < 90) c += (90 - d) * 60;
        // Taker up in the far part of the lens: his delivery comes down through the top band.
        if (!s.low && ball.y < H * 0.4 && Math.abs(ball.x - (s.r.l + s.r.r) / 2) < W * 0.35) c += 2500;
      }
      return c;
    };
    let pick: Slot;
    if (!this.project) {
      // No projector: portrait set pieces go above the buttons (the goal is up top), else top centre.
      pick = H > W && this.setPiece() ? slots.find((s) => s.k === 'low')! : slots[0];
    } else {
      const costs = slots.map((s, i) => cost(s, i));
      let best = 0;
      costs.forEach((c, i) => {
        if (c < costs[best]) best = i;
      });
      pick = slots[best];
      // Stay put unless another slot is clearly better (no flicker between two).
      const cur = slots.findIndex((s) => s.k === this.hintSlot);
      if (!force && cur >= 0 && costs[cur] <= costs[best] + 400) pick = slots[cur];
    }
    this.hintSlot = pick.k;
    if (pick.low !== this.hintLow) {
      this.hintLow = pick.low;
      el.classList.toggle('low', pick.low);
    }
    st.maxWidth = `${Math.round(pick.maxW)}px`;
    if (!pick.low) {
      // Top slots keep the CSS centring transform (the pulse animates it), so `left` is the box centre.
      st.bottom = '';
      st.left = this.project ? `${Math.round((pick.r.l + pick.r.r) / 2)}px` : '';
      st.top = this.project ? `${Math.round(pick.r.t)}px` : '';
      if (!this.project) st.maxWidth = '';
      return;
    }
    st.top = '';
    st.left = `${Math.round(pick.r.l)}px`;
    st.bottom = `${Math.round(pick.bottom)}px`;
  }

  /** Hide play-only widgets (radar, player chip, tips) outside live play. */
  setLive(on: boolean): void {
    // Live play only comes after the intro fly-in: if it was skipped, its title card must not linger.
    if (on) this.hideIntro();
    this.root.classList.toggle('dead', !on);
  }

  /** Hide the minimap (set pieces, play near the bottom touchline) without touching the rest of the HUD. */
  setRadarHidden(hidden: boolean): void {
    if (hidden === this.radarHidden) return;
    this.radarHidden = hidden;
    this.root.classList.toggle('radar-off', hidden);
  }

  /**
   * Cinematic shots (card close-ups): the ticker, the event flag ("FREE KICK"), the set-piece hint, the player
   * chip, tips and the minimap fade out (0.15 s, style.css ".hud.cinematic"); the score bug, clock, booking
   * chips, booking plate and pause button stay. Off again: they fade back (the ticker re-places first).
   */
  setCinematic(on: boolean): void {
    if (on === this.root.classList.contains('cinematic')) return;
    this.root.classList.toggle('cinematic', on);
    if (!on && this.cmLine && this.cmTextOn) {
      this.cmPlaceT = 0.3;
      this.placeTicker();
    }
  }

  /** True while a cinematic shot has the HUD stripped back (tests / debugging). */
  get cinematic(): boolean {
    return this.root.classList.contains('cinematic');
  }

  /**
   * Booking under that side of the score bug: a yellow chip per player on a yellow, a red chip per player sent
   * off. A red for a player already on a yellow (second yellow) replaces that yellow. Pass the player index
   * so the right yellow is swapped; without it, a yellow immediately followed by a red for the same side (the
   * old "second yellow = both cards" call pattern) still counts as one player's second yellow.
   */
  card(side: 0 | 1, color: 'yellow' | 'red', player?: number): void {
    const b = this.booked[side];
    this.lastBooked[side] = player ?? null;
    if (color === 'yellow') {
      const key = player ?? `a${this.anon++}`;
      if (!b.yellow.includes(key) && !b.red.includes(key)) b.yellow.push(key);
      if (player === undefined) {
        this.justYellow[side] = key as string;
        queueMicrotask(() => {
          if (this.justYellow[side] === key) this.justYellow[side] = null;
        });
      }
    } else {
      let key: number | string | undefined = player;
      const pair = this.justYellow[side];
      if (key === undefined && pair) {
        // Legacy second yellow: the pair's yellow is this red, and the player's first yellow goes too.
        key = pair;
        const first = b.yellow.findIndex((k) => k !== pair && typeof k === 'string');
        if (first >= 0) b.yellow.splice(first, 1);
      }
      this.justYellow[side] = null;
      key ??= `a${this.anon++}`;
      const y = b.yellow.indexOf(key);
      if (y >= 0) b.yellow.splice(y, 1);
      if (!b.red.includes(key)) b.red.push(key);
    }
    this.drawCards(side, color);
  }

  /** A booking chip was drawn before its player's name was known. */
  private unnamed: [boolean, boolean] = [false, false];
  /** Latest booking per side: its player is named on the plate. */
  private lastBooked: [number | string | null, number | string | null] = [null, null];

  private playerName(key: number | string): string {
    return typeof key === 'number' ? this.m?.players[key]?.def.name ?? '' : '';
  }

  private drawCards(side: 0 | 1, fresh?: 'yellow' | 'red'): void {
    const b = this.booked[side];
    const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    // One plate per side: a chip per booking (more than three of a colour collapse to chip + count), then the
    // surname of the latest booked player, so the plate reads "yellow card: DASH" rather than a mystery icon.
    // Every name is in the tooltip / label.
    const chips = (k: 'yellow' | 'red') => {
      const n = b[k].length;
      if (!n) return '';
      return n > 3 ? `<i class="sb-chip ${k}"></i><b>${n}</b>` : Array.from({ length: n }, () => `<i class="sb-chip ${k}"></i>`).join('');
    };
    const last = this.lastBooked[side];
    const lastName = last !== null && (b.yellow.includes(last) || b.red.includes(last))
      ? surname(this.playerName(last), this.m ? pitchNames(this.m) : undefined).toUpperCase()
      : '';
    const y = b.yellow.length;
    const r = b.red.length;
    const el = this.cards[side];
    const who = (k: 'yellow' | 'red') => b[k].map((key) => this.playerName(key)).filter(Boolean).join(', ');
    this.unnamed[side] = [...b.yellow, ...b.red].some((key) => typeof key === 'number' && !this.playerName(key));
    const label = [
      y ? `${y} yellow card${y > 1 ? 's' : ''}${who('yellow') ? `: ${who('yellow')}` : ''}` : '',
      r ? `${r} red card${r > 1 ? 's' : ''}${who('red') ? `: ${who('red')}` : ''}` : '',
    ].filter(Boolean).join('; ');
    el.innerHTML = y || r
      ? `<span class="sb-card" role="img" title="${esc(label)}" aria-label="${esc(label)}">${chips('yellow')}${chips('red')}${lastName ? `<em>${esc(lastName)}</em>` : ''}</span>`
      : '';
    // The booking row grows the score bug: the event flag and the booking plate under it move down with it.
    if (this.toast.classList.contains('on')) this.placeToast();
    if (this.bannerCard && this.bannerTimer > 0) this.placeBanner();
    if (fresh) {
      const icons = el.querySelectorAll(`.sb-chip.${fresh}`);
      icons[icons.length - 1]?.classList.add('new');
    }
  }

  /** Booking counts shown on the score bug (for tests / debugging). */
  cardCounts(side: 0 | 1): { yellow: number; red: number } {
    return { yellow: this.booked[side].yellow.length, red: this.booked[side].red.length };
  }

  /** Tutorial tip (top centre). Empty string hides it. */
  setTip(html: string): void {
    if (this.tip.dataset.t === html) return;
    this.tip.dataset.t = html;
    this.tip.innerHTML = html;
    this.tip.classList.toggle('on', html.length > 0);
  }

  setReplay(on: boolean): void {
    this.replay.classList.toggle('on', on);
    this.root.classList.toggle('replaying', on);
    // Replays are silent on the ticker: nothing queued comes back afterwards either.
    if (on) this.hideLine();
  }

  setPlayer(num: number, name: string, stamina: number): void {
    const up = name.toUpperCase();
    if (this.chipNum.textContent !== String(num) || this.chipName.textContent !== up) {
      this.chipNum.textContent = String(num);
      this.chipName.textContent = up;
    }
    this.stamina.style.width = `${Math.round(stamina * 100)}%`;
    this.stamina.style.background = stamina > 0.5 ? '#3aff9e' : stamina > 0.3 ? '#ffd23a' : '#ff4a3a';
  }

  update(dt: number, frame: Float32Array): void {
    this.justYellow[0] = this.justYellow[1] = null;
    this.lastFrame = frame;
    this.clockS += dt;
    if (this.cmPending) {
      this.cmPending.age += dt;
      if (this.cmPending.age > PENDING_MAX_S) this.cmPending = null;
    }
    if (this.cmLine) {
      this.cmAge += dt;
      this.cmLeft -= dt;
      if (this.cmPending && this.cmAge >= LINE_MIN_S + 0.6) {
        const next = this.cmPending.line;
        this.cmPending = null;
        this.showLine(next);
      } else if (this.cmLeft <= 0) {
        this.cmLine = null;
        this.cm.classList.remove('on');
      } else if (this.cmTextOn) {
        this.cmPlaceT -= dt;
        // Full re-place every 0.3 s; in between, a cheap look every frame whether the camera has panned the
        // goal mouth up to the line, which moves it at once (at most 20 times a second).
        if (this.cmPlaceT <= 0 || (this.cmPlaceT <= 0.25 && this.tickerNearGoal())) {
          this.cmPlaceT = 0.3;
          this.placeTicker();
        }
      }
    } else if (this.cmPending) {
      const next = this.cmPending.line;
      this.cmPending = null;
      this.showLine(next);
    }
    if (this.hintHold > 0) {
      this.hintHold -= dt;
      if (this.hintHold <= 0) {
        this.hintHold = 0;
        this.setHint(this.hintWant);
      }
    }
    if (this.hint.classList.contains('on')) {
      this.hintT -= dt;
      if (this.hintT <= 0) {
        this.hintT = 0.25;
        this.placeHint();
      }
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('on');
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.classList.remove('on');
    }
    if (this.timingT > 0) {
      this.timingT -= dt;
      if (this.timingT <= 0) this.timingEl.classList.remove('on');
      else if (this.project) {
        // The camera follows the shot towards goal: move off the goal mouth if it pans under the word.
        const r = this.timingEl.getBoundingClientRect();
        const box = { l: r.left, t: r.top, r: r.right, b: r.bottom };
        if (this.goalRects().some((gr) => overlapArea(box, gr, 6) > 0)) this.placeTiming();
      }
    }
    this.radarT -= dt;
    const hidden = this.radarHidden || this.root.classList.contains('dead') || this.root.classList.contains('replaying');
    if (this.radarT <= 0 && !hidden) {
      this.radarT = 1 / 20;
      this.drawRadar(frame);
      this.fadeRadar(frame);
    }
  }

  /**
   * The minimap nearly vanishes while the ball, our man or the team-mate his pass is locked onto is under it
   * on screen (checked with the radar redraw, 20 times a second).
   */
  private fadeRadar(f: Float32Array): void {
    const P = this.project;
    let under = false;
    if (P) {
      const r = this.radar.getBoundingClientRect();
      const pad = 14;
      const hit = (x: number, y: number, z: number) => {
        let p: { x: number; y: number } | null = null;
        try {
          p = P(x, y, z);
        } catch {
          p = null;
        }
        return !!p && p.x > r.left - pad && p.x < r.right + pad && p.y > r.top - pad && p.y < r.bottom + pad;
      };
      const player = (i: number) => i >= 0 && i < 22 && (hit(f[i * PF], 0.2, f[i * PF + 1]) || hit(f[i * PF], 1.6, f[i * PF + 1]));
      const aim = this.m?.passAim ?? -1;
      under = hit(f[BALL_OFS], f[BALL_OFS + 1], f[BALL_OFS + 2]) || player(f[BALL_OFS + 8]) || player(typeof aim === 'number' ? aim : -1);
    }
    if (under !== this.radar.classList.contains('under')) this.radar.classList.toggle('under', under);
  }

  /** Match the canvas backing store to its CSS size at devicePixelRatio, so the minimap stays crisp. */
  private fitRadar(): void {
    const c = this.radar;
    const cssW = c.clientWidth;
    if (!cssW) return; // display:none (penalty shootout): keep the old backing store until it shows again
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    // The CSS box is locked to the pitch's 8:5 aspect, so the height follows the width.
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(w * 0.625));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    this.radarDirty = false;
  }

  private drawRadar(f: Float32Array): void {
    const c = this.radar;
    if (this.radarDirty) this.fitRadar();
    const g = c.getContext('2d')!;
    const dpr = c.width / (c.clientWidth || c.width);
    // Work in CSS pixels; line and marker sizes scale gently with the widget's size.
    const w = c.width / dpr;
    const h = c.height / dpr;
    const u = Math.max(0.75, Math.min(1.2, w / 170));
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(38, 70, 30, 0.6)';
    g.fillRect(0, 0, w, h);
    const m = Math.round(3 * u);
    g.strokeStyle = 'rgba(255,255,255,0.6)';
    g.lineWidth = Math.max(1, 1.5 * u);
    g.strokeRect(m, m, w - m * 2, h - m * 2);
    g.beginPath();
    g.moveTo(w / 2, m);
    g.lineTo(w / 2, h - m);
    g.stroke();
    const sx = (x: number) => m + ((x + HALF_L) / (HALF_L * 2)) * (w - m * 2);
    const sz = (z: number) => m + ((z + HALF_W) / (HALF_W * 2)) * (h - m * 2);
    g.beginPath();
    g.arc(w / 2, h / 2, sz(CENTER_R) - sz(0), 0, Math.PI * 2);
    g.stroke();
    const boxD = sx(-HALF_L + BOX_DEPTH) - sx(-HALF_L);
    const bz0 = sz(-BOX_W / 2);
    const bz1 = sz(BOX_W / 2);
    g.strokeRect(m, bz0, boxD, bz1 - bz0);
    g.strokeRect(w - m - boxD, bz0, boxD, bz1 - bz0);
    const active = f[BALL_OFS + 8];
    const s0 = Math.max(4, Math.round(5.5 * u));
    const s1 = s0 + 2;
    g.lineWidth = Math.max(1, 1.25 * u);
    for (let i = 0; i < 22; i++) {
      const o = i * PF;
      if (f[o + 4] === 10) continue; // sent off
      const side = i < 11 ? 0 : 1;
      const x = sx(f[o]);
      const y = sz(f[o + 1]);
      const s = i === active ? s1 : s0;
      g.fillStyle = this.dotFill[side];
      g.strokeStyle = this.dotEdge[side];
      g.fillRect(x - s / 2, y - s / 2, s, s);
      g.strokeRect(x - s / 2, y - s / 2, s, s);
      if (i === active) {
        g.strokeStyle = '#ffd23a';
        g.lineWidth = Math.max(1.5, 2 * u);
        g.strokeRect(x - s / 2 - 2.5 * u, y - s / 2 - 2.5 * u, s + 5 * u, s + 5 * u);
        g.lineWidth = Math.max(1, 1.25 * u);
      }
    }
    const bs = Math.max(4, Math.round(5 * u));
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#1d1d24';
    const bx = sx(f[BALL_OFS]);
    const by = sz(f[BALL_OFS + 2]);
    g.fillRect(bx - bs / 2, by - bs / 2, bs, bs);
    g.strokeRect(bx - bs / 2, by - bs / 2, bs, bs);
  }

  dispose(): void {
    this.radarObs?.disconnect();
    if (this.cmVoice) stopSpeech();
    this.root.remove();
  }
}

export function hudTeam(t: TeamDef, kitShirt: number, kitShirt2: number): HudTeam {
  return { short: t.short, name: t.name, color: kitShirt, color2: kitShirt2, kit: t.kit };
}
