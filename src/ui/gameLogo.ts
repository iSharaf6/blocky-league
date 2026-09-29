/**
 * The Blocky League game logo as crisp inline SVG, with no font dependency:
 *
 *  - the WORDMARK: "BLOCKY" (cream) over "LEAGUE" (yellow) in Silkscreen Bold's own pixel grid (the glyph bitmaps
 *    below were read back from the game's Silkscreen 700 face, one cell = one font pixel), with the title
 *    screen's dark outline and chunky drop;
 *  - the MARK: the game's voxel football (src/render/characters.ts buildBallGeometry's algorithm: a sphere on a
 *    voxel grid with twelve icosahedron-direction patches, here on a 16³ grid so the pentagons read at logo
 *    size) sitting on a square of pitch with one white line, drawn as an orthographic 3/4 view with the
 *    renderer's face tints (src/render/voxel.ts: top 1.0, sides 0.9) and a hard sun shadow;
 *  - the LOCKUPS: horizontal (mark left, wordmark right), stacked (mark above), and the mark alone.
 *
 * Everything is in "cell" units (one Silkscreen pixel) and scales to any size; the wordmark is crispEdges so
 * its rects stay hard. The store icons and covers (store-assets/) are rendered from these same functions, so
 * the in-game title and the store art are one logo. See docs/BRAND.md.
 */

export const LOGO_INK = '#26262e';
export const LOGO_CREAM = '#fbfbf4';
export const LOGO_YELLOW = '#ffd23a';
export const LOGO_SKY = '#5cc8f5';

/** Silkscreen Bold, 5 cells tall, as read from the font ('.' clear, 'X' ink; ink columns only). */
const GLYPHS: Record<string, readonly string[]> = {
  B: ['XXXX.', 'XX.XX', 'XXXXX', 'XX.XX', 'XXXX.'],
  L: ['XX..', 'XX..', 'XX..', 'XX..', 'XXXX'],
  O: ['.XXX.', 'XX.XX', 'XX.XX', 'XX.XX', '.XXX.'],
  C: ['.XXX.', 'XX.XX', 'XX...', 'XX.XX', '.XXX.'],
  K: ['XX.XX', 'XXX..', 'XX...', 'XXX..', 'XX.XX'],
  Y: ['XX..XX', '.XXXX.', '..XX..', '..XX..', '..XX..'],
  E: ['XXXX', 'XX..', 'XXXX', 'XX..', 'XXXX'],
  A: ['.XXX.', 'XX.XX', 'XXXXX', 'XX.XX', 'XX.XX'],
  G: ['.XXXX', 'XX...', 'XX.XX', 'XX.XX', '.XXX.'],
  U: ['XX.XX', 'XX.XX', 'XX.XX', 'XX.XX', '.XXX.'],
};
const CAP = 5;
/** Silkscreen's natural letter gap (one cell of side bearing on each side). */
const GAP = 2;

interface Rect { x: number; y: number; w: number; h: number }

/** Horizontal runs of ink for a word, as cell rects with the word's left edge at 0. Width = the ink width. */
function wordRects(word: string): { rects: Rect[]; width: number } {
  const rects: Rect[] = [];
  let x = 0;
  for (const ch of word) {
    const rows = GLYPHS[ch];
    if (!rows) throw new Error(`gameLogo: no glyph for "${ch}"`);
    rows.forEach((row, y) => {
      let start = -1;
      for (let i = 0; i <= row.length; i++) {
        const on = i < row.length && row[i] === 'X';
        if (on && start < 0) start = i;
        if (!on && start >= 0) { rects.push({ x: x + start, y, w: i - start, h: 1 }); start = -1; }
      }
    });
    x += rows[0].length + GAP;
  }
  return { rects, width: x - GAP };
}

const WORD_1 = wordRects('BLOCKY');
const WORD_2 = wordRects('LEAGUE');
/** Cells between the two lines' cap boxes (the title screen's line-height 0.86 gives ~1.9). */
const LINE_GAP = 2;
/** Wordmark ink box in cells. */
export const WORDMARK_CELLS = { w: Math.max(WORD_1.width, WORD_2.width), h: CAP * 2 + LINE_GAP };

