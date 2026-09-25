import { Rng, hashString } from '../core/rng';
import { FORMATIONS } from '../sim/formations';
import type { FormationId, Kit, KitPattern, PlayerDef, PlayerStats, Role, TeamDef } from '../sim/types';

// Bright, toy-like kit colours in the spirit of the art direction.
export const KIT_COLORS = {
  red: 0xe8443a,
  crimson: 0xb3243a,
  orange: 0xff8a2b,
  yellow: 0xffd23a,
  lime: 0x9bd83a,
  green: 0x2fae5a,
  teal: 0x1fb3a6,
  sky: 0x5cc8f5,
  blue: 0x2f6fe0,
  navy: 0x223a78,
  purple: 0x8a55d8,
  pink: 0xff79b0,
  white: 0xf6f4ec,
  black: 0x2a2a30,
  grey: 0x9aa0a8,
  maroon: 0x7e1f33,
  gold: 0xe0b23a,
  brown: 0x8a5a36,
} as const;

const C = KIT_COLORS;

const FIRST = [
  'Alex', 'Ben', 'Carlos', 'Dani', 'Eli', 'Femi', 'Gio', 'Hugo', 'Ivan', 'Jonah', 'Kai', 'Luca', 'Mo', 'Nico', 'Oli',
  'Pablo', 'Quin', 'Rafa', 'Sami', 'Theo', 'Umar', 'Vik', 'Wes', 'Xavi', 'Yuri', 'Zak', 'Ade', 'Bruno', 'Cian', 'Dario',
  'Emre', 'Finn', 'Goran', 'Hiro', 'Idris', 'Jules', 'Kofi', 'Leon', 'Milo', 'Nuno', 'Otto', 'Pedro', 'Rio', 'Seb',
  'Tariq', 'Ugo', 'Vasco', 'Wren', 'Yaya', 'Zeno', 'Arlo', 'Bram', 'Cruz', 'Dex', 'Ezra', 'Felix', 'Gus', 'Hamza',
];

const LAST = [
  'Pebble', 'Brickley', 'Hopper', 'Stack', 'Cubbins', 'Blockman', 'Voxley', 'Pixton', 'Mossby', 'Tumble', 'Crumb',
  'Nibbs', 'Puddle', 'Chunk', 'Waddle', 'Dash', 'Sprout', 'Bramble', 'Thistle', 'Clover', 'Quarry', 'Fletch',
  'Morrow', 'Ashby', 'Kettle', 'Marble', 'Button', 'Cobble', 'Rook', 'Barrow', 'Finch', 'Wicket', 'Juniper', 'Mallow',
  'Pudding', 'Hazel', 'Oakes', 'Rivers', 'Stone', 'Brook', 'Hill', 'Field', 'Carver', 'Duffy', 'Garnet', 'Hollis',
  'Ibarra', 'Jansen', 'Kowal', 'Lindqvist', 'Mbeki', 'Novak', 'Okafor', 'Petrov', 'Quiroga', 'Rossi', 'Santos',
  'Tanaka', 'Ueda', 'Varga', 'Wójcik', 'Yilmaz', 'Zulu', 'Abara', 'Bento', 'Costa', 'Diallo', 'Eriksen', 'Fofana',
];

const TOWNS = [
  'Mossvale', 'Pinebrook', 'Redcliff', 'Ashford', 'Lakemoor', 'Hopton', 'Crumbleton', 'Bramblewick', 'Kettleby',
  'Stonehaven', 'Riverside', 'Pebbleport', 'Oakridge', 'Foxhollow', 'Duckworth', 'Clovermead', 'Harbourne',
  'Thistledown', 'Brickfield', 'Northwick', 'Sunnyside', 'Cobbleford', 'Marblehead', 'Wrenfield',
];

const SUFFIX = ['FC', 'United', 'Rovers', 'Athletic', 'City', 'Wanderers', 'Town', 'Albion', 'Rangers', 'Sporting'];

export interface ClubSeed {
  name: string;
  short: string;
  kit: Kit;
  formation: FormationId;
  level: number;
}

