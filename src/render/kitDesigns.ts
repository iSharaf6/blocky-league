import { grassLike } from '../meta/data';
import type { Kit, KitPattern } from '../sim/types';
import type { VoxelGrid } from './voxel';

/**
 * PREMIUM KITS (meta/shop.ts sells them; core/save.ts KIT_IDS lists the ids): each is its own design, painted voxel
 * by voxel on the footballer (render/characters.ts builds the torso, arms and legs from these painters), never a
 * recolour. A design has
 * - its own pattern: art on an 8 x 5 shirt front (flames, a bolt, a crest...) or a function (camo, checks, stars),
 *   carried round the sides and on to the back;
 * - its own details: the collar (crew, V or polo), sleeves and cuffs, shorts (with a side stripe or not) and socks
 *   (hoops, a band);
 * - and on the dearest a material, as a per-voxel fx channel (render/voxel.ts) the kit material reads
 *   (render/characters.ts kitFxMaterial): FX.metal gold foil that catches the light, FX.glow trim that lights up in
 *   night matches, FX.iri a sheen that shifts colour as he turns, FX.twinkle stars, FX.flicker flames.
 *
 * Every design's `shirt` is the colour it reads as from the broadcast gantry: the match's clash and contrast checks
 * (meta/data.ts, game/kitContrast.ts) work on it, so the two sides still read apart (and the fixed blue and red rings
 * under the players do the rest). None is grass green and none is the referee's charcoal (tests/kits.test.ts).
 *
 * Grid coordinates (characters.ts): torso x 0 (back) .. 4 (front), y 0..6 (the bottom SHORTS rows are shorts), z 0..7
 * across the chest; arm x 0..2, y 0 (fingertips) .. 4 (shoulder), cuff at y 2; leg y 0 boot, 1..2 sock, 3 knee, 4 shorts.
 */

/** Material channel per voxel (render/voxel.ts `fx`; the kit material's shader switches on it). */
export const FX = { none: 0, metal: 1, glow: 2, iri: 3, lit: 4, twinkle: 5, flicker: 6 } as const;

/** A painted cell: a colour, or a colour and its fx. */
export type Cell = number | readonly [number, number];

const col = (c: Cell): number => (typeof c === 'number' ? c : c[0]);
const fxOf = (c: Cell): number => (typeof c === 'number' ? 0 : c[1]);

export interface KitDesign {
  id: string;
  /** What the kit reads as (contrast and clash checks, HUD chips, the crowd's shirts): main, second, shorts, socks. */
  shirt: number;
  shirt2: number;
  shorts: number;
  socks: number;
  /** The classic pattern it reads closest to (kitContrast blends the colours by it). */
  pattern: KitPattern;
  /** Shirt body at torso cell (x, v, z): v counts shirt rows up from the waist (0..4). */
  body: (x: number, v: number, z: number) => Cell;
  /** Sleeve cell (arm x, row v 0..2 up from the cuff, z); default: the body's colour at the shoulder. */
  sleeve?: (x: number, v: number, z: number) => Cell;
  collar?: { style: 'crew' | 'vee' | 'polo'; c: Cell };
  cuff?: Cell;
  /** Shorts cell (torso rows below the shirt, and the top of each leg), and an optional side stripe. */
  shortsCell?: (x: number, y: number, z: number) => Cell;
  stripe?: Cell;
  /** Sock rows: the foot row (1) and the turnover (2). */
  sock: readonly [Cell, Cell];
  /** The shirt number on the back. */
  ink: number;
}

