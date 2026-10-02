/**
 * The coin SHOP's rules (no DOM: ui/shop.ts draws it). Two things to spend coins on:
 *
 * - Cosmetics: goal celebrations and ball looks (the level ladder's items: bought with coins OR earned free at
 *   their level, whichever comes first), goal explosion themes and sprint trails (coins only). Owned, equipped
 *   into Settings, drawn in every match (render/cosmetics.ts, game/matchSession.ts).
 * - SCOUT PACKS: a random player card for MY CLUB (meta/career.ts ClubState, the club PLAY NOW and CAREER field)
 *   at a fixed price with the odds on show. A card signs into the squad (squad limit and all) or is sold on.
 *
 * Fair by construction: coins only ever come from playing (no real money anywhere), cosmetics are looks, and
 * ONLINE friendlies use the preset clubs, so nothing bought here wins a match against a friend. Everything
 * persists in SaveData.shop (core/save.ts normalizeShop) and Settings.
 */
import { Rng, hashString } from '../core/rng';
import {
  BALL_SKIN_IDS, BALL_SKIN_LEVEL, BALL_SKIN_NAMES, CELEBRATION_IDS, CELEBRATION_LEVEL, CELEBRATION_NAMES, GOAL_FX_IDS, TRAIL_IDS, levelOf,
  normalizeShop, type SaveData, type ShopState,
} from '../core/save';
import { FORMATIONS } from '../sim/formations';
import { overall, type PlayerDef, type Role } from '../sim/types';
import { SQUAD_MAX, SQUAD_MIN, clonePlayer, clubRating, freeNumber, sellPlayer, swapPlayers, tuneToOverall, type CareerState, type ClubState, type Wallet } from './career';
import { makePlayer, surnameOf } from './data';
import { pinMeta, quickSaleValue, type MetaPlayer } from './market';

// ------------------------------------------------------------------ catalogue

export type ShopCat = 'celebration' | 'ball' | 'goalfx' | 'trail';
export const SHOP_CATS: readonly ShopCat[] = ['celebration', 'ball', 'goalfx', 'trail'];

export interface ShopItem {
  cat: ShopCat;
  id: string;
  /** Shown name (no hyphens: the pixel font draws them badly). */
  name: string;
  /** Coins; 0 = everyone has it from the start. */
  price: number;
  /** The level that earns it free (the unlock ladder: celebrations and balls); undefined = coins only. */
  level?: number;
  /** One line for the showcase. */
  blurb: string;
}

/**
 * Prices, tuned to what a match pays (main.ts standardReward: a win on Normal ~170-210, a draw ~90, a loss ~50,
 * x1.1 a win in a row up to x2) plus the daily gift (100-400) and challenges (100-220 each): something new every
 * two to four matches early on (250-500), the middle of the range a week of play, and a few to aim at (1500+).
 */
const CELEB_PRICE: { readonly [k in (typeof CELEBRATION_IDS)[number]]: number } = {
  classic: 0, knee: 300, shush: 450, plane: 600, robot: 800, backflip: 1200, pile: 1800,
};
const CELEB_BLURB: { readonly [k in (typeof CELEBRATION_IDS)[number]]: string } = {
  classic: 'Arms up and mobbed by your mates.',
  knee: 'Sprint away and slide in on your knees.',
  shush: 'Finger to the lips. Silence the away end.',
  plane: 'Arms out, banking round the pitch.',
  robot: 'Stiff, snappy and a little bit silly.',
  backflip: 'A full backflip. Stick the landing.',
  pile: 'Hit the deck and the whole team piles on.',
};
const BALL_PRICE: { readonly [k in (typeof BALL_SKIN_IDS)[number]]: number } = {
  classic: 0, retro: 250, blaze: 500, ice: 600, neon: 800, gold: 2500,
};
const BALL_BLURB: { readonly [k in (typeof BALL_SKIN_IDS)[number]]: string } = {
  classic: 'The match ball.',
  retro: 'Big black panels, old school.',
  blaze: 'Burnt orange with red panels.',
  ice: 'Frosty white with blue panels.',
  neon: 'Glows green under the lights.',
  gold: 'Solid gold. For legends only.',
};
const GOAL_FX: { readonly [k in (typeof GOAL_FX_IDS)[number]]: { name: string; price: number; blurb: string } } = {
  club: { name: 'Club Colours', price: 0, blurb: 'Your kit colours, every goal.' },
  gold: { name: 'Gold Rush', price: 400, blurb: 'A shower of gold over the goal mouth.' },
  fire: { name: 'Inferno', price: 450, blurb: 'Your goals go up in flames.' },
  ice: { name: 'Frostbite', price: 450, blurb: 'A blizzard in the six yard box.' },
  neon: { name: 'Neon Rave', price: 650, blurb: 'Rave colours, full volume.' },
  rainbow: { name: 'Rainbow', price: 900, blurb: 'Every colour at once.' },
  galaxy: { name: 'Galaxy', price: 1500, blurb: 'Purple, blue and stardust.' },
};
const TRAILS: { readonly [k in (typeof TRAIL_IDS)[number]]: { name: string; price: number; blurb: string } } = {
  white: { name: 'Chalk', price: 0, blurb: 'Clean white speed lines.' },
  fire: { name: 'Afterburner', price: 300, blurb: 'Flames off your heels on every sprint.' },
  ice: { name: 'Ice Trail', price: 300, blurb: 'Cold blue streaks behind you.' },
  lime: { name: 'Toxic', price: 350, blurb: 'Radioactive green.' },
  pink: { name: 'Bubblegum', price: 350, blurb: 'Pink, loud and proud.' },
  gold: { name: 'Golden Boots', price: 1000, blurb: 'Gold lines behind every sprint.' },
  rainbow: { name: 'Rainbow Dash', price: 1400, blurb: 'Leave a rainbow behind you.' },
};

