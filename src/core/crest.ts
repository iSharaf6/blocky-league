import { hashString } from './rng';

/**
 * CLUB CRESTS: one pixel-art crest per club, drawn the same everywhere it shows (the hub, the score bug, the league
 * table, the centre circle decal, the tifo, the big screen, the BIG CREST kit).
 *
 * A crest is a design: a SHAPE (shields, a roundel, a diamond, a pennant...), a field PATTERN in two colours, an
 * EMBLEM in a third, and an optional BANNER carrying the club's short name. Your own club's is designed in the club
 * creator and MY CLUB > KIT (ui/club.ts) and saved with the club (meta/career.ts ClubState.crest). Every other club
 * gets one from its name and colours (defaultCrest), so the whole league wears the same art language.
 *
 * Pure: no DOM, nothing from three. The rasteriser fills a 26 x 30 grid of ROLES (outline, field one, field two,
 * emblem...), cached per design; ui/crest.ts turns it into SVG and the renderer into decals and textures.
 */

export const CREST_W = 26;
export const CREST_H = 30;

export const CREST_SHAPES = [
  'shield', 'classic', 'kite', 'tower', 'roundel', 'oval', 'diamond', 'pennant', 'hex', 'block', 'arch', 'cog', 'swallow',
] as const;
export type CrestShape = (typeof CREST_SHAPES)[number];
export const CREST_SHAPE_NAMES: { readonly [k in CrestShape]: string } = {
  shield: 'Shield', classic: 'Classic', kite: 'Kite', tower: 'Tower', roundel: 'Roundel', oval: 'Oval', diamond: 'Diamond',
  pennant: 'Pennant', hex: 'Hexagon', block: 'Block', arch: 'Arch', cog: 'Cog', swallow: 'Flag',
};

export const CREST_PATTERNS = ['plain', 'halves', 'chief', 'stripes', 'hoops', 'sash', 'quarters', 'chevron', 'border', 'rays'] as const;
export type CrestPattern = (typeof CREST_PATTERNS)[number];
export const CREST_PATTERN_NAMES: { readonly [k in CrestPattern]: string } = {
  plain: 'Plain', halves: 'Halves', chief: 'Top Band', stripes: 'Stripes', hoops: 'Hoops', sash: 'Sash', quarters: 'Quarters',
  chevron: 'Chevron', border: 'Border', rays: 'Sunburst',
};

export const CREST_EMBLEMS = [
  'ball', 'star', 'lion', 'eagle', 'crown', 'bolt', 'tree', 'castle', 'anchor', 'flame', 'wolf', 'initials', 'none',
] as const;
export type CrestEmblem = (typeof CREST_EMBLEMS)[number];
export const CREST_EMBLEM_NAMES: { readonly [k in CrestEmblem]: string } = {
  ball: 'Ball', star: 'Star', lion: 'Lion', eagle: 'Eagle', crown: 'Crown', bolt: 'Lightning', tree: 'Tree', castle: 'Castle',
  anchor: 'Anchor', flame: 'Flame', wolf: 'Wolf', initials: 'Initials', none: 'No Emblem',
};

/** A club's crest as saved (ClubState.crest): the template picks and three colours. */
export interface CrestDesign {
  shape: CrestShape;
  pattern: CrestPattern;
  emblem: CrestEmblem;
  /** Field colour, second field colour (the pattern) and the emblem's (the banner takes it too). */
  c1: number;
  c2: number;
  c3: number;
  /** A ribbon across the crest with the club's short name. */
  banner: boolean;
}

/** What a cell of the crest is (crestRoles): painters map these to colours, or to grass tones for the pitch decal. */
export const ROLE = { none: 0, ink: 1, c1: 2, c2: 3, emblem: 4, light: 5, ribbon: 6, text: 7, detail: 8 } as const;

const INK = 0x26262e;
const CREAM = 0xfbfbf4;
const GOLD = 0xffc23a;

// ------------------------------------------------------------------ pixel fonts