/** A cheap, fixed hash of a cell (0..1). */
export function cellHash(x: number, y: number, z: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

/**
 * A shirt from pixel art: `front` is 5 rows (top first) of 8 characters across the chest, `back` the same (default:
 * the front again), looked up in `pal`; the sides carry on the nearest column of the front.
 */
function art(front: readonly string[], pal: { readonly [c: string]: Cell }, back: readonly string[] = front): KitDesign['body'] {
  return (x, v, z) => {
    const rows = x === 0 ? back : front;
    const row = rows[4 - v] ?? rows[rows.length - 1];
    const zz = x === 0 ? 7 - z : z;
    const ch = row[Math.max(0, Math.min(7, zz))] ?? '.';
    return pal[ch] ?? pal['.'];
  };
}

const WHITE = 0xfbfbf4;
const NAVY = 0x1b2a6b;
const GOLD = 0xffc23a;

// ------------------------------------------------------------------ the designs

const D: KitDesign[] = [
  // Zigzag: tangerine, a navy zigzag across the chest, navy V and trim.
  {
    id: 'zigzag', shirt: 0xff8a2b, shirt2: NAVY, shorts: NAVY, socks: 0xff8a2b, pattern: 'hoops', ink: WHITE,
    body: (_x, v, z) => {
      const c = 2 + [-1, 0, 1, 0][z % 4];
      return v === c || v === c + 1 ? NAVY : 0xff8a2b;
    },
    collar: { style: 'vee', c: NAVY }, cuff: NAVY, sock: [0xff8a2b, NAVY],
  },
  // Checkerboard: red and white checks, two voxels square, down to checked socks.
  {
    id: 'checker', shirt: 0xe8443a, shirt2: WHITE, shorts: WHITE, socks: 0xe8443a, pattern: 'stripes', ink: 0x1c1c22,
    body: (x, v, z) => (((x === 0 || x === 4 ? z >> 1 : x >> 1) + (v >> 1)) % 2 === 0 ? 0xe8443a : WHITE),
    sleeve: (x, v) => ((x + v) % 2 === 0 ? 0xe8443a : WHITE),
    collar: { style: 'crew', c: 0x1c1c22 }, cuff: 0x1c1c22, sock: [0xe8443a, WHITE],
  },
  // Arctic camo: white, ice and slate blobs (never green: it would melt into the grass).
  {
    id: 'camo', shirt: 0xd6e2ea, shirt2: 0x5a6e88, shorts: 0x5a6e88, socks: 0xe8eef2, pattern: 'plain', ink: 0x26262e,
    body: (x, v, z) => {
      const n = Math.sin(z * 1.31 + v * 2.07 + x * 0.9) + Math.sin(z * 0.63 - v * 1.71 + x * 1.7) * 0.8;
      return n > 0.85 ? 0x5a6e88 : n > 0.05 ? 0xa8c8e0 : 0xeef3f6;
    },
    sleeve: (x, v, z) => (cellHash(x, v, z) > 0.6 ? 0x5a6e88 : cellHash(z, x, v) > 0.5 ? 0xa8c8e0 : 0xeef3f6),
    collar: { style: 'crew', c: 0x5a6e88 }, cuff: 0x5a6e88, sock: [0xe8eef2, 0x5a6e88],
  },
  // Tiger: orange with black stripes coming in from the sides.
  {
    id: 'tiger', shirt: 0xff8a1a, shirt2: 0x1c1c22, shorts: 0x1c1c22, socks: 0xff8a1a, pattern: 'plain', ink: WHITE,
    body: art(['BB....BB', 'B.....BB', '.BB..BB.', 'BB....B.', 'B.B..B.B'], { '.': 0xff8a1a, B: 0x1c1c22 }),
    sleeve: (_x, v) => (v === 1 ? 0x1c1c22 : 0xff8a1a),
    collar: { style: 'vee', c: 0x1c1c22 }, cuff: 0x1c1c22, sock: [0x1c1c22, 0xff8a1a],
  },
  // Sunset fade: pink at the waist to gold at the shoulders.
  {
    id: 'fade', shirt: 0xff7a3c, shirt2: 0xffd23a, shorts: 0x3a1f7a, socks: 0xffd23a, pattern: 'hoops', ink: 0x3a1f7a,
    body: (_x, v) => [0xff3c8a, 0xff5a6a, 0xff7a3c, 0xffa42a, 0xffd23a][v],
    sleeve: () => 0xffd23a,
    collar: { style: 'crew', c: WHITE }, cuff: 0xff3c8a, stripe: 0xff7a3c, sock: [0xffd23a, 0xff3c8a],
  },
  // Retro 80s: white, teal and pink shapes, yellow sparks, a polo collar.
  {
    id: 'retro', shirt: WHITE, shirt2: 0x2bb5a8, shorts: 0x2bb5a8, socks: WHITE, pattern: 'sash', ink: 0x2bb5a8,
    body: art(['..Y...P.', '.....PP.', 'TT..PP..', 'TTT....Y', 'TTTT....'], { '.': WHITE, T: 0x2bb5a8, P: 0xff3c9e, Y: 0xffd23a }),
    sleeve: (_x, v) => (v === 1 ? 0xff3c9e : WHITE),
    collar: { style: 'polo', c: 0x2bb5a8 }, cuff: 0x2bb5a8, stripe: 0xff3c9e, sock: [WHITE, 0xff3c9e],
  },
  // Inferno: deep red, pixel flames licking up from the hem (they flicker, and glow at night).
  {
    id: 'inferno', shirt: 0x8a1424, shirt2: 0xff8a1a, shorts: 0x5a0f18, socks: 0x8a1424, pattern: 'hoops', ink: 0xffd23a,
    body: art(['........', '.r....r.', 'rOr..rOr', 'OYOrrOYO', 'YYYOOYYY'], {
      '.': 0x8a1424, r: [0xe8241a, FX.flicker], O: [0xff8a1a, FX.flicker], Y: [0xffd23a, FX.flicker],
    }),
    collar: { style: 'vee', c: [0xff8a1a, FX.flicker] }, cuff: [0xff8a1a, FX.flicker], stripe: [0xff8a1a, FX.flicker],
    sock: [0x8a1424, [0xff8a1a, FX.flicker]],
  },
  // Thunder: electric blue, a yellow bolt across the chest, trim that glows at night.
  {
    id: 'bolt', shirt: 0x1f5fe8, shirt2: 0xffe23a, shorts: 0x10245a, socks: 0x1f5fe8, pattern: 'sash', ink: 0xffe23a,
    body: art(['..YY....', '...YY...', '..YYYY..', '....YY..', '.....YY.'], { '.': 0x1f5fe8, Y: [0xffe23a, FX.glow] }, [
      '........', '........', '........', '........', '........',
    ]),
    collar: { style: 'vee', c: [0xffe23a, FX.glow] }, cuff: [0xffe23a, FX.glow], stripe: [0xffe23a, FX.glow], sock: [0x1f5fe8, [0xffe23a, FX.glow]],
  },
  // Ice King: ice blue, frost crystals that shimmer as he turns.
  {
    id: 'iceking', shirt: 0xa8e4ff, shirt2: WHITE, shorts: WHITE, socks: 0xa8e4ff, pattern: 'plain', ink: 0x2f7be8,
    body: art(['W.B..B.W', '.WBW.WB.', 'BWWWBWWB', '.WBW.WB.', 'W.B..B.W'], {
      '.': [0xa8e4ff, FX.iri], W: [0xffffff, FX.iri], B: [0x5cc8f5, FX.iri],
    }),
    sleeve: (_x, v) => (v === 1 ? [0xffffff, FX.iri] : [0xa8e4ff, FX.iri]),
    collar: { style: 'crew', c: [0x2f7be8, FX.iri] }, cuff: [0x2f7be8, FX.iri], sock: [0xa8e4ff, [0xffffff, FX.iri]],
  },
  // Hologram: pearl white that shimmers every colour.
  {
    id: 'holo', shirt: 0xe6e8f0, shirt2: 0xc8ccd8, shorts: 0xe6e8f0, socks: 0xe6e8f0, pattern: 'plain', ink: 0x5a5a6a,
    body: (_x, v, z) => [(v + z) % 3 === 0 ? 0xf6f8ff : 0xdfe2ec, FX.iri],
    sleeve: () => [0xeef0f8, FX.iri],
    shortsCell: () => [0xe6e8f0, FX.iri],
    collar: { style: 'crew', c: [0xc8ccd8, FX.metal] }, cuff: [0xc8ccd8, FX.metal], sock: [[0xe6e8f0, FX.iri], [0xc8ccd8, FX.metal]],
  },
  // Galaxy: deep purple space, pink nebula clouds and twinkling stars (they glow at night).
  {
    id: 'galaxy', shirt: 0x3b1e8a, shirt2: 0xc23cc8, shorts: 0x2a1460, socks: 0x3b1e8a, pattern: 'plain', ink: 0xffffff,
    body: (x, v, z) => {
      const h = cellHash(x, v, z);
      if (h > 0.86) return [0xffffff, FX.twinkle];
      if (h > 0.8) return [0x8fe3ff, FX.twinkle];
      const n = Math.sin(z * 0.9 + v * 1.3 + x * 0.4) + Math.sin(z * 0.4 - v * 0.8);
      return n > 0.9 ? 0xc23cc8 : n > 0.2 ? 0x6a2fb8 : 0x3b1e8a;
    },
    sleeve: (x, v, z) => (cellHash(z, v, x) > 0.8 ? [0xffffff, FX.twinkle] : 0x3b1e8a),
    collar: { style: 'crew', c: [0xff5cf0, FX.glow] }, cuff: [0xff5cf0, FX.glow], stripe: [0x8fe3ff, FX.twinkle],
    sock: [0x2a1460, [0xffffff, FX.twinkle]],
  },
  // Gold pinstripe: royal navy, gold foil pinstripes, gold collar, cuffs and socks.
  {
    id: 'pinstripe', shirt: 0x23408f, shirt2: GOLD, shorts: 0x23408f, socks: 0x23408f, pattern: 'plain', ink: GOLD,
    body: (x, _v, z) => ((x === 0 || x === 4 ? z : x) % 3 === 1 ? [GOLD, FX.metal] : 0x23408f),
    sleeve: (_x, _v, z) => (z === 0 ? [GOLD, FX.metal] : 0x23408f),
    collar: { style: 'polo', c: [GOLD, FX.metal] }, cuff: [GOLD, FX.metal], stripe: [GOLD, FX.metal], sock: [0x23408f, [GOLD, FX.metal]],
  },
  // Glow in the dark: white with neon circuit lines that light up under the floodlights.
  {
    id: 'neonglow', shirt: 0xdfe6ee, shirt2: 0x3cf7ff, shorts: 0x2a2f4a, socks: 0xdfe6ee, pattern: 'plain', ink: 0xff3cf0,
    body: art(['C......P', 'CCC..PPP', '..C..P..', '..CCPP..', '...CP...'], { '.': 0xdfe6ee, C: [0x3cf7ff, FX.glow], P: [0xff3cf0, FX.glow] }),
    sleeve: (_x, v) => (v === 2 ? [0x3cf7ff, FX.glow] : 0xdfe6ee),
    collar: { style: 'vee', c: [0x3cf7ff, FX.glow] }, cuff: [0xff3cf0, FX.glow], stripe: [0x3cf7ff, FX.glow], sock: [0xdfe6ee, [0xff3cf0, FX.glow]],
  },
  // Gold foil: solid gold head to toe (it catches the light as he runs), black trim.
  {
    id: 'goldfoil', shirt: 0xffc23a, shirt2: 0x26262e, shorts: 0xffc23a, socks: 0xffc23a, pattern: 'plain', ink: 0x26262e,
    body: (_x, v, z) => [(v + z) % 4 === 0 ? 0xfff0b0 : GOLD, FX.metal],
    sleeve: () => [GOLD, FX.metal],
    shortsCell: () => [0xe8a82a, FX.metal],
    collar: { style: 'vee', c: 0x26262e }, cuff: 0x26262e, stripe: 0x26262e, sock: [[GOLD, FX.metal], 0x26262e],
  },
  // ---- Club Pass kits, one a month (January first: core/save.ts PASS_IDS)
  {
    id: 'pass01', shirt: 0xf4f8ff, shirt2: 0x5cc8f5, shorts: NAVY, socks: 0xf4f8ff, pattern: 'plain', ink: NAVY,
    body: art(['NNNNNNNN', '.B....B.', 'BBB..BBB', '.B....B.', 'NNNNNNNN'], { '.': 0xf4f8ff, B: 0x5cc8f5, N: NAVY }),
    collar: { style: 'crew', c: 0x5cc8f5 }, cuff: NAVY, sock: [0xf4f8ff, 0x5cc8f5],
  },
  {
    id: 'pass02', shirt: 0xe6d2a8, shirt2: 0x7a5236, shorts: 0x7a5236, socks: 0xe6d2a8, pattern: 'plain', ink: 0x5a3a20,
    body: (x, v, z) => (cellHash(x, v, z) > 0.72 ? 0x7a5236 : cellHash(z, x, v) > 0.85 ? 0x9a6e48 : 0xe6d2a8),
    collar: { style: 'polo', c: 0x7a5236 }, cuff: 0x7a5236, sock: [0x7a5236, 0xe6d2a8],
  },
  {
    id: 'pass03', shirt: WHITE, shirt2: 0xff8ad0, shorts: 0xff8ad0, socks: WHITE, pattern: 'plain', ink: 0xd8408a,
    body: art(['.P....P.', 'PYP..PYP', '.P..P...', '...PYP..', '....P..P'], { '.': WHITE, P: 0xff8ad0, Y: 0xffd23a }),
    collar: { style: 'crew', c: 0xff8ad0 }, cuff: 0xff8ad0, sock: [WHITE, 0xff8ad0],
  },
  {
    id: 'pass04', shirt: 0x2f7be8, shirt2: 0xa8e4ff, shorts: NAVY, socks: 0x2f7be8, pattern: 'plain', ink: WHITE,
    body: art(['.L...L..', '...L...L', '.L...L..', '...L...L', '.L...L..'], { '.': 0x2f7be8, L: 0xa8e4ff }),
    collar: { style: 'vee', c: WHITE }, cuff: WHITE, sock: [0x2f7be8, WHITE],
  },
  {
    id: 'pass05', shirt: WHITE, shirt2: GOLD, shorts: GOLD, socks: WHITE, pattern: 'plain', ink: 0xc7970f,
    body: art(['G......G', '..GGGG..', '..GGGG..', '...GG...', '..GGGG..'], { '.': WHITE, G: [GOLD, FX.metal] }),
    shortsCell: () => [0xe8a82a, FX.metal],
    collar: { style: 'polo', c: [GOLD, FX.metal] }, cuff: [GOLD, FX.metal], sock: [WHITE, [GOLD, FX.metal]],
  },
  {
    id: 'pass06', shirt: 0xff8a6a, shirt2: 0x2bb5a8, shorts: 0x2bb5a8, socks: 0xffd23a, pattern: 'hoops', ink: WHITE,
    body: (_x, v) => [0xff5c8a, 0xff8a2b, 0xffd23a, 0x2bb5a8, 0xff8a6a][v],
    collar: { style: 'crew', c: WHITE }, cuff: 0x2bb5a8, sock: [0xffd23a, 0xff5c8a],
  },
  {
    id: 'pass07', shirt: 0xff5a2a, shirt2: 0xffd23a, shorts: 0xc4261a, socks: 0xff5a2a, pattern: 'hoops', ink: WHITE,
    body: (_x, v) => [[0xd8241a, FX.flicker], [0xec4a2a, FX.flicker], 0xff6a2a, 0xff9a2a, 0xffd23a][v] as Cell,
    collar: { style: 'vee', c: 0xffd23a }, cuff: 0xd8241a, sock: [0xff5a2a, 0xffd23a],
  },
  {
    id: 'pass08', shirt: 0x1fb3a6, shirt2: WHITE, shorts: WHITE, socks: 0x1fb3a6, pattern: 'plain', ink: WHITE,
    body: (x, v, z) => {
      const side = x !== 0 && x !== 4;
      if (side) return WHITE;
      if (z === 0 || z === 7) return WHITE;
      return v === 4 && (z === 1 || z === 6) ? 0xffd23a : 0x1fb3a6;
    },
    sleeve: () => WHITE,
    collar: { style: 'crew', c: 0xffd23a }, cuff: 0x1fb3a6, sock: [0x1fb3a6, WHITE],
  },
  {
    id: 'pass09', shirt: 0xd8a41a, shirt2: 0x8a5a36, shorts: 0x8a5a36, socks: 0xd8a41a, pattern: 'stripes', ink: 0xfff0b0,
    body: (x, v, z) => {
      const u = x === 0 || x === 4 ? z : x;
      if (u % 3 === 2 && v % 2 === 1) return 0xfff0b0;
      return u % 3 === 2 || v % 2 === 1 ? 0x8a5a36 : 0xd8a41a;
    },
    collar: { style: 'polo', c: 0x8a5a36 }, cuff: 0x8a5a36, sock: [0xd8a41a, 0x8a5a36],
  },
  {
    id: 'pass10', shirt: 0x8a55d8, shirt2: 0x3cf7ff, shorts: 0x3a1f7a, socks: 0x8a55d8, pattern: 'plain', ink: WHITE,
    body: art(['C......C', '.C....C.', '..C..C..', '...CC...', '........'], { '.': 0x8a55d8, C: [0x3cf7ff, FX.glow] }),
    collar: { style: 'vee', c: [0x3cf7ff, FX.glow] }, cuff: [0x3cf7ff, FX.glow], stripe: [0x3cf7ff, FX.glow], sock: [0x8a55d8, [0x3cf7ff, FX.glow]],
  },
  {
    id: 'pass11', shirt: 0xb8241a, shirt2: 0xff9a1f, shorts: 0x6a1410, socks: 0xb8241a, pattern: 'plain', ink: 0xffd23a,
    body: (x, v, z) => {
      const h = cellHash(x, v, z);
      return h > 0.85 ? [0xffd23a, FX.flicker] : h > 0.72 ? [0xff9a1f, FX.flicker] : 0xb8241a;
    },
    collar: { style: 'crew', c: [0xff9a1f, FX.glow] }, cuff: [0xff9a1f, FX.glow], sock: [0xb8241a, [0xff9a1f, FX.flicker]],
  },
  {
    id: 'pass12', shirt: 0xd8241a, shirt2: WHITE, shorts: WHITE, socks: 0xd8241a, pattern: 'hoops', ink: WHITE,
    body: art(['WWWWWWWW', '.W.W.W.W', 'W.W.W.W.', '...G....', 'WWWWWWWW'], { '.': 0xd8241a, W: WHITE, G: [GOLD, FX.metal] }),
    collar: { style: 'crew', c: WHITE }, cuff: WHITE, sock: [0xd8241a, WHITE],
  },
];

/** Every premium kit design by id (the club's own kit, 'club', is not a design: it is drawn as ever). */
export const KIT_DESIGNS: { readonly [id: string]: KitDesign } = Object.fromEntries(D.map((d) => [d.id, d]));

/**
 * Big Crest: not a fixed palette but your club's own colours, with a giant crest across the chest (a shield in the
 * second colour, a gold rim and a star). Made per club and cached.
 */
const crestCache = new Map<string, KitDesign>();
function crestDesign(club: Kit): KitDesign {
  // A green club's crest kit is in its other colour (the crest takes the green): never green on green, so the match
  // never has to swap it for a change strip.
  const greenMain = grassLike(club.shirt);
  const main = greenMain ? (grassLike(club.shirt2) || club.shirt2 === club.shirt ? WHITE : club.shirt2) : club.shirt;
  const base = { ...club, shirt: main, shorts: grassLike(club.shorts) ? main : club.shorts, socks: grassLike(club.socks) ? main : club.socks };
  const key = `${base.shirt}-${club.shirt}-${club.shirt2}-${base.shorts}-${base.socks}`;
  let d = crestCache.get(key);
  if (!d) {
    const other = greenMain ? club.shirt : club.shirt2;
    const two = other === main ? (main === WHITE ? 0x26262e : WHITE) : other;
    d = {
      id: 'crest', shirt: base.shirt, shirt2: two, shorts: base.shorts, socks: base.socks, pattern: 'plain', ink: two,
      body: art(['.GGGGGG.', '.G2S22G.', '.G2222G.', '..G22G..', '...GG...'], { '.': base.shirt, G: [GOLD, FX.metal], '2': two, S: [WHITE, FX.metal] }, [
        '........', '........', '........', '........', '........',
      ]),
      collar: { style: 'polo', c: two }, cuff: two, stripe: two, sock: [base.socks, two],
    };
    crestCache.set(key, d);
  }
  return d;
}

/** The design for a premium kit id ('crest' is made from `base`, your club's kit); null for the club's own kit. */
export function kitDesign(id: string | undefined, base?: Kit): KitDesign | null {
  if (!id || id === 'club') return null;
  if (id === 'crest') return base ? crestDesign(base) : null;
  return KIT_DESIGNS[id] ?? null;
}

// ------------------------------------------------------------------ the styled kit a match draws

/** The player-look slots (core/save.ts LOOK_SLOTS), as the renderer reads them. */
export interface LookSet {
  hair?: string;
  head?: string;
  arm?: string;
  boots?: string;
  gloves?: string;
  shades?: string;
}

/** What a side's kit may carry beyond the classic Kit (meta/style.ts dresses the human's side with it). */
export interface KitStyle {
  /** A premium kit design id (KIT_DESIGNS, or 'crest'). */
  design?: string;
  /** Player looks for this side. */
  looks?: LookSet;
  /** The player id who wears the captain's looks (hair, headgear, armband). */
  captain?: string;
}

export type StyledKit = Kit & KitStyle;

/** A kit dressed in premium design `id` (its colours, so every clash and contrast check reads the real kit). */
export function designKit(id: string | undefined, base: Kit): StyledKit {
  const d = kitDesign(id, base);
  if (!d) return { ...base };
  return { ...base, shirt: d.shirt, shirt2: d.shirt2, pattern: d.pattern, shorts: d.shorts, socks: d.socks, design: d.id };
}

/**
 * The design a styled kit is drawn in, or null: none set, or the match changed its colours (a clash fix the human
 * side should never get: meta/style.ts resolves clashes on the other side first) and the classic kit must show.
 */
export function designOf(kit: Kit): KitDesign | null {
  const k = kit as StyledKit;
  const d = kitDesign(k.design, k);
  if (!d) return null;
  return d.shirt === k.shirt && d.shorts === k.shorts ? d : null;
}

// ------------------------------------------------------------------ painters (render/characters.ts calls them)

/** Paint a design's torso into grid `g` (TORSO_D x TORSO_H x TORSO_W) with `shortsRows` rows of shorts at the bottom. */
export function paintTorso(g: VoxelGrid, d: KitDesign, shortsRows: number): void {
  const nx = g.nx, ny = g.ny, nz = g.nz;
  const front = nx - 1;
  for (let y = 0; y < ny; y++) {
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        let c: Cell;
        if (y < shortsRows) {
          c = d.shortsCell ? d.shortsCell(x, y, z) : d.shorts;
          if (d.stripe && (z === 0 || z === nz - 1) && x >= 1 && x <= nx - 2) c = d.stripe;
          if (y === shortsRows - 1 && !d.shortsCell) c = shadeHex(col(c), 0.86);
        } else c = d.body(x, y - shortsRows, z);
        g.set(x, y, z, col(c), fxOf(c));
      }
    }
  }
  // The collar on the front's top rows (the head hides the top face).
  const top = ny - 1;
  const mid = nz / 2;
  if (d.collar) {
    const cc = d.collar.c;
    const put = (y: number, z: number) => g.set(front, y, z, col(cc), fxOf(cc));
    if (d.collar.style === 'crew') for (let z = mid - 2; z < mid + 2; z++) put(top, z);
    else if (d.collar.style === 'vee') {
      for (let z = mid - 2; z < mid + 2; z++) put(top, z);
      put(top - 1, mid - 1);
      put(top - 1, mid);
    } else {
      for (let z = mid - 3; z < mid + 3; z++) put(top, z);
      put(top - 1, mid);
      put(top - 2, mid);
      g.set(front, top - 1, mid - 1, 0xfbfbf4);
    }
  }
}

