/**
 * Always-visible scrollbars (docs/UX.md section 10). Every pane on a menu screen that holds more than fits shows a
 * track and a thumb, on every platform, all the time. iOS Safari (and macOS) draw overlay scrollbars only while a
 * scroll is moving and ignore ::-webkit-scrollbar, so on an iPhone a cut row of tiles read as a broken screen, not a
 * strip that moves: CrazyGames' second Full Launch review (October 2026). This draws its own.
 *
 * - Found by itself: any element of a `#ui > .screen` (the screen too) with overflow auto or scroll on an axis and
 *   more than SCROLL_SLACK px of content past its box gets a bar on that axis. A pane that fits has none.
 * - Room of its own: the pane's padding on that side (bottom for a sideways strip, right for a list) grows to the
 *   bar's gutter (its thickness and 6 px)
 *   and the bar sits in it, so it never covers a tile, a button or a word. The native bar is hidden there.
 * - Never fades. The thumb follows every scroll; the bar is re-placed on resize, content change, text size change,
 *   fonts loading, and as an animation ends.
 * - Works by hand: drag the thumb, or tap the track to page. (`no-dragscroll`: ui/dragScroll.ts leaves it be.)
 * - The bar is the pane's next sibling, so it clips, scrolls and stacks with the pane, and is placed over the pane's
 *   gutter in layout px (see place): no transform (the fit box's scale, a panel's pop-in) can put it anywhere else.
 */
import './scrollbars.css';

/** Overflow up to this many px is not a scroll (a bobbing tile, rounding). ui/fitBox.ts's audit uses the same. */
export const SCROLL_SLACK = 3;
/** The bar's thickness on screen (px), whatever the fit box's scale (up to MAX_T in layout px). */
const THICK = 5;
const MAX_T = 6.5;
/** Beside the bar in its gutter: 2 px to the pane's edge, 4 px clear of the content. */
const AROUND = 6;
/** The shortest thumb, in px. */
const MIN_THUMB = 24;
/** Where the track starts and ends inside its strip (px). */
const INSET = 3;

type Axis = 'x' | 'y';

interface Bar {
  el: HTMLDivElement;
  thumb: HTMLElement;
  /** The track's length in the bar's own px (set when placed). */
  len: number;
}

interface Pane {
  el: HTMLElement;
  bars: Partial<Record<Axis, Bar>>;
  /** The pane's own inline padding (value, priority) before a gutter was added: put back when the bar goes. */
  inline: Partial<Record<Axis, [string, string]>>;
  /** Its computed padding on that side without the gutter (px). */
  base: Partial<Record<Axis, number>>;
  /** The bar's thickness and the gutter it keeps, in the pane's own px (from the fit box's scale). */
  t: number;
  g: number;
  /** How far its positioned bits hang past its content on that side (px): the gutter grows by it. */
  over: Partial<Record<Axis, number>>;
}

const PAD: Record<Axis, string> = { x: 'padding-bottom', y: 'padding-right' };
const panes = new Map<HTMLElement, Pane>();

/** A bar's element knows its pane (the audit finds it from the page, whichever copy of this module drew it). */
type BarEl = HTMLDivElement & { sbPane?: HTMLElement };

/** The bar drawn for `pane` on `axis`, if it has one: right after the pane (ui/fitBox.ts's audit). */
export function scrollbarOf(pane: Element, axis: Axis): HTMLElement | null {
  for (let n = pane.nextElementSibling as BarEl | null; n?.classList.contains('sb'); n = n.nextElementSibling as BarEl | null) {
    if (n.sbPane === pane && n.classList.contains(`sb-${axis}`)) return n;
  }
  return null;
}

const scrolls = (v: string) => v === 'auto' || v === 'scroll';

/** What the pane needs now: a bar on x, on y (its content past its box on an axis that scrolls). */
function needs(el: HTMLElement, cs: CSSStyleDeclaration): Record<Axis, boolean> {
  if (!el.isConnected || el.clientWidth < 1 || el.clientHeight < 1 || cs.display === 'none' || cs.visibility === 'hidden') return { x: false, y: false };
  return {
    x: scrolls(cs.overflowX) && el.scrollWidth - el.clientWidth > SCROLL_SLACK,
    y: scrolls(cs.overflowY) && el.scrollHeight - el.clientHeight > SCROLL_SLACK,
  };
}