export interface WordmarkStyle {
  /** Outline thickness in cells (the title's dark edge). */
  outline?: number;
  /** Drop (extrusion below) in cells. */
  drop?: number;
  ink?: string;
  top?: string;
  bottom?: string;
}
const WORD_STYLE: Required<WordmarkStyle> = { outline: 0.25, drop: 0.75, ink: LOGO_INK, top: LOGO_CREAM, bottom: LOGO_YELLOW };

function rectsSvg(rects: Rect[], dx: number, dy: number, grow: number, fill: string): string {
  let s = `<g fill="${fill}">`;
  for (const r of rects) s += `<rect x="${r.x + dx - grow}" y="${r.y + dy - grow}" width="${r.w + grow * 2}" height="${r.h + grow * 2}"/>`;
  return s + '</g>';
}

/**
 * The wordmark's SVG body (no <svg> wrapper), in cell units with the ink box's top-left at (0, 0): the two lines
 * centred on each other, each as a dark outline + drop layer under the coloured ink.
 */
export function wordmarkBody(style: WordmarkStyle = {}): string {
  const st = { ...WORD_STYLE, ...style };
  const cx1 = (WORDMARK_CELLS.w - WORD_1.width) / 2;
  const cx2 = (WORDMARK_CELLS.w - WORD_2.width) / 2;
  const y2 = CAP + LINE_GAP;
  // Shadow layer: the outline grown around every rect, plus the same shape pushed down by the drop in quarter-cell
  // steps, so the drop reads as a solid slab under each letter (like the title's stacked text-shadows).
  const shadow = (rects: Rect[], dx: number, dy: number) => {
    const steps = Math.max(1, Math.ceil(st.drop / 0.25));
    let out = '';
    for (let i = 0; i <= steps; i++) out += rectsSvg(rects, dx, dy + (st.drop * i) / steps, st.outline, st.ink);
    return out;
  };
  return shadow(WORD_1.rects, cx1, 0) + shadow(WORD_2.rects, cx2, y2) + rectsSvg(WORD_1.rects, cx1, 0, 0, st.top) + rectsSvg(WORD_2.rects, cx2, y2, 0, st.bottom);
}

/** Outer box of the wordmark including outline and drop, in cells: [x, y, w, h] relative to the ink box origin. */
export function wordmarkBox(style: WordmarkStyle = {}): [number, number, number, number] {
  const st = { ...WORD_STYLE, ...style };
  return [-st.outline, -st.outline, WORDMARK_CELLS.w + st.outline * 2, WORDMARK_CELLS.h + st.outline * 2 + st.drop];
}

/** The wordmark alone as an <svg>, `heightPx` tall (outline and drop included). */
export function wordmarkSvg(heightPx: number, style: WordmarkStyle = {}, cls = 'bl-wordmark'): string {
  const [bx, by, bw, bh] = wordmarkBox(style);
  const w = Math.round((heightPx * bw) / bh);
  return `<svg class="${cls}" width="${w}" height="${heightPx}" viewBox="${bx} ${by} ${bw} ${bh}" shape-rendering="crispEdges" role="img" aria-label="Blocky League">${wordmarkBody(style)}</svg>`;
}

// ------------------------------------------------------------------------------------------------ the mark

