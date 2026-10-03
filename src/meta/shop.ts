/**
 * The coin SHOP's rules (no DOM: ui/shop.ts draws it). Two things to spend coins on:
 *
 * - Cosmetics: goal celebrations and ball looks (the level ladder's items: bought with coins OR earned free at
 *   their level, whichever comes first), goal explosion themes and sprint trails (coins only). Owned, equipped
 *   into Settings, drawn in every match (render/cosmetics.ts, game/matchSession.ts).
 * - SCOUT PACKS: a random player card for MY CLUB (meta/career.ts ClubState, the club PLAY NOW and CAREER field)
 *   at a fixed price with the odds on show. A card signs into the squad (squad limit and all) or is sold on.
 *
 * Where coins come from: playing (matches, challenges, the daily gift), rewarded ads on the web portals (FREE
 * COINS below: a few a day) and, in the iOS and Android apps only, store purchases (platform/iap.ts). Cosmetics
 * are looks, and ONLINE friendlies use the preset clubs, so nothing bought here wins a match against a friend.
 * Scout packs are random cards whoever earned or bought the coins, so their odds are always on show.
 * Everything persists in SaveData.shop and SaveData.iap (core/save.ts normalizeShop / normalizeIap) and Settings.
 */
import { Rng, hashString } from '../core/rng';
import {
  BALL_SKIN_IDS, BALL_SKIN_LEVEL, BALL_SKIN_NAMES, CELEBRATION_IDS, CELEBRATION_LEVEL, CELEBRATION_NAMES, GOAL_FX_IDS, PASS_IDS, TRAIL_IDS, levelOf,
  normalizeIap, normalizeShop, type IapState, type PassId, type SaveData, type ShopState,
} from '../core/save';
import { SEASON_THEMES } from './season';
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
  /** A Club Pass look: earned on its month's pass track only, never sold for coins (core/save.ts PASS_IDS). */
  pass?: true;
}

