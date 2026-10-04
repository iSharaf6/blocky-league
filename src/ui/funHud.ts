import type { Bounty, FunCue, Grade, GoalTag } from '../game/funLayer';
import { cssHex } from '../render/palette';
import type { Side } from '../sim/types';
import { pixelIcon } from './pixelIcons';
import './fun.css';

/**
 * The in-match fun layer on screen (src/game/funLayer.ts has the rules; the session hands its cues over). Everything
 * hangs off the score bug, top-left, so the rest of the HUD (the event flag, the ticker, the plates) already makes room
 * for it and the play stays clear (docs/UX.md: an 852x393 phone):
 *
 *   row 3 (under the score): each side's HYPE bar under its name, in its colours; full, it glows and a bolt shows (the
 *          side's next shot is a SUPER SHOT). Under the clock: the SHOWTIME grade letter, and the coins this match's
 *          LIVE GOALS have banked (once there are some).
 *   row 4: the live goal (one at a time: its icon, what to do, its progress, the coins, a draining bar), the daily
 *          challenge it just moved on, and the FINAL MINUTES call.
 *
 * Plus a red pulse round the screen's edge in the final minutes (the heartbeat), and the coins flying from where the
 * goal was done to the bank. No emojis (pixel icons), no monospace, no dots or dashes as separators.
 */
export class FunHud {
  private hypeRow: HTMLDivElement;
  private bars: [HTMLElement, HTMLElement];
  private fills: [HTMLElement, HTMLElement];
  private shown: [number, number] = [-1, -1];
  private armed: [boolean, boolean] = [false, false];
  private gradeCell: HTMLDivElement;
  private gradeEl: HTMLElement;
  private bankEl: HTMLElement;
  private bankN: HTMLElement;
  private bank = 0;
  private row: HTMLDivElement;
  private card: HTMLDivElement;
  private cardBar: HTMLElement;
  private cardHave: HTMLElement;
  private cardT = 0;
  private cardId = -1;
  private pill: HTMLDivElement;
  private pillT = 0;
  private vignette: HTMLDivElement;
  private beatPhase = 0;
  private flying: HTMLElement[] = [];
  private grade: Grade | null = null;
  private readonly reduce: boolean;