/** 3 x 5 pixel capitals and digits (the banner's short name, the seats mosaic). */
export const FONT_3X5: { readonly [c: string]: readonly string[] } = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'], B: ['##.', '#.#', '##.', '#.#', '##.'], C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'], E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'], H: ['#.#', '#.#', '###', '#.#', '#.#'], I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'], K: ['#.#', '#.#', '##.', '#.#', '#.#'], L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'], N: ['##.', '#.#', '#.#', '#.#', '#.#'], O: ['###', '#.#', '#.#', '#.#', '###'],
  P: ['##.', '#.#', '##.', '#..', '#..'], Q: ['###', '#.#', '#.#', '###', '..#'], R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'], T: ['###', '.#.', '.#.', '.#.', '.#.'], U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'], W: ['#.#', '#.#', '###', '###', '#.#'], X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'], Z: ['###', '..#', '.#.', '#..', '###'],
  0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'], 2: ['##.', '..#', '.#.', '#..', '###'],
  3: ['##.', '..#', '.#.', '..#', '##.'], 4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '##.', '..#', '##.'],
  6: ['.##', '#..', '###', '#.#', '###'], 7: ['###', '..#', '.#.', '.#.', '.#.'], 8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '##.'],
};

/** 5 x 7 pixel capitals and digits (the INITIALS emblem). */
export const FONT_5X7: { readonly [c: string]: readonly string[] } = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'], B: ['####.', '#...#', '####.', '#...#', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'], D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '####.', '#....', '#....', '#....', '#####'], F: ['#####', '#....', '####.', '#....', '#....', '#....', '#....'],
  G: ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.####'], H: ['#...#', '#...#', '#####', '#...#', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'], J: ['..###', '....#', '....#', '....#', '#...#', '#...#', '.###.'],
  K: ['#...#', '#..#.', '###..', '#..#.', '#...#', '#...#', '#...#'], L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'], N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'], P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'], R: ['####.', '#...#', '#...#', '####.', '#..#.', '#...#', '#...#'],
  S: ['.####', '#....', '.###.', '....#', '....#', '#...#', '.###.'], T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'], V: ['#...#', '#...#', '#...#', '#...#', '.#.#.', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'], X: ['#...#', '.#.#.', '..#..', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..', '..#..'], Z: ['#####', '...#.', '..#..', '.#...', '#....', '#....', '#####'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'], 1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '..##.', '.#...', '#....', '#####'], 3: ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  4: ['#...#', '#...#', '#...#', '#####', '....#', '....#', '....#'], 5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['.###.', '#....', '####.', '#...#', '#...#', '#...#', '.###.'], 7: ['#####', '....#', '...#.', '..#..', '..#..', '..#..', '..#..'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'], 9: ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
};

// ------------------------------------------------------------------ the emblems (12 x 12: X emblem, o ink, + highlight)

