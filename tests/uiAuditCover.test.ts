import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { coverAt, largestGap, paints } from '../src/ui/fitBox';

// The fit audit's `cover` and `empty` checks (src/ui/fitBox.ts, docs/UX.md section 10). CrazyGames' QA, 22 October, at
// 745x290 on an iPhone: the pinned button row of YOU'RE READY, the daily gift and UNLOCKED! was drawn over their last
// lines with blank panel under it, and `__uiAudit()` said nothing (the words under the row were simply "not on top").

/** A tiny stand-in for the DOM the two helpers read: a tree, computed styles, and what is hit at a point. */
type Style = { position?: string; background?: string; image?: string; border?: string; opacity?: string };
class El {
  parentElement: El | null = null;
  childNodes: (El | { nodeType: number; textContent: string })[] = [];
  constructor(readonly tagName: string, readonly css: Style = {}, readonly cls = '', text = '') {
    if (text) this.childNodes.push({ nodeType: 3, textContent: text });
  }
  add(...kids: El[]): this {
    for (const k of kids) {
      k.parentElement = this;
      this.childNodes.push(k);
    }
    return this;
  }
  contains(o: El | null): boolean {
    for (let e = o; e; e = e.parentElement) if (e === this) return true;
    return false;
  }
  closest(sel: string): El | null {
    const c = sel.replace(/^\./, '');
    for (let e: El | null = this; e; e = e.parentElement) if (e.cls.split(' ').includes(c)) return e;
    return null;
  }
  checkVisibility(): boolean {
    return this.css.opacity !== '0';
  }
}

let hitAt: El | null = null;

