import { BALL_OFS, PF } from '../game/replay';
import { BOX_DEPTH, BOX_W, CENTER_R, GOAL_DEPTH, GOAL_H, GOAL_W, HALF_L, HALF_W } from '../sim/constants';
import type { Match } from '../sim/match';
import type { Kit, MatchEvent, PowerUpKind, TeamDef } from '../sim/types';
import { crestSvg } from './crest';
import { cssHex } from '../render/palette';
import { Commentator, POWER_INFO, pitchNames, surname, type CommentaryLine } from './commentary';
import { actionKey, currentDevice, remapKeys } from '../core/input';
import { coachParts, cueKey, cueOfText, fillCoach, type CoachCue, type CoachParts } from './coach';
import { pixelIcon } from './pixelIcons';
import { escHtml, scoreHtml, sepsOfText } from './text';

/** How long (s) each power-up runs once used, for the slot's countdown ring when the sim doesn't say. */
export const POWER_SECONDS: Record<PowerUpKind, number> = { turbo: 6, mega: 8, freeze: 5, magnet: 6, shield: 6, golden: 20 };
/** Seconds a power-up banner ("TURBO!") stays up. */
const POWER_BANNER_S = 1.3;

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
/** How often (s) the event flag re-measures the score bug it hangs off while it is up (every frame: the bug grows
 * under it the moment a live goal or FINAL MINUTES comes up). */