/** An element's zoom on the page (LARGE text zooms a panel's children: src/style.css "text size"). */
function zoomOf(el: Element | null): number {
  let z = 1;
  for (let e = el; e; e = e.parentElement) z *= parseFloat(getComputedStyle(e).zoom) || 1;
  return z;
}

/**
 * The pane itself popping in or sliding (a panel's own `pop`): its bar, a sibling, can't follow that transform, so it
 * waits, hidden, for the end (the bar's own place is right all along). Endless loops (a glow) don't count.
 */
function moving(el: HTMLElement): boolean {
  if (typeof el.getAnimations !== 'function') return false;
  return el.getAnimations().some((a) => {
    const fx = a.effect as KeyframeEffect | null;
    if (a.playState !== 'running' || !fx || !Number.isFinite(fx.getComputedTiming().endTime)) return false;
    return fx.getKeyframes().some((f) => 'transform' in f || 'translate' in f || 'scale' in f || 'rotate' in f || 'opacity' in f);
  });
}

/** A dark background behind the pane (its own or the nearest one under it): the bar turns light on it. */
function onDark(el: HTMLElement): boolean {
  for (let e: HTMLElement | null = el; e && e.id !== 'ui'; e = e.parentElement) {
    const cs = getComputedStyle(e);
    let m = /rgba?\(([^)]+)\)/.exec(cs.backgroundColor);
    let parts = m ? m[1].split(/[ ,/]+/).filter(Boolean).map(Number) : [];
    if (!(parts.length >= 3 && (parts.length < 4 || parts[3] > 0.5)) && cs.backgroundImage.includes('gradient')) {
      m = /rgba?\(([^)]+)\)/.exec(cs.backgroundImage);
      parts = m ? m[1].split(/[ ,/]+/).filter(Boolean).map(Number) : [];
    }
    if (parts.length >= 3 && (parts.length < 4 || parts[3] > 0.5)) {
      const [r, g, b] = parts.map((v) => v / 255);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.42;
    }
  }
  return false;
}

function makeBar(p: Pane, axis: Axis): Bar {
  const el: BarEl = document.createElement('div');
  el.sbPane = p.el;
  el.className = `sb sb-${axis} no-dragscroll`;
  el.setAttribute('aria-hidden', 'true');
  el.style.left = '0px';
  el.style.top = '0px';
  el.style.width = '10px';
  el.style.height = '10px';
  const thumb = document.createElement('i');
  el.append(thumb);
  const bar: Bar = { el, thumb, len: 0 };
  el.addEventListener('pointerdown', (e) => grab(p, axis, bar, e));
  // (A wheel over the bar scrolls its pane, along the bar.)
  el.addEventListener('wheel', (e) => {
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (axis === 'x') p.el.scrollLeft += d;
    else p.el.scrollTop += d;
    e.preventDefault();
    e.stopPropagation();
  }, { passive: false });
  // (A tap on the bar is the bar's: nothing under it, nor the screen around it, takes it as a click.)
  el.addEventListener('click', (e) => e.stopPropagation());
  return bar;
}