function kit(shirt: number, shirt2: number, pattern: KitPattern, shorts: number, socks: number, gk: number): Kit {
  return { shirt, shirt2, pattern, shorts, socks, gk };
}

/** Hand-authored rivals for quick matches, from park football to superstars. */
export const PRESET_CLUBS: ClubSeed[] = [
  { name: 'Mossvale Rovers', short: 'MOS', kit: kit(C.green, C.white, 'hoops', C.white, C.green, C.yellow), formation: '4-4-2', level: 42 },
  { name: 'Pebbleport Town', short: 'PEB', kit: kit(C.sky, C.white, 'sleeves', C.navy, C.sky, C.orange), formation: '4-4-2', level: 48 },
  { name: 'Duckworth Albion', short: 'DUC', kit: kit(C.yellow, C.black, 'plain', C.black, C.yellow, C.purple), formation: '4-3-3', level: 54 },
  { name: 'Crumbleton City', short: 'CRU', kit: kit(C.maroon, C.gold, 'sash', C.white, C.maroon, C.lime), formation: '4-2-3-1', level: 60 },
  { name: 'Foxhollow Athletic', short: 'FOX', kit: kit(C.orange, C.white, 'halves', C.black, C.orange, C.teal), formation: '3-5-2', level: 65 },
  { name: 'Stonehaven United', short: 'STO', kit: kit(C.navy, C.red, 'stripes', C.navy, C.red, C.lime), formation: '4-4-2', level: 70 },
  { name: 'Lakemoor Sporting', short: 'LAK', kit: kit(C.teal, C.white, 'plain', C.white, C.teal, C.pink), formation: '4-3-3', level: 75 },
  { name: 'Redcliff Rangers', short: 'RED', kit: kit(C.red, C.white, 'stripes', C.white, C.red, C.green), formation: '4-2-3-1', level: 80 },
  { name: 'Harbourne FC', short: 'HAR', kit: kit(C.purple, C.gold, 'sleeves', C.purple, C.gold, C.lime), formation: '5-3-2', level: 84 },
  { name: 'Northwick Wanderers', short: 'NOR', kit: kit(C.white, C.black, 'halves', C.black, C.white, C.orange), formation: '4-3-3', level: 88 },
  { name: 'Brickfield Royale', short: 'BRK', kit: kit(C.gold, C.navy, 'plain', C.navy, C.gold, C.pink), formation: '4-2-3-1', level: 92 },
];

const STAT_KEYS: (keyof PlayerStats)[] = ['pace', 'shooting', 'passing', 'dribbling', 'defending', 'keeping', 'stamina'];

const ROLE_BIAS: Record<Role, Partial<Record<keyof PlayerStats, number>>> = {
  GK: { keeping: 12, pace: -12, shooting: -30, dribbling: -20, defending: -10, passing: -5 },
  DF: { defending: 10, pace: 0, shooting: -14, dribbling: -8, keeping: -60, passing: -2 },
  MF: { passing: 9, dribbling: 5, stamina: 6, keeping: -60, defending: -4, shooting: -2 },
  FW: { shooting: 11, pace: 6, dribbling: 6, defending: -22, keeping: -60, passing: -3 },
};

export function makeStats(rng: Rng, role: Role, level: number): PlayerStats {
  const out = {} as PlayerStats;
  for (const k of STAT_KEYS) {
    const bias = ROLE_BIAS[role][k] ?? 0;
    out[k] = Math.round(Math.max(8, Math.min(99, level + bias + rng.gauss() * 6)));
  }
  return out;
}

export function makeName(rng: Rng): string {
  return `${rng.pick(FIRST)[0]}. ${rng.pick(LAST)}`;
}

