/**
 * The fit box (docs/UX.md section 10): every menu screen fully visible on every frame.
 *
 * The menus are laid out for landscape frames of at least 667 by 375 (an iPhone SE on its side). Outside that envelope
 * (a phone upright, an iPad upright, a phone on its side under Safari's bars and a portal's banner) a menu screen is
 * laid out at a landscape design box instead and scaled to fit the frame, centred, with the stadium around it:
 *
 * - upright or squarish frames (width / height under 1.25): 852 by 480, or 667 by 375 under 600 wide (bigger type);
 * - landscape frames under 667 wide or 375 tall: the frame itself scaled up to that minimum, same shape (wider than
 *   2.4 to 1 is held at 2.4 and letterboxed), so the screen fills the frame edge to edge.
 *
 * Inside the box the screen is its own size container (`container: app / size`) and its viewport units are the box's
 * (`--vw`, `--vh`, `--dvh`, `--vmin`... set in shell.css from the variables written here), so every `@container app`
 * rule and every unit sees the box, exactly as it would see a real frame of that size. Only `.screen` children of #ui
 * fit; the match HUD, the touch controls and the canvas never do.
 *
 * Pointer input needs nothing: hit testing follows the transform. Code that turns screen pixels into layout pixels
 * (a pane's scrollTop from client rects, the drag ghost's size) divides by `layoutScale(el)`.
 */

/** The envelope the menus are designed for: smaller or upright frames use the fit box. */
export const FIT_MIN_W = 667;
export const FIT_MIN_H = 375;
/** Width over height under this is treated as upright (a 4:5 or square window too). */
export const FIT_MIN_ASPECT = 1.25;
/** A small landscape frame wider than this (width over height) keeps this shape and is letterboxed. */
export const FIT_MAX_ASPECT = 2.4;
/** The design box for upright frames 600 wide and over (an iPad held upright, a tall desktop window). */
export const FIT_UPRIGHT = { w: 852, h: 480 } as const;
/** The design box for narrow upright frames (a phone held upright): the smallest layout, so its type is biggest. */
export const FIT_UPRIGHT_NARROW = { w: 667, h: 375 } as const;

export interface Fit {
  /** The box is in use (false: native layout, the screen fills the frame). */
  on: boolean;
  /** The box the screen is laid out at, in CSS pixels. */
  w: number;
  h: number;
  /** Its scale on screen (box * scale fits inside the frame). 1 when off. */
  scale: number;
  /** An upright frame: the box sits mid frame, clear of the notch (a landscape box reaches the frame's edges). */
  upright: boolean;
}

/** The smallest a label may draw on screen: 8px in a box shrunk under 0.8 (a 640 by 290 frame), 9px otherwise. */
export const FLOOR_SMALL = 8;
export const FLOOR = 9;
/** The floor never asks more than this of a layout (an upright phone's 0.58 would need 14px labels). */
export const FLOOR_MAX = 10.6;

/**
 * The layout size the smallest labels need inside a box at `scale` to draw at the floor on screen (0: none needed).
 * Written as `--fit-floor`; the small labels' rules take `max(their size, var(--fs-floor, 0px))` (shell.css).
 */
export function fitFloor(scale: number): number {
  if (!(scale > 0) || scale >= 1) return 0;
  const need = (scale < 0.8 ? FLOOR_SMALL : FLOOR) / scale;
  return Math.min(FLOOR_MAX, Math.ceil(need * 10 - 1e-6) / 10);
}

/** The fit for a frame of `fw` by `fh` CSS pixels (pure). */
export function fitFor(fw: number, fh: number): Fit {
  if (!(fw > 0 && fh > 0)) return { on: false, w: Math.max(0, fw), h: Math.max(0, fh), scale: 1, upright: false };
  if (fw / fh < FIT_MIN_ASPECT) {
    const box = fw >= 600 ? FIT_UPRIGHT : FIT_UPRIGHT_NARROW;
    return { on: true, w: box.w, h: box.h, scale: Math.min(fw / box.w, fh / box.h), upright: true };
  }
  if (fw >= FIT_MIN_W && fh >= FIT_MIN_H) return { on: false, w: fw, h: fh, scale: 1, upright: false };
  const k = Math.min(fw / FIT_MIN_W, fh / FIT_MIN_H);
  // (The epsilon: 290 / (290 / 375) must floor to 375, not 374.)
  const h = Math.max(FIT_MIN_H, Math.floor(fh / k + 1e-6));
  const w = Math.max(FIT_MIN_W, Math.min(Math.floor(fw / k + 1e-6), Math.floor(h * FIT_MAX_ASPECT)));
  return { on: true, w, h, scale: Math.min(fw / w, fh / h), upright: false };
}