const TOAST_PLACE_S = 0;

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
  /** The fourth official's board (added time), hung beside the clock. */
  private board: HTMLDivElement;
  private banner: HTMLDivElement;
  private bannerTimer = 0;
  private hint: HTMLDivElement;
  private tip: HTMLDivElement;
  private chip: HTMLDivElement;
  private chipName: HTMLSpanElement;
  private chipNum: HTMLSpanElement;
  private stamina: HTMLDivElement;
  private replay: HTMLDivElement;
  private scoreBug: HTMLElement | null;
  private radar: HTMLCanvasElement;
  private radarT = 0;
  private radarHidden = false;
  /** Canvas backing size is re-derived from its CSS box (x devicePixelRatio) whenever that changes. */
  private radarDirty = true;
  private radarObs: ResizeObserver | null = null;
  /** The score bug's size: a plate or the event flag hung off it moves with it before the frame is drawn. */
  private bugObs: ResizeObserver | null = null;
  /** The corner picture coming up or going: a centred banner clears it before the frame is drawn. */
  private sideObs: MutationObserver | null = null;
  /** The window size the HUD was last laid out for: a change (resized, the phone turned) means relayout(). */
  private seenW = 0;
  private seenH = 0;
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
  private toastPlaceT = 0;
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
  /** Seconds left on a moment's countdown, or null when the match clock is showing. */
  private countdown: number | null = null;
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
  /** The hint the session last asked for (it comes back when a blackout ends), as shown (cueKey of its card). */
  private hintWant = '';
  /** ...and as it was asked for (setHint's own words or card and `bound` flag), to ask again without remapping twice. */
  private hintAsked: string | CoachCue | null = '';
  private hintBound = false;
  /** The card in the hint box now (cueKey). */
  private hintText = '';
  /** The hint and tip boxes are coach cards (ui/coach.ts): their title, key caps and line. */
  private hintParts!: CoachParts;
  private tipParts!: CoachParts;
  /** A hint the player has already acted on (hidden until the session wants a different one). */
  private hintDone = '';
  private btnDown = false;
  /** The kick-off prompt (setKickoff): its box, the verb and key cap in it, and whose kick-off it frames. */
  private kick: HTMLDivElement;
  private kickVerb: HTMLElement;
  private kickKey: HTMLElement;
  private kickAt: { taker: number; top: number } | null = null;
  /** Nowhere clear for the ticker (a set piece where every free band would cover the goal): hidden meanwhile. */
  private cmBlocked = false;
  /** The banner up now is a booking (compact plate in the top band / under the score bug). */
  private bannerCard = false;
  /** The banner up now is a power-up call ("TURBO!"): the same plate, kept off the goal mouth. */
  private bannerPower = false;
  private bannerGoal = false;
  /** The banner up now is a tag (kind 'tag': SECOND HALF), hung off the score bug where the scorer's plate goes. */
  private bannerTag = false;
  /** A plate hung off the score bug: the scorer's, or a tag. */
  private get bannerHung(): boolean {
    return this.bannerGoal || this.bannerTag;
  }
  private bannerPlaceT = 0;
  /** Blitz: the power-up slot under the score bug. */
  private power: HTMLDivElement;
  private powerIcon: HTMLElement;
  private powerName: HTMLElement;
  private powerKey: HTMLElement;
  private powerRing: SVGCircleElement;
  private powerKind: PowerUpKind | null = null;
  private powerActive: { kind: PowerUpKind; left: number; total: number } | null = null;
  private powerDevice: 'keyboard' | 'touch' | 'gamepad' = 'keyboard';
  private powerPlaceT = 0;
  /** Every match event, before the commentary (main.ts counts goals, headers, tackles ... for XP and challenges). */
  onEvent: ((e: MatchEvent, m: Match) => void) | null = null;
  onPause: (() => void) | null = null;
  /** The camera button (beside pause): the session cycles WIDE / NORMAL / CLOSE / CINEMATIC. */
  onCamera: (() => void) | null = null;
  /**
   * Rewrites (or drops, by returning null) a banner before it shows: LEARN THE BASICS turns the moment's
   * FAILED / COMPLETE! verdicts into its own words and drops the last-seconds countdown (main.ts sets it).
   */
  retitle: ((b: { title: string; sub: string; kind: string; seconds: number }) => { title: string; sub: string; kind: string; seconds: number } | null) | null = null;
  /** Shown in the clock cell instead of a moment's countdown (LEARN THE BASICS: "1/3"); null = the countdown. */
  countdownLabel: string | null = null;
  /**
   * LEARN THE BASICS (main.ts sets it): the fades over the play (fadeUnder) give way for every man of ours on the pitch
   * (a drill has two or three), not only his man and the pass target: the runner waiting under the score bug, the
   * winger under a control, are never hidden. Matches leave it off.
   */
  fadeTeam = false;
  /** Colour-blind aid on the minimap: the other side's dots are round, yours square (shape, not only colour). */
  private colorblind = false;

  constructor(teams: [HudTeam, HudTeam], humanSide: number) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    const [h, a] = teams;
    this.root.innerHTML = `
      <div class="scorebug">
        <div class="sb-team">${h.kit ? crestSvg(h.name, h.short, h.kit, 2) : `<i class="crest" style="--a:${cssHex(h.color)};--b:${cssHex(h.color2)}"></i>`}<b>${h.short}</b></div>
        <div class="sb-score">${scoreHtml(0, 0)}</div>
        <div class="sb-team"><b>${a.short}</b>${a.kit ? crestSvg(a.name, a.short, a.kit, 2) : `<i class="crest" style="--a:${cssHex(a.color)};--b:${cssHex(a.color2)}"></i>`}</div>
        <div class="sb-clock">00:00</div>
        <div class="sb-board" role="status" aria-label="Added time"></div>
        <div class="sb-cards h"></div>
        <div class="sb-cards a"></div>
      </div>
      <button class="hud-pause" aria-label="Pause">II</button>
      <button class="hud-cam" aria-label="Camera" tabindex="-1">${pixelIcon('camera', '#fbfbf4', 3)}</button>
      <div class="hud-power" role="status" aria-live="polite" hidden>
        <span class="pw-slot"><i class="pw-ico"></i><svg class="pw-ring" viewBox="0 0 40 40" aria-hidden="true"><circle class="pw-ring-bg" cx="20" cy="20" r="17"/><circle class="pw-ring-fg" cx="20" cy="20" r="17"/></svg></span>
        <span class="pw-text"><b class="pw-name">NO POWER UP</b><kbd class="pw-key">E</kbd></span>
      </div>
      <div class="hud-banner"></div>
      <div class="hud-toast"></div>
      <div class="hud-timing" aria-live="polite"></div>
      <div class="hud-hint"></div>
      <div class="hud-kick" role="status" aria-live="polite"><span class="kk-verb">PRESS</span><kbd class="kk-key">SPACE</kbd><span class="kk-to">TO KICK OFF</span></div>
      <div class="hud-tip"></div>
      <div class="hud-cm" role="status" aria-live="polite"><b class="cm-tag"></b><span class="cm-text"></span></div>
      <div class="hud-chip"><span class="chip-num"></span><span class="chip-name"></span><div class="chip-stam"><div></div></div></div>
      <div class="hud-replay"><b>REPLAY</b><em class="rp-cap"></em><span class="rp-key">PRESS ANY BUTTON TO SKIP</span><span class="rp-tap">TAP TO SKIP</span></div>
      <canvas class="hud-radar" width="240" height="150" aria-hidden="true"></canvas>`;
    this.score = this.root.querySelector('.sb-score')!;
    this.clock = this.root.querySelector('.sb-clock')!;
    this.board = this.root.querySelector('.sb-board')!;
    this.banner = this.root.querySelector('.hud-banner')!;
    this.hint = this.root.querySelector('.hud-hint')!;
    this.tip = this.root.querySelector('.hud-tip')!;
    this.hintParts = coachParts(this.hint);
    this.tipParts = coachParts(this.tip);
    this.kick = this.root.querySelector('.hud-kick')!;
    this.kickVerb = this.root.querySelector('.kk-verb')!;
    this.kickKey = this.root.querySelector('.kk-key')!;
    this.chip = this.root.querySelector('.hud-chip')!;
    this.chipName = this.root.querySelector('.chip-name')!;
    this.chipNum = this.root.querySelector('.chip-num')!;
    this.stamina = this.root.querySelector('.chip-stam div')!;
    this.replay = this.root.querySelector('.hud-replay')!;
    this.scoreBug = this.root.querySelector<HTMLElement>('.scorebug');
    this.radar = this.root.querySelector('.hud-radar')!;
    this.toast = this.root.querySelector('.hud-toast')!;
    this.timingEl = this.root.querySelector('.hud-timing')!;
    this.power = this.root.querySelector('.hud-power')!;
    this.powerIcon = this.root.querySelector('.pw-ico')!;
    this.powerName = this.root.querySelector('.pw-name')!;
    this.powerKey = this.root.querySelector('.pw-key')!;
    this.powerRing = this.root.querySelector('.pw-ring-fg')!;
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
      if (this.scoreBug) {
        this.bugObs = new ResizeObserver(() => {
          this.fitBookingNames();
          if (this.bannerHung && this.bannerTimer > 0) this.placeBanner();
          if (this.toastTimer > 0) this.placeToast();
          if (this.cmLine && this.cmTextOn) this.placeTicker();
          if (this.bannerTimer > 0) this.clearBanner();
          // (Grown under the play this frame, after its look round: it gives way before the frame is drawn.)
          const off = this.root.classList.contains('dead') || this.root.classList.contains('replaying');
          if (!off && this.lastFrame && this.scoreBug) {
            this.fadeUnder(this.scoreBug, this.lastFrame, [...this.scoreBug.querySelectorAll<HTMLElement>('.sb-board.on, .bty.on, .fun-pill.on, .sb-hype, .sb-grade')]);
          }
        });
        this.bugObs.observe(this.scoreBug);
      }
    }
    const pause = this.root.querySelector('.hud-pause')!;
    // A second finger does not synthesize click while the first is still holding the stick.
    pause.addEventListener('pointerdown', (e) => {
      if ((e as PointerEvent).pointerType !== 'touch') return;
      e.preventDefault();
      this.onPause?.();
    });
    pause.addEventListener('click', () => this.onPause?.());
    const cam = this.root.querySelector<HTMLButtonElement>('.hud-cam')!;
    // (As pause: a second finger while the first holds the stick; the click that follows a touch is swallowed.)
    let camTouch = 0;
    cam.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      e.preventDefault();
      camTouch = performance.now();
      this.onCamera?.();
    });
    cam.addEventListener('click', () => {
      if (performance.now() - camTouch > 600) this.onCamera?.();
      cam.blur();
    });
    if (humanSide < 0) this.chip.style.display = 'none';
  }

  setScore(h: number, a: number, animate = true): void {
    this.score.innerHTML = scoreHtml(h, a);
    this.score.classList.remove('pop');
    if (!animate) return;
    void this.score.offsetWidth;
    this.score.classList.add('pop');
  }

  /** Game clock in seconds, plus added-time minutes (0 = none). Ignored while a countdown is showing (setCountdown). */
  setClock(seconds: number, added: number | null): void {
    if (this.countdown !== null) return;
    const mm = Math.floor(seconds / 60);
    const ss = seconds % 60;
    // Added time counts on beside the held clock, as on a broadcast: 45:00 +0:37.
    const plus = added !== null && added >= 0 ? `<em>+${Math.floor(added / 60)}:${String(added % 60).padStart(2, '0')}</em>` : '';
    this.clock.innerHTML = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}${plus}`;
  }

  /**
   * The fourth official's board at 45:00 / 90:00 (Law 7.3): `minutes` of added time, the least that will be played, on
   * a voxel LED board that pops up beside the clock and stays for the added time. null takes it down (the whistle).
   */
  showAddedBoard(minutes: number | null, animate = true): void {
    const el = this.board;
    if (minutes === null) {
      el.classList.remove('on', 'pop');
      return;
    }
    el.textContent = `+${minutes}`;
    el.classList.remove('pop');
    el.classList.add('on');
    if (!animate) return;
    void el.offsetWidth;
    el.classList.add('pop');
  }

  /**
   * A booked player's name under the score bug in full or not at all: a narrow column (a phone on its side, the style
   * grade beside the away chips) takes it a size down (10 px, then 9), then his initial ("L."), never an ellipsis.
   */
  private fitBookingNames(): void {
    for (const em of this.root.querySelectorAll<HTMLElement>('.sb-card em')) {
      const full = em.dataset.name ?? em.textContent ?? '';
      em.dataset.name = full;
      em.textContent = full;
      em.style.fontSize = '';
      em.style.letterSpacing = '';
      const fits = () => em.scrollWidth <= em.clientWidth + 0.5;
      if (fits()) continue;
      for (const px of [10, 9]) {
        em.style.fontSize = `${px}px`;
        em.style.letterSpacing = '0';
        if (fits()) break;
      }
      if (!fits()) em.textContent = `${full.charAt(0)}.`;
    }
  }

  /** The score bug with the added-time board when it is up (it hangs off the bug's right edge). */
  private bugRect(): Rect | null {
    const sb = this.rectOf('.scorebug', false);
    const bd = this.board.classList.contains('on') ? this.rectOf('.sb-board', false) : null;
    if (!sb || !bd) return sb;
    return { l: Math.min(sb.l, bd.l), t: Math.min(sb.t, bd.t), r: Math.max(sb.r, bd.r), b: Math.max(sb.b, bd.b) };
  }

  /**
   * Football Moments: the clock counts DOWN. `seconds` left takes over the score bug's clock cell with a
   * countdown look ("0:20" on ink; red and pulsing from 5 s), and setClock is ignored meanwhile, so the session
   * can keep its match-clock path as it is. null puts the match clock back (the next setClock redraws it).
   */
  setCountdown(seconds: number | null): void {
    if (seconds === null) {
      this.countdown = null;
      this.clock.classList.remove('count', 'low');
      return;
    }
    const s = Math.max(0, Math.ceil(seconds));
    this.countdown = s;
    this.clock.classList.add('count');
    if (this.countdownLabel !== null) {
      // A drill with no clock to beat: the step it is, never a ticking count.
      this.clock.classList.remove('low');
      if (this.clock.textContent !== this.countdownLabel) this.clock.textContent = this.countdownLabel;
      return;
    }
    this.clock.classList.toggle('low', s <= 5);
    this.clock.innerHTML = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  /**
   * Big chunky centre text. Bookings (kind "card") and power-up calls (kind "power") are a compact plate up
   * top instead (see placeBanner); the power plate also keeps off the goal mouth in shot.
   * The subtitle is formatted (see ui/text.ts): a score written "1 - 0" gets the score divider, and facts
   * split with " · " get the divider element, so the session can keep writing them the plain way.
   */
  show(title: string, sub = '', kind = '', seconds = 2.2): void {
    if (this.retitle) {
      const r = this.retitle({ title, sub, kind, seconds });
      if (!r) return;
      ({ title, sub, kind, seconds } = r);
    }
    // Key names in the words ("move with WASD / ARROWS") follow the player's own bindings.
    sub = remapKeys(sub, currentDevice());
    this.bannerCard = /(^|\s)card(\s|$)/.test(kind);
    this.bannerPower = /(^|\s)power(\s|$)/.test(kind);
    // Scenario verdicts also use the goal colour. Only a scored goal gets the corner score flash.
    this.bannerGoal = /^GOAL!/.test(title) && /(^|\s)goal(\s|$)/.test(kind);
    // A tag ("SECOND HALF"): the scorer's plate's place, hung off the score bug, never across the kick-off taker.
    this.bannerTag = /(^|\s)tag(\s|$)/.test(kind);
    this.banner.className = `hud-banner on ${kind}${this.bannerGoal ? ' score-flash' : ''}${this.bannerCard || this.bannerPower || this.bannerHung ? ' plate' : ''}`;
    // Letters fly in one by one, grouped by word so a long title can wrap between words; past 12 characters the
    // letters also shrink (--bn-k), so "MOMENT COMPLETE" fits where "GOAL!" was measured (see .bn-title i).
    let n = 0;
    const words = title.split(' ').map((w) => `<span class="bn-w">${[...w].map((ch) => `<i style="animation-delay:${n++ * 45}ms">${escHtml(ch)}</i>`).join('')}</span>`);
    this.banner.innerHTML = `<div class="bn-title">${words.join('')}</div>${sub ? `<div class="bn-sub">${sepsOfText(sub)}</div>` : ''}`;
    this.banner.style.setProperty('--bn-k', String(Math.min(1, 12 / Math.max(1, title.replace(/\s+/g, '').length + (words.length - 1) * 0.5))));
    this.bannerTimer = seconds;
    const st = this.banner.style;
    st.left = st.top = st.width = '';
    // A centred banner (HALF TIME, FULL TIME) on a short frame: its title reaches up into the score bug and the pause
    // buttons, so its centring box starts lower, just enough to clear them.
    this.bannerShift = 0;
    this.clearBanner();
    if (this.bannerCard) {
      // The card says it all: the FOUL! flag goes, and no set-piece hint pops up over the close-up.
      this.toast.classList.remove('on');
      this.toastTimer = 0;
      this.suppressHints(seconds);
    } else if (this.bannerHung) {
      // So does the goal plate, which hangs off the score bug just where the flag does.
      this.toast.classList.remove('on');
      this.toastTimer = 0;
    }
    if (this.bannerCard || this.bannerPower || this.bannerHung) {
      // (A plate hung off the score bug follows it from the next frame: the bug grows under it at a goal.)
      this.bannerPlaceT = this.bannerHung ? 0 : 0.25;
      this.placeBanner();
    }
    // The ticker moves off any banner now, not at its next look round.
    if (this.cmLine) this.placeTicker();
  }

  // ---------------------------------------------------------------- blitz: the power-up slot

  /** Blitz mode shows the power-up slot under the score bug; classic football hides it. */
  setBlitz(on: boolean): void {
    this.power.hidden = !on;
    this.root.classList.toggle('blitz', on);
    if (!on) {
      this.powerKind = null;
      this.powerActive = null;
    }
    this.drawPower();
  }

  /** How far (px of `top`) a centred banner's box was moved down to clear the top cluster. */
  private bannerShift = 0;

  /**
   * A centred banner (HALF TIME, the line-up's title card) on a short frame: its title reaches up into the score bug,
   * the pause buttons or the corner picture, so its centring box starts lower, just enough to clear them. Looked at
   * again while it is up (the coin toss's picture comes up after the title card).
   */
  private clearBanner(): void {
    if (this.bannerCard || this.bannerPower || this.bannerHung || /(^|\s)(foul|goal)(\s|$)/.test(this.banner.className)) return;
    const t = this.banner.querySelector?.('.bn-title')?.getBoundingClientRect();
    if (!t || !(t.height > 0)) return;
    const base = t.top - this.bannerShift / 2;
    const need = this.hintTopY(t.left, t.right) - base;
    const shift = need > 0 ? Math.round(2 * need) : 0;
    if (shift === this.bannerShift) return;
    this.bannerShift = shift;
    this.banner.style.top = shift ? `${shift}px` : '';
  }

  /** The device in hand: the slot's key hint reads E (keyboard), Y (gamepad) or POWER (the touch button). */
  setPowerDevice(dev: 'keyboard' | 'touch' | 'gamepad'): void {
    if (dev === this.powerDevice) return;
    this.powerDevice = dev;
    this.drawPower();
  }

  /** The power-up the human side holds (Match.heldPower, every frame). A new one pulses the slot. */
  setHeldPower(kind: PowerUpKind | null): void {
    if (kind === this.powerKind) return;
    this.powerKind = kind;
    this.drawPower();
    if (kind) {
      this.power.classList.remove('got');
      void this.power.offsetWidth;
      this.power.classList.add('got');
    }
  }

  /** The human side used a power-up: banner, and the slot counts it down (the sim's duration, or POWER_SECONDS). */
  powerUsed(kind: PowerUpKind, seconds = POWER_SECONDS[kind]): void {
    const total = Math.max(0.5, seconds);
    this.powerActive = { kind, left: total, total };
    this.powerKind = null;
    this.drawPower();
    this.show(POWER_INFO[kind].banner, '', 'power small', POWER_BANNER_S);
    this.banner.style.setProperty('--pw', POWER_INFO[kind].color);
  }

  /** The active power-up wore off (the sim's powerupEnd; the ring would run out on its own otherwise). */
  powerEnded(): void {
    if (!this.powerActive) return;
    this.powerActive = null;
    this.drawPower();
  }

  /** What the slot shows and the countdown left (tests / debugging). */
  get powerState(): { held: PowerUpKind | null; active: PowerUpKind | null; left: number } {
    return { held: this.powerKind, active: this.powerActive?.kind ?? null, left: this.powerActive?.left ?? 0 };
  }

  /** The slot hangs under the score bug (whose height changes with booking chips and the clock row wrapping). */
  private placePower(): void {
    if (this.power.hidden) return;
    const sb = this.rectOf('.scorebug', false);
    if (!sb) return;
    const top = `${Math.round(sb.b + 6)}px`;
    if (this.power.style.top !== top) this.power.style.top = top;
  }

  private drawPower(): void {
    this.placePower();
    const el = this.power;
    const a = this.powerActive;
    const kind = a?.kind ?? this.powerKind;
    const info = kind ? POWER_INFO[kind] : null;
    el.classList.toggle('on', !el.hidden);
    el.classList.toggle('has', !!this.powerKind && !a);
    el.classList.toggle('active', !!a);
    el.dataset.kind = kind ?? '';
    el.style.setProperty('--pw', info?.color ?? 'rgba(255,255,255,0.35)');
    this.powerIcon.innerHTML = pixelIcon(info?.icon ?? 'bolt', 'currentColor', 2.4);
    this.powerName.textContent = a ? info!.name.toUpperCase() : info ? info.name.toUpperCase() : 'NO POWER UP';
    this.powerKey.textContent = actionKey('power', this.powerDevice);
    this.powerKey.hidden = !this.powerKind || !!a;
    const ring = this.powerRing;
    const C = 2 * Math.PI * 17;
    ring.style.strokeDasharray = `${C}`;
    ring.style.strokeDashoffset = `${a ? C * (1 - Math.max(0, Math.min(1, a.left / a.total))) : C}`;
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
   * Booking / power-up plate: in the top band beside the score bug when it fits there (landscape), else right
   * under the top cluster, centred (portrait). Either way the top ~20% of the screen, never across the players
   * the card close-up frames in the middle of the lens. A power-up plate also takes whichever of the two
   * keeps off the goal mouth in shot (a corner, a shot on the way).
   */
  private placeBanner(): void {
    if (!this.bannerCard && !this.bannerPower && !this.bannerHung) return;
    const b = this.banner;
    const st = b.style;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const g = W < 480 ? 8 : 12;
    const sb = this.bugRect();
    if (!sb) return;
    const pause = this.topRight();
    if (this.bannerHung) {
      // A narrow plate attached to the score bug leaves the celebration's centre and skip control clear.
      // The bug already includes the device's safe-area insets, even on a notched landscape phone.
      st.left = `${Math.round(sb.l)}px`;
      const cornerWidth = W > H ? Math.min(240, W * 0.32) : 240;
      st.width = `${Math.round(Math.min(cornerWidth, W - sb.l - Math.max(g, W - (pause?.r ?? W))))}px`;
      st.top = `${Math.round(sb.b + 8)}px`;
      // SECOND HALF on a phone on its side: hung under a tall bug it would reach down onto the resting thumbstick (the
      // touch controls are up for the kick-off); the clock already says which half it is, so the tag gives way.
      if (this.bannerTag) {
        const stick = this.rectOf('#ui > .touch:not(.hidden) .touch-base', false);
        const ph = b.offsetHeight;
        if (stick && ph > 0 && stick.l < sb.l + b.offsetWidth + 6 && stick.r > sb.l - 6 && stick.t < sb.b + 8 + ph + 6) {
          this.bannerTimer = 0;
          b.classList.remove('on');
        }
      }
      return;
    }
    type Cand = { l: number; w: number; t: number };
    const apply = (c: Cand) => {
      st.left = `${Math.round(c.l)}px`;
      st.width = `${Math.round(c.w)}px`;
      st.top = `${Math.round(c.t)}px`;
    };
    const rectAfter = (c: Cand): Rect => {
      apply(c);
      return { l: c.l, t: c.t, r: c.l + c.w, b: c.t + b.offsetHeight };
    };
    const cands: { c: Cand; r: Rect }[] = [];
    const bl = sb.r + g;
    const br = (pause ? pause.l : W) - g;
    if (br - bl >= 300) {
      const c = { l: bl, w: br - bl, t: sb.t };
      const r = rectAfter(c);
      if (r.b - r.t <= Math.max(H * 0.2 - sb.t, 64)) cands.push({ c, r });
    }
    let top = sb.b;
    for (const sel of ['.so-track', '.hud-toast.on', '.hud-power.on']) {
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
    const under = { l: g, w: right - g, t: top + 8 };
    cands.push({ c: under, r: rectAfter(under) });
    // Bookings: the first that fits (as before). Power-ups: the first clear of the goal mouth, else the least over it.
    const goals = this.bannerPower ? this.goalRects() : [];
    const cost = (r: Rect) => goals.reduce((c, gr) => c + overlapArea(r, gr, 10), 0);
    const pick = cands.find((x) => cost(x.r) === 0) ?? [...cands].sort((a, c) => cost(a.r) - cost(c.r))[0];
    apply(pick.c);
  }

  /** The booking / power-up plate's box while it is up (the ticker keeps clear of it). */
  private cardBannerRect(): Rect | null {
    return (this.bannerCard || this.bannerPower || this.bannerHung) && this.bannerTimer > 0 ? this.rectOf('.hud-banner.plate', false) : null;
  }

  /**
   * Event flag ("CORNER", "FOUL!"): hangs off the bottom of the score bug (under any booking chips or the
   * shootout tracker), at the top edge where it never covers players in the box.
   */
  toastMsg(text: string, seconds = 1.4): void {
    // Plain words from the session ("SUB · X ON · Y OFF"): escaped, the separators drawn as dividers.
    this.toast.innerHTML = sepsOfText(text);
    this.placeToast();
    this.toast.classList.remove('on');
    void this.toast.offsetWidth;
    this.toast.classList.add('on');
    this.toastTimer = seconds;
    this.toastPlaceT = TOAST_PLACE_S;
    // The ticker moves off it now, not at its next look round.
    if (this.cmLine) this.placeTicker();
  }

  /** Under the score bug (and its booking chips / the shootout tracker); below the portrait minimap if they'd meet. */
  private placeToast(): void {
    const sb = this.rectOf('.scorebug', false);
    if (!sb) return;
    let top = sb.b;
    const so = this.rectOf('.so-track', false);
    if (so) top = Math.max(top, so.b);
    const pw = this.rectOf('.hud-power.on', false);
    if (pw) top = Math.max(top, pw.b);
    // The goal plate hangs off the score bug just here: the flag goes under it. (A power-up plate keeps clear of the
    // flag itself, and a booking plate takes the flag away.)
    const plate = this.bannerTimer > 0 && this.bannerHung ? this.rectOf('.hud-banner.on.plate', false) : null;
    if (plate && plate.t < window.innerHeight * 0.4 && plate.l < sb.r) top = Math.max(top, plate.b);
    top += 8;
    const w = this.toast.offsetWidth;
    const h = this.toast.offsetHeight;
    const radar = this.rectOf('.hud-radar', false);
    if (radar && radar.t < window.innerHeight * 0.4 && radar.l < sb.l + w && radar.b > top && radar.t < top + h) top = radar.b + 8;
    // A phone on its side with a tall bug (bookings, a live goal): under it the flag would reach down onto the resting
    // thumbstick, so it hangs beside the bug instead, level with its top row (the ticker's band starts after it).
    let left = sb.l;
    const stick = this.rectOf('#ui > .touch:not(.hidden) .touch-base', false);
    if (stick && stick.l < sb.l + w + 6 && stick.r > sb.l - 6 && stick.t < top + h + 6) {
      left = sb.r + 8;
      top = (this.rectOf('.scorebug .sb-clock', false) ?? sb).t;
    }
    this.toast.style.left = `${Math.round(left)}px`;
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
    // (Its pop swells it about a third: that much margin from the frame's edges.)
    const mx = g + w * 0.18;
    const my = g + h * 0.18;
    const box = (cx: number, t: number): Rect => {
      const l = Math.max(mx, Math.min(W - mx - w, cx - w / 2));
      const tt = Math.max(my, Math.min(H - my - h, t));
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
    // Beside him, either side, level with his body (a phone on its side has little room over his head).
    if (f && P && this.timingPlayer >= 0 && this.timingPlayer < 22) {
      const o = this.timingPlayer * PF;
      let mid: { x: number; y: number } | null = null;
      try {
        mid = P(f[o], 0.9 + (f[o + 2] || 0), f[o + 1]);
      } catch {
        mid = null;
      }
      if (mid && mid.x > 0 && mid.x < W && mid.y > 0 && mid.y < H) {
        opts.push(box(mid.x + w / 2 + 26, mid.y - h / 2), box(mid.x - w / 2 - 26, mid.y - h / 2));
      }
    }
    const goals = this.goalRects();
    const solid = [
      '#ui > .touch:not(.hidden) .touch-btns', '#ui > .touch:not(.hidden) .touch-base', '.scorebug', '.sb-board.on', '.hud-pause', '.hud-cam', '.hud-toast.on',
      '.hud-tip.on', '.hud-hint.on', '.hud-kick.on', '.hud-cm.on:not(.blocked)', '.hud-radar', '.pitch-trainer .trainer-card', '.pz-chant.on', '.skill-hud .sk-tell.on', '.hud-replay',
    ]
      .map((sel) => this.rectOf(sel, false))
      .filter((q): q is Rect => !!q);
    // (Never over the shooter himself: his boots, body and head.)
    const body: { x: number; y: number }[] = [];
    if (f && P && this.timingPlayer >= 0 && this.timingPlayer < 22) {
      const o = this.timingPlayer * PF;
      for (const y of [0.2, 0.9, 1.6]) {
        try {
          const q = P(f[o], y + (f[o + 2] || 0), f[o + 1]);
          if (q) body.push(q);
        } catch {
          /* behind the lens */
        }
      }
    }
    const cost = (r: Rect) =>
      goals.reduce((c, gr) => c + overlapArea(r, gr, 10) * 4, 0) + solid.reduce((c, q) => c + overlapArea(r, q, 4), 0) +
      body.filter((q) => q.x >= r.l - 6 && q.x <= r.r + 6 && q.y >= r.t - 6 && q.y <= r.b + 6).length * 1e6;
    const pick = opts.find((r) => cost(r) === 0);
    // Nowhere clear of the HUD, the goal mouth and the shooter: the word gives way this time (never on top of
    // anything; the strike itself still says how it went).
    if (!pick) {
      this.timingT = 0;
      el.classList.remove('on');
      return;
    }
    el.style.left = `${Math.round(pick.l)}px`;
    el.style.top = `${Math.round(pick.t)}px`;
  }

  /**
   * The set-piece / penalty / keeper's-ball hint: a coach card (ui/coach.ts restartCue and friends, already in
   * the player's own keys), or plain words, which become the same card (cueOfText: "SPACE to kick off" reads
   * [SPACE] Kick off). Plain words name the default keys unless `bound`: the player's own bindings replace them.
   */
  setHint(hint: string | CoachCue | null, bound = false): void {
    this.hintAsked = hint;
    this.hintBound = bound;
    const dev = currentDevice();
    const cue = typeof hint === 'string' ? (hint ? cueOfText(bound ? hint : remapKeys(hint, dev), dev) : null) : hint;
    let text = cueKey(cue && cue.actions.length ? cue : null);
    this.hintWant = text;
    // The player acted on this hint (see buttons()): it stays down until the session asks for another one.
    if (!text) this.hintDone = '';
    if (text && text === this.hintDone) text = '';
    if (this.hintHold > 0) text = '';
    const on = text.length > 0;
    // Off: keep the old words while it fades out (an empty box shrinking looks broken).
    if (on && cue && this.hintText !== text) {
      this.hintText = text;
      fillCoach(this.hintParts, cue);
    }
    const fresh = on && !this.hint.classList.contains('on');
    if (fresh) {
      // Decide the slot before it fades in, so it never flashes over the taker or the goal first.
      this.hintT = 0;
      this.placeHint(true);
    }
    this.hint.classList.toggle('on', on);
    // The ticker moves off it now, not at its next look round.
    if (fresh && this.cmLine) this.placeTicker();
  }

  /**
   * The action buttons (PASS / SHOOT / THROUGH, any device), every frame. Pressing one while a set-piece hint
   * is up means the player is taking the kick: the hint goes at once, rather than lingering through the run-up
   * and the wait for the box runners into open play.
   */
  buttons(down: boolean): void {
    if (down && !this.btnDown && this.hint.classList.contains('on') && this.hintWant) {
      this.hintDone = this.hintWant;
      this.setHint(this.hintAsked, this.hintBound);
    }
    this.btnDown = down;
  }

  /**
   * Keep set-piece hints hidden for `seconds` (the render side calls this for the card close-up; every booking
   * banner does it too), whatever setHint is asked meanwhile. The last asked-for hint returns afterwards.
   */
  suppressHints(seconds: number): void {
    this.hintHold = Math.max(this.hintHold, seconds);
    this.setHint(this.hintAsked, this.hintBound);
  }

  /**
   * The kick-off prompt (CrazyGames' review: "At the beginning of the match, you can show that players need to press
   * Space"): while the match waits for OUR kick-off (the first, the second half's, after a goal), one big line in the
   * middle of the picture, "PRESS SPACE TO KICK OFF", with the player's own binding (`key`, from the session: the bound
   * key, the pad button, or the touch button's label, with "TAP" for `verb` on touch). It sits right above the taker's
   * name tag, or right under his feet when the top cluster leaves no room there: never over him or the ball. null:
   * gone at once (the ball is played, or the picture is not the live one). The session calls it every frame.
   */
  setKickoff(p: { verb: string; key: string; taker: number; top: number } | null): void {
    if (!p) {
      this.kickAt = null;
      if (this.kick.classList.contains('on')) {
        this.kick.classList.remove('on');
        // The ticker may have the band back now.
        if (this.cmLine) this.placeTicker();
      }
      return;
    }
    if (this.kickVerb.textContent !== p.verb) this.kickVerb.textContent = p.verb;
    if (this.kickKey.textContent !== p.key) this.kickKey.textContent = p.key;
    this.kickAt = { taker: p.taker, top: p.top };
    const fresh = !this.kick.classList.contains('on');
    // (Placed before it shows, so it never flashes over the taker first; then every frame, as the camera settles.)
    this.placeKick();
    if (fresh) {
      this.kick.classList.add('on');
      if (this.cmLine) this.placeTicker();
    }
  }

  /** The kick-off prompt's words while it is up ('' when none): tests and the dev hooks. */
  get kickoffShown(): string {
    return this.kick.classList.contains('on') ? `${this.kickVerb.textContent} ${this.kickKey.textContent} TO KICK OFF` : '';
  }

  /**
   * Where the kick-off prompt goes: centred across the screen, its bottom just above the taker's name tag (or the ball,
   * whichever is higher on screen); when that would run into what hangs off the top edge (the score bug, the pause
   * and camera buttons, the event flag, the chant), its top just under the taker's feet and the ball instead, above
   * the minimap and the controls. Neither fitting (a tiny frame): the one that runs over the least.
   */
  private placeKick(): void {
    const at = this.kickAt;
    const el = this.kick;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const l = (W - w) / 2;
    const r = l + w;
    const across = (q: Rect | null): q is Rect => !!q && q.r > l - 4 && q.l < r + 4;
    let top = 6;
    for (const sel of ['.scorebug', '.sb-board.on', '.so-track', '.hud-toast.on', '.hud-power.on', '.hud-pause', '.hud-cam', '.hud-qsub.on', '.pz-chant.on', '.hud-banner.on.plate', '.side-cam.on']) {
      const q = this.rectOf(sel, sel === '.side-cam.on');
      if (across(q) && q.t < H * 0.45) top = Math.max(top, q.b + 6);
    }
    let bottom = H - 6;
    const lowSels = ['.hud-chip', '#ui > .touch:not(.hidden) .touch-btns', '#ui > .touch:not(.hidden) .touch-base', '.hud-hint.on'];
    if (!this.radarHidden && !this.root.classList.contains('dead')) lowSels.push('.hud-radar');
    for (const sel of lowSels) {
      const q = this.rectOf(sel, false);
      if (across(q) && q.b > H * 0.55) bottom = Math.min(bottom, q.t - 6);
    }
    // The taker's name tag top, his feet and the ball, on screen.
    const f = this.lastFrame;
    const P = this.project;
    let hi = H * 0.42;
    let lo = H * 0.58;
    if (f && P && at && at.taker >= 0 && at.taker < 22) {
      const o = at.taker * PF;
      let tag: { x: number; y: number } | null = null;
      let feet: { x: number; y: number } | null = null;
      let ball: { x: number; y: number } | null = null;
      try {
        tag = P(f[o], at.top + (f[o + 2] || 0), f[o + 1]);
        feet = P(f[o], 0, f[o + 1]);
        ball = P(f[BALL_OFS], f[BALL_OFS + 1], f[BALL_OFS + 2]);
      } catch {
        tag = feet = ball = null;
      }
      const ys = [tag, feet, ball].filter((q): q is { x: number; y: number } => !!q).map((q) => q.y);
      if (ys.length) {
        hi = Math.min(...ys);
        lo = Math.max(...ys);
      }
    }
    const gap = H < 420 ? 6 : 12;
    const above = hi - gap - h;
    const below = lo + gap;
    let t: number;
    if (above >= top) t = above;
    else if (below + h <= bottom) t = below;
    // (Never onto the HUD itself: held at the edge of the clear band, over the top of the name tag or the boots.)
    else t = top - above <= below + h - bottom ? top : bottom - h;
    t = Math.round(Math.max(0, Math.min(H - h, t)));
    const px = `${t}px`;
    if (el.style.top !== px) el.style.top = px;
  }

  /** Where the camera puts world points on screen; enables keep-clear placement of the ticker and hints. */
  setProjector(fn: Projector | null): void {
    this.project = fn;
  }

  /** The commentary ticker switch (Settings > COMMENTARY). Text only: there is no spoken commentary. */
  setCommentary(text: boolean): void {
    this.cmTextOn = text;
    if (!text) this.hideLine();
  }

  /** Settings > COMMENTARY as it stands (the chant caption follows it: game/matchSession.ts). */
  get commentaryOn(): boolean {
    return this.cmTextOn;
  }

  /** Colour-blind aid (Settings > COLOUR-BLIND): shape cues on the minimap as well as the kit colours. */
  setColorblind(on: boolean): void {
    this.colorblind = on;
    this.root.classList.toggle('cb', on);
  }

  /** The match the fades read (fadeTeam: its men) before its first event has come through commentary(). */
  setMatch(m: Match): void {
    this.m = m;
  }

  /** Event hook (named for the ticker it feeds): the session forwards every match event here (before its own handling). */
  commentary(e: MatchEvent, m: Match): void {
    this.m = m;
    try {
      this.onEvent?.(e, m);
    } catch {
      // A counting hook must never break the match loop.
    }
    try {
      // Blitz: the slot follows the human side's pickups (Match.heldPower is synced every frame as well).
      if (e.type === 'powerupTaken' || e.type === 'powerupUsed' || e.type === 'powerupEnd') {
        if (this.humanSide >= 0 && e.side === this.humanSide) {
          if (e.type === 'powerupTaken') this.setHeldPower(e.kind);
          else if (e.type === 'powerupUsed') this.powerUsed(e.kind, this.powerSeconds(m, e.kind));
          else this.powerEnded();
        }
      }
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
      if (!this.cmTextOn) return;
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

  /** How long the sim says a power-up runs (Match.powerSeconds / POWER_DURATION, if it has them), else POWER_SECONDS. */
  private powerSeconds(m: Match, kind: PowerUpKind): number {
    const x = m as unknown as { powerSeconds?: Partial<Record<PowerUpKind, number>>; POWER_DURATION?: Partial<Record<PowerUpKind, number>> };
    const v = x.powerSeconds?.[kind] ?? x.POWER_DURATION?.[kind];
    return typeof v === 'number' && v > 0 ? v : POWER_SECONDS[kind];
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

  /** The top-right buttons (pause and the camera beside it) as one box: where the top band ends. */
  private topRight(): Rect | null {
    const p = this.rectOf('.hud-pause', false);
    const c = this.rectOf('.hud-cam', false);
    if (!p || !c) return p ?? c;
    return { l: Math.min(p.l, c.l), t: Math.min(p.t, c.t), r: Math.max(p.r, c.r), b: Math.max(p.b, c.b) };
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
    const sb = this.bugRect();
    const pause = this.topRight();
    if (!sb) return;
    // Its one-line size first (the whole frame's width, measured from the left edge: the words wrap, so where it
    // sits now would narrow it): a band narrower than the line takes it on two lines (boxOf), never an ellipsis.
    const was = { left: this.cm.style.left, max: this.cm.style.maxWidth };
    this.cm.style.left = '0px';
    this.cm.style.maxWidth = `${Math.round(W - g * 2)}px`;
    const h = this.cm.offsetHeight || 34;
    const card = this.cardBannerRect();
    const bands: { k: string; l: number; r: number; t: number }[] = [];
    // 1) Top band between the score bug and the pause button (unless the booking plate is up there); after the event
    // flag when it hangs beside the bug (placeToast).
    const flag = this.toastTimer > 0 ? this.rectOf('.hud-toast.on', false) : null;
    const bl = (flag && flag.t < sb.b && flag.l >= sb.r - 2 ? flag.r : sb.r) + g;
    let br = (pause ? pause.l : W) - g;
    // The quick-sub card up in that top row (a landscape phone, ui/quickSub.ts): the band ends at it.
    const qsRow = this.rectOf('.hud-qsub.on', false);
    if (qsRow && qsRow.t < sb.b) br = Math.min(br, qsRow.l - g);
    const topRow = this.rectOf('.scorebug .sb-clock', false) ?? sb;
    if (br - bl >= 300 && !(card && card.t < sb.b)) bands.push({ k: 'top', l: bl, r: br, t: topRow.t });
    // 2) Under the top cluster (score bug + chips, shootout tracker, flag, radar in portrait, hint, tip, plate).
    const setPiece = this.setPiece();
    let under = sb.b;
    for (const sel of ['.so-track', '.hud-toast.on', '.hud-power.on', '.hud-hint.on:not(.low)', '.hud-tip.on', '.hud-radar', '.hud-banner.on.goal.plate', '.hud-qsub.on']) {
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
    // The trainer's controls bar sits just above the minimap (ui/trainer.ts): the line goes above it, never on it.
    const bar = this.rectOf('.pitch-trainer .trainer-card');
    if (bar && bar.t > H * 0.5) low = Math.min(low, bar.t - 8);
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
    // (Unrounded: a box held to a width rounded down by a fraction of a pixel wraps its last word.)
    const natural = this.cm.getBoundingClientRect().width || this.cm.offsetWidth;
    // Its height at a band's width (two lines where the band is narrower than the line), measured once per width.
    const tall = new Map<number, number>();
    const heightAt = (w: number): number => {
      if (w >= natural) return h;
      const k = Math.ceil(w);
      let v = tall.get(k);
      if (v === undefined) {
        this.cm.style.maxWidth = `${k}px`;
        v = this.cm.offsetHeight || h;
        tall.set(k, v);
      }
      return v;
    };
    const goals = this.celebrating() ? [] : this.goalRects();
    const ball = this.ballOnScreen();
    // The touch controls: never under the caption, whichever band it is in. Nor a big centred banner (HALF TIME,
    // the title card, a verdict) while it is up: the line takes another band, or waits.
    const big = this.bannerTimer > 0 && this.banner.classList.contains('on') && !this.banner.classList.contains('plate')
      ? ['.bn-title', '.bn-sub', '.bn-tags'].map((sel) => this.rectOf(`.hud-banner.on ${sel}`, false)) : [];
    // (Nor the kick-off prompt, the one thing to read while it is up, nor the chant's caption under the pause button.)
    const kick = this.kick.classList.contains('on') ? this.rectOf('.hud-kick.on', false) : null;
    const chant = this.rectOf('.pz-chant.on', false);
    // Each touch button by its own box too: the landscape phone's top button (CROSS) sits above the buttons' block.
    const each = [...this.root.ownerDocument.querySelectorAll<HTMLElement>('#ui > .touch:not(.hidden) .tb')]
      .map((el) => el.getBoundingClientRect()).filter((q) => q.width > 0 && q.height > 0)
      .map((q): Rect => ({ l: q.left, t: q.top, r: q.right, b: q.bottom }));
    // (And the booking, power-up or GOAL plate wherever it hangs: on a short frame the goal plate's tags reach the
    // lower third.)
    // (The minimap's place too, faded or not: on a short frame the band under the top cluster reaches down to it.)
    const map = radar && radar.t > H * 0.5 ? radar : null;
    const solid = [btns, stick, kick, chant, card, map, ...each, ...big].filter((q): q is Rect => !!q);
    // `pad` px round the goal mouth: a little margin, as the broadcast camera pans the goal across the screen
    // between two placements.
    const covers = (r: Rect, pad = 6) => goals.some((gr) => overlapArea(r, gr, pad) > 0) || solid.some((q) => overlapArea(r, q, 4) > 0);
    const near = (r: Rect) => !!ball && distTo(ball, r) <= 80;
    const boxes = new Map<string, Rect>();
    const boxOf = (b: { k: string; l: number; r: number; t: number }): Rect => {
      const got = boxes.get(b.k);
      if (got) return got;
      const w = Math.min(natural, b.r - b.l);
      // Two lines grow down from a top band, and up from a bottom one (its foot stays where the one line's was).
      const hb = heightAt(w);
      const t = b.k === 'top' || b.k === 'under' ? b.t : b.t + h - hb;
      const at = (left: number): Rect => ({ l: left, r: left + w, t, b: t + hb });
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
    if (!pick) {
      this.cm.style.left = was.left;
      this.cm.style.maxWidth = was.max;
      return;
    }
    // A dead ball with the only band left sitting on the taker: better no caption than one over him.
    if (setPiece && clear(pick) < 50) {
      this.setTickerBlocked(true);
      return;
    }
    // Stay put unless the ball (or the goal) really is in the way (no jitter between two bands).
    const cur = pref.find((b) => b.k === this.cmSlot);
    if (cur && cur !== pick && clear(cur) > 40 && (!onGoal(cur) || onGoal(pick))) pick = cur;
    const box = boxOf(pick);
    // (The box's own width: the line wraps exactly where it was measured to; a whole line gets its pixel back.)
    this.cm.style.maxWidth = `${box.r - box.l >= natural ? Math.ceil(natural) + 1 : Math.ceil(box.r - box.l)}px`;
    this.cm.style.left = `${Math.round(box.l)}px`;
    this.cm.style.top = `${Math.round(box.t)}px`;
    this.cm.dataset.slot = pick.k;
    this.cmSlot = pick.k;
    this.cmX = Math.round(box.l);
    this.cmBox = { l: Math.round(box.l), t: Math.round(box.t), r: Math.round(box.l) + (box.r - box.l), b: Math.round(box.b) };
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

  /** The ticker sits in the top band beside the score bug, and the bug (with its board) now reaches under it. */
  private bugGrewUnderTicker(): boolean {
    const box = this.cmBox;
    if (!box || this.cmBlocked || this.cmSlot !== 'top') return false;
    const sb = this.bugRect();
    return !!sb && overlapArea(box, sb, 2) > 0;
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
    for (const sel of ['.scorebug', '.sb-board.on', '.so-track', '.hud-toast.on', '.hud-power.on', '.hud-pause', '.hud-cam', '.hud-qsub.on']) take(this.rectOf(sel, false));
    // (The corner picture, when it shows: a side show under the pause button.)
    take(this.rectOf('.side-cam.on'));
    // The minimap only while it shows (it is off for set pieces).
    if (!this.radarHidden && !this.root.classList.contains('dead')) take(this.rectOf('.hud-radar'));
    // Landscape: a little lower than the top row, which belongs to the ticker and the event flag.
    return Math.round(Math.max(y + 10, W > H ? H * 0.16 : 0));
  }

  /**
   * Set-piece hint: always in the bottom band, as every control the game shows is (CrazyGames' review asked for the
   * controls at the bottom; the opening kick-off's hint up top centre over the stands was what they flagged again).
   * Slots, in order of preference: the bottom centre (where the trainer's controls bar sits in play: just above the
   * minimap, clear of the player chip and the touch controls), then the bottom band's two halves and the whole band
   * (full width above the controls on portrait phones). It takes the one that covers least of what matters: the goal
   * mouth being aimed at first, then the taker (the ball): a throw-in on the near touchline under the centre slot moves
   * it to a side. (Our kick-off has its own prompt in the middle instead: setKickoff.)
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
    const goals = this.goalRects();
    let ll = g;
    let lr = W - g;
    let bottom = 14;
    const chip = this.rectOf('.hud-chip');
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
    // The minimap's place, whether it shows now or not (it fades back in for play, or as the HUD comes live under a
    // hint placed while it was off): the hint stays above it, as the trainer's bar does. (A shootout drops it: null.)
    const radar = this.rectOf('.hud-radar', false);
    // Each slot sits above whatever is under it: the minimap (bottom centre on a landscape screen), the player chip.
    const lowSlot = (k: string, l: number, maxW: number, align: 'l' | 'c' | 'r') => {
      const a = size(maxW);
      const x = align === 'r' ? l + maxW - a.w : align === 'c' ? Math.max(ll, Math.min(lr - a.w, (W - a.w) / 2)) : l;
      let bt = bottom;
      for (const q of [radar, chip]) if (q && q.t > H * 0.5 && q.l < x + a.w && q.r > x) bt = Math.max(bt, H - q.t + 8);
      slots.push({ k, low: true, r: { l: x, r: x + a.w, t: H - bt - a.h, b: H - bt }, maxW, bottom: bt });
    };
    lowSlot('lowC', ll, lr - ll, 'c');
    const lowHalf = (lr - ll) / 2 - g / 2;
    if (lowHalf >= 280) {
      lowSlot('lowL', ll, lowHalf, 'l');
      lowSlot('lowR', lr - lowHalf, lowHalf, 'r');
    }
    lowSlot('low', ll, lr - ll, 'l');
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
      }
      return c;
    };
    let pick: Slot;
    if (!this.project) {
      // No projector: the bottom centre.
      pick = slots[0];
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

  /** The minimap stays up but goes see-through (play is under it, or a set piece is coming in over it). */
  setRadarDim(dim: boolean): void {
    this.root.classList.toggle('radar-dim', dim);
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
    this.fitBookingNames();
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

  /** The first-match tutorial tip (top centre), a coach card in the player's own keys. null hides it. */
  setTip(cue: CoachCue | null): void {
    const key = cueKey(cue);
    if (this.tip.dataset.t === key) return;
    this.tip.dataset.t = key;
    // Off: keep the old words while it fades out.
    if (cue) fillCoach(this.tipParts, cue);
    this.tip.classList.toggle('on', !!cue);
  }

  /** A goal celebration that a tap skips: the replay's skip line on its own (no REPLAY badge). */
  setSkippable(on: boolean): void {
    // (Low and centred then: the top setReplay gave it must not hold it up there.)
    if (on) this.replay.style.top = '';
    if (this.replay.classList.contains('skip-only') !== on) this.replay.classList.toggle('skip-only', on);
  }

  /** `caption`: an incident clip's one line under the badge ("FOUL BY 5 CINDER"); none on a goal replay. */
  setReplay(on: boolean, label = 'REPLAY', caption = ''): void {
    this.replay.classList.remove('skip-only');
    const badge = this.replay.querySelector('b');
    if (badge) badge.textContent = on ? label : 'REPLAY';
    const cap = this.replay.querySelector('.rp-cap');
    if (cap) cap.textContent = on ? caption : '';
    if (on) this.placeReplay();
    this.replay.classList.toggle('on', on);
    this.root.classList.toggle('replaying', on);
    // A decision/result has its own replay badge; its earlier announcement must not cover the footage.
    // Replays are silent on the ticker: nothing queued comes back afterwards either.
    if (on) {
      this.bannerTimer = 0;
      this.banner?.classList.remove('on');
      this.hideLine();
    }
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

  /**
   * The chant's caption and the touch controls (each button and the thumbstick's resting base) as well: see-through
   * while the ball or our man is drawn under them, so a phone on its side never hides the play under its own thumbs'
   * buttons. A button held down keeps its look. (`off`: the HUD is dead or replaying; nothing stays faded.)
   */
  private fadeControls(f: Float32Array | null, off = false): void {
    const els = [this.root.querySelector<HTMLElement>('.pz-chant'),
      ...document.querySelectorAll<HTMLElement>('#ui > .touch:not(.hidden) .tb, #ui > .touch:not(.hidden) .touch-base')];
    for (const el of els) {
      if (!el) continue;
      if (off || !f || el.classList.contains('down') || (el.classList.contains('pz-chant') && !el.classList.contains('on'))) {
        if (el.classList.contains('under')) el.classList.remove('under');
      } else this.fadeUnder(el, f);
    }
  }

  update(dt: number, frame: Float32Array): void {
    this.justYellow[0] = this.justYellow[1] = null;
    this.lastFrame = frame;
    if (!this.sideObs && typeof MutationObserver !== 'undefined') {
      const sc = this.root.querySelector?.('.side-cam');
      if (sc) {
        this.sideObs = new MutationObserver(() => {
          if (this.bannerTimer > 0) this.clearBanner();
        });
        this.sideObs.observe(sc, { attributes: true, attributeFilter: ['class'] });
      }
    }
    // (Looked at every frame rather than on 'resize': that event can come late, or not at all, in a hidden tab.)
    if (typeof window !== 'undefined' && (window.innerWidth !== this.seenW || window.innerHeight !== this.seenH)) {
      const first = this.seenW === 0;
      this.seenW = window.innerWidth;
      this.seenH = window.innerHeight;
      if (!first) this.relayout();
    }
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
        // (Or at once when the score bug it sits beside has grown under it: the style grade, the added-time board.)
        if (this.cmPlaceT <= 0 || (this.cmPlaceT <= 0.25 && this.tickerNearGoal()) || this.bugGrewUnderTicker()) {
          // (Quicker while the goal plate is up: its tags pop in one by one and it grows under the line.)
          this.cmPlaceT = this.bannerHung && this.bannerTimer > 0 ? 0 : 0.3;
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
        this.setHint(this.hintAsked, this.hintBound);
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
      if (this.bannerTimer > 0) this.clearBanner();
      if (this.bannerTimer <= 0) this.banner.classList.remove('on');
      else if (this.bannerHung || (this.bannerPower && this.project)) {
        // The camera pans: keep the power-up plate off the goal mouth (checked a few times a second).
        this.bannerPlaceT -= dt;
        if (this.bannerPlaceT <= 0) {
          this.bannerPlaceT = this.bannerHung ? 0 : 0.25;
          const r = this.banner.getBoundingClientRect();
          const box = { l: r.left, t: r.top, r: r.right, b: r.bottom };
          if (this.bannerHung || this.goalRects().some((gr) => overlapArea(box, gr, 6) > 0)) this.placeBanner();
        }
      }
    }
    if (this.powerActive) {
      this.powerActive.left -= dt;
      if (this.powerActive.left <= 0) this.powerActive = null;
      this.drawPower();
    } else if (!this.power.hidden) {
      this.powerPlaceT -= dt;
      if (this.powerPlaceT <= 0) {
        this.powerPlaceT = 0.5;
        this.placePower();
      }
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.classList.remove('on');
      else if ((this.toastPlaceT -= dt) <= 0) {
        // The score bug can grow under it (a live goal, the HYPE row): it keeps hanging off the bottom.
        this.toastPlaceT = TOAST_PLACE_S;
        this.placeToast();
      }
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
    // (The fades over the play run whenever the HUD is live, the minimap switched off for a set piece or not.)
    const off = this.root.classList.contains('dead') || this.root.classList.contains('replaying');
    const hidden = this.radarHidden || off;
    if (!off) {
      // (The minimap redraws 20 times a second; what fades over the play looks every frame, so a fast run up the far
      // touchline is never under the score bug for a frame or two before it gives way.)
      if (this.radarT <= 0) {
        this.radarT = 1 / 20;
        if (!hidden) this.drawRadar(frame);
      }
      this.fadeRadar(frame);
    } else {
      // No look round while the HUD is dead or replaying: nothing stays faded for a play it can no longer see.
      for (const el of [this.cm, this.toast, this.scoreBug, this.banner, this.root.querySelector('.hud-qsub')]) if (el?.classList.contains('under')) el.classList.remove('under');
      this.fadeControls(null, true);
    }
  }

  /**
   * The minimap nearly vanishes while the ball, our man or the team-mate his pass is locked onto is under it
   * on screen (checked with the radar redraw, 20 times a second).
   */
  private fadeRadar(f: Float32Array): void {
    this.fadeUnder(this.radar, f);
    // The score bug too: the ball up by the far touchline can pass under it on a phone.
    if (this.scoreBug) this.fadeUnder(this.scoreBug, f, [...this.scoreBug.querySelectorAll<HTMLElement>('.sb-board.on, .bty.on, .fun-pill.on, .sb-hype, .sb-grade')]);
    // The player chip (bottom left) as well.
    this.fadeUnder(this.chip, f);
    // The commentary ticker, the event flag and the quick-sub card too, while they are up.
    const qs = this.root.querySelector<HTMLElement>('.hud-qsub');
    for (const el of [this.cm, this.toast, qs]) {
      if (!el) continue;
      if (el.classList.contains('on')) this.fadeUnder(el, f);
      else if (el.classList.contains('under')) el.classList.remove('under');
    }
    // And a power-up plate in open play (with LARGE text it reaches down under the top cluster).
    // (And the plates hung off the score bug, the scorer's and SECOND HALF, when play comes up under them.)
    if ((this.bannerPower || this.bannerHung) && this.bannerTimer > 0) this.fadeUnder(this.banner, f);
    else if (this.banner.classList.contains('under')) this.banner.classList.remove('under');
    // The PERFECT / GOOD word follows the shooter's run: see-through if he (or the ball) comes under it.
    if (this.timingT > 0) this.fadeUnder(this.timingEl, f);
    else if (this.timingEl.classList.contains('under')) this.timingEl.classList.remove('under');
    this.fadeControls(f);
  }

  /** `el` nearly see-through ('under') while the ball, our man or his locked pass target is under it on screen. */
  private fadeUnder(el: HTMLElement, f: Float32Array, parts: HTMLElement[] = []): void {
    const P = this.project;
    let under = false;
    if (P) {
      // (Its own box and what hangs off it: the added-time board, a live goal grown past the bug's edge.)
      const rs = [el, ...parts].map((x) => x.getBoundingClientRect()).filter((q) => q.width > 0 && q.height > 0);
      const pad = 14;
      const hit = (x: number, y: number, z: number) => {
        let p: { x: number; y: number } | null = null;
        try {
          p = P(x, y, z);
        } catch {
          p = null;
        }
        return !!p && rs.some((r) => p!.x > r.left - pad && p!.x < r.right + pad && p!.y > r.top - pad && p!.y < r.bottom + pad);
      };
      const player = (i: number) => i >= 0 && i < 22 && (hit(f[i * PF], 0.2, f[i * PF + 1]) || hit(f[i * PF], 0.9, f[i * PF + 1]) || hit(f[i * PF], 1.6, f[i * PF + 1]));
      const aim = this.m?.passAim ?? -1;
      under = hit(f[BALL_OFS], f[BALL_OFS + 1], f[BALL_OFS + 2]) || player(f[BALL_OFS + 8]) || player(this.m?.active ?? -1) || player(typeof aim === 'number' ? aim : -1);
      const m = this.m;
      if (!under && this.fadeTeam && m) under = m.players.some((p) => p.side === m.cfg.humanSide && !p.sentOff && player(p.idx));
    }
    if (under !== el.classList.contains('under')) el.classList.toggle('under', under);
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
      if (this.colorblind && side !== this.humanSide) {
        // Colour-blind aid: the other side are round dots, yours stay square.
        g.beginPath();
        g.arc(x, y, s / 2 + 0.5, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      } else {
        g.fillRect(x - s / 2, y - s / 2, s, s);
        g.strokeRect(x - s / 2, y - s / 2, s, s);
      }
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
    this.bugObs?.disconnect();
    this.sideObs?.disconnect();
    this.root.remove();
  }

  /**
   * The window was resized or the phone turned mid-match (portal QA does both): the plate, the event flag, the hint,
   * the timing word, the replay badge, the power slot and the ticker are placed again for the new frame (in that
   * order: the ticker keeps clear of the others). The rest follow the frame by CSS or are placed every frame.
   */
  private relayout(): void {
    if (this.bannerTimer > 0 && (this.bannerCard || this.bannerPower || this.bannerHung)) this.placeBanner();
    if (this.toast.classList.contains('on')) this.placeToast();
    if (this.hint.classList.contains('on')) this.placeHint(true);
    if (this.timingT > 0) this.placeTiming();
    if (this.replay.classList.contains('on')) this.placeReplay();
    this.placePower();
    if (this.cmLine) this.placeTicker();
  }

  /** The replay badge: under the score bug however tall it has grown (the HYPE row, a live goal card), never across it. */
  private placeReplay(): void {
    this.replay.style.top = '';
    const sb = this.rectOf('.scorebug', false);
    const top = this.replay.getBoundingClientRect().top;
    if (sb && sb.b + 8 > top) this.replay.style.top = `${Math.round(sb.b + 8)}px`;
  }
}

export function hudTeam(t: TeamDef, kitShirt: number, kitShirt2: number): HudTeam {
  return { short: t.short, name: t.name, color: kitShirt, color2: kitShirt2, kit: t.kit };
}