export function makePlayer(rng: Rng, role: Role, level: number, number: number, id: string): PlayerDef {
  return {
    id,
    name: makeName(rng),
    number,
    role,
    stats: makeStats(rng, role, level),
    look: {
      skin: rng.int(6),
      hair: rng.int(9),
      hairColor: rng.int(8),
      beard: rng.chance(0.25) ? 1 + rng.int(2) : 0,
      boots: rng.pick([0x2a2a30, 0xf6f4ec, 0xff4d8a, 0x3aff9e, 0xffd23a, 0x39a0ff, 0xff7a1a]),
    },
  };
}

const NUMBERS: Record<Role, number[]> = {
  GK: [1],
  DF: [2, 3, 4, 5, 6, 12, 15],
  MF: [8, 6, 10, 7, 11, 14, 16, 18],
  FW: [9, 10, 11, 7, 19, 20],
};

export function makeTeam(seed: ClubSeed, id = seed.short): TeamDef {
  const rng = new Rng(hashString(seed.name));
  const slots = FORMATIONS[seed.formation];
  const used = new Set<number>();
  const players = slots.map((slot, i) => {
    let n = NUMBERS[slot.role].find((x) => !used.has(x)) ?? 20 + i;
    used.add(n);
    return makePlayer(rng, slot.role, seed.level, n, `${id}-${i}`);
  });
  const benchRoles: Role[] = ['GK', 'DF', 'MF', 'MF', 'FW'];
  const bench = benchRoles.map((role, i) => {
    let n = NUMBERS[role].find((x) => !used.has(x)) ?? 12 + i * 2;
    while (used.has(n)) n++;
    used.add(n);
    return makePlayer(rng, role, seed.level - 3, n, `${id}-b${i}`);
  });
  return { id, name: seed.name, short: seed.short, kit: seed.kit, formation: seed.formation, players, bench };
}

export function randomClubSeed(rng: Rng, level: number): ClubSeed {
  const town = rng.pick(TOWNS);
  const name = `${town} ${rng.pick(SUFFIX)}`;
  const cols = Object.values(KIT_COLORS);
  const shirt = rng.pick(cols);
  let shirt2 = rng.pick(cols);
  if (shirt2 === shirt) shirt2 = shirt === C.white ? C.black : C.white;
  const patterns: KitPattern[] = ['plain', 'plain', 'stripes', 'hoops', 'halves', 'sash', 'sleeves'];
  const formations: FormationId[] = ['4-4-2', '4-3-3', '4-2-3-1', '3-5-2', '5-3-2'];
  return {
    name,
    short: town.slice(0, 3).toUpperCase(),
    kit: kit(shirt, shirt2, rng.pick(patterns), rng.chance(0.5) ? C.white : shirt2, shirt, rng.pick([C.lime, C.orange, C.pink, C.yellow, C.teal])),
    formation: rng.pick(formations),
    level,
  };
}

/** When both kits clash, the away side wears a change strip. */
export function resolveKitClash(home: Kit, away: Kit): Kit {
  const d = colorDistance(home.shirt, away.shirt);
  if (d > 110) return away;
  const alt = colorDistance(home.shirt, C.white) > 140 ? C.white : C.black;
  return { ...away, shirt: alt, shirt2: away.shirt, shorts: alt === C.white ? away.shirt : C.white, socks: alt };
}

function colorDistance(a: number, b: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2);
}

/** Is this colour close to the grass? (hue in the greens, not too grey or too dark). */
export function grassLike(hex: number): boolean {
  const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 0.12 || l < 0.18 || l > 0.8) return false;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return h >= 62 && h <= 165;
}

/** Players vanish into the pitch in mostly-green kits: switch to the change strip for the match. */
export function grassSafeKit(k: Kit): Kit {
  const mostlyShirt = k.pattern === 'plain' || k.pattern === 'sleeves' || k.pattern === 'sash';
  if (!grassLike(k.shirt) || (!mostlyShirt && !grassLike(k.shirt2))) return k;
  const alt = grassLike(k.shirt2) ? C.white : k.shirt2;
  return { ...k, shirt: alt, shirt2: k.shirt, shorts: grassLike(k.shorts) ? C.white : k.shorts, socks: grassLike(k.socks) ? alt : k.socks };
}