/** Layout pixels per screen pixel for `el` (its rendered width over its layout width): 1 outside the fit box. */
export function layoutScale(el: HTMLElement): number {
  const w = el.offsetWidth;
  if (!w) return 1;
  const s = el.getBoundingClientRect().width / w;
  return s > 0.05 && Number.isFinite(s) ? s : 1;
}

// ------------------------------------------------------------------ toasts (docs/UX.md 7)

/** Where a toast stands, in client pixels, and the element it stands in for (hidden while it is up). */
interface ToastSlot { l: number; t: number; w: number; h: number; under: HTMLElement | null }

// (Not opacity: a screen still fading in is there all the same. A title a toast stands in for still counts.)
const isShown = (el: Element | null | undefined): el is HTMLElement =>
  !!el && el.getClientRects().length > 0
  && (el.classList.contains('toast-under') || ((el as HTMLElement).checkVisibility?.({ visibilityProperty: true }) ?? true));

/**
 * One spot for every toast, top centre, never over a button, a tile or a result line:
 * 1. a screen's header (MENU, the title, the wallet): the toast takes the title's place for its moment;
 * 2. a card's own title (PLAY IT AGAIN?, the gift): the same;
 * 3. the hub: its top bar, between the level and the wallet;
 * 4. anything else (a match: the score bug, the minimap, the top buttons): the widest free stretch of the top band.
 */
/**
 * Client rects of `els` as they will stand once their entrance animations end: a panel pops in (moved and scaled), and
 * a toast placed at that moment must not land where the header is in mid flight. (Rects, not offsets: LARGE text
 * zooms the panel's contents.)
 */
function settledRects(els: HTMLElement[], scr: HTMLElement): DOMRect[] {
  const anims = new Set<Animation>();
  for (const el of els) {
    for (let n: HTMLElement | null = el; n; n = n === scr ? null : n.parentElement) for (const a of n.getAnimations()) anims.add(a);
  }
  const held: [Animation, CSSNumberish | null][] = [];
  for (const a of anims) {
    const end = a.effect?.getComputedTiming().endTime;
    if (typeof end !== 'number' || !Number.isFinite(end)) continue;
    held.push([a, a.currentTime]);
    a.currentTime = end;
  }
  const out = els.map((e) => e.getBoundingClientRect());
  for (const [a, t] of held) a.currentTime = t;
  return out;
}

function toastSlot(ui: HTMLElement, toast: HTMLElement): ToastSlot {
  const screens = [...ui.querySelectorAll<HTMLElement>(':scope > .screen')].filter(isShown);
  const scr = screens[screens.length - 1];
  const title = scr?.querySelector<HTMLElement>('.mc-top > .mc-title');
  if (scr && isShown(title)) {
    const [r, bar] = settledRects([title, title.parentElement!], scr);
    return { l: r.left, t: bar.top, w: r.width, h: bar.height, under: title };
  }
  const h2 = scr?.querySelector<HTMLElement>('.panel > h2');
  if (scr && isShown(h2)) {
    const [r] = settledRects([h2], scr);
    return { l: r.left, t: r.top - 3, w: r.width, h: r.height + 6, under: h2 };
  }
  const hubTop = scr?.querySelector<HTMLElement>('.hub-top');
  const prog = hubTop?.querySelector<HTMLElement>('.hub-progress');
  const acts = hubTop?.querySelector<HTMLElement>('.hub-acts');
  if (scr && hubTop && isShown(prog) && isShown(acts)) {
    // (From what each side shows: the level's box is wider than its chip when TOMORROW steps aside for the strip.)
    const left = [...prog.children].filter(isShown);
    const right = [...acts.children].filter(isShown);
    const [r, ...q] = settledRects([hubTop, ...left, ...right], scr);
    const l = Math.max(r.left, ...q.slice(0, left.length).map((x) => x.right)) + 8;
    const rt = Math.min(r.right, ...q.slice(left.length).map((x) => x.left)) - 8;
    if (rt - l >= 120) return { l, t: r.top, w: rt - l, h: r.height, under: null };
  }
  // A match (or anything else): the first band from the top with a free stretch wide enough, so a toast fired as a
  // match starts sits beside the score bug and the commentary, or under them, never over them or a banner.
  const W = window.innerWidth;
  const H = window.innerHeight;
  const leaves: DOMRect[] = [];
  for (const el of ui.querySelectorAll<HTMLElement>('*')) {
    // (Here opacity counts: a HUD widget faded out is not in the way.)
    if (el === toast || toast.contains(el) || !isShown(el) || !(el.checkVisibility?.({ opacityProperty: true }) ?? true)) continue;
    if ((el.childElementCount && !/^(BUTTON|CANVAS|svg|IMG)$/.test(el.tagName)) || el.parentElement?.closest('svg')) continue;
    const r = el.getBoundingClientRect();
    // (A layer over the whole frame, the pitch's edge arrows say, draws nothing of its own there.)
    if (r.width < 1 || r.top > H * 0.6 || (r.width > W * 0.6 && r.height > H * 0.5)) continue;
    leaves.push(r);
  }
  const bandH = 44;
  for (let top = 6; top + bandH < H * 0.6; ) {
    const busy = leaves.filter((r) => r.bottom > top && r.top < top + bandH).map((r) => [r.left, r.right] as [number, number]);
    busy.sort((p, q) => p[0] - q[0]);
    let best = { l: 8, w: 0 };
    let x = 8;
    for (const [l, r] of [...busy, [W - 8, W] as [number, number]]) {
      if (l - x > best.w) best = { l: x, w: l - x };
      x = Math.max(x, r);
    }
    if (best.w >= 160) return { l: best.l + 4, t: top, w: best.w - 8, h: bandH, under: null };
    const low = Math.max(0, ...leaves.filter((r) => r.bottom > top && r.top < top + bandH).map((r) => r.bottom));
    top = Math.max(top + 12, low + 6);
  }
  return { l: 8, t: 6, w: W - 16, h: bandH, under: null };
}