const EMBLEM_ART: { readonly [k in Exclude<CrestEmblem, 'initials' | 'none'>]: readonly string[] } = {
  ball: [
    '....XXXX....', '..XXXooXXX..', '.XXXXooXXXX.', '.XoXXXXXXoX.', 'XooXXooXXooX', 'XoXXooooXXoX',
    'XXXXooooXXXX', 'XXXXXooXXXXX', '.XXoXXXXoXX.', '.XoooXXoooX.', '..XXoXXoXX..', '....XXXX....',
  ],
  star: [
    '.....XX.....', '.....XX.....', '....XXXX....', 'XXXXXXXXXXXX', '.XXXXXXXXXX.', '..XXXXXXXX..',
    '...XXXXXX...', '..XXXXXXXX..', '..XXXXXXXX..', '.XXXX..XXXX.', '.XXX....XXX.', 'XX........XX',
  ],
  lion: [
    '.X.X.XX.X.X.', 'XXXXXXXXXXXX', 'XXX++++++XXX', 'XX++++++++XX', 'XX+o++++o+XX', 'XX++++++++XX',
    'XXX++oo++XXX', 'XX+++oo+++XX', 'XXX+o++o+XXX', '.XXX+oo+XXX.', '.XXXX++XXXX.', '..X.XXXX.X..',
  ],
  eagle: [
    'X....XX....X', 'XX..XXoX..XX', 'XX..XXXXX.XX', 'XXX..XX..XXX', 'XXXX.XX.XXXX', 'XXXXXXXXXXXX',
    'X.XXXXXXXX.X', 'X.X.XXXX.X.X', '....XXXX....', '...XXXXXX...', '..XX.XX.XX..', '..X..XX..X..',
  ],
  crown: [
    '.X...XX...X.', '.X...XX...X.', 'XXX.XXXX.XXX', 'XXX.XXXX.XXX', 'XXXXXXXXXXXX', 'XXXXXXXXXXXX',
    'XXoXXooXXoXX', 'XXXXXXXXXXXX', '++++++++++++',
  ],
  bolt: [
    '......XXXX..', '.....XXXX...', '....XXXX....', '...XXXX.....', '..XXXXXXXX..', '..XXXXXXX...',
    '.....XXXX...', '....XXXX....', '...XXXX.....', '...XXX......', '..XXX.......', '..XX........',
  ],
  tree: [
    '....XXXX....', '..XXXXXXXX..', '.XXXX+XXXXX.', 'XXX++XXXXXXX', 'XXXXXXXXXXXX', 'XXXXXXXXXXXX',
    '.XXXXXXXXXX.', '..XXXXXXXX..', '.....XX.....', '.....XX.....', '....XXXX....', '...XXXXXX...',
  ],
  castle: [
    'XX.XX..XX.XX', 'XX.XX..XX.XX', 'XXXXXXXXXXXX', 'XXXXXXXXXXXX', '.XXXXXXXXXX.', '.XXoXXXXoXX.',
    '.XXoXXXXoXX.', '.XXXXXXXXXX.', '.XXXXooXXXX.', '.XXXooooXXX.', '.XXXooooXXX.', 'XXXXooooXXXX',
  ],
  anchor: [
    '....XXXX....', '....X..X....', '....XXXX....', '.....XX.....', '..XXXXXXXX..', '.....XX.....',
    '.....XX.....', 'X....XX....X', 'XX...XX...XX', 'XXX..XX..XXX', '.XXXXXXXXXX.', '...XXXXXX...',
  ],
  flame: [
    '.....X......', '.....XX.....', '....XXX.....', '....XXXX.X..', '...XXXXX.XX.', '..XXXXXXXXX.',
    '.XXXX+XXXXXX', '.XXX++XXXXXX', 'XXXX+++XXXXX', 'XXX++++XXXX.', '.XXX+++XXX..', '..XXXXXXX...',
  ],
  wolf: [
    'X..........X', 'XX........XX', 'XXX.XXXX.XXX', 'XXXXXXXXXXXX', 'XXXXXXXXXXXX', 'XXoXXXXXXoXX',
    'XXXoXXXXoXXX', '.XXX++++XXX.', '.XX++++++XX.', '..X++oo++X..', '...X+oo+X...', '....XXXX....',
  ],
};

/** The INITIALS emblem's letters: the first letters of the name's first two words, else the short code's first. */
export function crestInitials(name: string, short: string): string {
  const words = name.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const pick = words.length >= 2 ? words[0][0] + words[1][0] : (words[0]?.[0] ?? short.toUpperCase()[0] ?? 'B');
  return [...pick].filter((c) => FONT_5X7[c]).join('').slice(0, 2) || 'B';
}

