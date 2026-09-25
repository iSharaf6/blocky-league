import { BALL_OFS, PF } from '../game/replay';
import { HALF_L, HALF_W } from '../sim/constants';
import type { TeamDef } from '../sim/types';
import { cssHex } from '../render/palette';

export interface HudTeam {
  short: string;
  name: string;
  color: number;
  color2: number;
}

/** In-match overlay: score bug, radar, banners, player chip, hints. */
export class Hud {
  readonly root: HTMLDivElement;
  private score: HTMLDivElement;
  private clock: HTMLDivElement;
  private banner: HTMLDivElement;
  private bannerTimer = 0;
  private hint: HTMLDivElement;
  private chip: HTMLDivElement;
  private chipName: HTMLSpanElement;
  private chipNum: HTMLSpanElement;
  private stamina: HTMLDivElement;
  private replay: HTMLDivElement;
  private radar: HTMLCanvasElement;
  private radarT = 0;
  private toast: HTMLDivElement;
  private toastTimer = 0;
  onPause: (() => void) | null = null;

  constructor(private teams: [HudTeam, HudTeam], humanSide: number) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    const [h, a] = teams;
    this.root.innerHTML = `
      <div class="scorebug">
        <div class="sb-team"><i style="background:${cssHex(h.color)};box-shadow:inset -6px 0 0 ${cssHex(h.color2)}"></i><b>${h.short}</b></div>
        <div class="sb-score">0<span>-</span>0</div>
        <div class="sb-team"><b>${a.short}</b><i style="background:${cssHex(a.color)};box-shadow:inset -6px 0 0 ${cssHex(a.color2)}"></i></div>
        <div class="sb-clock">0'</div>
      </div>
      <button class="hud-pause" aria-label="Pause">II</button>
      <div class="hud-banner"></div>
      <div class="hud-toast"></div>
      <div class="hud-hint"></div>
      <div class="hud-chip"><span class="chip-num">9</span><span class="chip-name">PLAYER</span><div class="chip-stam"><div></div></div></div>
      <div class="hud-replay"><b>REPLAY</b><span>press any button to skip</span></div>
      <canvas class="hud-radar" width="240" height="150"></canvas>`;
    this.score = this.root.querySelector('.sb-score')!;
    this.clock = this.root.querySelector('.sb-clock')!;
    this.banner = this.root.querySelector('.hud-banner')!;
    this.hint = this.root.querySelector('.hud-hint')!;
    this.chip = this.root.querySelector('.hud-chip')!;
    this.chipName = this.root.querySelector('.chip-name')!;
    this.chipNum = this.root.querySelector('.chip-num')!;
    this.stamina = this.root.querySelector('.chip-stam div')!;
    this.replay = this.root.querySelector('.hud-replay')!;
    this.radar = this.root.querySelector('.hud-radar')!;
    this.toast = this.root.querySelector('.hud-toast')!;
    this.root.querySelector('.hud-pause')!.addEventListener('click', () => this.onPause?.());
    if (humanSide < 0) this.chip.style.display = 'none';
  }

  setScore(h: number, a: number): void {
    this.score.innerHTML = `${h}<span>-</span>${a}`;
    this.score.classList.remove('pop');
    void this.score.offsetWidth;
    this.score.classList.add('pop');
  }

  setClock(min: number, stoppage: boolean): void {
    this.clock.textContent = stoppage ? `${min}'+` : `${min}'`;
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

  setReplay(on: boolean): void {
    this.replay.classList.toggle('on', on);
    this.root.classList.toggle('replaying', on);
  }

  setPlayer(num: number, name: string, stamina: number): void {
    if (this.chipNum.textContent !== String(num)) {
      this.chipNum.textContent = String(num);
      this.chipName.textContent = name.toUpperCase();
    }
    this.stamina.style.width = `${Math.round(stamina * 100)}%`;
    this.stamina.style.background = stamina > 0.5 ? '#3aff9e' : stamina > 0.3 ? '#ffd23a' : '#ff4a3a';
  }

  update(dt: number, frame: Float32Array): void {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('on');
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.classList.remove('on');
    }
    this.radarT -= dt;
    if (this.radarT <= 0) {
      this.radarT = 1 / 20;
      this.drawRadar(frame);
    }
  }

  private drawRadar(f: Float32Array): void {
    const c = this.radar;
    const g = c.getContext('2d')!;
    const w = c.width;
    const h = c.height;
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(38, 70, 30, 0.55)';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 2;
    g.strokeRect(4, 4, w - 8, h - 8);
    g.beginPath();
    g.moveTo(w / 2, 4);
    g.lineTo(w / 2, h - 4);
    g.stroke();
    g.beginPath();
    g.arc(w / 2, h / 2, 16, 0, Math.PI * 2);
    g.stroke();
    const sx = (x: number) => 4 + ((x + HALF_L) / (HALF_L * 2)) * (w - 8);
    const sz = (z: number) => 4 + ((z + HALF_W) / (HALF_W * 2)) * (h - 8);
    g.strokeRect(4, sz(-18), 30, sz(18) - sz(-18));
    g.strokeRect(w - 34, sz(-18), 30, sz(18) - sz(-18));
    const active = f[BALL_OFS + 8];
    for (let i = 0; i < 22; i++) {
      const o = i * PF;
      const side = i < 11 ? 0 : 1;
      const x = sx(f[o]);
      const y = sz(f[o + 1]);
      g.fillStyle = cssHex(this.teams[side].color);
      g.strokeStyle = 'rgba(20,20,26,0.9)';
      g.lineWidth = 2;
      const s = i === active ? 11 : 8;
      g.fillRect(x - s / 2, y - s / 2, s, s);
      g.strokeRect(x - s / 2, y - s / 2, s, s);
      if (i === active) {
        g.strokeStyle = '#ffd23a';
        g.strokeRect(x - s / 2 - 3, y - s / 2 - 3, s + 6, s + 6);
      }
    }
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#1d1d24';
    const bx = sx(f[BALL_OFS]);
    const by = sz(f[BALL_OFS + 2]);
    g.fillRect(bx - 4, by - 4, 8, 8);
    g.strokeRect(bx - 4, by - 4, 8, 8);
  }

  dispose(): void {
    this.root.remove();
  }
}

export function hudTeam(t: TeamDef, kitShirt: number, kitShirt2: number): HudTeam {
  return { short: t.short, name: t.name, color: kitShirt, color2: kitShirt2 };
}