/**
 * Put `toast` (already in the page, its text set) in its spot, sized to its text: one line, two at most, a step smaller
 * if it must, never under 9 px on screen. Returns the element it stands in for: the caller hides it (`toast-under`)
 * while the toast is up and shows it again after.
 */
export function placeToast(toast: HTMLElement, ui: HTMLElement): HTMLElement | null {
  const slot = toastSlot(ui, toast);
  // (A meta screen's toast sits inside its screen, which the fit box may scale: its own pixels are the screen's.)
  const host = getComputedStyle(toast).position === 'fixed' ? null : (toast.offsetParent as HTMLElement | null);
  const s = host ? layoutScale(host) : 1;
  const o = host ? host.getBoundingClientRect() : { left: 0, top: 0 };
  const w = slot.w / s;
  const h = slot.h / s;
  toast.classList.add('placed');
  const st = toast.style;
  st.left = '0px';
  st.top = '0px';
  st.bottom = 'auto';
  st.width = 'max-content';
  st.maxWidth = `${Math.max(80, Math.floor(w))}px`;
  st.fontSize = '';
  const base = parseFloat(getComputedStyle(toast).fontSize) || 15;
  const fit = (): boolean => {
    for (let px = base; px >= 9 / s; px -= 0.5) {
      st.fontSize = `${px}px`;
      if (toast.offsetHeight <= h + 0.5) return true;
    }
    return false;
  };
  // (Still too tall at the smallest type: the same words, closer together.)
  st.padding = '';
  st.lineHeight = '';
  if (!fit()) {
    st.padding = '2px 8px 1px';
    st.lineHeight = '1.05';
    fit();
  }
  st.left = `${Math.round((slot.l - o.left) / s + (w - toast.offsetWidth) / 2)}px`;
  st.top = `${Math.round((slot.t - o.top) / s + Math.max(0, (h - toast.offsetHeight) / 2))}px`;
  return slot.under;
}

let current: Fit = { on: false, w: 0, h: 0, scale: 1, upright: false };

/** The fit now in use (for code that maps pointer pixels to layout pixels). */
export function currentFit(): Fit {
  return current;
}

/**
 * Keep #ui's fit up to date: class `fit` and the variables `--fit-w`, `--fit-h`, `--fit-s` (+ the unit sizes) while
 * the box is on. Recomputed on resize, orientation change and the visual viewport's resize. Without container query
 * support nothing changes (the native layout stays).
 */