/** An emblem's art rows (the initials are set tall: 5 x 7 capitals stretched to 14 rows, one letter doubled across). */
function emblemRows(e: CrestEmblem, name: string, short: string): readonly string[] {
  if (e === 'none') return [];
  if (e !== 'initials') return EMBLEM_ART[e];
  const ini = crestInitials(name, short);
  const rows: string[] = [];
  for (let y = 0; y < 7; y++) {
    let r = '';
    [...ini].forEach((ch, i) => {
      const g = FONT_5X7[ch][y].replace(/#/g, 'X');
      if (i > 0) r += '.';
      r += ini.length === 1 ? [...g].map((c) => c + c).join('') : g;
    });
    rows.push(r, r);
  }
  return rows;
}

// ------------------------------------------------------------------ shapes

const HALF = CREST_W / 2;

/** Is cell (x, y) inside shape `s`? (fx: across from the centre line, fy: down from the top, at the cell's centre.) */
function inShape(s: CrestShape, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= CREST_W || y >= CREST_H) return false;
  const fx = Math.abs(x + 0.5 - HALF);
  const fy = y + 0.5;
  const point = (from: number, pow: number, w = HALF) => (fy < from ? fx < w : fx < w * (1 - ((fy - from) / (CREST_H - from)) ** pow) + 0.35);
  switch (s) {
    case 'shield':
      return !(y === 0 && fx > 12) && point(14, 1.9);
    case 'classic':
      // Raised corners and a dipped top edge, then a long curve to the point.
      return fy > 2.6 * (1 - (fx / HALF) ** 2) && point(12, 1.6);
    case 'kite':
      return fy < 7 ? fx < 12 * Math.sqrt(1 - ((7 - fy) / 7) ** 2) + 0.3 : fx < 12 * (1 - ((fy - 7) / 23) ** 1.25) + 0.4;
    case 'tower':
      // Three merlons on top, a rounded foot.
      if (y < 3) return x <= 5 || (x >= 10 && x <= 15) || x >= 20;
      return fy < 19 ? true : fx < HALF * Math.sqrt(Math.max(0, 1 - ((fy - 19) / 11.2) ** 2)) + 0.2;
    case 'roundel':
      return Math.hypot(fx, fy - 15) < 13;
    case 'oval':
      return (fx / 12) ** 2 + ((fy - 15) / 15) ** 2 < 1;
    case 'diamond':
      return fx / 13.4 + Math.abs(fy - 15) / 15.4 < 1;
    case 'pennant':
      return fy < 4 ? true : fx < HALF * (1 - (fy - 4) / 26.5) + 0.3;
    case 'hex':
      return fx < HALF - Math.max(0, 7.5 - fy, fy - 22.5) * 0.86 + 0.3;
    case 'block': {
      if (y < 2 || y > 27) return false;
      const dx = Math.max(0, fx - 9.5), dy = Math.max(0, Math.abs(fy - 15) - 9.5);
      return Math.hypot(dx, dy) < 3.6;
    }
    case 'arch':
      if (y > 28) return false;
      return fy < 13 ? Math.hypot(fx, fy - 13) < 13 : !(y === 28 && fx > 12);
    case 'cog': {
      const r = Math.hypot(fx, fy - 15);
      const a = Math.atan2(fy - 15, x + 0.5 - HALF);
      return r < (Math.cos(a * 8) > -0.15 ? 13.2 : 11.3);
    }
    case 'swallow':
      // A hanging flag: straight sides, a V cut out of the foot.
      return fx < 12 && fy < 24 + fx * 0.5;
  }
}

/** Where the emblem's centre row sits, without the banner and with it. */
const EMBLEM_CY: { readonly [k in CrestShape]: readonly [number, number] } = {
  shield: [12.5, 9.5], classic: [13, 10], kite: [11.5, 9.5], tower: [15, 11], roundel: [15, 10.5], oval: [15, 10.5], diamond: [15, 11.5],
  pennant: [10, 8.5], hex: [15, 10.5], block: [15, 10.5], arch: [15, 10.5], cog: [15, 10.5], swallow: [12, 9.5],
};
/** The banner's top row per shape (nine rows: an outline, the ribbon, an outline). */
const BANNER_Y: { readonly [k in CrestShape]: number } = {
  shield: 18, classic: 18, kite: 18, tower: 19, roundel: 18, oval: 19, diamond: 19, pennant: 16, hex: 19, block: 18, arch: 19, cog: 18, swallow: 17,
};

function field(p: CrestPattern, x: number, y: number): number {
  const fx = x + 0.5 - HALF;
  const fy = y + 0.5 - 15;
  switch (p) {
    case 'plain': return ROLE.c1;
    case 'halves': return x < HALF ? ROLE.c1 : ROLE.c2;
    case 'chief': return y < 9 ? ROLE.c2 : ROLE.c1;
    case 'stripes': return Math.floor((x + 1) / 4) % 2 ? ROLE.c2 : ROLE.c1;
    case 'hoops': return Math.floor((y + 2) / 4) % 2 ? ROLE.c2 : ROLE.c1;
    case 'sash': return Math.abs(fx + fy * 0.9 + 1) < 4.2 ? ROLE.c2 : ROLE.c1;
    case 'quarters': return (x < HALF) === (y < 14) ? ROLE.c1 : ROLE.c2;
    case 'chevron': {
      const d = fy - 3 + Math.abs(fx) * 0.8;
      return d > 0 && d < 5.2 ? ROLE.c2 : ROLE.c1;
    }
    case 'border': return ROLE.c1;
    case 'rays': {
      const a = Math.atan2(fy, fx) + Math.PI;
      return Math.floor((a / (Math.PI * 2)) * 12 + 0.5) % 2 ? ROLE.c2 : ROLE.c1;
    }
  }
}

const roleCache = new Map<string, Uint8Array>();

