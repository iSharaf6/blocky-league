import {
  CREST_EMBLEMS, CREST_EMBLEM_NAMES, CREST_PATTERNS, CREST_PATTERN_NAMES, CREST_SHAPES, CREST_SHAPE_NAMES, emblemColorFor, randomCrest,
  type CrestDesign, type CrestEmblem, type CrestPattern, type CrestShape,
} from '../core/crest';
import { KIT_COLORS } from '../meta/data';
import { cssHex } from '../render/palette';
import type { Handlers } from './club';
import { crestDesignSvg } from './crest';
import './crest.css';

/**
 * The CREST DESIGNER (the club creator and MY CLUB > KIT, ui/club.ts): pick a shape, a field pattern, an emblem and
 * three colours, switch the banner with the short name on or off, or hit RANDOM. Every pick is a thumbnail of your
 * own crest with that one thing changed, so the grid is the preview. One pane, nothing scrolls on a phone but the
 * grid itself (docs/UX.md).
 */

export type CrestTab = 'shape' | 'pattern' | 'emblem' | 'color';
export type CrestColorKey = 'c1' | 'c2' | 'c3';

export interface CrestEditState {
  crest: CrestDesign;
  tab: CrestTab;
  col: CrestColorKey;
}

const TABS: readonly (readonly [CrestTab, string])[] = [['shape', 'SHAPE'], ['pattern', 'PATTERN'], ['emblem', 'EMBLEM'], ['color', 'COLOURS']];
const COLS: readonly (readonly [CrestColorKey, string])[] = [['c1', 'MAIN'], ['c2', 'SECOND'], ['c3', 'EMBLEM']];
/** The kit palette plus the crest's own cream, ink and bright gold. */
const PALETTE: readonly (readonly [string, number])[] = [...(Object.entries(KIT_COLORS) as [string, number][])];

export function crestEditorHtml(s: CrestEditState, name: string, short: string): string {
  const d = s.crest;
  const thumb = (v: CrestDesign) => crestDesignSvg(v, short, name, 3);
  const cell = (on: boolean, action: string, value: string, label: string, v: CrestDesign) =>
    `<button class="crx-pick ${on ? 'on' : ''}" data-a="${action}" data-v="${value}" aria-pressed="${on}" aria-label="${label}" title="${label.toUpperCase()}">${thumb(v)}</button>`;
  let body = '';
  if (s.tab === 'shape') {
    body = `<div class="crx-grid pane-scroll" data-scroll-key="cr-shape">${CREST_SHAPES.map((k) => cell(d.shape === k, 'cshape', k, CREST_SHAPE_NAMES[k], { ...d, shape: k })).join('')}</div>`;
  } else if (s.tab === 'pattern') {
    body = `<div class="crx-grid pane-scroll" data-scroll-key="cr-pattern">${CREST_PATTERNS.map((k) => cell(d.pattern === k, 'cpattern', k, CREST_PATTERN_NAMES[k], { ...d, pattern: k })).join('')}</div>`;
  } else if (s.tab === 'emblem') {
    body = `<div class="crx-grid pane-scroll" data-scroll-key="cr-emblem">${CREST_EMBLEMS.map((k) => cell(d.emblem === k, 'cemblem', k, CREST_EMBLEM_NAMES[k], { ...d, emblem: k })).join('')}</div>`;
  } else {
    body = `<div class="crx-colors">
      <div class="seg crx-cols">${COLS.map(([k, l]) => `<button class="${k === s.col ? 'on' : ''}" data-a="ccol" data-v="${k}" aria-pressed="${k === s.col}"><i style="--sw:${cssHex(d[k])}"></i>${l}</button>`).join('')}</div>
      <div class="mc-swatches">${PALETTE.map(([n, c]) => `<button class="mc-sw ${d[s.col] === c ? 'on' : ''}" data-a="ccolor" data-v="${c}" style="--sw:${cssHex(c)}" aria-label="${n}" title="${n.toUpperCase()}"></button>`).join('')}</div>
    </div>`;
  }
  return `<div class="crx-ed">
    <div class="ck-partrow">
      <div class="seg crx-tabs" role="tablist">${TABS.map(([k, l]) => `<button class="${k === s.tab ? 'on' : ''}" data-a="ctab" data-v="${k}" role="tab" aria-selected="${k === s.tab}">${l}</button>`).join('')}</div>
      <button class="btn btn-white mc-rand" data-a="crand" aria-label="A random crest">RANDOM</button>
    </div>
    ${body}
    <button class="crx-banner ${d.banner ? 'on' : ''}" data-a="cbanner" aria-pressed="${d.banner}"><i></i>BANNER WITH ${short || 'YOUR CODE'}</button>
  </div>`;
}

/**
 * The designer's click handlers. `kit` is the club's kit now (RANDOM mostly keeps the club's colours); `changed` runs
 * after every edit (save and redraw).
 */
export function crestEditorHandlers(s: CrestEditState, kit: () => { shirt: number; shirt2: number }, changed: () => void): Handlers {
  const colors = PALETTE.map(([, c]) => c);
  return {
    ctab: (el) => {
      s.tab = el.dataset.v as CrestTab;
      changed();
    },
    cshape: (el) => {
      s.crest.shape = el.dataset.v as CrestShape;
      changed();
    },
    cpattern: (el) => {
      s.crest.pattern = el.dataset.v as CrestPattern;
      changed();
    },
    cemblem: (el) => {
      s.crest.emblem = el.dataset.v as CrestEmblem;
      changed();
    },
    ccol: (el) => {
      s.col = el.dataset.v as CrestColorKey;
      changed();
    },
    ccolor: (el) => {
      s.crest[s.col] = Number(el.dataset.v);
      changed();
    },
    cbanner: () => {
      s.crest.banner = !s.crest.banner;
      changed();
    },
    crand: () => {
      // Mostly in the club's own colours (either way round), now and then something else entirely.
      const k = kit();
      const roll = Math.random();
      const keep = roll < 0.4 ? { c1: k.shirt, c2: k.shirt2 } : roll < 0.7 ? { c1: k.shirt2, c2: k.shirt } : undefined;
      Object.assign(s.crest, randomCrest(Math.random, colors, keep));
      changed();
    },
  };
}

/** The crest's colours following the kit (the creator, until the player picks crest colours of his own). */
export function crestFollowKit(d: CrestDesign, kit: { shirt: number; shirt2: number }): void {
  d.c1 = kit.shirt;
  d.c2 = kit.shirt2 === kit.shirt ? (kit.shirt === KIT_COLORS.white ? KIT_COLORS.black : KIT_COLORS.white) : kit.shirt2;
  d.c3 = emblemColorFor(d.c1, d.c2);
}