beforeEach(() => {
  vi.stubGlobal('Node', { TEXT_NODE: 3 });
  vi.stubGlobal('window', { innerWidth: 745, innerHeight: 290 });
  vi.stubGlobal('document', { elementFromPoint: () => hitAt });
  vi.stubGlobal('getComputedStyle', (e: El) => ({
    position: e.css.position ?? 'static',
    backgroundColor: e.css.background ?? 'rgba(0, 0, 0, 0)',
    backgroundImage: e.css.image ?? 'none',
    getPropertyValue: (k: string) => (/width$/.test(k) ? (e.css.border ? '3px' : '0px') : e.css.border ? 'solid' : 'none'),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  hitAt = null;
});

/** YOU'RE READY as Safari drew it: the screen, the panel, its last line and the pinned row with its buttons. */
function readyPanel() {
  const scr = new El('div', {}, 'screen basics-screen');
  const panel = new El('div', { background: 'rgb(251, 251, 244)' }, 'panel narrow');
  const line = new El('p', {}, 'fine big', 'Score in your first match');
  const row = new El('div', { position: 'sticky', background: 'rgb(251, 251, 244)' }, 'btn-row');
  const go = new El('button', {}, 'btn btn-go', 'FIRST MATCH');
  scr.add(panel.add(line, row.add(go)));
  return { scr, panel, line, row, go };
}

const as = <T>(e: El) => e as unknown as T;

describe('cover: something drawn over words it is not part of', () => {
  it('finds a pinned button row over the line it should follow, and names the row', () => {
    const { scr, line, row, go } = readyPanel();
    hitAt = go;
    const c = coverAt(as<Element>(line), as<HTMLElement>(scr), 300, 150);
    expect(c?.hit).toBe(go);
    expect(c?.layer).toBe(row);
    // (The cream band of the row itself, between its buttons, covers too.)
    hitAt = row;
    expect(coverAt(as<Element>(line), as<HTMLElement>(scr), 300, 150)?.layer).toBe(row);
  });

  it('never counts parent and child, a scrollbar, another screen, or something that draws nothing there', () => {
    const { scr, panel, line, go } = readyPanel();
    // The words' own box, or a box holding them.
    hitAt = line;
    expect(coverAt(as<Element>(line), as<HTMLElement>(scr), 300, 150)).toBeNull();
    hitAt = panel;
    expect(coverAt(as<Element>(line), as<HTMLElement>(scr), 300, 150)).toBeNull();
    // A pane's own bar (bar-over's job).
    const sb = new El('div', { position: 'absolute', background: 'rgb(38, 38, 46)' }, 'sb sb-y');
    panel.add(sb);
    hitAt = sb;
    expect(coverAt(as<Element>(line), as<HTMLElement>(scr), 300, 150)).toBeNull();
    // A sheet that is another screen over this one.
    const other = new El('div', {}, 'screen gift-screen').add(new El('div', { background: 'rgb(251, 251, 244)' }, 'panel'));
    hitAt = other.childNodes[0] as El;
    expect(coverAt(as<Element>(line), as<HTMLElement>(scr), 300, 150)).toBeNull();
    // A see-through wrapper laid over it (no background, border or words of its own), or one faded out.
    const wrap = new El('div', { position: 'absolute' }, 'wrap');
    panel.add(wrap);
    hitAt = wrap;
    expect(coverAt(as<Element>(line), as<HTMLElement>(scr), 300, 150)).toBeNull();
    const faded = new El('div', { position: 'absolute', background: 'rgb(255, 255, 255)', opacity: '0' }, 'faded');
    panel.add(faded);
    hitAt = faded;
    expect(coverAt(as<Element>(line), as<HTMLElement>(scr), 300, 150)).toBeNull();
    // Off the frame: nothing to test there.
    hitAt = go;
    expect(coverAt(as<Element>(line), as<HTMLElement>(scr), 300, 400)).toBeNull();
  });

  it('a badge hung over a label is a cover too (its positioned layer is named)', () => {
    const scr = new El('div', {}, 'screen');
    const tile = new El('button', { background: 'rgb(255, 255, 255)' }, 'tile');
    const name = new El('b', {}, '', 'PLAYERS');
    const tagBox = new El('span', { position: 'absolute' }, 'tag-box');
    const tag = new El('i', { background: 'rgb(230, 60, 50)' }, 'new', 'NEW');
    scr.add(tile.add(name), tagBox.add(tag));
    hitAt = tag;
    expect(coverAt(as<Element>(name), as<HTMLElement>(scr), 50, 20)?.layer).toBe(tagBox);
  });

  it('paints: pictures and controls, a background, a border or words of its own', () => {
    expect(paints(as<Element>(new El('img')))).toBe(true);
    expect(paints(as<Element>(new El('div', { background: 'rgb(1, 2, 3)' })))).toBe(true);
    expect(paints(as<Element>(new El('div', { background: 'rgba(1, 2, 3, 0.05)' })))).toBe(false);
    expect(paints(as<Element>(new El('div', { image: 'linear-gradient(red, blue)' })))).toBe(true);
    expect(paints(as<Element>(new El('div', { border: 'solid' })))).toBe(true);
    expect(paints(as<Element>(new El('span', {}, '', 'WORDS')))).toBe(true);
    expect(paints(as<Element>(new El('div')))).toBe(false);
  });
});

describe('empty: the longest blank stretch of a box', () => {
  it('measures the blank under the last thing drawn (half time at 1920x945: the ratings, then nothing)', () => {
    // A 715 px panel's match pane from 222 to 735: the score, the best player and two ratings end at 470.
    expect(largestGap(222, 735, [[222, 320], [330, 378], [390, 428], [434, 470]])).toBe(265);
  });

  it('measures a blank between things, merges overlaps, and ignores what lies outside the box', () => {
    expect(largestGap(0, 100, [[0, 10], [5, 30], [80, 100]])).toBe(50);
    expect(largestGap(0, 100, [[-50, -10], [0, 100], [120, 200]])).toBe(0);
    expect(largestGap(0, 100, [])).toBe(100);
    expect(largestGap(0, 100, [[-20, 40]])).toBe(60);
  });
});