/** Drag the thumb, or page by a tap on the track either side of it. */
function grab(p: Pane, axis: Axis, bar: Bar, e: PointerEvent): void {
  if ((e.pointerType === 'mouse' && e.button !== 0) || !e.isPrimary) return;
  e.preventDefault();
  e.stopPropagation();
  const pane = p.el;
  const x = axis === 'x';
  const at = x ? e.clientX : e.clientY;
  const tr = bar.el.getBoundingClientRect();
  const th = bar.thumb.getBoundingClientRect();
  const t0 = x ? th.left : th.top;
  const t1 = x ? th.right : th.bottom;
  if (at < t0 - 6 || at > t1 + 6) {
    const page = (x ? pane.clientWidth : pane.clientHeight) * 0.85 * (at < t0 ? -1 : 1);
    pane.scrollBy({ [x ? 'left' : 'top']: page, behavior: 'smooth' });
    return;
  }
  // Client px the thumb can travel (the track's length on screen less the thumb's), to the pane's scroll range.
  const own = parseFloat(x ? bar.el.style.width : bar.el.style.height) || 1;
  const track = bar.len * ((x ? tr.width : tr.height) / own);
  const room = track - (x ? th.width : th.height);
  const max = x ? pane.scrollWidth - pane.clientWidth : pane.scrollHeight - pane.clientHeight;
  const k = room > 1 ? max / room : 0;
  const s0 = x ? pane.scrollLeft : pane.scrollTop;
  const id = e.pointerId;
  bar.el.classList.add('held');
  try {
    bar.el.setPointerCapture(id);
  } catch {
    /* gone already */
  }
  const move = (m: PointerEvent) => {
    if (m.pointerId !== id) return;
    const v = s0 + ((x ? m.clientX : m.clientY) - at) * k;
    if (x) pane.scrollLeft = v;
    else pane.scrollTop = v;
    if (m.cancelable) m.preventDefault();
  };
  const up = (u: PointerEvent) => {
    if (u.pointerId !== id) return;
    bar.el.classList.remove('held');
    bar.el.removeEventListener('pointermove', move);
    bar.el.removeEventListener('pointerup', up);
    bar.el.removeEventListener('pointercancel', up);
  };
  bar.el.addEventListener('pointermove', move);
  bar.el.addEventListener('pointerup', up);
  bar.el.addEventListener('pointercancel', up);
}

/** The thumb's size and place along the track, from the pane's scroll. */
function thumb(p: Pane, axis: Axis): void {
  const bar = p.bars[axis];
  if (!bar || bar.len <= 0) return;
  const el = p.el;
  const x = axis === 'x';
  const view = x ? el.clientWidth : el.clientHeight;
  const all = x ? el.scrollWidth : el.scrollHeight;
  const pos = x ? el.scrollLeft : el.scrollTop;
  const size = Math.min(bar.len, Math.max(MIN_THUMB, (bar.len * view) / Math.max(1, all)));
  const max = Math.max(1, all - view);
  const at = (bar.len - size) * Math.min(1, Math.max(0, Math.abs(pos) / max));
  const st = bar.thumb.style;
  if (x) {
    st.width = `${size.toFixed(1)}px`;
    st.transform = `translateX(${at.toFixed(1)}px)`;
  } else {
    st.height = `${size.toFixed(1)}px`;
    st.transform = `translateY(${at.toFixed(1)}px)`;
  }
}

/**
 * The bar's thickness for the pane (5 px on screen: a fit box drawn at 0.77 gets a thicker bar in layout px, up to
 * MAX_T) and the gutter it keeps. (The fit box's scale, not the pane's rect: a panel popping in is scaled for a moment.)
 */
function sizeFor(p: Pane): void {
  const ui = p.el.closest('#ui');
  const s = ui ? parseFloat(getComputedStyle(ui).getPropertyValue('--fit-s')) : NaN;
  p.t = Math.min(MAX_T, Math.max(THICK, s > 0 && s < 1 ? THICK / s : THICK));
  p.g = Math.round(p.t + AROUND);
}

/**
 * How far the pane's positioned bits (a NEW ribbon or a THIS WEEK tag over a tile's corner) hang past its content box
 * on the bar's side, in the pane's own px, up to 12: the gutter grows by that much, so no tag ever meets the bar.
 */
function overhang(p: Pane, axis: Axis): number {
  const el = p.el;
  const r = el.getBoundingClientRect();
  const k = axis === 'x' ? r.height / (el.offsetHeight || 1) : r.width / (el.offsetWidth || 1);
  if (!(k > 0)) return 0;
  // (Only a pane that doesn't also scroll the other way: there, its content runs past the box anyway, and tags in
  // rows scrolled out of view are not hanging over the gutter.)
  if (axis === 'x' ? el.scrollHeight - el.clientHeight > SCROLL_SLACK : el.scrollWidth - el.clientWidth > SCROLL_SLACK) return 0;
  const cs = getComputedStyle(el);
  const edge = axis === 'x'
    ? r.top + (el.clientTop + el.clientHeight - (parseFloat(cs.paddingBottom) || 0)) * k
    : r.left + (el.clientLeft + el.clientWidth - (parseFloat(cs.paddingRight) || 0)) * k;
  let most = 0;
  for (const d of el.querySelectorAll<HTMLElement>('*')) {
    const dr = d.getBoundingClientRect();
    if (dr.width < 1 || dr.height < 1) continue;
    const o = ((axis === 'x' ? dr.bottom : dr.right) - edge) / k;
    if (o <= most) continue;
    // (Past the edge and drawn there: a tag placed over a corner, or a chip wider than its card. Not when a box inside
    // the pane clips it.)
    let clipped = false;
    for (let a = d.parentElement; a && a !== el; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        clipped = true;
        break;
      }
    }
    if (!clipped) most = o;
  }
  return Math.min(12, Math.ceil(most));
}