/** The design as a CREST_W x CREST_H grid of ROLE values (row by row from the top), cached. Do not write to it. */
export function crestRoles(d: CrestDesign, short = '', name = ''): Uint8Array {
  const code = short.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  const ini = d.emblem === 'initials' ? crestInitials(name, code) : '';
  const key = `${d.shape}|${d.pattern}|${d.emblem}|${d.banner ? code : ''}|${ini}`;
  const hit = roleCache.get(key);
  if (hit) return hit;
  const W = CREST_W, H = CREST_H;
  const g = new Uint8Array(W * H);
  const inside = (x: number, y: number) => inShape(d.shape, x, y);
  const edge = (x: number, y: number) => !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!inside(x, y)) continue;
    if (edge(x, y)) g[y * W + x] = ROLE.ink;
    else if (d.pattern === 'border') {
      // A ring in the second colour just inside the outline.
      let ring = false;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-2, 0], [2, 0], [0, -2], [0, 2], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        if (!inside(x + dx, y + dy) || edge(x + dx, y + dy)) ring = true;
      }
      g[y * W + x] = ring ? ROLE.c2 : ROLE.c1;
    } else g[y * W + x] = field(d.pattern, x, y);
  }
  // The emblem, centred, with an ink edge so it reads on any field (never over the crest's own outline).
  const rows = emblemRows(d.emblem, name, code);
  if (rows.length) {
    const ew = rows[0].length, eh = rows.length;
    const cy = EMBLEM_CY[d.shape][d.banner ? 1 : 0];
    const x0 = Math.floor((W - ew) / 2), y0 = Math.round(cy - eh / 2);
    const at = (ex: number, ey: number) => rows[ey]?.[ex] ?? '.';
    const paint = (x: number, y: number, role: number) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const cur = g[y * W + x];
      if (cur === ROLE.none || cur === ROLE.ink) return;
      g[y * W + x] = role;
    };
    for (let ey = -1; ey <= eh; ey++) for (let ex = -1; ex <= ew; ex++) {
      const ch = at(ex, ey);
      if (ch !== '.') continue;
      if (at(ex - 1, ey) !== '.' || at(ex + 1, ey) !== '.' || at(ex, ey - 1) !== '.' || at(ex, ey + 1) !== '.') paint(x0 + ex, y0 + ey, ROLE.ink);
    }
    for (let ey = 0; ey < eh; ey++) for (let ex = 0; ex < ew; ex++) {
      const ch = at(ex, ey);
      if (ch !== '.') paint(x0 + ex, y0 + ey, ch === 'o' ? ROLE.detail : ch === '+' ? ROLE.light : ROLE.emblem);
    }
  }
  // The banner: a ribbon right across (it overhangs a crest that narrows there), its ends notched, the short name on it.
  if (d.banner && code) {
    const by = BANNER_Y[d.shape];
    for (let y = by; y < by + 9; y++) for (let x = 0; x < W; x++) {
      const notch = (x === 0 || x === W - 1) && y >= by + 3 && y <= by + 5;
      if (notch) {
        g[y * W + x] = ROLE.none;
        continue;
      }
      const rim = y === by || y === by + 8 || x === 0 || x === W - 1 || ((x === 1 || x === W - 2) && y >= by + 3 && y <= by + 5);
      g[y * W + x] = rim ? ROLE.ink : ROLE.ribbon;
    }
    const tw = code.length * 4 - 1;
    const tx = Math.floor((W - tw) / 2);
    [...code].forEach((ch, i) => {
      const glyph = FONT_3X5[ch];
      if (!glyph) return;
      for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) if (glyph[y][x] === '#') g[(by + 2 + y) * W + tx + i * 4 + x] = ROLE.text;
    });
  }
  if (roleCache.size > 400) roleCache.clear();
  roleCache.set(key, g);
  return g;
}

