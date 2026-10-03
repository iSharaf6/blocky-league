/**
 * Drag and drop between items (docs/UX.md section 4): squad swaps, subs. Pointer events, so touch, mouse and pen
 * all work, alongside the screen's own tap-then-tap (a press that never moves is left to the click handler).
 *
 * Items carry `data-drag="<id>"` (any element matching `item`); every item is also a drop target. While dragging:
 * a ghost copy follows the pointer (`.drag-ghost`), the source dims (`.drag-src`), valid targets glow (`.drop-ok`)
 * and the one under the pointer lights up (`.drop-hover`). Dropping anywhere else cancels (the ghost flies back).
 *
 * Touch inside a scrolling list (`.pane-scroll`): a vertical swipe still scrolls the list; a sideways drag (towards
 * the pitch) or a short hold starts the drag. Elsewhere any move past a few pixels starts it.
 */

export interface DragSwapOptions {
  /** The draggable items, which are also the drop targets (default `[data-drag]`). */
  item?: string;
  /** May `from` be dropped on `to`? (Default: any other item.) */
  canDrop?: (from: string, to: string) => boolean;
  onDrop: (from: string, to: string) => void;
  /** A drag began (after the hold or the first real move). */
  onStart?: (from: string) => void;
  /** A drag ended: dropped on a valid target, or cancelled. */
  onEnd?: (dropped: boolean) => void;
}

/** Pixels a press may wander before it counts as a drag. */
const SLOP = 8;
/** A touch held this long inside a list starts a drag without moving. */
const HOLD_MS = 280;
/** Pixels from a list's top or bottom edge where a drag scrolls it. */
const EDGE = 30;

interface Press {
  id: string;
  el: HTMLElement;
  pid: number;
  touch: boolean;
  inList: boolean;
  x0: number;
  y0: number;
  x: number;
  y: number;
  hold: number;
  dragging: boolean;
  ghost: HTMLElement | null;
  /** Where the press sat inside the item (the ghost keeps that grip). */
  gx: number;
  gy: number;
  over: HTMLElement | null;
}