/**
 * Prices, tuned to what a match pays (main.ts standardReward: a win on Normal ~170-210, a draw ~90, a loss ~50,
 * x1.1 a win in a row up to x2) plus the daily gift (100-400) and challenges (100-220 each). The ladder (docs/ECONOMY.md):
 * COMMON something new every two to four matches early on (250-450); RARE and EPIC a few days to a week of play
 * (500-2800); LEGENDARY a few weeks for a free player (4500-7500), the looks to aim at and the reason a coin pack is
 * ever worth it. Club Pass looks are never on sale for coins.
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
// Every look is its own thing, not a recolour: shapes and patterns for the balls (render/characters.ts BALL_LOOK),
// a scripted show for each goal explosion (render/fx/goals.ts) and an emitter for each trail (render/fx/trails.ts).
// The rarer it is, the bigger the show: LEGENDARY is the most spectacular in each category.
const BALL_PRICE: { readonly [k in (typeof BALL_SKIN_IDS)[number]]: number } = {
  classic: 0, retro: 250, beach: 400, melon: 450, blaze: 600, hoops: 700, eight: 800, ice: 900, neon: 1000, moon: 1200, disco: 1800,
  gold: 2500, planet: 4500, diamond: 7500,
};
const BALL_BLURB: { readonly [k in (typeof BALL_SKIN_IDS)[number]]: string } = {
  classic: 'The match ball.',
  retro: 'Old brown leather, stitched panels and laces.',
  beach: 'Six bright stripes, straight off the beach.',
  melon: 'A striped watermelon, stalk and all.',
  blaze: 'Cracked rock with lava glowing through.',
  hoops: 'A basketball that thinks it is a football.',
  eight: 'Black and glossy with the 8 on it.',
  ice: 'Frozen solid, icicles sticking out.',
  neon: 'A black ball with glowing grid lines.',
  moon: 'Grey, cratered and out of this world.',
  disco: 'Mirror tiles that catch the floodlights.',
  gold: 'Polished gold. For legends only.',
  planet: 'A tiny world with oceans and a ring round it.',
  diamond: 'A cut gem. The rarest ball in the game.',
};
type Look = { name: string; price: number; blurb: string };
const GOAL_FX: { readonly [k in Exclude<(typeof GOAL_FX_IDS)[number], PassId>]: Look } = {
  club: { name: 'Club Colours', price: 0, blurb: 'A burst and confetti in your kit colours.' },
  shockwave: { name: 'Shockwave', price: 300, blurb: 'A ring of force rolls out over the grass.' },
  balloons: { name: 'Balloon Party', price: 350, blurb: 'A bunch of balloons floats up out of the net.' },
  confetti: { name: 'Confetti Cannons', price: 450, blurb: 'Two cannons pop up and blast the box with confetti.' },
  popcorn: { name: 'Popcorn', price: 600, blurb: 'A bucket pops up and the kernels go everywhere.' },
  gold: { name: 'Gold Rush', price: 700, blurb: 'A geyser of gold coins out of the net.' },
  ice: { name: 'Frostbite', price: 800, blurb: 'The goal freezes solid, then shatters.' },
  pinata: { name: 'Pinata', price: 900, blurb: 'Whack, whack! It bursts into sweets.' },
  fire: { name: 'Inferno', price: 1200, blurb: 'Flame jets go off along the goal line.' },
  rainbow: { name: 'Rainbow', price: 1400, blurb: 'A voxel rainbow arches out of the goal.' },
  neon: { name: 'Neon Disco', price: 1800, blurb: 'A mirror ball, lasers and a dance floor.' },
  fireworks: { name: 'Fireworks', price: 2200, blurb: 'Rockets launch from behind the net and burst in the sky.' },
  volcano: { name: 'Volcano', price: 2500, blurb: 'A volcano bursts out of the box and erupts.' },
  lightning: { name: 'Thunderbolt', price: 2800, blurb: 'Lightning strikes the goal mouth three times.' },
  galaxy: { name: 'Black Hole', price: 4500, blurb: 'A vortex swallows the stars, then bursts.' },
  meteor: { name: 'Meteor Strike', price: 5000, blurb: 'A flaming meteor craters the goal mouth.' },
  diamond: { name: 'Diamond Rain', price: 6000, blurb: 'A giant diamond shatters and it rains gems.' },
  supernova: { name: 'Supernova', price: 7500, blurb: 'A star gathers light over the box, then goes off.' },
};
const TRAILS: { readonly [k in Exclude<(typeof TRAIL_IDS)[number], PassId>]: Look } = {
  white: { name: 'Chalk', price: 0, blurb: 'Clean white speed lines.' },
  toon: { name: 'Toon Dash', price: 300, blurb: 'Cartoon dust puffs and inky speed lines.' },
  hearts: { name: 'Hearts', price: 350, blurb: 'Little hearts float up behind you.' },
  pink: { name: 'Bubblegum', price: 400, blurb: 'Bubbles drift up behind you and pop.' },
  popcorn: { name: 'Popcorn', price: 450, blurb: 'Kernels pop off your heels and bounce.' },
  notes: { name: 'Music Notes', price: 600, blurb: 'Notes bob up behind you in a wavy line.' },
  lime: { name: 'Slime', price: 650, blurb: 'Goo drips off your boots and splats.' },
  ice: { name: 'Ice Trail', price: 750, blurb: 'Frozen boot prints and falling snow.' },
  fire: { name: 'Afterburner', price: 900, blurb: 'Pixel flames lick off your heels.' },
  gold: { name: 'Golden Boots', price: 1200, blurb: 'Gold coins spill off your heels.' },
  glitch: { name: 'Glitch', price: 1500, blurb: 'You break up into flickering pixels.' },
  rainbow: { name: 'Rainbow Ribbon', price: 2000, blurb: 'A rainbow ribbon streams out behind you.' },
  lightning: { name: 'Lightning', price: 4500, blurb: 'Bolts crackle off your heels and arc round you.' },
  comet: { name: 'Comet Tail', price: 6000, blurb: 'A blazing tail of stardust and stars.' },
};

/** What each month's Club Pass looks do (January first): its own goal explosion and trail, not a colourway. */
const PASS_BLURB: { readonly [k in 'goalfx' | 'trail']: readonly string[] } = {
  goalfx: [
    'A snow tornado spins up out of the goal.', 'A giant ball of mud splats the whole box.', 'Flowers burst up all over the box.',
    'Rain clouds roll in and it pours.', 'A giant trophy rises out of the goal.', 'A big wave crashes out of the net.',
    'A grinning sun rises over the goal.', 'Footballs pour out of the net.', 'A gust of autumn leaves and pumpkins.',
    'Searchlights sweep the night sky.', 'Catherine wheels spin on the posts.', 'A big present bursts open into gifts.',
  ],
  trail: [
    'A flurry of snowflakes whirls off you.', 'Muddy boot prints and flying mud.', 'Flowers spring up in your footsteps.',
    'Your own little rain cloud follows you.', 'Gold stars and ticker tape.', 'Every step splashes.',
    'Little suns spin up off you.', 'Training cones pop up in a slalom.', 'Autumn leaves kicked up behind you.',
    'A neon light line painted behind you.', 'A sparkler fizzing off you.', 'Tiny presents bounce out behind you.',
  ],
};

