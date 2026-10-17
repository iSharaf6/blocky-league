/**
 * Off-screen team-mate indicators: a small chevron in the team colour at the screen edge pointing at each of
 * the human's team-mates outside the frame, with his shirt number, fading with his distance from the ball.
 * The one a PASS pressed now would go to (Match.passPreview) is lit white and a touch bigger; the THROUGH
 * target gets a lighter rim. The session decides when they show (our ball or a loose one near us, open play
 * on the broadcast shot only) and projects the players; this only lays the arrows out and draws them.
 */

/** One team-mate, as the session sees him this frame. */
export interface EdgeMate {
  /** Player index (a stable key). */
  idx: number;
  /** Where he is on screen (CSS px from the viewport's top left; may be far outside it). */
  x: number;
  y: number;
  /** Shirt number. */
  num: number;
  /** 0..1: fades with his distance from the ball. */
  alpha: number;
  /** 0..1: how much of the PASS / THROUGH preview highlight he wears (the ring on the pitch, cross-faded). */
  pass: number;
  through: number;
}

export interface EdgeRect {
  l: number;
  t: number;
  r: number;
  b: number;
}

/** Nearest two arrows may sit to each other along an edge (px). */
const GAP = 34;
/** A team-mate this far (px) inside the viewport edge still counts as on screen (no arrow). */
const ON_SCREEN = 6;
/** Badge offset inwards from the arrow (px). */
const BADGE = 18;

/** An arrow moves only once it is this much (device px) off where it was drawn. */
const STEP_HOLD = 0.75;
/**
 * What an arrow paints around its anchor (px): the chevron's reach (1.25x lit), the number badge's half width and
 * height (1.15x lit), centred BADGE px inwards. A HUD box is kept CLEAR px clear of all of it.
 */
const ARROW_R = 14;
const ARROW_R_LIT = 17;
const NUM_HW = 12;
const NUM_HH = 11;
const NUM_LIT = 1.15;
const CLEAR = 6;
/** Opacity an arrow regains per frame once a HUD box, or a stronger arrow, leaves it a clear spot again. */
const VIS_STEP = 0.2;

interface Slot {
  el: HTMLDivElement;
  arrow: SVGSVGElement;
  num: HTMLElement;
  n: number;
  key: string;
  cls: string;
  /** Where it was last drawn (CSS px). */
  x: number;
  y: number;
  /** 0..1: eased out while it has no spot clear of the HUD boxes and the stronger arrows. */
  vis: number;
}

/** The box an arrow anchored at (x, y), pointing along (ux, uy), paints (the chevron and its number badge). */
function footprint(x: number, y: number, ux: number, uy: number, lit: boolean): EdgeRect {
  const r = lit ? ARROW_R_LIT : ARROW_R;
  const hw = lit ? NUM_HW * NUM_LIT : NUM_HW;
  const hh = lit ? NUM_HH * NUM_LIT : NUM_HH;
  const bx = x - Math.round(ux * BADGE);
  const by = y - Math.round(uy * BADGE);
  return { l: Math.min(x - r, bx - hw), t: Math.min(y - r, by - hh), r: Math.max(x + r, bx + hw), b: Math.max(y + r, by + hh) };
}

/** Do two boxes overlap, with `pad` px of clearance kept between them? */
function meets(a: EdgeRect, b: EdgeRect, pad: number): boolean {
  return a.l < b.r + pad && a.r > b.l - pad && a.t < b.b + pad && a.b > b.t - pad;
}

export class EdgeArrows {
  readonly root: HTMLDivElement;
  private slots = new Map<number, Slot>();
  private shown = false;

  constructor(fill: number, edge: number) {
    this.root = document.createElement('div');
    this.root.className = 'hud-edge';
    this.root.setAttribute('aria-hidden', 'true');
    const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
    const lum = (0.299 * ((fill >> 16) & 255) + 0.587 * ((fill >> 8) & 255) + 0.114 * (fill & 255)) / 255;
    this.root.style.setProperty('--ea-fill', css(fill));
    this.root.style.setProperty('--ea-edge', css(edge));
    this.root.style.setProperty('--ea-text', lum > 0.56 ? '#26262e' : '#fbfbf4');
  }