export interface MarkOptions {
  /** Ball voxel grid and patch threshold: the game's own ball is n = 8, patch 0.9 (BALL_LOOK.classic). */
  n: number;
  patch: number;
  /** Ball spin about +y (degrees) so a pentagon faces the camera. */
  rot: number;
  /** Ball radius in tile voxels (8 across, like the game's 8³ ball). */
  r: number;
  /** Pitch tile: side and thickness in voxels, the white line's column, the mown-stripe width. */
  tile: number;
  thick: number;
  line: number;
  stripe: number;
  /** Camera: yaw about +y and pitch above the ground (degrees) for the orthographic 3/4 view. */
  yaw: number;
  pitch: number;
  /** Direction towards the sun (world.ts LOOKS.day offset with z flipped so the shadow falls in front of the ball). */
  sun: readonly [number, number, number];
}
export const MARK_DEFAULT: MarkOptions = {
  n: 16, patch: 0.95, rot: 30, r: 4,
  tile: 14, thick: 3, line: 3, stripe: 3,
  yaw: 38, pitch: 34,
  sun: [-44, 48, -30],
};

const BALL_BASE = 0xfbfbf6;
const BALL_PATCH = 0x26262e;
const GRASS_A = 0xa2d65c;
const GRASS_B = 0x88c247;
const LINE = 0xfbfbf4;
const SHADOW = 0.66;

type V3 = readonly [number, number, number];
const ICO: V3[] = (() => {
  const phi = (1 + Math.sqrt(5)) / 2;
  return ([
    [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
    [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
    [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
  ] as V3[]).map(([x, y, z]) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l] as const; });
})();

/** A voxel object: integer grid cells (key "x,y,z") with a colour and a shade factor, placed in the world by scale + origin. */
interface VoxelObject {
  cells: Map<string, { c: number; s: number }>;
  scale: number;
  origin: V3;
}

/** The ball's cells (buildBallGeometry's loop) on an n³ grid, patches sampled on a grid spun by `rot` about +y. */
function ballObject(n: number, patch: number, rot: number, r: number): VoxelObject {
  const cells = new Map<string, { c: number; s: number }>();
  const c = (n - 1) / 2;
  const rad = n / 2;
  const a = (rot * Math.PI) / 180;
  const cr = Math.cos(a), sr = Math.sin(a);
  for (let x = 0; x < n; x++)
    for (let y = 0; y < n; y++)
      for (let z = 0; z < n; z++) {
        const dx = x - c, dy = y - c, dz = z - c;
        const d = Math.hypot(dx, dy, dz);
        if (d > rad - 0.05) continue;
        const qx = dx * cr - dz * sr, qz = dx * sr + dz * cr;
        let col = BALL_BASE;
        const l = d || 1;
        for (const v of ICO) if ((qx * v[0] + dy * v[1] + qz * v[2]) / l > patch) col = BALL_PATCH;
        cells.set(`${x},${y},${z}`, { c: col, s: 1 });
      }
  const scale = (r * 2) / n;
  return { cells, scale, origin: [-r, 0, -r] };
}

/** The pitch tile: stripes, one white line, and the ball's hard shadow stamped on the top layer. */
function tileObject(o: MarkOptions, ball: VoxelObject, sun: V3): VoxelObject {
  const T = o.tile, H = o.thick;
  const shadow = new Set<string>();
  for (const key of ball.cells.keys()) {
    const [x, y, z] = key.split(',').map(Number);
    // Cell centre in world units, then along the sun to the tile top (y = 0).
    const wx = ball.origin[0] + (x + 0.5) * ball.scale, wy = ball.origin[1] + (y + 0.5) * ball.scale, wz = ball.origin[2] + (z + 0.5) * ball.scale;
    const t = wy / sun[1];
    const sx = wx - sun[0] * t, sz = wz - sun[2] * t;
    const hb = ball.scale * 0.35;
    for (const [ox, oz] of [[-hb, -hb], [hb, -hb], [-hb, hb], [hb, hb], [0, 0]]) {
      const gx = Math.floor(sx + ox + T / 2), gz = Math.floor(sz + oz + T / 2);
      if (gx >= 0 && gz >= 0 && gx < T && gz < T) shadow.add(`${gx},${gz}`);
    }
  }
  const cells = new Map<string, { c: number; s: number }>();
  for (let x = 0; x < T; x++)
    for (let z = 0; z < T; z++)
      for (let y = 0; y < H; y++) {
        const top = y === H - 1;
        const c = top && x === o.line ? LINE : Math.floor(x / o.stripe) % 2 === 0 ? GRASS_A : GRASS_B;
        cells.set(`${x},${y},${z}`, { c, s: top && shadow.has(`${x},${z}`) ? SHADOW : 1 });
      }
  return { cells, scale: 1, origin: [-T / 2, -H, -T / 2] };
}

function hex(c: number, k: number): string {
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, '0');
  return `#${ch((c >> 16) & 255)}${ch((c >> 8) & 255)}${ch(c & 255)}`;
}