  constructor(
    private readonly root: HTMLElement,
    colors: [number, number],
    private readonly humanSide: number,
    private readonly opt: { hype: boolean; showtime: boolean; bounties: boolean; reducedMotion?: boolean },
  ) {
    this.reduce = !!opt.reducedMotion;
    const sb = root.querySelector('.scorebug') ?? root;
    const mine = (s: Side) => (s === humanSide ? ' mine' : '');
    this.hypeRow = document.createElement('div');
    this.hypeRow.className = 'sb-hype';
    this.hypeRow.hidden = !opt.hype;
    this.hypeRow.setAttribute('aria-hidden', 'true');
    // (A dark kit gets a cream rim on the dark bar.)
    const dark = (c: number) => (0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255)) / 255 < 0.28 ? ' dark' : '';
    this.hypeRow.innerHTML = [0, 1].map((s) => `<span class="hy ${s === 0 ? 'h' : 'a'}${mine(s as Side)}${dark(colors[s])}" style="--c:${cssHex(colors[s])}"><i></i>${pixelIcon('bolt', '#26262e', 1.6, 'hy-bolt')}</span>`).join('');
    const hy = this.hypeRow.querySelectorAll<HTMLElement>('.hy');
    this.bars = [hy[0], hy[1]];
    this.fills = [hy[0].querySelector('i')!, hy[1].querySelector('i')!];
    this.gradeCell = document.createElement('div');
    this.gradeCell.className = 'sb-grade';
    this.gradeCell.hidden = !opt.showtime && !opt.bounties;
    this.gradeCell.innerHTML = `<b class="g" data-g="" role="img" aria-label="Style grade"></b><span class="bank" hidden><i></i><span>0</span></span>`;
    this.gradeEl = this.gradeCell.querySelector('.g')!;
    // (Shown from the first style points: a grey C at kick-off would only read as a telling-off.)
    this.gradeEl.hidden = true;
    this.bankEl = this.gradeCell.querySelector('.bank')!;
    this.bankN = this.bankEl.querySelector('span')!;
    this.row = document.createElement('div');
    this.row.className = 'sb-fun';
    this.row.innerHTML = `
      <div class="bty" role="status" aria-live="polite">
        <span class="bty-ico"></span><b class="bty-t"></b><em class="bty-have"></em>
        <span class="bty-rw"><i></i><span></span></span>
        <span class="bty-bar"><i></i></span>
      </div>
      <div class="fun-pill" role="status" aria-live="polite"></div>`;
    this.card = this.row.querySelector('.bty')!;
    this.cardBar = this.row.querySelector('.bty-bar i')!;
    this.cardHave = this.row.querySelector('.bty-have')!;
    this.pill = this.row.querySelector('.fun-pill')!;
    sb.append(this.hypeRow, this.gradeCell, this.row);
    this.vignette = document.createElement('div');
    this.vignette.className = 'hud-tension';
    this.vignette.setAttribute('aria-hidden', 'true');
    root.appendChild(this.vignette);
  }

  // ---------------------------------------------------------------- hype

  /** Both meters (0..1), every frame: only a change of half a percent touches the DOM. */
  setHype(h0: number, h1: number): void {
    if (!this.opt.hype) return;
    const hs: [number, number] = [h0, h1];
    for (const s of [0, 1] as Side[]) {
      const v = Math.max(0, Math.min(1, hs[s]));
      if (Math.abs(v - this.shown[s]) < 0.005) continue;
      this.shown[s] = v;
      this.fills[s].style.transform = `scaleX(${v.toFixed(3)})`;
      const full = v >= 1;
      if (full !== this.armed[s]) {
        this.armed[s] = full;
        this.bars[s].classList.toggle('full', full);
      }
    }
  }

  /** A side's meter just filled: its bar pops. */
  hypeFull(side: Side): void {
    const b = this.bars[side];
    b.classList.remove('pop');
    void b.offsetWidth;
    b.classList.add('pop');
  }

  // ---------------------------------------------------------------- SHOWTIME

  private setGrade(g: Grade, pop: boolean): void {
    if (g === this.grade) return;
    this.grade = g;
    this.gradeEl.textContent = g;
    this.gradeEl.dataset.g = g;
    this.gradeEl.setAttribute('aria-label', `Style grade ${g}`);
    if (pop) {
      this.gradeEl.classList.remove('up');
      void this.gradeEl.offsetWidth;
      this.gradeEl.classList.add('up');
    }
  }

  /** Style points scored: the grade letter follows (it pops when it goes up), a big haul flashes "+N" by it. */
  style(c: Extract<FunCue, { type: 'style' }>): void {
    if (!this.opt.showtime) return;
    this.gradeEl.hidden = false;
    this.setGrade(c.grade, c.up);
    // (A big haul flashes "+N"; a drift of the pace with no new points says nothing.)
    if (c.points < 30 || this.reduce) return;
    const p = document.createElement('span');
    p.className = 'sty-pop';
    p.textContent = `+${c.points}`;
    this.gradeCell.appendChild(p);
    setTimeout(() => p.remove(), 900);
  }

  // ---------------------------------------------------------------- live goals

  /** A bounty offered, moved on, done or failed. */
  bounty(c: Extract<FunCue, { type: 'bounty' }>): void {
    const b = c.b;
    const card = this.card;
    if (c.state === 'offer' || b.id !== this.cardId) {
      this.cardId = b.id;
      card.querySelector('.bty-ico')!.innerHTML = pixelIcon(b.def.icon, '#26262e', 2);
      card.querySelector('.bty-t')!.textContent = b.def.title;
      card.querySelector('.bty-rw span')!.textContent = `+${b.def.coins}`;
      card.className = 'bty on offer';
      card.setAttribute('aria-label', `Live goal: ${b.def.title.toLowerCase()} for ${b.def.coins} coins`);
    }
    this.drawHave(b);
    if (c.state === 'progress') {
      card.classList.remove('tick');
      void card.offsetWidth;
      card.classList.add('tick');
    } else if (c.state === 'done') {
      // Done: green, a star for the icon (the coins fly from here to the bank).
      card.className = 'bty on done';
      card.querySelector('.bty-ico')!.innerHTML = pixelIcon('star', '#26262e', 2);
      this.cardHave.hidden = true;
      this.cardT = 1.4;
    } else if (c.state === 'fail') {
      card.className = 'bty on fail';
      this.cardT = 0.9;
    }
  }

  private drawHave(b: Bounty): void {
    this.cardHave.textContent = b.def.need > 1 ? `${b.have}/${b.def.need}` : '';
    this.cardHave.hidden = b.def.need <= 1;
  }

  /** The live bounty's clock (every frame while one is up). */
  tickBounty(b: Bounty | null, dt: number): void {
    if (b && b.id === this.cardId) {
      const k = Math.max(0, Math.min(1, b.left / b.total));
      this.cardBar.style.transform = `scaleX(${k.toFixed(3)})`;
      this.card.classList.toggle('late', b.left < Math.min(5, b.total * 0.3));
      return;
    }
    if (this.cardT > 0 && (this.cardT -= dt) <= 0) {
      this.card.className = 'bty';
      this.cardId = -1;
    } else if (this.cardT <= 0 && !b && this.card.classList.contains('on')) this.card.className = 'bty';
  }

  /**
   * Coins earned: `n` coins fly from `from` (screen px; null: the live goal card) to the bank under the clock, which
   * counts them in as they land (`land` is called once per coin, for the sound).
   */
  coins(n: number, from: { x: number; y: number } | null, land?: (i: number) => void): void {
    if (!this.opt.bounties) return;
    this.bankEl.hidden = false;
    const target = this.bankEl.getBoundingClientRect();
    const src = from ?? (() => {
      const r = this.card.getBoundingClientRect();
      return { x: r.right - 24, y: r.top + r.height / 2 };
    })();
    const to = this.bank + n;
    const count = this.reduce ? 0 : Math.min(8, 3 + Math.round(n / 10));
    if (!count || !target.width || typeof document.body.animate !== 'function') {
      this.setBank(to, true);
      land?.(0);
      return;
    }
    const tx = target.left + 10;
    const ty = target.top + target.height / 2;
    const step = n / count;
    for (let i = 0; i < count; i++) {
      const c = document.createElement('i');
      c.className = 'coin-fly';
      c.style.left = `${src.x}px`;
      c.style.top = `${src.y}px`;
      this.root.appendChild(c);
      this.flying.push(c);
      const dx = tx - src.x;
      const dy = ty - src.y;
      const lift = -40 - Math.random() * 50;
      const spread = (Math.random() - 0.5) * 70;
      const a = c.animate([
        { transform: 'translate(-50%, -50%) scale(0.4)', opacity: 0 },
        { transform: `translate(calc(-50% + ${spread}px), calc(-50% + ${lift}px)) scale(1.15)`, opacity: 1, offset: 0.35 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.7)`, opacity: 1 },
      ], { duration: 620 + i * 60, delay: i * 70, easing: 'cubic-bezier(0.45, 0, 0.6, 1)', fill: 'forwards' });
      a.onfinish = () => {
        c.remove();
        this.flying = this.flying.filter((x) => x !== c);
        this.setBank(Math.min(to, Math.round(this.bank + step)), true);
        if (i === count - 1) this.setBank(to, true);
        land?.(i);
      };
    }
  }

  private setBank(v: number, pop: boolean): void {
    this.bank = v;
    this.bankN.textContent = String(v);
    if (!pop) return;
    this.bankEl.classList.remove('pop');
    void this.bankEl.offsetWidth;
    this.bankEl.classList.add('pop');
  }

  /** A short line under the score bug for `seconds`: a daily challenge moving on, the final minutes. */
  private showPill(html: string, kind: string, seconds: number): void {
    this.pill.innerHTML = html;
    this.pill.className = `fun-pill on ${kind}`;
    this.pillT = seconds;
  }

  daily(c: Extract<FunCue, { type: 'daily' }>): void {
    const esc = c.text.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
    this.showPill(`<b>DAILY</b><span>${esc}</span><em>${c.done ? `DONE <i></i>${c.coins}` : `${c.have}/${c.goal}`}</em>`, c.done ? 'daily done' : 'daily', c.done ? 3 : 2.4);
  }

  /** The final minutes start: the call (and what it means for us), then the heartbeat round the edge. */
  finalMinutes(diff: number): void {
    const say = this.humanSide < 0 ? '' : diff < 0 ? (diff === -1 ? 'YOU NEED A GOAL' : `${-diff} GOALS DOWN`) : diff === 0 ? 'FIND A WINNER' : 'HOLD ON';
    this.showPill(`<b>FINAL MINUTES</b>${say ? `<span class="say">${say}</span>` : ''}`, 'final', 3.2);
  }

  /** Tension 0..1 (the final minutes): the red edge pulses with the heartbeat; `beat` (1/s) is its rate. */
  tension(k: number, beat: number, dt: number): void {
    if (k <= 0) {
      if (this.vignette.style.opacity !== '0') this.vignette.style.opacity = '0';
      this.beatPhase = 0;
      return;
    }
    this.beatPhase = (this.beatPhase + dt * beat) % 1;
    // A double thump: lub (0) and dub (0.22), fading fast.
    const p = this.beatPhase;
    const pulse = Math.max(Math.exp(-p * 9), 0.7 * Math.exp(-Math.abs(p - 0.22) * 14));
    const o = this.reduce ? 0.35 * k : k * (0.3 + 0.7 * pulse);
    this.vignette.style.opacity = o.toFixed(3);
  }

  /** Per frame: the pill's timer. */
  update(dt: number): void {
    if (this.pillT > 0 && (this.pillT -= dt) <= 0) this.pill.classList.remove('on');
  }

  // ---------------------------------------------------------------- goals

  /**
   * The goal's callouts (HAT TRICK, LATE WINNER, SUPER SHOT, SCREAMER...) as chunky plates under the GOAL! banner's
   * subtitle, popping in one after another (the headline one gold and bigger).
   */
  goalTags(tags: readonly GoalTag[], ours: boolean): void {
    if (!tags.length) return;
    const banner = this.root.querySelector<HTMLElement>('.hud-banner.on');
    if (!banner) return;
    banner.querySelector('.bn-tags')?.remove();
    const row = document.createElement('div');
    row.className = `bn-tags${ours ? '' : ' against'}`;
    row.innerHTML = tags.map((t, i) => `<i class="gt${t.big ? ' big' : ''}" style="animation-delay:${450 + i * 260}ms">${t.text}</i>`).join('');
    banner.appendChild(row);
  }

  dispose(): void {
    for (const c of this.flying) c.remove();
    this.flying = [];
    this.hypeRow.remove();
    this.gradeCell.remove();
    this.row.remove();
    this.vignette.remove();
  }
}