const lum = (hex: number): number => (((hex >> 16) & 255) * 0.299 + ((hex >> 8) & 255) * 0.587 + (hex & 255) * 0.114) / 255;
const scale = (hex: number, f: number): number => {
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return (ch((hex >> 16) & 255) << 16) | (ch((hex >> 8) & 255) << 8) | ch(hex & 255);
};
const blend = (a: number, b: number, t: number): number => {
  const ch = (sh: number) => Math.round(((a >> sh) & 255) + (((b >> sh) & 255) - ((a >> sh) & 255)) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};
const dist = (a: number, b: number): number => Math.hypot(((a >> 16) & 255) - ((b >> 16) & 255), ((a >> 8) & 255) - ((b >> 8) & 255), (a & 255) - (b & 255));

const pixelCache = new Map<string, Int32Array>();

/**
 * The crest in its colours: CREST_W x CREST_H hex colours, -1 where it is clear. A bevel is painted in (the row under
 * the top edge a touch lighter, the cells against the right and bottom edges a touch darker), so it reads as a badge.
 */
export function crestPixels(d: CrestDesign, short = '', name = ''): Int32Array {
  const key = `${d.shape}|${d.pattern}|${d.emblem}|${d.banner ? short.toUpperCase() : ''}|${d.emblem === 'initials' ? crestInitials(name, short) : ''}|${d.c1}|${d.c2}|${d.c3}`;
  const hit = pixelCache.get(key);
  if (hit) return hit;
  const roles = crestRoles(d, short, name);
  const W = CREST_W, H = CREST_H;
  const out = new Int32Array(W * H);
  // (An emblem in a dark colour gets its eyes, seams and highlights in cream, a light one in ink.)
  const dark = lum(d.c3) < 0.3;
  const textC = lum(d.c3) > 0.55 ? INK : CREAM;
  // (The emblem's second tone: lighter on a dark or mid colour, a shade down on a pale one, so it always shows.)
  const tone = lum(d.c3) > 0.72 ? scale(d.c3, 0.76) : blend(d.c3, dark ? CREAM : 0xffffff, 0.5);
  const pal = [-1, INK, d.c1, d.c2, d.c3, tone, d.c3, textC, dark ? CREAM : INK];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const r = roles[y * W + x];
    let c = pal[r];
    if (r === ROLE.c1 || r === ROLE.c2) {
      const up = y > 0 ? roles[(y - 1) * W + x] : ROLE.none;
      const right = x < W - 1 ? roles[y * W + x + 1] : ROLE.none;
      const down = y < H - 1 ? roles[(y + 1) * W + x] : ROLE.none;
      const rimUp = up === ROLE.ink && (y < 2 || roles[(y - 2) * W + x] === ROLE.none);
      const rimSide = (right === ROLE.ink && (x > W - 3 || roles[y * W + x + 2] === ROLE.none)) || (down === ROLE.ink && (y > H - 3 || roles[(y + 2) * W + x] === ROLE.none));
      if (rimUp) c = blend(c, 0xffffff, 0.22);
      else if (rimSide) c = scale(c, 0.84);
    }
    out[y * W + x] = c;
  }
  if (pixelCache.size > 400) pixelCache.clear();
  pixelCache.set(key, out);
  return out;
}

// ------------------------------------------------------------------ defaults, random, normalise

/** A colour for the emblem that reads on both field colours: cream, gold or ink, whichever stands furthest off. */
export function emblemColorFor(c1: number, c2: number): number {
  let best = CREAM;
  let bestD = -1;
  for (const c of [CREAM, GOLD, INK]) {
    const dd = Math.min(dist(c, c1), dist(c, c2));
    if (dd > bestD) {
      bestD = dd;
      best = c;
    }
  }
  return best;
}

const DEFAULT_SHAPES: readonly CrestShape[] = ['shield', 'classic', 'roundel', 'kite', 'tower', 'diamond', 'hex', 'pennant', 'block', 'arch', 'oval', 'swallow'];
const DEFAULT_PATTERNS: readonly CrestPattern[] = ['plain', 'halves', 'chief', 'stripes', 'border', 'sash', 'hoops', 'quarters', 'plain', 'chevron'];
const DEFAULT_EMBLEMS: readonly CrestEmblem[] = ['initials', 'ball', 'star', 'lion', 'eagle', 'crown', 'bolt', 'tree', 'castle', 'anchor', 'flame', 'wolf', 'initials'];

/** The crest a club has before anyone designs one: its shape, pattern and emblem from its name, its colours from its kit. */
export function defaultCrest(name: string, _short: string, kit: { shirt: number; shirt2: number }): CrestDesign {
  // (Whatever the case: the hub shouts a club's name, the table doesn't, and both draw the same crest.)
  const h = hashString((name || 'club').trim().toLowerCase());
  const c1 = kit.shirt;
  const c2 = dist(kit.shirt2, kit.shirt) < 40 ? (lum(kit.shirt) > 0.6 ? INK : CREAM) : kit.shirt2;
  return {
    shape: DEFAULT_SHAPES[h % DEFAULT_SHAPES.length],
    pattern: DEFAULT_PATTERNS[(h >>> 5) % DEFAULT_PATTERNS.length],
    emblem: DEFAULT_EMBLEMS[(h >>> 11) % DEFAULT_EMBLEMS.length],
    c1, c2, c3: emblemColorFor(c1, c2),
    banner: ((h >>> 17) & 3) === 0,
  };
}