/** The six cube faces: normal axis, sign, and the two in-plane axes. */
const FACES: { a: 0 | 1 | 2; sgn: 1 | -1; u: 0 | 1 | 2; v: 0 | 1 | 2 }[] = [
  { a: 0, sgn: 1, u: 2, v: 1 }, { a: 0, sgn: -1, u: 2, v: 1 },
  { a: 1, sgn: 1, u: 0, v: 2 }, { a: 1, sgn: -1, u: 0, v: 2 },
  { a: 2, sgn: 1, u: 0, v: 1 }, { a: 2, sgn: -1, u: 0, v: 1 },
];

interface Face { depth: number; pts: string; fill: string }

/**
 * Greedy-meshed camera-facing faces of a voxel object, projected. Exposed faces with the same normal, plane and
 * colour merge into rectangles (like a voxel mesher's greedy pass), which keeps the SVG small.
 */
function projectObject(obj: VoxelObject, d: V3, sun: V3, project: (p: V3) => readonly [number, number], layer: number, out: Face[]): void {
  for (const F of FACES) {
    const n: V3 = [F.a === 0 ? F.sgn : 0, F.a === 1 ? F.sgn : 0, F.a === 2 ? F.sgn : 0];
    if (n[0] * d[0] + n[1] * d[1] + n[2] * d[2] <= 0) continue; // faces away from the camera
    const tint = F.a === 1 ? (F.sgn > 0 ? 1 : 0.7) : 0.9;
    const lit = Math.max(0, n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2]);
    const k = tint * (0.74 + 0.3 * lit);
    // Exposed faces per plane: plane index -> Map<"u,v", fill>.
    const planes = new Map<number, Map<string, string>>();
    for (const [key, cell] of obj.cells) {
      const p = key.split(',').map(Number) as [number, number, number];
      const q: [number, number, number] = [p[0], p[1], p[2]];
      q[F.a] += F.sgn;
      if (obj.cells.has(`${q[0]},${q[1]},${q[2]}`)) continue;
      const plane = p[F.a] + (F.sgn > 0 ? 1 : 0);
      let m = planes.get(plane);
      if (!m) planes.set(plane, (m = new Map()));
      m.set(`${p[F.u]},${p[F.v]}`, hex(cell.c, k * cell.s));
    }
    for (const [plane, m] of planes) {
      // Greedy rectangles over (u, v).
      const done = new Set<string>();
      const keys = [...m.keys()].map((s) => s.split(',').map(Number) as [number, number]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      for (const [u0, v0] of keys) {
        const k0 = `${u0},${v0}`;
        if (done.has(k0)) continue;
        const fill = m.get(k0)!;
        let u1 = u0 + 1;
        while (m.get(`${u1},${v0}`) === fill && !done.has(`${u1},${v0}`)) u1++;
        let v1 = v0 + 1;
        outer: for (;;) {
          for (let u = u0; u < u1; u++) if (m.get(`${u},${v1}`) !== fill || done.has(`${u},${v1}`)) break outer;
          v1++;
        }
        for (let u = u0; u < u1; u++) for (let v = v0; v < v1; v++) done.add(`${u},${v}`);
        const corner = (u: number, v: number): V3 => {
          const g = [0, 0, 0];
          g[F.a] = plane; g[F.u] = u; g[F.v] = v;
          return [obj.origin[0] + g[0] * obj.scale, obj.origin[1] + g[1] * obj.scale, obj.origin[2] + g[2] * obj.scale];
        };
        const cs = [corner(u0, v0), corner(u1, v0), corner(u1, v1), corner(u0, v1)];
        const centre: V3 = [(cs[0][0] + cs[2][0]) / 2, (cs[0][1] + cs[2][1]) / 2, (cs[0][2] + cs[2][2]) / 2];
        const pts = cs.map((c) => { const [x, y] = project(c); return `${x.toFixed(2)},${y.toFixed(2)}`; }).join(' ');
        out.push({ depth: layer + centre[0] * d[0] + centre[1] * d[1] + centre[2] * d[2], pts, fill });
      }
    }
  }
}

