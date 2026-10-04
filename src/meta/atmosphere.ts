/**
 * CLUB ATMOSPHERE: what stadium style and mascots are FOR. The owner: "stadium and shit looks broken, mascots and
 * shit feel useless why would i want that, like make them useful and worth it".
 *
 * Every stadium style item you own AND wear (the pitch pattern, nets, flags, the name in the seats, the tifo, the
 * walkout, the floodlights, the mascot) and every part of the ground you have built adds to your club's ATMOSPHERE.
 * At your home matches a better atmosphere means:
 *   - MATCHDAY INCOME: more coins from the match (fans buy tickets to a ground worth going to),
 *   - a FULLER GROUND: more of the seats taken (the stands you see, and the noise),
 *   - MORE CHANTS: the home crowd sings more often,
 *   - a HALF TIME SHOW: a mascot entertains the crowd at half time, which pays a few coins.
 * Each item says exactly what it adds on its shop card (`bonusText`).
 *
 * The rules that keep it fair (tests/economy.test.ts pins them):
 * - It is the META only: coins, the crowd and the noise. Nothing here touches a player's rating or the match itself.
 * - Every total is CAPPED (INCOME_CAP, CROWD_CAP, CHANT_CAP), and the caps are reached with mid-priced items, so
 *   the dearest looks are for the look: a nice boost, never a paywall.
 * - Every item is bought with coins earned by playing (meta/shop.ts): no gems and no money needed.
 * Pure rules, no DOM.
 */
import { DECOR_IDS, DECOR_SLOT_OF, PASS_NET_IDS, PASS_ENTRY_IDS, type DecorId, type DecorSlot, type SaveData } from '../core/save';
import { builtLevel, type GroundState, type PartId } from './ground';
import { equippedSlots } from './shop';

export interface AtmoBonus {
  /** Matchday income, in % of a home match's coins. */
  income?: number;
  /** How much fuller the ground gets, in points of attendance (5 = five in a hundred more seats taken). */
  crowd?: number;
  /** More chants from the home crowd (each one makes them sing about a fifth more often). */
  chants?: number;
  /** A mascot's half time show: coins at every home match. */
  show?: number;
}

/** The most the items and parts can add up to, whatever is owned. */
export const INCOME_CAP = 12;
export const CROWD_CAP = 12;
export const CHANT_CAP = 4;
/** How much more often the crowd sings per chant (sfx.setChantRate: 1 + this each). */
export const CHANT_STEP = 0.2;

/** What each stadium style item adds while it is worn (one per slot). The shop card says exactly this. */
export const DECOR_BONUS: { readonly [k in DecorId]: AtmoBonus } = {
  mowchecks: { income: 1 }, mowdiag: { income: 1 }, mowcircle: { income: 2 }, mowcrest: { income: 3 },
  netclub: { income: 1 }, nethex: { income: 1 }, netrainbow: { income: 2 }, netglow: { income: 3 },
  flagclub: { income: 1 }, flagcheck: { income: 1 }, flagfire: { income: 2 },
  seatname: { income: 3 },
  tifoflags: { chants: 1 }, tifobig: { chants: 2, income: 1 },
  kickconfetti: { crowd: 3 }, kickfire: { crowd: 6 }, kickpyro: { crowd: 10, chants: 1 },
  lightclub: { income: 2 }, lightshow: { income: 4 },
  mascotbear: { show: 20, chants: 1 }, mascotrobot: { show: 35, chants: 1 }, mascotdragon: { show: 60, chants: 2 },
  // Premium signatures are a visual identity. The ordinary coin pieces already reach every atmosphere cap.
  ...(Object.fromEntries([...PASS_NET_IDS, ...PASS_ENTRY_IDS].map((id) => [id, {}])) as { [id in (typeof PASS_NET_IDS)[number] | (typeof PASS_ENTRY_IDS)[number]]: AtmoBonus }),
};

/** What the built parts of the ground add (on top of what each part does itself: meta/ground.ts). */
export const PART_BONUS: { readonly [k in PartId]?: AtmoBonus } = {
  lights: { crowd: 2 },
  north: { crowd: 2 },
  south: { crowd: 2 },
  roof: { crowd: 3, chants: 1 },
  screen: { crowd: 2 },
  fanzone: { crowd: 3, chants: 1 },
};

export interface Atmosphere {
  /** The headline number, 0..100 (the STADIUM tab's meter). */
  rating: number;
  /** A word for it ("QUIET" .. "ELECTRIC"). */
  word: string;
  /** Matchday income in % (capped), as a multiplier too. */
  income: number;
  /** Attendance points added (capped), 0..CROWD_CAP. */
  crowd: number;
  /** More chants (capped), 0..CHANT_CAP. */
  chants: number;
  /** The mascot's half time show: coins (0 without a mascot) and the mascot's item id. */
  show: number;
  mascot: string;
  /** Totals before the caps (the shop says "MAX" when a cap is reached). */
  raw: { income: number; crowd: number; chants: number };
}

const WORDS: readonly [number, string][] = [[80, 'ELECTRIC'], [60, 'ROCKING'], [40, 'LOUD'], [20, 'LIVELY'], [1, 'WARMING UP'], [0, 'QUIET']];

type StyleSave = Pick<SaveData, 'shop' | 'progress' | 'settings'>;