/** A Club Pass look of the season theme at index `m` (January 0): its goal explosion or its trail. */
const passLook = (cat: 'goalfx' | 'trail', m: number): Look => ({
  name: SEASON_THEMES[m].name,
  price: 0,
  blurb: `Club Pass only: ${PASS_BLURB[cat][m]}`,
});
const isPass = (id: string): id is PassId => (PASS_IDS as readonly string[]).includes(id);

/** Shop order within a category: the free one, then cheapest first, the Club Pass looks last (by month). */
const byPrice = (list: ShopItem[]): ShopItem[] => list.sort((a, b) => (a.pass ? 1 : 0) - (b.pass ? 1 : 0) || a.price - b.price);

const ITEMS: readonly ShopItem[] = [
  ...CELEBRATION_IDS.map((id): ShopItem => ({
    cat: 'celebration', id, name: CELEBRATION_NAMES[id].replace(/-/g, ' '), price: CELEB_PRICE[id], level: CELEBRATION_LEVEL[id], blurb: CELEB_BLURB[id],
  })),
  ...byPrice(BALL_SKIN_IDS.map((id): ShopItem => ({
    cat: 'ball', id, name: BALL_SKIN_NAMES[id], price: BALL_PRICE[id], level: BALL_SKIN_LEVEL[id], blurb: BALL_BLURB[id],
  }))),
  ...byPrice(GOAL_FX_IDS.map((id): ShopItem => (isPass(id) ? { cat: 'goalfx', id, ...passLook('goalfx', PASS_IDS.indexOf(id)), pass: true } : { cat: 'goalfx', id, ...GOAL_FX[id] }))),
  ...byPrice(TRAIL_IDS.map((id): ShopItem => (isPass(id) ? { cat: 'trail', id, ...passLook('trail', PASS_IDS.indexOf(id)), pass: true } : { cat: 'trail', id, ...TRAILS[id] }))),
].map((it) => (it.price === 0 ? { ...it, level: undefined } : it));

/** The Club Pass looks of season `id` ("2026-10"): its goal explosion and its trail. */
export function seasonPassItems(id: string): { goalfx: ShopItem; trail: ShopItem } {
  const m = Math.max(0, Math.min(11, (Number(id.slice(5, 7)) || 1) - 1));
  return { goalfx: shopItem('goalfx', PASS_IDS[m])!, trail: shopItem('trail', PASS_IDS[m])! };
}

// ------------------------------------------------------------------ rarity (status: shown on every tile)

export type ItemTier = 'common' | 'rare' | 'epic' | 'legendary' | 'season';
export const ITEM_TIER_NAMES: { readonly [k in ItemTier]: string } = {
  common: 'COMMON', rare: 'RARE', epic: 'EPIC', legendary: 'LEGENDARY', season: 'CLUB PASS',
};