/**
 * The mark's SVG body (no wrapper) in tile-voxel units: the tile, then the ball, each painter-sorted (far to
 * near) and merged. Returns the body and its bounding box [x, y, w, h].
 */
export function markBody(over: Partial<MarkOptions> = {}): { body: string; box: [number, number, number, number] } {
  const o = { ...MARK_DEFAULT, ...over };
  const yaw = (o.yaw * Math.PI) / 180;
  const pitch = (o.pitch * Math.PI) / 180;
  // View direction (towards the camera), camera right and up.
  const d: V3 = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
  const rl = Math.hypot(d[2], d[0]);
  const rt: V3 = [d[2] / rl, 0, -d[0] / rl];
  const up: V3 = [d[1] * rt[2] - d[2] * rt[1], d[2] * rt[0] - d[0] * rt[2], d[0] * rt[1] - d[1] * rt[0]];
  const project = (p: V3) => [p[0] * rt[0] + p[1] * rt[1] + p[2] * rt[2], -(p[0] * up[0] + p[1] * up[1] + p[2] * up[2])] as const;
  const sl = Math.hypot(o.sun[0], o.sun[1], o.sun[2]);
  const sun: V3 = [o.sun[0] / sl, o.sun[1] / sl, o.sun[2] / sl];

  const ball = ballObject(o.n, o.patch, o.rot, o.r);
  const tile = tileObject(o, ball, sun);
  const faces: Face[] = [];
  projectObject(tile, d, sun, project, 0, faces);
  projectObject(ball, d, sun, project, 1000, faces);
  faces.sort((a, b) => a.depth - b.depth);
  let body = '<g stroke-width="0.05" stroke-linejoin="round">';
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of faces) {
    body += `<polygon points="${f.pts}" fill="${f.fill}" stroke="${f.fill}"/>`;
    for (const pair of f.pts.split(' ')) {
      const [x, y] = pair.split(',').map(Number);
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  body += '</g>';
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return { body, box: [r2(minX), r2(minY), r2(maxX - minX), r2(maxY - minY)] };
}

const markCache = new Map<string, { body: string; box: [number, number, number, number] }>();
function mark(over: Partial<MarkOptions> = {}): { body: string; box: [number, number, number, number] } {
  const key = JSON.stringify(over);
  let m = markCache.get(key);
  if (!m) markCache.set(key, (m = markBody(over)));
  return m;
}

/** The mark alone as an <svg>, `sizePx` tall (its width follows the 3/4 view's box). */
export function markSvg(sizePx: number, cls = 'bl-mark', over: Partial<MarkOptions> = {}): string {
  const { body, box } = mark(over);
  const [bx, by, bw, bh] = box;
  const w = Math.round((sizePx * bw) / bh);
  return `<svg class="${cls}" width="${w}" height="${sizePx}" viewBox="${bx} ${by} ${bw} ${bh}" aria-hidden="true">${body}</svg>`;
}

export type LogoLockup = 'horizontal' | 'stacked' | 'mark';

export interface LockupOptions {
  /** Stacked lockup: the mark's width as a fraction of the wordmark's (0.6 for store art; the title uses less). */
  markWidth?: number;
  mark?: Partial<MarkOptions>;
  /**
   * An ink outline round the mark's silhouette, as thick as the wordmark's (in cells). The in-game title sets it:
   * there the pitch tile sits on the game's own green pitch and would melt into it. Store art (on sky) leaves it off.
   */
  markOutline?: number;
}

/**
 * A full lockup as an <svg>, `heightPx` tall:
 *  - 'horizontal': the mark on the left at the wordmark's height, a 2-cell gap, the wordmark;
 *  - 'stacked': the mark above the wordmark, both centred;
 *  - 'mark': the mark alone.
 */
export function logoSvg(kind: LogoLockup, heightPx: number, style: WordmarkStyle = {}, cls = 'bl-logo', lock: LockupOptions = {}): string {
  const over = lock.mark ?? {};
  if (kind === 'mark') return markSvg(heightPx, cls, over);
  const { vb, markT, wordT, markScale } = lockupLayout(kind, style, lock);
  const w = Math.round((heightPx * vb[2]) / vb[3]);
  const body = mark(over).body;
  // The outline: the same polygons once more underneath, all ink, stroked twice the outline wide (half of a
  // stroke lies outside the shape), in the mark's own units.
  const outline = lock.markOutline
    ? `<g fill="${style.ink ?? LOGO_INK}" stroke="${style.ink ?? LOGO_INK}" stroke-width="${((lock.markOutline * 2) / markScale).toFixed(3)}" stroke-linejoin="round">${body.replace(/ fill="#[0-9a-f]{6}" stroke="#[0-9a-f]{6}"/g, '').replace(/<g [^>]*>/, '<g>')}</g>`
    : '';
  // (overflow visible: the outline may reach a fraction of a cell past the lockup's box at the ball's top.)
  return `<svg class="${cls}" width="${w}" height="${heightPx}" viewBox="${vb.join(' ')}"${outline ? ' overflow="visible"' : ''} role="img" aria-label="Blocky League">` +
    `<g transform="${markT}">${outline}${body}</g>` +
    `<g transform="${wordT}" shape-rendering="crispEdges">${wordmarkBody(style)}</g></svg>`;
}

/** A lockup's size in wordmark cells [w, h]: at a whole multiple of 4 px per cell every letter edge is on a pixel. */
export function lockupCells(kind: Exclude<LogoLockup, 'mark'>, style: WordmarkStyle = {}, lock: LockupOptions = {}): [number, number] {
  const { vb } = lockupLayout(kind, style, lock);
  return [vb[2], vb[3]];
}

function lockupLayout(kind: Exclude<LogoLockup, 'mark'>, style: WordmarkStyle, lock: LockupOptions): { vb: [number, number, number, number]; markT: string; wordT: string; markScale: number } {
  const over = lock.mark ?? {};
  const [wx, wy, ww, wh] = wordmarkBox(style);
  const { box } = mark(over);
  const [mx, my, mw, mh] = box;
  let vb: [number, number, number, number];
  let markT: string;
  let wordT: string;
  let markScale: number;
  // The wordmark's outer box always starts on a whole cell of the lockup (the gap under / beside the mark is
  // rounded up to one), so at a whole number of pixels per cell every letter edge lands on a pixel (store art).
  if (kind === 'horizontal') {
    const scale = wh / mh; // mark as tall as the wordmark's outer box
    markScale = scale;
    const mW = mw * scale;
    const at = Math.ceil(mW + GAP);
    vb = [0, 0, at + ww, wh];
    markT = `translate(${(at - GAP - mW) / 2 - mx * scale} ${-my * scale}) scale(${scale})`;
    wordT = `translate(${at - wx} ${-wy})`;
  } else {
    const scale = (ww * (lock.markWidth ?? 0.6)) / mw;
    markScale = scale;
    const mW = mw * scale, mH = mh * scale;
    const at = Math.ceil(mH + 1.5);
    vb = [0, 0, ww, at + wh];
    markT = `translate(${(ww - mW) / 2 - mx * scale} ${(at - 1.5 - mH) / 2 - my * scale}) scale(${scale})`;
    wordT = `translate(${-wx} ${at - wy})`;
  }
  return { vb, markT, wordT, markScale };
}