/** The pane's padding on `axis` with the gutter: its own, or the bar's room and any overhang, whichever is more. */
function applyPad(p: Pane, axis: Axis): void {
  p.el.style.setProperty(PAD[axis], `${Math.max(p.base[axis] ?? 0, p.g + (p.over[axis] ?? 0))}px`, 'important');
}

/** Set the gutter on `axis` (on: at least the bar's gutter of padding) or give the pane its own padding back. */
function gutter(p: Pane, axis: Axis, on: boolean): void {
  const st = p.el.style;
  const prop = PAD[axis];
  if (on) {
    if (!p.inline[axis]) {
      p.inline[axis] = [st.getPropertyValue(prop), st.getPropertyPriority(prop)];
      p.base[axis] = parseFloat(getComputedStyle(p.el).getPropertyValue(prop)) || 0;
    }
    applyPad(p, axis);
    p.over[axis] = overhang(p, axis);
    applyPad(p, axis);
  } else if (p.inline[axis]) {
    const [v, pri] = p.inline[axis]!;
    if (v) st.setProperty(prop, v, pri);
    else st.removeProperty(prop);
    delete p.inline[axis];
    delete p.base[axis];
    delete p.over[axis];
  }
}

/** Re-read the pane's own padding (a container query or the text size may have changed it under the gutter). */
function rebase(p: Pane): void {
  sizeFor(p);
  for (const axis of ['x', 'y'] as Axis[]) {
    const saved = p.inline[axis];
    if (!saved) continue;
    const st = p.el.style;
    const prop = PAD[axis];
    if (saved[0]) st.setProperty(prop, saved[0], saved[1]);
    else st.removeProperty(prop);
    p.base[axis] = parseFloat(getComputedStyle(p.el).getPropertyValue(prop)) || 0;
    applyPad(p, axis);
    p.over[axis] = Math.max(p.over[axis] ?? 0, overhang(p, axis));
    applyPad(p, axis);
  }
}

/**
 * New content (a deep look): its tags may hang further than the last. Only ever further: a gutter that grew can wrap the
 * content (a rail's label onto two lines), which moves its tags, which would shrink it again, round and round, the bar
 * placed against a layout about to change. Growing only, it settles at once.
 */
function reover(p: Pane): void {
  for (const axis of ['x', 'y'] as Axis[]) {
    if (!p.bars[axis]) continue;
    const o = overhang(p, axis);
    if (o > (p.over[axis] ?? 0)) {
      p.over[axis] = o;
      applyPad(p, axis);
    }
  }
}

/** Bars on, off and in place for one pane. */
function settle(p: Pane): void {
  const el = p.el;
  let want = needs(el, getComputedStyle(el));
  for (let pass = 0; pass < 2; pass++) {
    let changed = false;
    for (const axis of ['x', 'y'] as Axis[]) {
      if (want[axis] && !p.bars[axis]) {
        gutter(p, axis, true);
        const bar = makeBar(p, axis);
        p.bars[axis] = bar;
        // (After the pane, and after its other bar: the pane stays where its own siblings expect it.)
        (p.bars[axis === 'x' ? 'y' : 'x']?.el ?? el).after(bar.el);
        changed = true;
      } else if (!want[axis] && p.bars[axis]) {
        p.bars[axis]!.el.remove();
        delete p.bars[axis];
        gutter(p, axis, false);
        changed = true;
      }
    }
    el.classList.toggle('sb-on', !!(p.bars.x || p.bars.y));
    if (!changed) break;
    // (A gutter can change the other axis: a list one bar narrower may now run past its box.)
    const again = needs(el, getComputedStyle(el));
    want = { x: want.x || again.x, y: want.y || again.y };
  }
  place(p);
}