/** Paint a design's arm into grid `g` (3 x ARM_L x 2): sleeve and cuff (`cuffRow`), skin hands below. */
export function paintArm(g: VoxelGrid, d: KitDesign, skin: number, cuffRow: number): void {
  for (let y = 0; y < g.ny; y++) {
    for (let x = 0; x < g.nx; x++) {
      for (let z = 0; z < g.nz; z++) {
        let c: Cell;
        if (y < cuffRow) c = skin;
        else if (y === cuffRow) c = d.cuff ?? shadeHex(col(sleeveAt(d, x, 0, z)), 0.86);
        else c = sleeveAt(d, x, y - cuffRow, z);
        g.set(x, y, z, col(c), fxOf(c));
      }
    }
  }
}

function sleeveAt(d: KitDesign, x: number, v: number, z: number): Cell {
  return d.sleeve ? d.sleeve(x, v, z) : d.body(2, 4, z === 0 ? 0 : 7);
}

/** Paint a design's leg (shorts at the top row, knee, socks; boots are the caller's) into grid `g`. */
export function paintLeg(g: VoxelGrid, d: KitDesign, skin: number): void {
  const top = g.ny - 1;
  for (let x = 0; x < 2; x++) {
    for (let z = 0; z < g.nz; z++) {
      const sh = d.shortsCell ? d.shortsCell(x, 1, z) : d.shorts;
      const s = d.stripe && z === 0 ? d.stripe : sh;
      g.set(x, top, z, col(s), fxOf(s));
      g.set(x, top - 1, z, skin);
      g.set(x, 1, z, col(d.sock[0]), fxOf(d.sock[0]));
      g.set(x, 2, z, col(d.sock[1]), fxOf(d.sock[1]));
    }
  }
}

/** 0xRRGGBB scaled by k (clamped). */
export function shadeHex(c: number, k: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * k));
  const b = Math.min(255, Math.round((c & 255) * k));
  return (r << 16) | (g << 8) | b;
}
