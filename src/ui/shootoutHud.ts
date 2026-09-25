import { cssHex } from '../render/palette';
import type { Kit, Side } from '../sim/types';
import { crestSvg } from './crest';

export interface TrackerTeam {
  short: string;
  color: number;
  color2: number;
  /** Club name + kit: draws the same pixel crest as the score bug. */
  name?: string;
  kit?: Kit;
}

export interface TrackerState {
  kicks: [boolean[], boolean[]];
  turn: Side;
  winner: Side | -1;
}

/** Most kicks shown per row; long sudden deaths scroll the oldest off. */
const MAX_DOTS = 8;

/**
 * Penalty tracker under the scorebug: a row of kicks per side (green scored, red missed, grey to come),
 * with the side stepping up next highlighted. Mounted inside the match HUD root.
 */
export class ShootoutHud {
  readonly root: HTMLDivElement;
  private key = '';
  private readonly clock: HTMLElement | null;
  /** Crest markup per side: the score bug's own crest when it has one, so both read as the same club. */
  private readonly crests: [string, string];

  constructor(parent: HTMLElement, private readonly teams: [TrackerTeam, TrackerTeam]) {
    this.root = document.createElement('div');
    this.root.className = 'so-track';
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-label', 'Penalty shootout');
    parent.appendChild(this.root);
    // The match clock means nothing now.
    this.clock = parent.querySelector<HTMLElement>('.sb-clock');
    const bug = parent.querySelectorAll('.scorebug .sb-team');
    this.crests = [0, 1].map((i) => {
      const t = teams[i];
      if (t.kit) return crestSvg(t.name ?? t.short, t.short, t.kit, 2);
      const svg = bug[i]?.querySelector('svg.crest-svg');
      if (svg) return svg.outerHTML;
      return `<i class="so-crest" style="--a:${cssHex(t.color)};--b:${cssHex(t.color2)}"></i>`;
    }) as [string, string];
  }

  update(s: TrackerState): void {
    if (this.clock && this.clock.textContent !== 'PENS') this.clock.textContent = 'PENS';
    const [a, b] = s.kicks;
    const key = `${a.map(Number).join('')}|${b.map(Number).join('')}|${s.turn}|${s.winner}`;
    if (key === this.key) return;
    this.key = key;
    const level = a.length === b.length;
    const n = Math.max(5, a.length, b.length) + (s.winner < 0 && level && a.length >= 5 ? 1 : 0);
    const from = Math.max(0, n - MAX_DOTS);
    const row = (side: Side) => {
      const k = s.kicks[side];
      const t = this.teams[side];
      let dots = '';
      for (let i = from; i < n; i++) {
        const cls = i < k.length ? (k[i] ? 'ok' : 'no') : s.winner < 0 && side === s.turn && i === k.length ? 'next' : 'wait';
        dots += `<i class="so-dot ${cls}"></i>`;
      }
      const goals = k.filter(Boolean).length;
      const up = s.winner < 0 && side === s.turn ? ' up' : s.winner === side ? ' won' : '';
      return `<div class="so-row${up}">
        ${this.crests[side]}
        <b>${t.short}</b><span class="so-dots">${dots}</span><em>${goals}</em>
      </div>`;
    };
    this.root.innerHTML = `<span class="so-head">${s.winner < 0 && Math.min(a.length, b.length) >= 5 ? 'SUDDEN DEATH' : 'PENALTIES'}</span>${row(0)}${row(1)}`;
  }

  dispose(): void {
    this.root.remove();
  }
}