/** A random design (`rand` in 0..1) from `colors`, the emblem always readable on the field. */
export function randomCrest(rand: () => number, colors: readonly number[], keep?: { c1?: number; c2?: number }): CrestDesign {
  const pick = <T>(a: readonly T[]): T => a[Math.min(a.length - 1, Math.floor(rand() * a.length))];
  const c1 = keep?.c1 ?? pick(colors);
  let c2 = keep?.c2 ?? pick(colors);
  for (let i = 0; i < 8 && dist(c1, c2) < 90; i++) c2 = pick(colors);
  if (dist(c1, c2) < 90) c2 = lum(c1) > 0.6 ? INK : CREAM;
  return {
    shape: pick(CREST_SHAPES),
    pattern: pick(CREST_PATTERNS),
    emblem: pick(CREST_EMBLEMS.filter((e) => e !== 'none')),
    c1, c2, c3: emblemColorFor(c1, c2),
    banner: rand() < 0.4,
  };
}

const isColor = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 0xffffff;

/** A crest as stored by any build made whole: unknown picks and bad colours fall back to `fallback`'s. */
export function normalizeCrest(raw: unknown, fallback: CrestDesign): CrestDesign {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...fallback };
  const v = raw as { [k: string]: unknown };
  const one = <T extends string>(list: readonly T[], x: unknown, fb: T): T => (typeof x === 'string' && (list as readonly string[]).includes(x) ? (x as T) : fb);
  return {
    shape: one(CREST_SHAPES, v.shape, fallback.shape),
    pattern: one(CREST_PATTERNS, v.pattern, fallback.pattern),
    emblem: one(CREST_EMBLEMS, v.emblem, fallback.emblem),
    c1: isColor(v.c1) ? Math.round(v.c1) : fallback.c1,
    c2: isColor(v.c2) ? Math.round(v.c2) : fallback.c2,
    c3: isColor(v.c3) ? Math.round(v.c3) : fallback.c3,
    banner: typeof v.banner === 'boolean' ? v.banner : fallback.banner,
  };
}

export function sameCrest(a: CrestDesign, b: CrestDesign): boolean {
  return a.shape === b.shape && a.pattern === b.pattern && a.emblem === b.emblem && a.c1 === b.c1 && a.c2 === b.c2 && a.c3 === b.c3 && a.banner === b.banner;
}

// ------------------------------------------------------------------ whose crest (your club's design, everywhere)

interface Mine {
  name: string;
  short: string;
  shirt: number;
  shirt2: number;
  design: CrestDesign;
}
let mine: Mine | null = null;

/**
 * Your club's designed crest, registered once it is known (meta/career.ts clubTeam and the hub's badge, ui/club.ts on
 * every edit): from then on crestFor() hands it out wherever your club's crest is drawn, with no caller having to
 * carry the design about. Null clears it.
 */
export function setMyCrest(club: { name: string; short: string; kit: { shirt: number; shirt2: number }; crest?: CrestDesign } | null): void {
  mine = club ? { name: club.name, short: club.short, shirt: club.kit.shirt, shirt2: club.kit.shirt2, design: club.crest ?? defaultCrest(club.name, club.short, club.kit) } : null;
}

/** The crest of the club called `name` in `kit`: yours as you designed it, anyone else's from its name and colours. */
export function crestFor(name: string, short: string, kit: { shirt: number; shirt2: number }): CrestDesign {
  if (mine && ((name && name.trim().toLowerCase() === mine.name.toLowerCase()) || (!name && short.toUpperCase() === mine.short && kit.shirt === mine.shirt && kit.shirt2 === mine.shirt2))) return mine.design;
  return defaultCrest(name || short, short, kit);
}

/** Your crest when `kit` is your club's (the BIG CREST kit and the shop's stage know only the kit), else null. */
export function myCrestForKit(kit: { shirt: number; shirt2: number }): { design: CrestDesign; short: string; name: string } | null {
  return mine && kit.shirt === mine.shirt && kit.shirt2 === mine.shirt2 ? { design: mine.design, short: mine.short, name: mine.name } : null;
}