/** Add up bonuses. */
function total(list: readonly AtmoBonus[]): Required<AtmoBonus> {
  const t = { income: 0, crowd: 0, chants: 0, show: 0 };
  for (const b of list) {
    t.income += b.income ?? 0;
    t.crowd += b.crowd ?? 0;
    t.chants += b.chants ?? 0;
    t.show = Math.max(t.show, b.show ?? 0);
  }
  return t;
}

/**
 * The atmosphere from a set of worn stadium style items (by slot) and, in ROAD TO GLORY, the ground as built.
 * `slots` is what is worn and owned (meta/shop.ts equippedSlots); unknown ids count for nothing.
 */
export function atmosphereFrom(slots: { readonly [slot: string]: string | undefined }, ground?: GroundState | null): Atmosphere {
  const worn: AtmoBonus[] = [];
  let mascot = '';
  for (const [slot, id] of Object.entries(slots)) {
    if (!id || DECOR_SLOT_OF[id as DecorId] !== slot) continue;
    worn.push(DECOR_BONUS[id as DecorId]);
    if (slot === 'mascot') mascot = id;
  }
  const parts: AtmoBonus[] = [];
  if (ground) {
    for (const [id, b] of Object.entries(PART_BONUS) as [PartId, AtmoBonus][]) if (builtLevel(ground, id) > 0) parts.push(b);
  }
  const raw = total([...worn, ...parts]);
  const income = Math.min(INCOME_CAP, raw.income);
  const crowd = Math.min(CROWD_CAP, raw.crowd);
  const chants = Math.min(CHANT_CAP, raw.chants);
  // The headline: each capped total as a share of its cap (income counts double), and a mascot's show.
  const rating = Math.round(Math.min(100, (income / INCOME_CAP) * 40 + (crowd / CROWD_CAP) * 25 + (chants / CHANT_CAP) * 25 + (raw.show > 0 ? 10 : 0)));
  const word = WORDS.find(([n]) => rating >= n)![1];
  return { rating, word, income, crowd, chants, show: raw.show, mascot, raw: { income: raw.income, crowd: raw.crowd, chants: raw.chants } };
}

/** The save's atmosphere: what it wears (owned only) and, when given, its ground. */
export function atmosphereOf(save: StyleSave, ground?: GroundState | null): Atmosphere {
  return atmosphereFrom(equippedSlots(save, 'decor'), ground);
}

/** A home match's coins with the matchday income on top (rounded; never less than it was). */
export function withIncome(coins: number, a: Pick<Atmosphere, 'income'>): number {
  if (!Number.isFinite(coins) || coins <= 0) return Math.max(0, Math.floor(coins) || 0);
  return Math.round(coins * (1 + Math.max(0, Math.min(INCOME_CAP, a.income)) / 100));
}

/** A home match's attendance (0..1) with the fuller ground on top. */
export function withCrowd(attendance: number, a: Pick<Atmosphere, 'crowd'>): number {
  return Math.max(0, Math.min(1, attendance + Math.max(0, Math.min(CROWD_CAP, a.crowd)) / 100));
}

/** How much more often the home crowd sings (1 = as usual), for the crowd audio. */
export function chantRate(a: Pick<Atmosphere, 'chants'>): number {
  return 1 + CHANT_STEP * Math.max(0, Math.min(CHANT_CAP, a.chants));
}

/** One bonus in words ("+4% MATCHDAY INCOME", "+2 CHANTS", "HALF TIME SHOW +35 COINS"). No hyphens: the pixel font. */
function bonusParts(b: AtmoBonus): string[] {
  const out: string[] = [];
  if (b.show) out.push(`HALF TIME SHOW +${b.show} COINS`);
  if (b.income) out.push(`+${b.income}% MATCHDAY INCOME`);
  if (b.crowd) out.push(`+${b.crowd}% CROWD`);
  if (b.chants) out.push(`+${b.chants} ${b.chants === 1 ? 'CHANT' : 'CHANTS'}`);
  return out;
}

/** What a stadium style item does, for its shop card (the parts as a list: the UI joins them with its divider). */
export function decorBonusParts(id: string): string[] {
  const b = DECOR_BONUS[id as DecorId];
  return b ? bonusParts(b) : [];
}

/** The first (headline) bonus of an item, for its tile ("+3% INCOME", "+1 CHANT", "SHOW +20"): short. */
export function decorBonusShort(id: string): string {
  const b = DECOR_BONUS[id as DecorId];
  if (!b) return '';
  if (b.show) return `SHOW +${b.show}`;
  if (b.income) return `+${b.income}% INCOME`;
  if (b.crowd) return `+${b.crowd}% CROWD`;
  if (b.chants) return `+${b.chants} ${b.chants === 1 ? 'CHANT' : 'CHANTS'}`;
  return '';
}

/** What a built part of the ground adds to the atmosphere, in words ('' when nothing). */
export function partBonusParts(id: PartId): string[] {
  const b = PART_BONUS[id];
  return b ? bonusParts(b) : [];
}

/** The best atmosphere the catalogue allows (every slot's strongest item, the whole ground): the caps hold (tests). */
export function bestSlots(): { [k in DecorSlot]?: string } {
  const out: { [k in DecorSlot]?: string } = {};
  const score = (b: AtmoBonus) => (b.income ?? 0) * 3 + (b.crowd ?? 0) + (b.chants ?? 0) * 4 + (b.show ?? 0) / 5;
  for (const id of DECOR_IDS) {
    const slot = DECOR_SLOT_OF[id];
    const cur = out[slot];
    if (!cur || score(DECOR_BONUS[id]) > score(DECOR_BONUS[cur as DecorId])) out[slot] = id;
  }
  return out;
}