const ITEMS: readonly ShopItem[] = [
  ...CELEBRATION_IDS.map((id): ShopItem => ({
    cat: 'celebration', id, name: CELEBRATION_NAMES[id].replace(/-/g, ' '), price: CELEB_PRICE[id], level: CELEBRATION_LEVEL[id], blurb: CELEB_BLURB[id],
  })),
  ...BALL_SKIN_IDS.map((id): ShopItem => ({
    cat: 'ball', id, name: BALL_SKIN_NAMES[id], price: BALL_PRICE[id], level: BALL_SKIN_LEVEL[id], blurb: BALL_BLURB[id],
  })),
  ...GOAL_FX_IDS.map((id): ShopItem => ({ cat: 'goalfx', id, ...GOAL_FX[id] })),
  ...TRAIL_IDS.map((id): ShopItem => ({ cat: 'trail', id, ...TRAILS[id] })),
].map((it) => (it.price === 0 ? { ...it, level: undefined } : it));

/** Every item in a category (all of them without one), in shop order (cheapest first after the free one). */
export function shopItems(cat?: ShopCat): readonly ShopItem[] {
  return cat ? ITEMS.filter((it) => it.cat === cat) : ITEMS;
}

export function shopItem(cat: ShopCat, id: string): ShopItem | undefined {
  return ITEMS.find((it) => it.cat === cat && it.id === id);
}

/** The key an item is stored under in ShopState.owned / seen (and the unlock ladder's: 'ball:retro'). */
export const itemKey = (cat: ShopCat, id: string): string => `${cat}:${id}`;

/** What each category is, in a line ("NOW IN REACH: BACKFLIP goal celebration"). */
export const CAT_LABEL: { readonly [k in ShopCat]: string } = {
  celebration: 'goal celebration', ball: 'ball look', goalfx: 'goal explosion', trail: 'sprint trail',
};

/** The item everyone owns from the start in each category (what "nothing equipped" means). */
export const DEFAULT_ID: { readonly [k in ShopCat]: string } = { celebration: 'classic', ball: 'classic', goalfx: 'club', trail: 'white' };

/** Which Settings field each category equips into. */
const SETTING: { readonly [k in ShopCat]: 'celebration' | 'ballSkin' | 'goalFx' | 'trail' } = {
  celebration: 'celebration', ball: 'ballSkin', goalfx: 'goalFx', trail: 'trail',
};

// ------------------------------------------------------------------ owning, buying, equipping

/** The save's shop state, made whole in place first if it isn't (a save from any path: storage, a file, the cloud). */
export function shopOf(save: Pick<SaveData, 'shop'>): ShopState {
  const s = save.shop;
  if (!s || !Array.isArray(s.owned) || !Array.isArray(s.seen) || typeof s.freePack !== 'string' || !Number.isFinite(s.packs) || s.pending === undefined) {
    save.shop = normalizeShop(s);
  }
  return save.shop!;
}

/** Whole coins in the wallet (a damaged number counts as none). */
function wallet(save: Pick<SaveData, 'coins'>): number {
  return Number.isFinite(save.coins) ? Math.max(0, Math.floor(save.coins)) : 0;
}