/** A box an absolutely placed child is placed from: positioned, or transformed, filtered, contained. */
function holdsAbs(cs: CSSStyleDeclaration): boolean {
  const set = (v: string | undefined) => !!v && v !== 'none';
  return cs.position !== 'static' || set(cs.transform) || set(cs.translate) || set(cs.scale) || set(cs.rotate) || set(cs.filter)
    || set(cs.backdropFilter) || set(cs.perspective) || /paint|layout|strict|content/.test(cs.contain)
    || /transform|perspective|filter/.test(cs.willChange);
}

/**
 * Where `el`'s border box starts, in unzoomed px before any transform, from the padding box of the box its absolutely
 * placed siblings are placed from (the first ancestor that holds them: holdsAbs). That is its offsetParent mostly, a
 * panel mid pop-in included (its transform makes it one); but offsetParent also stops where the zoom changes (LARGE
 * text zooms a panel's children), so the walk goes on up from there. A box on the way that scrolls moves `el` and not
 * the bars: its scroll is taken off. Null: not drawn.
 */
function originOf(el: HTMLElement): [number, number] | null {
  let x = 0;
  let y = 0;
  for (let e = el; ; ) {
    const op = e.offsetParent as HTMLElement | null;
    if (!op) return null;
    const z = zoomOf(e);
    x += e.offsetLeft * z;
    y += e.offsetTop * z;
    for (let a = e.parentElement; a && a !== op; a = a.parentElement) {
      if (!a.scrollLeft && !a.scrollTop) continue;
      const za = zoomOf(a);
      x -= a.scrollLeft * za;
      y -= a.scrollTop * za;
    }
    // (The same zoom: the browser stopped there for its own reasons, the bars' box.)
    if (zoomOf(op) === z || holdsAbs(getComputedStyle(op))) return [x, y];
    const zo = zoomOf(op);
    x += (op.clientLeft - op.scrollLeft) * zo;
    y += (op.clientTop - op.scrollTop) * zo;
    e = op;
  }
}

/**
 * The bars over the pane's gutter, in layout px, which no transform touches (the fit box's scale, a panel's pop-in).
 * The bars are the pane's siblings and take its zoom, so they are placed in the pane's own px from where it stands
 * (originOf). A containing block that comes or goes (a pop-in starting or ending) has them placed again then.
 */
function place(p: Pane): void {
  const el = p.el;
  if (!p.bars.x && !p.bars.y) return;
  const cs = getComputedStyle(el);
  for (const b of [p.bars.x, p.bars.y]) if (b && b.el.style.zoom !== cs.zoom) b.el.style.zoom = cs.zoom;
  const o = originOf(el);
  const z = zoomOf(el);
  const px = (v: string) => parseFloat(v) || 0;
  const bl = px(cs.borderLeftWidth);
  const bt = px(cs.borderTopWidth);
  const l = (o ? o[0] / z : 0) + bl;
  const t = (o ? o[1] / z : 0) + bt;
  // The padding box's size, unrounded: from the used width and height (client sizes are whole px, a px out under LARGE
  // text's zoom). (The native bar is hidden: nothing else is in it.)
  let w = px(cs.width);
  let h = px(cs.height);
  if (cs.boxSizing === 'border-box') {
    w -= bl + px(cs.borderRightWidth);
    h -= bt + px(cs.borderBottomWidth);
  } else {
    w += px(cs.paddingLeft) + px(cs.paddingRight);
    h += px(cs.paddingTop) + px(cs.paddingBottom);
  }
  if (!(Math.abs(w - el.clientWidth) < 2)) w = el.clientWidth;
  if (!(Math.abs(h - el.clientHeight) < 2)) h = el.clientHeight;
  const both = !!(p.bars.x && p.bars.y);
  const hide = !o || moving(el);
  const dark = onDark(el);
  const zi = cs.zIndex;
  for (const axis of ['x', 'y'] as Axis[]) {
    const bar = p.bars[axis];
    if (!bar) continue;
    const x = axis === 'x';
    const [left, top, bw, bh] = x ? [l, t + h - p.g, w - (both ? p.g : 0), p.g] : [l + w - p.g, t, p.g, h - (both ? p.g : 0)];
    const st = bar.el.style;
    st.left = `${left.toFixed(2)}px`;
    st.top = `${top.toFixed(2)}px`;
    st.width = `${Math.max(1, bw).toFixed(2)}px`;
    st.height = `${Math.max(1, bh).toFixed(2)}px`;
    st.visibility = hide ? 'hidden' : '';
    bar.len = Math.max(0, (x ? bw : bh) - INSET * 2);
    st.setProperty('--sb-t', `${p.t.toFixed(2)}px`);
    bar.el.classList.toggle('dark', dark);
    // (The pane's own stacking: a positioned pane with a z-index, the bar beside it at the same level.)
    st.zIndex = zi !== 'auto' ? zi : '';
    thumb(p, axis);
  }
}