export function bindDragSwap(root: HTMLElement, o: DragSwapOptions): () => void {
  const sel = o.item ?? '[data-drag]';
  let st: Press | null = null;
  let swallowUntil = 0;
  const idOf = (el: Element) => (el as HTMLElement).dataset.drag ?? '';
  const ok = (from: string, to: string) => from !== to && (o.canDrop?.(from, to) ?? true);
  const items = () => Array.from(root.querySelectorAll<HTMLElement>(sel));

  const place = (s: Press) => {
    if (s.ghost) s.ghost.style.transform = `translate(${Math.round(s.x - s.gx)}px, ${Math.round(s.y - s.gy)}px) scale(1.08)`;
  };

  const start = (s: Press) => {
    if (s.dragging || !s.el.isConnected) return;
    s.dragging = true;
    window.clearTimeout(s.hold);
    const r = s.el.getBoundingClientRect();
    s.gx = s.x0 - r.left;
    s.gy = s.y0 - r.top;
    const g = s.el.cloneNode(true) as HTMLElement;
    // The ghost lives on <body>: it takes the custom properties (kit colours, token size) its source inherited.
    const cs = getComputedStyle(s.el);
    for (let i = 0; i < cs.length; i++) {
      const n = cs[i];
      if (n.startsWith('--')) g.style.setProperty(n, cs.getPropertyValue(n));
    }
    g.classList.remove('sel', 'hot', 'drop-ok', 'drop-hover', 'drag-src');
    g.classList.add('drag-ghost');
    for (const a of ['data-drag', 'data-a', 'data-k', 'id', 'aria-label']) g.removeAttribute(a);
    g.setAttribute('aria-hidden', 'true');
    Object.assign(g.style, {
      position: 'fixed', left: '0', top: '0', right: 'auto', bottom: 'auto', margin: '0', width: `${r.width}px`, height: `${r.height}px`,
      pointerEvents: 'none', zIndex: '1000', transition: 'none', fontFamily: cs.fontFamily,
    });
    document.body.appendChild(g);
    s.ghost = g;
    place(s);
    s.el.classList.add('drag-src');
    root.classList.add('dragging');
    for (const el of items()) if (ok(s.id, idOf(el))) el.classList.add('drop-ok');
    o.onStart?.(s.id);
  };

  const clear = () => {
    root.classList.remove('dragging');
    root.querySelectorAll('.drop-ok, .drop-hover, .drag-src').forEach((el) => el.classList.remove('drop-ok', 'drop-hover', 'drag-src'));
  };

  const finish = (drop: boolean) => {
    const s = st;
    st = null;
    if (!s) return;
    window.clearTimeout(s.hold);
    if (!s.dragging) return;
    // A slow tap (held, never moved) is still a tap: its click goes through. After a real drag, the click the
    // browser sends is not a tap.
    const moved = Math.hypot(s.x - s.x0, s.y - s.y0) >= SLOP;
    if (moved) swallowUntil = performance.now() + 450;
    const to = drop && s.over ? idOf(s.over) : '';
    const g = s.ghost;
    if (g && !to && s.el.isConnected) {
      // Cancelled: the ghost flies home, then goes.
      const r = s.el.getBoundingClientRect();
      g.style.transition = 'transform 0.16s ease-out, opacity 0.16s';
      g.style.transform = `translate(${Math.round(r.left)}px, ${Math.round(r.top)}px) scale(1)`;
      g.style.opacity = '0.4';
      window.setTimeout(() => g.remove(), 170);
    } else g?.remove();
    clear();
    if (to) o.onDrop(s.id, to);
    o.onEnd?.(!!to);
  };

  /** Near a list's top or bottom edge, the list scrolls under the ghost (a long bench). */
  const edgeScroll = (x: number, y: number) => {
    for (const pane of root.querySelectorAll<HTMLElement>('.pane-scroll')) {
      const r = pane.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top - EDGE || y > r.bottom + EDGE) continue;
      if (y < r.top + EDGE) pane.scrollTop -= 8;
      else if (y > r.bottom - EDGE) pane.scrollTop += 8;
    }
  };

  const move = (s: Press) => {
    place(s);
    edgeScroll(s.x, s.y);
    const hit = document.elementFromPoint(s.x, s.y)?.closest<HTMLElement>(sel) ?? null;
    const over = hit && root.contains(hit) && hit !== s.el && ok(s.id, idOf(hit)) ? hit : null;
    if (over !== s.over) {
      s.over?.classList.remove('drop-hover');
      over?.classList.add('drop-hover');
      s.over = over;
    }
  };

  const onDown = (e: PointerEvent) => {
    if (st || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const el = (e.target as Element).closest<HTMLElement>(sel);
    if (!el || !root.contains(el) || (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return;
    const touch = e.pointerType !== 'mouse';
    const s: Press = {
      id: idOf(el), el, pid: e.pointerId, touch, inList: !!el.closest('.pane-scroll'),
      x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, hold: 0, dragging: false, ghost: null, gx: 0, gy: 0, over: null,
    };
    if (touch) s.hold = window.setTimeout(() => st === s && start(s), HOLD_MS);
    st = s;
  };

  const onMove = (e: PointerEvent) => {
    const s = st;
    if (!s || e.pointerId !== s.pid) return;
    s.x = e.clientX;
    s.y = e.clientY;
    if (!s.dragging) {
      const dx = s.x - s.x0;
      const dy = s.y - s.y0;
      if (Math.hypot(dx, dy) < SLOP) return;
      // A vertical swipe on a list is a scroll, not a drag.
      if (s.touch && s.inList && Math.abs(dy) > Math.abs(dx)) {
        window.clearTimeout(s.hold);
        st = null;
        return;
      }
      start(s);
    }
    move(s);
  };

  const onUp = (e: PointerEvent) => {
    if (st && e.pointerId === st.pid) finish(true);
  };
  const onCancel = (e: PointerEvent) => {
    if (st && e.pointerId === st.pid) finish(false);
  };
  // Once a drag is under way the finger no longer scrolls the list or the page.
  const onTouchMove = (e: TouchEvent) => {
    if (st?.dragging && e.cancelable) e.preventDefault();
  };
  const onClick = (e: MouseEvent) => {
    if (performance.now() < swallowUntil) {
      swallowUntil = 0;
      e.stopPropagation();
      e.preventDefault();
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (st?.dragging && e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      finish(false);
    }
  };
  const onMenu = (e: Event) => {
    if (st) e.preventDefault();
  };
  // The browser's own image drag (a face tile) would cancel ours.
  const onNativeDrag = (e: Event) => {
    if ((e.target as Element | null)?.closest?.(sel)) e.preventDefault();
  };

  root.addEventListener('pointerdown', onDown);
  root.addEventListener('dragstart', onNativeDrag);
  root.addEventListener('touchmove', onTouchMove, { passive: false });
  root.addEventListener('click', onClick, true);
  root.addEventListener('contextmenu', onMenu);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey, true);
  return () => {
    finish(false);
    root.removeEventListener('pointerdown', onDown);
    root.removeEventListener('dragstart', onNativeDrag);
    root.removeEventListener('touchmove', onTouchMove);
    root.removeEventListener('click', onClick, true);
    root.removeEventListener('contextmenu', onMenu);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, true);
  };
}
