/**
 * GEMS on screen (meta/gems.ts holds the rules): the pixel gem, the counter that sits beside the coins, an inline
 * price, and the ONE confirm sheet every gem spend goes through.
 *
 * The rule (docs/ECONOMY.md, ethics): nothing takes gems without the player seeing the price and saying yes, once.
 * `confirmGems` shows what it is, what it costs and what is in the wallet; YES spends, anything else (NO, Esc, a tap
 * outside) changes nothing. Short of gems it says by how much and offers the way to the STORE instead: it never
 * spends what isn't there and never starts a purchase by itself.
 */
import { sfx } from '../audio/sfx';
import { buzz } from '../platform/haptics';
import './gems.css';

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c]);

/** The gem as crisp pixel art (an inline SVG, 9 by 9 cells): a cut stone in three blues. `px` is one cell. */
export function gemArt(px = 2, cls = ''): string {
  const rows = ['..XXXXX..', '.XooXXXX.', 'XooXXXXdX', 'XoXXXXddX', '.XXXXddX.', '..XXddX..', '...XdX...', '....X....', '.........'];
  const fill: Record<string, string> = { X: '#35c3f5', o: '#d3f6ff', d: '#1a86c2' };
  let rects = '';
  rows.forEach((r, y) => [...r].forEach((c, x) => {
    if (c !== '.') rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill[c]}"/>`;
  }));
  return `<svg class="gem${cls ? ` ${cls}` : ''}" width="${9 * px}" height="${9 * px}" viewBox="0 0 9 9" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

/** The gem counter for a top bar, beside the coins (`.mc-top`). */
export function gemsHtml(n: number): string {
  return `<div class="gems mc-gems" aria-label="${fmt(n)} gems">${gemArt(2)}<span>${fmt(n)}</span></div>`;
}

/** A price in gems, inline in a button or a tag ("[gem] 50"). */
export function gemPrice(n: number): string {
  return `<span class="gem-price">${gemArt(1.6)}${fmt(n)}</span>`;
}

export interface GemConfirm {
  /** What is being bought, as a question ("FINISH THE NORTH END NOW?"). */
  title: string;
  /** One line of what it does, if the title doesn't say it all ("OPENS FOR YOUR NEXT HOME MATCH"). */
  text?: string;
  /** Gems it costs, and gems in the wallet. */
  price: number;
  have: number;
  /** The yes button's word (default YES). */
  yes?: string;
  /** Spend and do it (the caller calls spendGems here and acts only if it returns true). */
  onYes: () => void;
  /** Backed out (optional). */
  onNo?: () => void;
  /** Short of gems: where GET GEMS goes (the STORE). Without it the sheet only says how many are missing. */
  getGems?: () => void;
  /** The free way to the same thing, said in a line under the buttons ("OR PLAY 2 MATCHDAYS"). */
  free?: string;
}

/**
 * The confirm sheet, over `host` (a screen's root). One tap on the yes button spends; nothing else does. Returns the
 * way to close it (a screen that redraws under it may want to).
 */
export function confirmGems(host: HTMLElement, o: GemConfirm): () => void {
  host.querySelector('.gem-sheet')?.remove();
  const short = Math.max(0, Math.ceil(o.price) - Math.floor(o.have));
  const sheet = document.createElement('div');
  sheet.className = 'gem-sheet';
  const yes = short > 0
    ? o.getGems ? '<button class="btn btn-blue btn-lg" data-g="get">GET GEMS</button>' : ''
    : `<button class="btn btn-go btn-lg" data-g="yes">${esc(o.yes ?? 'YES')} ${gemPrice(o.price)}</button>`;
  sheet.innerHTML = `<div class="gem-card" role="dialog" aria-modal="true" aria-label="${esc(o.title)}">
      <h3>${esc(o.title)}</h3>
      ${o.text ? `<p class="gem-text">${esc(o.text)}</p>` : ''}
      <div class="gem-cost"><span><small>PRICE</small><b>${gemArt(3)}${fmt(o.price)}</b></span><span><small>YOU HAVE</small><b class="${short > 0 ? 'short' : ''}">${gemArt(3)}${fmt(o.have)}</b></span></div>
      ${short > 0 ? `<p class="gem-short">${fmt(short)} MORE ${short === 1 ? 'GEM' : 'GEMS'} NEEDED</p>` : ''}
      <div class="btn-row no-stick"><button class="btn btn-white" data-g="no">${short > 0 ? 'OK' : 'NO THANKS'}</button>${yes}</div>
      ${o.free ? `<p class="gem-free">${esc(o.free)}</p>` : ''}
    </div>`;
  let open = true;
  const close = (): void => {
    if (!open) return;
    open = false;
    window.removeEventListener('keydown', onKey, true);
    sheet.remove();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    // (The sheet takes Esc: the screen under it must not go BACK as well.)
    e.preventDefault();
    e.stopPropagation();
    close();
    o.onNo?.();
  };
  window.addEventListener('keydown', onKey, true);
  sheet.addEventListener('click', (e) => {
    const el = (e.target as Element).closest<HTMLElement>('[data-g]');
    // A tap outside the card is a no.
    if (!el) {
      if (e.target === sheet) {
        close();
        o.onNo?.();
      }
      return;
    }
    sfx.click();
    close();
    if (el.dataset.g === 'yes') {
      buzz('success');
      o.onYes();
    } else if (el.dataset.g === 'get') o.getGems?.();
    else o.onNo?.();
  });
  host.appendChild(sheet);
  sheet.querySelector<HTMLElement>('[data-g=yes], [data-g=get], [data-g=no]')?.focus({ preventScroll: true });
  return close;
}