/** Bought in the shop (not counting level unlocks or the free items). */
export function bought(save: Pick<SaveData, 'shop'>, cat: ShopCat, id: string): boolean {
  return shopOf(save).owned.includes(itemKey(cat, id));
}

/** Yours to equip: free from the start, earned by level (the ladder) or bought. */
export function owns(save: Pick<SaveData, 'shop' | 'progress'>, cat: ShopCat, id: string): boolean {
  const it = shopItem(cat, id);
  if (!it) return false;
  if (it.price === 0) return true;
  if (it.level !== undefined && levelOf(save.progress.xp).level >= it.level) return true;
  return bought(save, cat, id);
}

export type BuyResult = { ok: true; item: ShopItem; coins: number } | { ok: false; reason: 'unknown' | 'owned' | 'no-coins'; short: number };

/**
 * Buy an item: the price comes out of the wallet (never below zero: short of it, nothing changes and `short`
 * says by how much), it is owned for good and marked seen. Equipping is separate (equipItem).
 */
export function buyItem(save: Pick<SaveData, 'shop' | 'progress' | 'coins'>, cat: ShopCat, id: string): BuyResult {
  const it = shopItem(cat, id);
  if (!it) return { ok: false, reason: 'unknown', short: 0 };
  if (owns(save, cat, id)) return { ok: false, reason: 'owned', short: 0 };
  const coins = wallet(save);
  if (coins < it.price) return { ok: false, reason: 'no-coins', short: it.price - coins };
  save.coins = coins - it.price;
  const shop = shopOf(save);
  const key = itemKey(cat, id);
  shop.owned.push(key);
  if (!shop.seen.includes(key)) shop.seen.push(key);
  return { ok: true, item: it, coins: save.coins };
}

/** Put an owned item on (into Settings, where the match reads it). False, and nothing changes, when it isn't yours. */
export function equipItem(save: Pick<SaveData, 'shop' | 'progress' | 'settings'>, cat: ShopCat, id: string): boolean {
  if (!owns(save, cat, id)) return false;
  save.settings[SETTING[cat]] = id;
  return true;
}

/** What is on in a category: the Settings choice while it is still yours, else the free default. */
export function equippedId(save: Pick<SaveData, 'shop' | 'progress' | 'settings'>, cat: ShopCat): string {
  const id = save.settings[SETTING[cat]];
  return id && owns(save, cat, id) ? id : DEFAULT_ID[cat];
}

// ------------------------------------------------------------------ nudges (sparing: see newInShop / inReach)

/** Items you don't own yet that the wallet covers, dearest first. */
export function affordable(save: Pick<SaveData, 'shop' | 'progress' | 'coins'>): ShopItem[] {
  const coins = wallet(save);
  return ITEMS.filter((it) => it.price > 0 && it.price <= coins && !owns(save, it.cat, it.id)).sort((a, b) => b.price - a.price);
}

/** The free daily scout pack is waiting (one a local day, YYYY-MM-DD). */
export function freePackReady(save: Pick<SaveData, 'shop'>, day: string): boolean {
  return shopOf(save).freePack !== day;
}

/**
 * The count on the menu's SHOP button: affordable items the shop hasn't shown you since they became affordable,
 * plus the free pack when it is waiting. 0 = no badge.
 */
export function newInShop(save: Pick<SaveData, 'shop' | 'progress' | 'coins'>, day: string): number {
  const seen = shopOf(save).seen;
  return affordable(save).filter((it) => !seen.includes(itemKey(it.cat, it.id))).length + (freePackReady(save, day) ? 1 : 0);
}

/** The shop showed a category: what you could buy there (or own) is no longer NEW. */
export function markSeen(save: Pick<SaveData, 'shop' | 'progress' | 'coins'>, cat: ShopCat): void {
  const shop = shopOf(save);
  const coins = wallet(save);
  for (const it of shopItems(cat)) {
    const key = itemKey(it.cat, it.id);
    if ((it.price <= coins || owns(save, it.cat, it.id)) && !shop.seen.includes(key)) shop.seen.push(key);
  }
}

/**
 * The dearest item this match's coins brought into reach (`before` < its price <= `after`), for one line at full
 * time; null when nothing crossed the line (so it shows only when there is news).
 */
export function inReach(save: Pick<SaveData, 'shop' | 'progress'>, before: number, after: number): ShopItem | null {
  const hit = ITEMS.filter((it) => it.price > before && it.price <= after && !owns(save, it.cat, it.id)).sort((a, b) => b.price - a.price);
  return hit[0] ?? null;
}

