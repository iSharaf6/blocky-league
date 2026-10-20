/**
 * Drag to scroll (docs/UX.md section 7): every strip or list on a menu screen that holds more than fits moves under a
 * finger AND under a mouse. Browsers scroll an overflowing box by touch on their own, but not by a mouse drag, and a
 * page with `touch-action: none` on <body> (style.css) can stop a phone's native pan too; this does it by hand.
 *
 * One delegated listener on #ui. A press on a screen inside a box that scrolls (overflow auto or scroll, with more
 * content than room) becomes a scroll once it moves past a few pixels along a scrolling axis; then the click that
 * ends it is swallowed, so a drag never also taps the chip or tile under it. A press that never moves is a tap.
 * Items that drag themselves (`[data-drag]`, ui/dragSwap.ts), form fields and range sliders are left alone. A mouse
 * wheel over a strip that only scrolls sideways moves it sideways.
 *
 * Every pane that scrolls also shows a bar that is always visible (ui/scrollbars.ts), installed here with it, so a
 * pane that can be dragged always says so, iOS included.
 */
import { layoutScale } from './fitBox';
import { installScrollbars } from './scrollbars';

/** Pixels a press may wander before it counts as a scroll. */
const SLOP = 6;

const SKIP = '[data-drag], input, textarea, select, [contenteditable=""], [contenteditable="true"], .no-dragscroll';

function scroller(from: Element | null, stop: Element): { el: HTMLElement; x: boolean; y: boolean } | null {
  for (let el = from as HTMLElement | null; el && el !== stop; el = el.parentElement) {
    const cs = getComputedStyle(el);
    const x = /(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1;
    const y = /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1;
    if (x || y) return { el, x, y };
  }
  return null;
}

export function installDragScroll(ui: HTMLElement): () => void {
  let st: { pid: number; el: HTMLElement; x: boolean; y: boolean; x0: number; y0: number; l0: number; t0: number; k: number; on: boolean } | null = null;
  let swallowUntil = 0;

  const down = (e: PointerEvent) => {
    if (st || (e.pointerType === 'mouse' && e.button !== 0) || !e.isPrimary) return;
    const t = e.target as Element | null;
    const scr = t?.closest('#ui > .screen');
    if (!t || !scr || t.closest(SKIP)) return;
    const s = scroller(t, scr.parentElement ?? ui);
    if (!s) return;
    st = { pid: e.pointerId, el: s.el, x: s.x, y: s.y, x0: e.clientX, y0: e.clientY, l0: s.el.scrollLeft, t0: s.el.scrollTop, k: 1, on: false };
  };
  const move = (e: PointerEvent) => {
    const s = st;
    if (!s || e.pointerId !== s.pid) return;
    const dx = e.clientX - s.x0;
    const dy = e.clientY - s.y0;
    if (!s.on) {
      // Only along an axis the box scrolls: a sideways drag on a vertical list is left to whatever else wants it.
      const along = (s.x && Math.abs(dx) >= SLOP && Math.abs(dx) >= Math.abs(dy)) || (s.y && Math.abs(dy) >= SLOP && Math.abs(dy) >= Math.abs(dx));
      if (!along) return;
      s.on = true;
      s.k = layoutScale(s.el);
      // The browser may have started its own pan (a touch): it then cancels this pointer, and its pan wins.
      try {
        s.el.setPointerCapture(s.pid);
      } catch {
        /* the pointer is already gone */
      }
      s.el.classList.add('drag-scrolling');
    }
    if (s.x) s.el.scrollLeft = s.l0 - dx / s.k;
    if (s.y) s.el.scrollTop = s.t0 - dy / s.k;
    if (e.cancelable) e.preventDefault();
  };
  const end = (e: PointerEvent) => {
    const s = st;
    if (!s || e.pointerId !== s.pid) return;
    st = null;
    if (s.on) {
      s.el.classList.remove('drag-scrolling');
      if (e.type === 'pointerup') swallowUntil = performance.now() + 400;
    }
  };
  const click = (e: MouseEvent) => {
    if (performance.now() < swallowUntil) {
      swallowUntil = 0;
      e.stopPropagation();
      e.preventDefault();
    }
  };
  // A wheel over a strip that only scrolls sideways (the shop's tabs, a journey's tiers) moves it sideways.
  const wheel = (e: WheelEvent) => {
    if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    const t = e.target as Element | null;
    const scr = t?.closest('#ui > .screen');
    if (!t || !scr) return;
    const s = scroller(t, scr.parentElement ?? ui);
    if (!s || !s.x || s.y) return;
    s.el.scrollLeft += e.deltaY;
    e.preventDefault();
  };
  ui.addEventListener('pointerdown', down, true);
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  ui.addEventListener('click', click, true);
  ui.addEventListener('wheel', wheel, { passive: false });
  const bars = installScrollbars(ui);
  return () => {
    bars();
    ui.removeEventListener('pointerdown', down, true);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    ui.removeEventListener('click', click, true);
    ui.removeEventListener('wheel', wheel);
  };
}