/** An item's rarity, by price (the free starters are common); Club Pass looks are their own tier. */
export function itemTier(it: Pick<ShopItem, 'price' | 'pass'>): ItemTier {
  if (it.pass) return 'season';
  return it.price >= 3000 ? 'legendary' : it.price >= 1000 ? 'epic' : it.price >= 500 ? 'rare' : 'common';
}

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

/** The save's store-purchase state, made whole in place first if it isn't (like shopOf). */
export function iapOf(save: Pick<SaveData, 'iap'>): IapState {
  const s = save.iap;
  if (!s || !Array.isArray(s.owned) || !Array.isArray(s.applied) || !s.freeAds || typeof s.freeAds.day !== 'string' || !Number.isFinite(s.freeAds.count)) {
    save.iap = normalizeIap(s);
  }
  return save.iap!;
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
  // (A Club Pass look is free of coins but never a starter: owned only once its pass track hands it over.)
  if (it.pass) return bought(save, cat, id);
  if (it.price === 0) return true;
  if (it.level !== undefined && levelOf(save.progress.xp).level >= it.level) return true;
  return bought(save, cat, id);
}

// ------------------------------------------------------------------ today's deal

/** Today's deal: one look a day at this much off (honest: it rotates daily, and every look comes round again). */
export const DEAL_OFF = 25;

/**
 * Today's deal for this save on local `day`: a look it doesn't own yet (never a Club Pass one), at DEAL_OFF % off.
 * Picked once per day and kept in the save, so buying it (or anything else) doesn't swap it for another; null when
 * there is nothing left to sell.
 */
export function dailyDeal(save: Pick<SaveData, 'shop' | 'progress'>, day: string): { item: ShopItem; price: number } | null {
  const shop = shopOf(save);
  if (shop.deal?.day !== day) {
    const pool = ITEMS.filter((it) => it.price > 0 && !it.pass && !owns(save, it.cat, it.id));
    const pick = pool.length ? pool[hashString(`deal|${day}`) % pool.length] : null;
    shop.deal = pick ? { day, key: itemKey(pick.cat, pick.id) } : null;
  }
  if (!shop.deal) return null;
  const [cat, id] = shop.deal.key.split(':') as [ShopCat, string];
  const item = shopItem(cat, id);
  if (!item || item.pass || item.price <= 0) return null;
  return { item, price: Math.round((item.price * (100 - DEAL_OFF)) / 100 / 10) * 10 };
}

/** What `it` costs on `day` (today's deal price for the deal look, else its price). */
export function priceOn(save: Pick<SaveData, 'shop' | 'progress'>, it: ShopItem, day?: string): number {
  if (!day) return it.price;
  const deal = dailyDeal(save, day);
  return deal && deal.item.cat === it.cat && deal.item.id === it.id ? deal.price : it.price;
}

export type BuyResult = { ok: true; item: ShopItem; coins: number } | { ok: false; reason: 'unknown' | 'owned' | 'no-coins' | 'pass'; short: number };

/**
 * Buy an item: the price comes out of the wallet (never below zero: short of it, nothing changes and `short`
 * says by how much), it is owned for good and marked seen. Equipping is separate (equipItem). With `day`, today's
 * deal price applies to the deal look. Club Pass looks aren't for sale.
 */
export function buyItem(save: Pick<SaveData, 'shop' | 'progress' | 'coins'>, cat: ShopCat, id: string, day?: string): BuyResult {
  const it = shopItem(cat, id);
  if (!it) return { ok: false, reason: 'unknown', short: 0 };
  if (owns(save, cat, id)) return { ok: false, reason: 'owned', short: 0 };
  if (it.pass) return { ok: false, reason: 'pass', short: 0 };
  const price = priceOn(save, it, day);
  const coins = wallet(save);
  if (coins < price) return { ok: false, reason: 'no-coins', short: price - coins };
  save.coins = coins - price;
  const shop = shopOf(save);
  const key = itemKey(cat, id);
  shop.owned.push(key);
  if (!shop.seen.includes(key)) shop.seen.push(key);
  return { ok: true, item: it, coins: save.coins };
}