export function installFitBox(ui: HTMLElement): () => void {
  if (typeof window === 'undefined' || typeof CSS === 'undefined' || !CSS.supports?.('container-type', 'size')) return () => {};
  let raf = 0;
  const apply = () => {
    raf = 0;
    // #ui is fixed to the layout viewport: an on-screen keyboard (which only shrinks the visual one) leaves it be.
    const f = fitFor(ui.clientWidth || window.innerWidth, ui.clientHeight || window.innerHeight);
    if (f.on === current.on && f.w === current.w && f.h === current.h && f.scale === current.scale) return;
    current = f;
    ui.classList.toggle('fit', f.on);
    const set = (k: string, v: string | null) => (v === null ? ui.style.removeProperty(k) : ui.style.setProperty(k, v));
    set('--fit-w', f.on ? `${f.w}px` : null);
    set('--fit-h', f.on ? `${f.h}px` : null);
    set('--fit-s', f.on ? `${f.scale.toFixed(5)}` : null);
    set('--fit-vmin', f.on ? `${Math.min(f.w, f.h) / 100}px` : null);
    set('--fit-vmax', f.on ? `${Math.max(f.w, f.h) / 100}px` : null);
    set('--fit-edge', f.on ? (f.upright ? '0' : '1') : null);
    const floor = f.on ? fitFloor(f.scale) : 0;
    set('--fit-floor', floor ? `${floor}px` : null);
  };
  const later = () => {
    if (!raf) raf = requestAnimationFrame(apply);
  };
  apply();
  window.addEventListener('resize', later);
  window.addEventListener('orientationchange', later);
  window.visualViewport?.addEventListener('resize', later);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(later) : null;
  ro?.observe(ui);
  if (import.meta.env.DEV) (window as unknown as { __uiAudit: typeof uiAudit }).__uiAudit = uiAudit;
  return () => {
    window.removeEventListener('resize', later);
    window.removeEventListener('orientationchange', later);
    window.visualViewport?.removeEventListener('resize', later);
    ro?.disconnect();
    if (raf) cancelAnimationFrame(raf);
  };
}

/** One problem the audit found: what, where (a short selector path and its text), and by how many pixels. */
export interface AuditIssue {
  kind: 'spill' | 'clipped' | 'offscreen' | 'overlap' | 'text-overlap' | 'small';
  el: string;
  px: number;
  with?: string;
}

const INTERACTIVE = 'button, a[href], input, select, textarea, [data-a], [role=button], [data-drag]';