// ------------------------------------------------------------------ scout packs

export type PackKind = 'scout' | 'elite';
export type Rarity = 'common' | 'rare' | 'epic' | 'legend';
export const RARITIES: readonly Rarity[] = ['common', 'rare', 'epic', 'legend'];

/** The packs on sale: base price (for a club rated PACK_BASE) and the odds of each rarity, in %, as shown. */
export const PACKS: { readonly [k in PackKind]: { name: string; price: number; odds: readonly [number, number, number, number] } } = {
  scout: { name: 'SCOUT PACK', price: 350, odds: [62, 28, 8, 2] },
  elite: { name: 'ELITE PACK', price: 1200, odds: [0, 55, 35, 10] },
};

/** A card's overall against your XI's average, by rarity (inclusive): a common is squad depth, a legend a star. */
export const RARITY_OVR: { readonly [k in Rarity]: readonly [number, number] } = {
  common: [-3, 1], rare: [2, 5], epic: [6, 10], legend: [11, 16],
};
export const PACK_OVR_CAP = 95;
/** The club rating the base prices hold up to (a new club is ~51); a stronger club's scouts cost more (packPrice). */
export const PACK_BASE = 52;

const ROLE_WEIGHTS: readonly [Role, number][] = [['GK', 10], ['DF', 30], ['MF', 30], ['FW', 30]];

/**
 * What a pack costs a club rated `rating`: the base price up to PACK_BASE, then with the square of the rating
 * (the scale player values follow, meta/career.ts playerPrice), so a card never resells for more than the pack.
 */
export function packPrice(kind: PackKind, rating: number): number {
  const k = Math.max(1, Math.min(4, (Math.max(0, rating) / PACK_BASE) ** 2));
  return Math.round((PACKS[kind].price * k) / 10) * 10;
}

export interface PackCard {
  player: MetaPlayer;
  rarity: Rarity;
  ovr: number;
}

/**
 * One card from a `kind` pack for a club whose XI averages `base`: pure, so the same seed always draws the same
 * card. Surnames in `avoid` (the squad's) are never drawn.
 */
export function rollPack(kind: PackKind, base: number, seed: number, avoid: Iterable<string> = []): PackCard {
  const rng = new Rng(hashString(`pack|${kind}|${seed >>> 0}`));
  const odds = PACKS[kind].odds;
  let roll = rng.next() * 100;
  let ri = 0;
  while (ri < 3 && roll >= odds[ri]) roll -= odds[ri++];
  const rarity = RARITIES[ri];
  const [lo, hi] = RARITY_OVR[rarity];
  const target = Math.max(30, Math.min(PACK_OVR_CAP, Math.round(base) + lo + rng.int(hi - lo + 1)));
  let w = rng.next() * 100;
  let role: Role = 'FW';
  for (const [r, p] of ROLE_WEIGHTS) {
    if (w < p) {
      role = r;
      break;
    }
    w -= p;
  }
  const names = new Set<string>([...avoid].map(surnameOf));
  const p = makePlayer(rng, role, target - 4, 0, `pack${seed >>> 0}`, names);
  tuneToOverall(p, target);
  // The better the card, the more likely he is in his prime; a young common one may still grow. Scouted players
  // sign one-year deals (the lowest resale value: a pack is never a way to print coins, see packPrice).
  const age = rarity === 'common' ? 18 + rng.int(15) : rarity === 'rare' ? 20 + rng.int(12) : 23 + rng.int(8);
  const potential = age <= 23 ? 1 + rng.int(rarity === 'common' ? 3 : 5) : 0;
  const player = pinMeta(p, { age, potential, contract: 1 });
  return { player, rarity, ovr: overall(player) };
}

export type PackResult = { ok: true; card: PackCard; price: number; free: boolean } | { ok: false; reason: 'no-club' | 'no-coins' | 'free-used'; short: number };

/**
 * Open a pack for `club`: the price (packPrice at the club's rating, or nothing for the day's free scout pack)
 * leaves the wallet, never below zero, and the card is drawn from the save's own pack count (so a reload draws
 * the same card again: no rerolling). The card is not signed yet: see signCard / sellCard.
 */
