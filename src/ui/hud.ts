import { BALL_OFS, PF } from '../game/replay';
import { BOX_DEPTH, BOX_W, CENTER_R, HALF_L, HALF_W } from '../sim/constants';
import type { Kit, TeamDef } from '../sim/types';
import { crestSvg } from './crest';
import { cssHex } from '../render/palette';

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
      <div class="hud-chip"><span class="chip-num"></span><span class="chip-name"></span><div class="chip-stam"><div></div></div></div>
      <div class="hud-replay"><b>REPLAY</b><span class="rp-key">press any button to skip</span><span class="rp-tap">tap to skip</span></div>
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

  toastMsg(text: string, seconds = 1.4): void {
    this.toast.textContent = text;
    this.toast.classList.add('on');
    this.toastTimer = seconds;
  }

  setHint(text: string): void {
    this.hint.textContent = text;
    this.hint.classList.toggle('on', text.length > 0);
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

  private drawCards(side: 0 | 1, fresh?: 'yellow' | 'red'): void {
    const b = this.booked[side];
    // One plate per side: a chip per booking, up to three per colour (more collapse into chip + count).
    const chips = (k: 'yellow' | 'red') => {
      const n = b[k].length;
      if (!n) return '';
      return n > 3 ? `<i class="sb-chip ${k}"></i><b>${n}</b>` : Array.from({ length: n }, () => `<i class="sb-chip ${k}"></i>`).join('');
    };
    const y = b.yellow.length;
    const r = b.red.length;
    const el = this.cards[side];
    const label = [y ? `${y} yellow card${y > 1 ? 's' : ''}` : '', r ? `${r} red card${r > 1 ? 's' : ''}` : ''].filter(Boolean).join(', ');
    el.innerHTML = y || r ? `<span class="sb-card" role="img" aria-label="${label}">${chips('yellow')}${chips('red')}</span>` : '';
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
    this.root.remove();
  }
}

export function hudTeam(t: TeamDef, kitShirt: number, kitShirt2: number): HudTeam {
  return { short: t.short, name: t.name, color: kitShirt, color2: kitShirt2, kit: t.kit };
}