  /** Nothing to show (the session's conditions are off). */
  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    for (const s of this.slots.values()) s.el.style.display = 'none';
  }

  /**
   * Lay out and draw this frame's arrows: `mates` all of them (on screen or not), `fade` the overall opacity
   * (eased by the session), `box` the band the arrows stay inside (clear of the score bug and the bottom HUD),
   * `avoid` screen boxes an arrow slides out of along its edge (the minimap, the touch buttons and stick, the ticker);
   * one with no clear spot left fades out.
   */
  update(mates: EdgeMate[], fade: number, box: EdgeRect, avoid: EdgeRect[]): void {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const cx = W / 2;
    const cy = H / 2;
    type P = { m: EdgeMate; x: number; y: number; ux: number; uy: number; vert: boolean; lit: boolean; free: boolean };
    const placed: P[] = [];
    for (const m of mates) {
      if (m.x > ON_SCREEN && m.x < W - ON_SCREEN && m.y > ON_SCREEN && m.y < H - ON_SCREEN) continue;
      const dx = m.x - cx;
      const dy = m.y - cy;
      const d = Math.hypot(dx, dy);
      if (d < 1) continue;
      const ux = dx / d;
      const uy = dy / d;
      // Where the ray from the centre towards him leaves the box.
      const tx = ux > 0 ? (box.r - cx) / ux : ux < 0 ? (box.l - cx) / ux : Infinity;
      const ty = uy > 0 ? (box.b - cy) / uy : uy < 0 ? (box.t - cy) / uy : Infinity;
      const t = Math.max(0, Math.min(tx, ty));
      placed.push({ m, x: cx + ux * t, y: cy + uy * t, ux, uy, vert: tx <= ty, lit: m.pass > 0.5, free: true });
    }
    // Slide out of the HUD boxes along the edge (past the minimap, the stick, the buttons, the ticker), the whole
    // chevron and its number kept CLEAR of them: whichever way is nearer and still inside the band.
    const slide = (p: P): void => {
      for (let it = 0; it < 3; it++) {
        let moved = false;
        for (const a of avoid) {
          const f = footprint(p.x, p.y, p.ux, p.uy, p.lit);
          if (!meets(f, a, CLEAR)) continue;
          if (p.vert) {
            const up = a.t - CLEAR - (f.b - p.y);
            const down = a.b + CLEAR + (p.y - f.t);
            const okUp = up >= box.t;
            const okDown = down <= box.b;
            if (!okUp && !okDown) continue;
            p.y = okUp && (!okDown || p.y - up <= down - p.y) ? up : down;
          } else {
            const left = a.l - CLEAR - (f.r - p.x);
            const right = a.r + CLEAR + (p.x - f.l);
            const okL = left >= box.l;
            const okR = right <= box.r;
            if (!okL && !okR) continue;
            p.x = okL && (!okR || p.x - left <= right - p.x) ? left : right;
          }
          moved = true;
        }
        if (!moved) break;
      }
    };
    for (const p of placed) slide(p);
    // Two team-mates in much the same direction: spread along the edge, never stacked on one spot.
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) {
          const a = placed[i];
          const b = placed[j];
          if (a.vert !== b.vert) continue;
          const along = a.vert ? b.y - a.y : b.x - a.x;
          const across = a.vert ? b.x - a.x : b.y - a.y;
          if (Math.abs(across) > GAP || Math.abs(along) >= GAP) continue;
          const push = (GAP - Math.abs(along)) / 2;
          const s = along >= 0 ? 1 : -1;
          if (a.vert) {
            a.y -= push * s;
            b.y += push * s;
          } else {
            a.x -= push * s;
            b.x += push * s;
          }
        }
      }
      for (const p of placed) {
        p.x = Math.min(box.r, Math.max(box.l, p.x));
        p.y = Math.min(box.b, Math.max(box.t, p.y));
      }
    }
    // The spread and the band may have pushed one back into a box. Whatever still has no clear spot (boxed in
    // between two HUD boxes, or on top of a stronger arrow round a corner) fades out until it has one.
    const rank = (p: P) => Math.max(p.m.alpha, p.m.through * 1.5, p.m.pass * 2);
    placed.sort((a, b) => rank(b) - rank(a));
    const kept: EdgeRect[] = [];
    for (const p of placed) {
      slide(p);
      const f = footprint(p.x, p.y, p.ux, p.uy, p.lit);
      p.free = !avoid.some((a) => meets(f, a, 0)) && !kept.some((k) => meets(f, k, -2));
      if (p.free) kept.push(f);
    }
    const live = new Set<number>();
    for (const p of placed) {
      const m = p.m;
      live.add(m.idx);
      const s = this.slot(m.idx);
      if (s.n !== m.num) {
        s.n = m.num;
        s.num.textContent = String(m.num);
      }
      const cls = m.pass > 0.5 ? 'ea pass' : m.through > 0.5 ? 'ea through' : 'ea';
      if (cls !== s.cls) {
        s.cls = cls;
        s.el.className = cls;
      }
      // Device pixels, moved only past STEP_HOLD of one (no flicker between two of them while its man barely
      // moves) / twentieths of opacity: style writes only when something visible changed.
      const dpr = window.devicePixelRatio || 1;
      if (Math.abs(p.x - s.x) * dpr > STEP_HOLD) s.x = Math.round(p.x * dpr) / dpr;
      if (Math.abs(p.y - s.y) * dpr > STEP_HOLD) s.y = Math.round(p.y * dpr) / dpr;
      const x = s.x;
      const y = s.y;
      // (Out at once, never drawn over what it lost its spot to; back in eased.)
      s.vis = p.free ? Math.min(1, s.vis + VIS_STEP) : 0;
      const op = Math.round(Math.min(1, Math.max(m.alpha, m.pass, m.through) * fade) * s.vis * 20) / 20;
      const deg = Math.round((Math.atan2(p.uy, p.ux) * 180) / Math.PI);
      const key = `${x},${y},${op},${deg}`;
      if (key !== s.key) {
        s.key = key;
        s.el.style.transform = `translate(${x}px, ${y}px)`;
        s.el.style.opacity = String(op);
        s.arrow.style.rotate = `${deg}deg`;
        s.num.style.translate = `${Math.round(-p.ux * BADGE)}px ${Math.round(-p.uy * BADGE)}px`;
      }
      s.el.style.display = '';
    }
    for (const [idx, s] of this.slots) if (!live.has(idx)) s.el.style.display = 'none';
    this.shown = placed.length > 0;
  }

  private slot(idx: number): Slot {
    let s = this.slots.get(idx);
    if (s) return s;
    const el = document.createElement('div');
    el.className = 'ea';
    el.innerHTML = '<svg class="ea-arrow" viewBox="-12 -12 24 24"><path d="M-6 -9 L10 0 L-6 9 L-2 0 Z"/></svg><b class="ea-num"></b>';
    this.root.appendChild(el);
    s = { el, arrow: el.querySelector('svg')!, num: el.querySelector('b')!, n: -1, key: '', cls: 'ea', x: -1e4, y: -1e4, vis: 1 };
    this.slots.set(idx, s);
    return s;
  }
}