export function openPack(
  save: Pick<SaveData, 'shop' | 'coins'>, club: ClubState | null, kind: PackKind, day: string, free = false,
): PackResult {
  if (!club) return { ok: false, reason: 'no-club', short: 0 };
  const shop = shopOf(save);
  const rating = clubRating(club);
  let price = 0;
  if (free) {
    if (kind !== 'scout' || !freePackReady(save, day)) return { ok: false, reason: 'free-used', short: 0 };
    shop.freePack = day;
  } else {
    price = packPrice(kind, rating);
    const coins = wallet(save);
    if (coins < price) return { ok: false, reason: 'no-coins', short: price - coins };
    save.coins = coins - price;
  }
  const seed = hashString(`${club.short}|${club.name}|${shop.packs}`);
  shop.packs++;
  // Kept until the card is signed or sold (settlePack): a closed tab mid-reveal brings the same card back.
  shop.pending = { kind, seed, base: rating, price };
  return { ok: true, card: rollPack(kind, rating, seed, club.squad.map((p) => p.name)), price, free };
}

/** The card of a pack opened but not yet signed or sold (pendingPack in the save), drawn again; null when none. */
export function pendingCard(save: Pick<SaveData, 'shop'>, club: ClubState | null): { card: PackCard; price: number } | null {
  const p = shopOf(save).pending;
  if (!p || !club) return null;
  return { card: rollPack(p.kind, p.base, p.seed, club.squad.map((q) => q.name)), price: p.price };
}

/** The open pack's card has been signed or sold: nothing is waiting any more. */
export function settlePack(save: Pick<SaveData, 'shop'>): void {
  shopOf(save).pending = null;
}

export type SignResult =
  | { ok: true; player: MetaPlayer; starter: boolean; replaced?: PlayerDef; ovrFrom: number; ovrTo: number }
  | { ok: false; reason: 'squad-full' };

/**
 * Sign a card into the squad (never past SQUAD_MAX): a fresh squad id and a free shirt number; straight into the
 * XI when he beats the weakest starter in a slot of his role (that man drops to the bench), else on the bench.
 * `paid` / `season` are what the career market's resale cap reads (meta/market.ts resaleCap: no flipping).
 */
export function signCard(club: ClubState, card: PackCard, paid = 0, season = 1): SignResult {
  if (club.squad.length >= SQUAD_MAX) return { ok: false, reason: 'squad-full' };
  const ovrFrom = clubRating(club);
  const src = card.player;
  const p = pinMeta({ ...clonePlayer(src), id: `c${club.nextId++}`, number: freeNumber(club.squad, src.role) }, {
    age: src.age, potential: src.potential, contract: src.contract,
  });
  p.paid = paid;
  p.boughtSeason = season;
  p.starts = 0;
  club.squad.push(p);
  const slots = FORMATIONS[club.formation];
  let worst = -1;
  for (let i = 0; i < Math.min(11, club.squad.length - 1); i++) {
    if (slots[i]?.role !== p.role) continue;
    if (worst < 0 || overall(club.squad[i]) < overall(club.squad[worst])) worst = i;
  }
  let replaced: PlayerDef | undefined;
  if (worst >= 0 && overall(club.squad[worst]) < overall(p)) {
    replaced = club.squad[worst];
    swapPlayers(club, worst, club.squad.length - 1);
  }
  return { ok: true, player: p, starter: !!replaced, replaced, ovrFrom, ovrTo: clubRating(club) };
}

/** Sell a card on instead of signing him: his quick-sale value (45% of his value, like any quick sale). */
export function sellCard(save: Pick<SaveData, 'coins'>, card: PackCard): number {
  const v = quickSaleValue(card.player);
  save.coins = wallet(save) + v;
  return v;
}

/**
 * Who goes when the squad is full and a card wants his place: the weakest bench player, never the last keeper
 * (and never below SQUAD_MIN). Index into the squad, or -1 when nobody can go.
 */
export function releaseCandidate(club: ClubState): number {
  if (club.squad.length <= SQUAD_MIN) return -1;
  const keepers = club.squad.filter((p) => p.role === 'GK').length;
  let best = -1;
  for (let i = 11; i < club.squad.length; i++) {
    const p = club.squad[i];
    if (p.role === 'GK' && keepers <= 1) continue;
    if (best < 0 || overall(p) < overall(club.squad[best])) best = i;
  }
  return best;
}

/** Let the release candidate go for his quick-sale value (career.ts sellPlayer: the career's own rules). */
export function makeRoom(state: CareerState, save: Wallet): { ok: true; player: PlayerDef; coins: number } | { ok: false } {
  const club = state.club;
  if (!club) return { ok: false };
  const i = releaseCandidate(club);
  const p = club.squad[i];
  if (!p) return { ok: false };
  const r = sellPlayer(state, save, p.id);
  return r.ok ? { ok: true, player: p, coins: r.delta } : { ok: false };
}
