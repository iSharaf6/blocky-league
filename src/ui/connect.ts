/**
 * CONNECT TO PLAY: what the player sees when something needs a connection and there is none (the online rule:
 * src/platform/online.ts). A small panel over the menu with RETRY and BACK, and the hub's tiles marked while the
 * gate is shut. It is part of the main bundle on purpose: it has to open with no network at all.
 *
 * docs/UX.md: one screen, one hint line, the primary action (RETRY) biggest; Esc goes back.
 */
import './connect.css';
import { sfx } from '../audio/sfx';
import { onGateChange, type Gate, type GateWhy } from '../platform/online';
import { pixelIcon } from './pixelIcons';

const LINE: Record<GateWhy, string> = {
  offline: 'YOU ARE OFFLINE. QUICK MATCH STILL PLAYS.',
  account: 'COULD NOT SIGN YOU IN. QUICK MATCH STILL PLAYS.',
};

let active: HTMLDivElement | null = null;

export interface ConnectHandlers {
  /** Try to connect now; true when the game is connected and signed in. */
  retry: () => Promise<boolean>;
  /** Connected: carry on to where the player was going. */
  done: () => void;
  /** BACK (or Escape): stay where he was. */
  back?: () => void;
  gate: () => Gate;
  why: () => GateWhy;
}

/** Open the panel (one at a time). It closes itself and calls `done` as soon as the gate opens. */
export function openConnect(h: ConnectHandlers): void {
  active?.remove();
  const root = document.createElement('div');
  root.className = 'screen cn-screen';
  root.innerHTML = '<div class="panel-wrap dim"><div class="panel narrow cn-panel" role="dialog" aria-modal="true" aria-labelledby="cn-title"></div></div>';
  (document.getElementById('ui') ?? document.body).appendChild(root);
  active = root;
  const panel = root.querySelector('.panel') as HTMLDivElement;
  let busy = false;
  let closed = false;
  let failed = false;

  const render = (): void => {
    const working = busy || h.gate() === 'connecting';
    const line = working ? 'CONNECTING' : failed ? (h.why() === 'offline' ? 'STILL OFFLINE. CHECK YOUR CONNECTION.' : 'NO LUCK. TRY AGAIN IN A MOMENT.') : LINE[h.why()];
    panel.innerHTML = `
      <i class="cn-art" aria-hidden="true">${pixelIcon('bolt', '#ffd23a', 6)}</i>
      <h2 id="cn-title">CONNECT TO PLAY</h2>
      <div class="cn-status ${working ? 'busy' : failed ? 'bad' : ''}" role="status" aria-live="polite"><i></i><span>${line}</span></div>
      <div class="btn-row cn-row">
        <button class="btn btn-white" data-a="back">BACK</button>
        <button class="btn btn-go btn-lg" data-a="retry" ${working ? 'disabled' : ''}>RETRY</button>
      </div>`;
  };
  const close = (): void => {
    if (closed) return;
    closed = true;
    off();
    window.removeEventListener('keydown', onKey, true);
    root.remove();
    if (active === root) active = null;
  };
  const finish = (): void => {
    close();
    h.done();
  };
  const off = onGateChange((g) => {
    if (closed) return;
    if (g === 'open') finish();
    else render();
  });
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    close();
    h.back?.();
  };
  window.addEventListener('keydown', onKey, true);
  panel.addEventListener('pointerdown', (e) => {
    if ((e.target as Element).closest('button:not(:disabled)')) sfx.click();
  });
  panel.addEventListener('click', (e) => {
    const el = (e.target as Element).closest<HTMLButtonElement>('[data-a]');
    if (!el || el.disabled || closed) return;
    if (el.dataset.a === 'back') {
      close();
      h.back?.();
      return;
    }
    if (busy) return;
    busy = true;
    failed = false;
    render();
    void h.retry()
      .then((ok) => ok && h.gate() === 'open', () => false)
      .then((ok) => {
        busy = false;
        if (closed) return;
        if (ok) finish();
        else {
          failed = true;
          render();
        }
      });
  });
  render();
  panel.querySelector<HTMLButtonElement>('[data-a=retry]')?.focus({ preventScroll: true });
}

/** Is the CONNECT TO PLAY panel up? */
export function connectOpen(): boolean {
  return !!active?.isConnected;
}

/** What the hub locks while the gate is shut: ROAD TO GLORY, MY CLUB, TRANSFERS, the SHOP, SEASON, EVENTS, NEXT GOAL, the coins and gems. */
const HUB_LOCKED = '[data-a=career], [data-a=club], [data-a=captain], [data-a=transfers], [data-a=shoptile], [data-a=season], [data-a=events], [data-a=goal], [data-a=coins], [data-a=gems]';

/**
 * Mark the hub's tiles while the gate is shut: greyed, and their small line reads CONNECT TO PLAY (a tap opens the
 * panel: main.ts). The hub is redrawn when the gate opens, which clears it.
 */
export function markHub(root: ParentNode | null, shut: boolean): void {
  if (!root || !shut) return;
  root.querySelectorAll<HTMLElement>(HUB_LOCKED).forEach((el) => {
    el.classList.add('cn-locked');
    // The tile's own small line (or the hero's PLAY) says what to do.
    const sub = el.querySelector<HTMLElement>('.ht-s, .hs-pass, .hh-play');
    if (sub) {
      const tri = sub.querySelector('.hh-tri');
      sub.textContent = 'CONNECT TO PLAY';
      if (tri) sub.appendChild(tri);
    }
    if (!el.getAttribute('aria-label')?.includes('Connect to play')) el.setAttribute('aria-label', `${el.getAttribute('aria-label') ?? el.textContent?.trim() ?? ''}. Connect to play`);
  });
}