/** Coins into the wallet (never a negative or damaged amount); the new total. */
export function creditCoins(save: Pick<SaveData, 'coins'>, amount: number): number {
  save.coins = wallet(save) + (Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0);
  return save.coins;
}

/**
 * An item handed over without coins (a store purchase's bundle, e.g. the Starter Pack's Gold ball): owned for
 * good and marked seen. False, and nothing changes, when it is already in the bought list or isn't an item.
 */
export function grantItem(save: Pick<SaveData, 'shop'>, cat: ShopCat, id: string): boolean {
  if (!shopItem(cat, id)) return false;
  const shop = shopOf(save);
  const key = itemKey(cat, id);
  if (shop.owned.includes(key)) return false;
  shop.owned.push(key);
  if (!shop.seen.includes(key)) shop.seen.push(key);
  return true;
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

// ------------------------------------------------------------------ free coins (rewarded ads, web portals)

/** Coins a watched rewarded ad pays in the shop's FREE COINS card, and how many a local day can be watched. */
export const FREE_AD_COINS = 75;
export const FREE_AD_DAILY_CAP = 5;

/** Free-coin ads still open today (`day` = localDay(); a new day starts the count again). */
export function freeAdsLeft(save: Pick<SaveData, 'iap'>, day: string): number {
  const f = iapOf(save).freeAds;
  return f.day === day ? Math.max(0, FREE_AD_DAILY_CAP - f.count) : FREE_AD_DAILY_CAP;
}

export type FreeAdResult = { ok: true; coins: number; left: number } | { ok: false; reason: 'cap' };

/**
 * One watched ad's coins into the wallet, counted against today's cap. Call it only once the ad was watched
 * through (platform/ads.ts rewarded() resolved true); a sixth ad in a day pays nothing.
 */
export function claimFreeAd(save: Pick<SaveData, 'iap' | 'coins'>, day: string): FreeAdResult {
  if (freeAdsLeft(save, day) <= 0) return { ok: false, reason: 'cap' };
  const f = iapOf(save).freeAds;
  if (f.day !== day) {
    f.day = day;
    f.count = 0;
  }
  f.count++;
  return { ok: true, coins: creditCoins(save, FREE_AD_COINS), left: FREE_AD_DAILY_CAP - f.count };
}

// ------------------------------------------------------------------ scout packs

export type PackKind = 'scout' | 'elite';

/**
 * What each pack costs in Scout Tokens (core/save.ts ShopState.tokens). Tokens are earned only, one for every daily
 * challenge done, and never sold: coins (which the app's store sells) can't buy a random card. Apple and PEGI
 * treat paid random items as loot boxes (age ratings, and bans for minors in some countries): this keeps the game
 * 4+ and fair for kids, while the free daily pack and the transfer market's chosen signings stay as they were.
 */
export const PACK_TOKENS: { readonly [k in PackKind]: number } = { scout: 1, elite: 3 };

/** Scout Tokens in hand. */
export function scoutTokens(save: Pick<SaveData, 'shop'>): number {
  return shopOf(save).tokens;
}

/** Add earned Scout Tokens (a daily challenge done); the new count. */
export function earnTokens(save: Pick<SaveData, 'shop'>, n: number): number {
  const shop = shopOf(save);
  shop.tokens = Math.min(999, shop.tokens + Math.max(0, Math.floor(Number.isFinite(n) ? n : 0)));
  return shop.tokens;
}
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

export type PackResult = { ok: true; card: PackCard; price: number; free: boolean } | { ok: false; reason: 'no-club' | 'no-tokens' | 'free-used'; short: number };

/**
 * Open a pack for `club`: its Scout Tokens (PACK_TOKENS, or nothing for the day's free scout pack) are spent,
 * never below zero; `price` is the card's coin value (packPrice at the club's rating), and the card is drawn from the save's own pack count (so a reload draws
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
    const cost = PACK_TOKENS[kind];
    if (shop.tokens < cost) return { ok: false, reason: 'no-tokens', short: cost - shop.tokens };
    shop.tokens -= cost;
    // (Its coin value, kept with the card: what a sale may fetch and the resale cap go by it, as before.)
    price = packPrice(kind, rating);
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