/**
 * Watch #ui's screens for scroll panes (ui/dragScroll.ts installs this with itself). Returns the uninstall.
 */
export function installScrollbars(ui: HTMLElement): () => void {
  if (typeof ResizeObserver === 'undefined' || typeof MutationObserver === 'undefined') return () => {};
  const watched = new Set<HTMLElement>();
  let raf = 0;
  let deep = false;
  let rebaseAll = false;
  let lastScan = 0;
  let timer = 0;
  let live = true;

  // A pane, its content or its neighbours changed size: the bars move before this frame is drawn, and the panes are
  // judged again next frame (a gutter changes sizes, which this callback must not).
  const ro = new ResizeObserver(() => {
    for (const p of panes.values()) place(p);
    later(false);
  });

  /** The panes now: every element of a screen (and the screen) that scrolls on an axis. */
  const candidates = (): HTMLElement[] => {
    const out: HTMLElement[] = [];
    for (const scr of ui.querySelectorAll<HTMLElement>(':scope > .screen')) {
      for (const el of [scr, ...scr.querySelectorAll<HTMLElement>('*')]) {
        if (!(el instanceof HTMLElement) || el.classList.contains('sb')) continue;
        const cs = getComputedStyle(el);
        if (scrolls(cs.overflowX) || scrolls(cs.overflowY)) out.push(el);
      }
    }
    return out;
  };

  const track = (el: HTMLElement): Pane => {
    const p: Pane = { el, bars: {}, inline: {}, base: {}, over: {}, t: THICK, g: THICK + AROUND };
    sizeFor(p);
    panes.set(el, p);
    return p;
  };

  const untrack = (p: Pane) => {
    for (const axis of ['x', 'y'] as Axis[]) {
      p.bars[axis]?.el.remove();
      delete p.bars[axis];
      gutter(p, axis, false);
    }
    p.el.classList.remove('sb-on');
    panes.delete(p.el);
  };

  const observe = (el: Element) => {
    if (!(el instanceof HTMLElement) || el.classList.contains('sb') || watched.has(el)) return;
    watched.add(el);
    ro.observe(el);
  };

  const run = () => {
    raf = 0;
    // (A deep look, a new list or a screen, at most every 120 ms while things keep changing: in between, the panes
    // already known are judged and placed all the same.)
    const wait = deep ? 120 - (performance.now() - lastScan) : 0;
    const full = deep && wait <= 0;
    if (full) deep = false;
    else if (deep && !timer) {
      timer = window.setTimeout(() => {
        timer = 0;
        later(false);
      }, wait);
    }
    const re = rebaseAll;
    rebaseAll = false;
    mo.takeRecords();
    if (full) {
      lastScan = performance.now();
      const now = new Set(candidates());
      for (const p of [...panes.values()]) if (!now.has(p.el) || !p.el.isConnected) untrack(p);
      // A bar whose pane is gone, or a second one for a pane that has its own (left behind by a re-render): removed,
      // so no stale thumb is drawn over the live one. (Bars of panes this copy doesn't track are not its to touch.)
      for (const b of ui.querySelectorAll<BarEl>('.sb')) {
        const owner = b.sbPane;
        const p = owner ? panes.get(owner) : undefined;
        if (!owner || !owner.isConnected || (p && p.bars.x?.el !== b && p.bars.y?.el !== b)) b.remove();
      }
      ro.disconnect();
      watched.clear();
      for (const el of now) {
        if (!panes.has(el)) track(el);
        // (The pane, its content, and the box it sits in with its neighbours: a list that grows, a grid that gains a
        // column, a row above it that grows and moves it.)
        for (const n of [el, ...el.children]) observe(n);
        if (el.parentElement) for (const n of [el.parentElement, ...el.parentElement.children]) observe(n);
      }
    }
    for (const p of panes.values()) {
      if (re) rebase(p);
      else if (full) reover(p);
      settle(p);
    }
    // (Our own writes are not changes to look at again.)
    mo.takeRecords();
  };

  /** Coalesced to one frame. */
  const later = (full: boolean, re = false) => {
    if (!live) return;
    if (full) deep = true;
    if (re) rebaseAll = true;
    if (!raf) raf = requestAnimationFrame(run);
  };

  // Screens come and go on #ui; their contents change under them. (The match HUD is #ui's too but never a screen:
  // only screen subtrees are watched closely, so a match costs nothing.)
  const screens = new Set<Element>();
  const mo = new MutationObserver((recs) => {
    let hit = false;
    for (const r of recs) {
      const t = r.target as Element;
      if (t.nodeType === 1 && t.classList.contains('sb')) continue;
      // (A bar going in or out is ours, not a change to the screen.)
      if (r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].every((n) => n.nodeType === 1 && (n as Element).classList.contains('sb'))) continue;
      hit = true;
    }
    if (hit) {
      watchScreens();
      later(true);
    }
  });
  const watchScreens = () => {
    for (const s of ui.querySelectorAll(':scope > .screen')) {
      if (screens.has(s)) continue;
      screens.add(s);
      mo.observe(s, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    }
    for (const s of [...screens]) if (!s.isConnected) screens.delete(s);
  };
  mo.observe(ui, { childList: true });
  watchScreens();

  // The text size (a class on <html>), the window and the fonts: the panes' own padding may differ now.
  const htmlMo = new MutationObserver(() => later(true, true));
  htmlMo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  const onResize = () => later(true, true);
  window.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', onResize);
  document.fonts?.addEventListener?.('loadingdone', onResize);
  document.fonts?.ready.then(onResize);

  // A panel's pop-in starts or ends: its transform makes it the containing block of the bars inside it, then unmakes
  // it, and a pane's own pop-in hides its bars until it lands. Those bars are placed in this frame, before it is drawn;
  // the panes are judged again next frame.
  const onAnim = (e: Event) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    let hit = false;
    for (const p of panes.values()) {
      if (!t.contains(p.el)) continue;
      place(p);
      hit = true;
    }
    if (hit) later(false);
  };
  const ANIM = ['animationstart', 'animationend', 'animationcancel', 'transitionend', 'transitioncancel'] as const;
  for (const t of ANIM) ui.addEventListener(t, onAnim);
  // A pane scrolls: its thumb follows. A box with panes inside it scrolls (a panel): their bars move with them.
  const onScroll = (e: Event) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const own = panes.get(t);
    if (own) {
      thumb(own, 'x');
      thumb(own, 'y');
    }
    for (const p of panes.values()) if (p !== own && t.contains(p.el)) place(p);
  };
  ui.addEventListener('scroll', onScroll, { capture: true, passive: true });

  later(true);
  // (ui/fitBox.ts's audit settles the bars first, so it judges what the player sees once a re-render has landed.
  // On the element, not in this module: a dev server's hot reload can leave two copies of it.)
  const flush = () => {
    if (raf) cancelAnimationFrame(raf);
    if (timer) clearTimeout(timer);
    raf = 0;
    timer = 0;
    deep = true;
    lastScan = 0;
    run();
  };
  (ui as HTMLElement & { sbFlush?: () => void }).sbFlush = flush;
  return () => {
    live = false;
    delete (ui as HTMLElement & { sbFlush?: () => void }).sbFlush;
    mo.disconnect();
    htmlMo.disconnect();
    ro.disconnect();
    window.removeEventListener('resize', onResize);
    window.visualViewport?.removeEventListener('resize', onResize);
    document.fonts?.removeEventListener?.('loadingdone', onResize);
    for (const t of ANIM) ui.removeEventListener(t, onAnim);
    ui.removeEventListener('scroll', onScroll, { capture: true });
    if (raf) cancelAnimationFrame(raf);
    if (timer) clearTimeout(timer);
    for (const p of [...panes.values()]) untrack(p);
  };
}