function label(el: Element): string {
  const cls = [...el.classList].slice(0, 3).join('.');
  const txt = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 24);
  return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}${txt ? ` "${txt}"` : ''}`;
}

const isScroller = (cs: CSSStyleDeclaration) => /(auto|scroll)/.test(cs.overflowX + cs.overflowY);

/**
 * The part of `el` not clipped by its overflow-hidden or scrolling ancestors up to `stop` (null: none of it shows).
 * `scrolled` tells whether a scrolling ancestor did any of the clipping (a list scrolled past it: fine).
 */
function visibleRect(el: Element, stop: Element, r0?: DOMRect): { r: DOMRect; scrolled: boolean } | null {
  const r = r0 ?? el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  let l = r.left, t = r.top, rt = r.right, b = r.bottom;
  let scrolled = false;
  for (let p = el.parentElement; p && p !== stop.parentElement; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
    const pr = p.getBoundingClientRect();
    const nl = Math.max(l, pr.left), nt = Math.max(t, pr.top), nr = Math.min(rt, pr.right), nb = Math.min(b, pr.bottom);
    if ((nl > l + 1 || nt > t + 1 || nr < rt - 1 || nb < b - 1) && isScroller(cs)) scrolled = true;
    l = nl; t = nt; rt = nr; b = nb;
    if (rt - l < 1 || b - t < 1) return scrolled ? null : { r: new DOMRect(l, t, 0, 0), scrolled };
  }
  return { r: new DOMRect(l, t, rt - l, b - t), scrolled };
}

/**
 * Dev only (`__uiAudit()` in the console): every open menu screen's fit problems, in screen pixels.
 * - spill: a line of text wider than its own box (it runs out of a chip or a button);
 * - clipped: text cut by a box that does not scroll (it can never be read whole);
 * - offscreen: an interactive element outside the frame, or cut by a box that does not scroll;
 * - overlap: two interactive elements, both on top at their centres, whose rects overlap;
 * - text-overlap: two pieces of text drawn over each other (tags colliding);
 * - small: text drawn under the floor on screen (FLOOR_SMALL in a box shrunk under 0.8, else FLOOR; MEDIUM text size).
 */
export function uiAudit(root: ParentNode = document): AuditIssue[] {
  const out: AuditIssue[] = [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // (Only where the floor holds: not under SMALL text, nor in a box shrunk past what FLOOR_MAX can lift, upright phones.)
  const floor = document.documentElement.classList.contains('ts-small') || (current.on && current.scale < FLOOR_SMALL / FLOOR_MAX) ? 0
    : current.on && current.scale < 0.8 ? FLOOR_SMALL : FLOOR;
  for (const scr of root.querySelectorAll<HTMLElement>('#ui > .screen')) {
    const texts: { node: Text; r: DOMRect; box: Element }[] = [];
    const walk = document.createTreeWalker(scr, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode() as Text | null; n; n = walk.nextNode() as Text | null) {
      if (!n.data.trim()) continue;
      let box = n.parentElement;
      while (box && box !== scr && /^(inline|contents)$/.test(getComputedStyle(box).display)) box = box.parentElement;
      if (!box || box.closest('svg')) continue;
      const cs = getComputedStyle(n.parentElement!);
      if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const rects = [...range.getClientRects()].filter((q) => q.width > 0.5 && q.height > 0.5);
      if (!rects.length) continue;
      // (The box's scale times the text size's zoom on the way up: a small badge's offsetWidth rounds too coarsely.)
      let zoom = 1;
      for (let e: Element | null = n.parentElement; e && e !== scr.parentElement; e = e.parentElement) zoom *= parseFloat(getComputedStyle(e).zoom) || 1;
      const drawn = parseFloat(cs.fontSize) * zoom * (current.on ? current.scale : 1);
      if (floor && drawn < floor - 0.05) out.push({ kind: 'small', el: label(box), px: Math.round(drawn * 10) / 10 });
      for (const r of rects) {
        const br = box.getBoundingClientRect();
        const spill = Math.max(br.left - r.left, r.right - br.right);
        if (spill > 1.5) out.push({ kind: 'spill', el: label(box), px: Math.round(spill) });
        const vis = visibleRect(box, scr, r);
        if (vis && !vis.scrolled) {
          const cut = Math.max(vis.r.left - r.left, r.right - vis.r.right, vis.r.top - r.top - r.height / 2, r.bottom - vis.r.bottom - r.height / 2);
          if (cut > 1.5) out.push({ kind: 'clipped', el: label(box), px: Math.round(cut) });
        }
        // (Only text drawn on top counts for text-overlap: a sheet's words over the dimmed screen under it are not a
        // collision. No hit at all, off the frame or no hit testing, still counts.)
        const hit = vis ? document.elementFromPoint(vis.r.left + vis.r.width / 2, vis.r.top + vis.r.height / 2) : null;
        const onTop = !hit || hit === n.parentElement || n.parentElement!.contains(hit) || hit.contains(n.parentElement);
        if (vis && vis.r.width > 1 && vis.r.height > 1 && onTop) texts.push({ node: n, r: vis.r, box });
      }
    }
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i], b = texts[j];
        if (a.node === b.node) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > 2 && h > Math.min(a.r.height, b.r.height) * 0.3) out.push({ kind: 'text-overlap', el: label(a.box), with: label(b.box), px: Math.round(Math.min(w, h)) });
      }
    }
    const items = [...scr.querySelectorAll<HTMLElement>(INTERACTIVE)]
      .map((el) => ({ el, v: visibleRect(el, scr) }))
      .filter((x): x is { el: HTMLElement; v: { r: DOMRect; scrolled: boolean } } => x.v !== null && x.v.r.width > 1);
    for (const { el, v } of items) {
      const r = v.r;
      const full = el.getBoundingClientRect();
      if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) out.push({ kind: 'offscreen', el: label(el), px: Math.round(Math.max(-r.left, -r.top, r.right - vw, r.bottom - vh)) });
      else if (!v.scrolled && (full.width - r.width > 2 || full.height - r.height > 2)) out.push({ kind: 'offscreen', el: label(el), px: Math.round(Math.max(full.width - r.width, full.height - r.height)) });
    }
    const top = items.filter(({ el, v }) => {
      const hit = document.elementFromPoint(v.r.left + v.r.width / 2, v.r.top + v.r.height / 2);
      return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
    });
    for (let i = 0; i < top.length; i++) {
      for (let j = i + 1; j < top.length; j++) {
        const a = top[i], b = top[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.v.r.right, b.v.r.right) - Math.max(a.v.r.left, b.v.r.left);
        const h = Math.min(a.v.r.bottom, b.v.r.bottom) - Math.max(a.v.r.top, b.v.r.top);
        if (w > 2 && h > 2) out.push({ kind: 'overlap', el: label(a.el), with: label(b.el), px: Math.round(Math.min(w, h)) });
      }
    }
  }
  return out;
}
