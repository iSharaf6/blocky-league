import { BALL_OFS, PF } from '../game/replay';
import { BOX_DEPTH, BOX_W, CENTER_R, HALF_L, HALF_W } from '../sim/constants';
import type { Match } from '../sim/match';
import type { Kit, MatchEvent, TeamDef } from '../sim/types';
import { crestSvg } from './crest';
import { cssHex } from '../render/palette';
import { Commentator, speak, stopSpeech, surname, type CommentaryLine } from './commentary';

/** Screen position (CSS px, viewport origin) of a world point, or null when it is behind the camera. */
export type Projector = (x: number, y: number, z: number) => { x: number; y: number } | null;

type Rect = { l: number; t: number; r: number; b: number };

/** Seconds a commentary line stays up (goals and other big moments a little longer). */
const LINE_S = 3;
const BIG_LINE_S = 4;
/** A showing line can be replaced by an equal-priority one after this long; a higher priority cuts in at once. */
const LINE_MIN_S = 1.5;
/** Queued lines go stale: commentary must never lag behind play. */
const PENDING_MAX_S = 2.5;

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
  private cmLastShown = -99;
  private clockS = 0;
  /** The match the session forwards events from (names for the booking chips). */
  private m: Match | null = null;
  private readonly teamColor: [string, string];
  private project: Projector | null = null;
  private lastFrame: Float32Array | null = null;
  private hintLow = false;
  private hintT = 0;
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

  /** Big chunky centre text. */
  show(title: string, sub = '', kind = '', seconds = 2.2): void {
    this.banner.className = `hud-banner on ${kind}`;
    const letters = [...title].map((ch, i) => `<i style="animation-delay:${i * 45}ms">${ch === ' ' ? '&nbsp;' : ch}</i>`).join('');
    this.banner.innerHTML = `<div class="bn-title">${letters}</div>${sub ? `<div class="bn-sub">${sub}</div>` : ''}`;
    this.bannerTimer = seconds;
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

  setHint(text: string): void {
    if (this.hint.textContent !== text) this.hint.textContent = text;
    const on = text.length > 0;
    if (on && !this.hint.classList.contains('on')) {
      // Decide the slot before it fades in, so it never flashes over the taker first.
      this.hintT = 0;
      this.placeHint(true);
    }
    this.hint.classList.toggle('on', on);
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
   * Put the ticker where it covers nothing: the top band beside the score bug (landscape), or under the top
   * HUD cluster (portrait); the lower third instead whenever the ball is up there.
   */
  private placeTicker(): void {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const g = W < 480 ? 8 : 12;
    const sb = this.rectOf('.scorebug', false);
    const pause = this.rectOf('.hud-pause', false);
    if (!sb) return;
    const h = this.cm.offsetHeight || 34;
    const bands: { k: string; l: number; r: number; t: number }[] = [];
    // 1) Top band between the score bug and the pause button.
    const bl = sb.r + g;
    const br = (pause ? pause.l : W) - g;
    const topRow = this.rectOf('.scorebug .sb-clock', false) ?? sb;
    if (br - bl >= 300) bands.push({ k: 'top', l: bl, r: br, t: topRow.t });
    // 2) Under the top cluster (score bug + chips, shootout tracker, flag, radar in portrait, hint, tip).
    let under = sb.b;
    for (const sel of ['.so-track', '.hud-toast.on', '.hud-hint.on:not(.low)', '.hud-tip.on', '.hud-radar', '.hud-banner.on.goal .bn-sub']) {
      // By class, not opacity: a widget fading in counts at once, and the minimap counts even while faded
      // out (it comes back mid-line). display:none (the shootout's minimap) never does.
      const r = this.rectOf(sel, false);
      if (r && r.t < H * 0.45) under = Math.max(under, r.b);
    }
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
    // The resting thumbstick on touch screens.
    const stick = this.rectOf('#ui > .touch:not(.hidden) .touch-base');
    if (stick && stick.b > low - h - 4 && stick.l < W / 2) ll = Math.max(ll, stick.r + g);
    const btns = this.rectOf('#ui > .touch:not(.hidden) .touch-btns');
    if (btns) lr = Math.min(lr, btns.l - g);
    if (lr - ll >= 220) bands.push({ k: 'low', l: ll, r: lr, t: low - h });
    const ball = this.ballOnScreen();
    const clear = (b: { l: number; r: number; t: number }) => {
      if (!ball) return Infinity;
      const dx = Math.max(b.l - ball.x, 0, ball.x - b.r);
      const dy = Math.max(b.t - ball.y, 0, ball.y - (b.t + h));
      return Math.hypot(dx, dy);
    };
    // First band that keeps ~80 px clear of the ball (the players around it), else the farthest from it.
    const pref = bands.filter((b) => b.k !== 'under' || !bands.some((x) => x.k === 'top'));
    let pick = pref.find((b) => clear(b) > 80);
    if (!pick) pick = [...pref].sort((a, b) => clear(b) - clear(a))[0];
    if (!pick) return;
    // Stay put unless the ball really is in the way (no jitter between two bands).
    const cur = pref.find((b) => b.k === this.cmSlot);
    if (cur && cur !== pick && clear(cur) > 40) pick = cur;
    const width = pick.r - pick.l;
    this.cm.style.maxWidth = `${Math.round(width)}px`;
    const w = Math.min(this.cm.offsetWidth, width);
    const left = pick.k === 'top' ? pick.l : pick.l + (width - w) / 2;
    this.cm.style.left = `${Math.round(left)}px`;
    this.cm.style.top = `${Math.round(pick.t)}px`;
    this.cm.dataset.slot = pick.k;
    this.cmSlot = pick.k;
  }

  /**
   * Set-piece hint: top centre by default; down in the bottom band when the taker (the ball) is in the upper
   * part of the screen, e.g. a far-side corner, so it never sits over him or his delivery. Down there it keeps
   * clear of the player chip, the resting thumbstick, the touch buttons and the minimap.
   */
  private placeHint(force = false): void {
    const ball = this.ballOnScreen();
    const H = window.innerHeight;
    const W = window.innerWidth;
    const y = ball ? ball.y / H : 1;
    const low = !!ball && (force ? y < 0.44 : this.hintLow ? y < 0.5 : y < 0.4);
    if (low !== this.hintLow) {
      this.hintLow = low;
      this.hint.classList.toggle('low', low);
    }
    const st = this.hint.style;
    if (!low) {
      st.left = st.bottom = st.maxWidth = '';
      return;
    }
    const g = 12;
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
    st.left = `${Math.round(ll)}px`;
    st.maxWidth = `${Math.round(lr - ll)}px`;
    const hr = ll + Math.min(this.hint.offsetWidth, lr - ll);
    const radar = this.rectOf('.hud-radar');
    if (radar && radar.t > H * 0.5 && radar.l < hr && radar.r > ll) bottom = Math.max(bottom, H - radar.t + 8);
    st.bottom = `${Math.round(bottom)}px`;
  }

  /** Hide play-only widgets (radar, player chip, tips) outside live play. */
  setLive(on: boolean): void {
    this.root.classList.toggle('dead', !on);
  }

  /** Hide the minimap (set pieces, play near the bottom touchline) without touching the rest of the HUD. */
  setRadarHidden(hidden: boolean): void {
    if (hidden === this.radarHidden) return;
    this.radarHidden = hidden;
    this.root.classList.toggle('radar-off', hidden);
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
    const lastName = last !== null && (b.yellow.includes(last) || b.red.includes(last)) ? surname(this.playerName(last)).toUpperCase() : '';
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
    // The booking row grows the score bug: the event flag under it moves down with it.
    if (this.toast.classList.contains('on')) this.placeToast();
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
        if (this.cmPlaceT <= 0) {
          this.cmPlaceT = 0.3;
          this.placeTicker();
        }
      }
    } else if (this.cmPending) {
      const next = this.cmPending.line;
      this.cmPending = null;
      this.showLine(next);
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
    this.radarT -= dt;
    const hidden = this.radarHidden || this.root.classList.contains('dead') || this.root.classList.contains('replaying');
    if (this.radarT <= 0 && !hidden) {
      this.radarT = 1 / 20;
      this.drawRadar(frame);
    }
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
