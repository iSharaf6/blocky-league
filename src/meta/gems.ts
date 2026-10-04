/**
 * GEMS: the premium currency (docs/ECONOMY.md, economy v3). Coins are earned every match and buy most things; gems
 * are scarce, come in small steady amounts from play (the board, legacy levels, cups, the login calendar, weekly
 * objectives, the season track) and in packs from the app's store (platform/iap.ts).
 *
 * The rules that keep it fair for kids (tests/economy.test.ts pins them):
 * - Gems never buy anything random. Every sink below is a stated, guaranteed outcome at a shown price.
 * - Gems are never needed to progress: every sink has a free way (`GEM_SINKS[k].free`): waiting, playing, or an
 *   optional rewarded ad. And gems themselves are earned by playing.
 * - Nothing gems buy changes an online friendly (preset clubs).
 *
 * THE API OTHER MODULES CALL (stable):
 *   gems(save)                      the balance
 *   addGems(save, n, source)        pay gems in ('board', 'legacy', 'cup', 'iap:bl.gems.100'...)
 *   spendGems(save, n, reason)      take gems out: false, and nothing changes, when short
 *   GEM_PRICES                      what each sink costs
 * Plus helpers: canAfford, finishBuildPrice, scoutNetworkTier / scoutNetworkOf / buyScoutNetwork, grantGemsOnce,
 * rewardGems, buyCoinsWithGems, topUpGems / coverShortfall. The confirm sheet every gem spend goes through is
 * ui/gemUi.ts confirmGems.
 *
 * Pure rules and state, no DOM. The state is SaveData.gems (made whole by normalizeGems, like every save blob).
 */
import type { SaveData } from '../core/save';

// ------------------------------------------------------------------ state

export interface GemLogEntry {
  /** Gems in (positive) or out (negative). */
  n: number;
  /** Where from or what for ('board', 'finishBuild'...). */
  why: string;
}

export interface GemState {
  /** Gems in hand. */
  balance: number;
  /** Lifetime totals: earned by playing, bought in the store, spent. */
  earned: number;
  bought: number;
  spent: number;
  /** One-time gem rewards already paid, by key ('welcome', 'ach:first_win', 'legacy:3'): none pays twice. */
  claimed: string[];
  /** Scouting Network tier owned (0 none .. SCOUT_NETWORKS.length). Permanent. */
  network: number;
  /** The last few movements, newest first (the STORE tab's history line, and support). */
  log: GemLogEntry[];
}

type GemSave = Pick<SaveData, 'gems'>;

/** A new player's (and an older save's) welcome gift: enough to try one replay or finish a build, not more. */
export const WELCOME_GEMS = 50;
export const GEM_MAX = 999_999;
const LOG_MAX = 12;

const whole = (v: unknown, max = GEM_MAX): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(max, Math.floor(v)) : 0);

export function defaultGems(): GemState {
  return { balance: WELCOME_GEMS, earned: WELCOME_GEMS, bought: 0, spent: 0, claimed: ['welcome'], network: 0, log: [] };
}

/** A gem blob as stored by any build (or none) made whole. A save from before gems starts with the welcome gift. */
export function normalizeGems(raw: unknown): GemState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultGems();
  const r = raw as Partial<GemState>;
  const claimed = Array.isArray(r.claimed)
    ? [...new Set(r.claimed.filter((k): k is string => typeof k === 'string' && /^[A-Za-z0-9:._-]{1,64}$/.test(k)))]
    : [];
  const log = Array.isArray(r.log)
    ? r.log
      .filter((e): e is GemLogEntry => !!e && typeof e === 'object' && typeof (e as GemLogEntry).n === 'number' && Number.isFinite((e as GemLogEntry).n) && typeof (e as GemLogEntry).why === 'string')
      .slice(0, LOG_MAX)
      .map((e) => ({ n: Math.max(-GEM_MAX, Math.min(GEM_MAX, Math.round(e.n))), why: e.why.slice(0, 40) }))
    : [];
  return {
    balance: whole(r.balance),
    earned: whole(r.earned, Number.MAX_SAFE_INTEGER),
    bought: whole(r.bought, Number.MAX_SAFE_INTEGER),
    spent: whole(r.spent, Number.MAX_SAFE_INTEGER),
    claimed,
    network: Math.min(SCOUT_NETWORKS.length, whole(r.network)),
    log,
  };
}

/** The save's gem state, made whole in place first if it isn't (a save from any path: storage, a file, the cloud). */
export function gemsOf(save: GemSave): GemState {
  const g = save.gems;
  if (!g || typeof g !== 'object' || !Number.isFinite(g.balance) || !Array.isArray(g.claimed) || !Array.isArray(g.log)) save.gems = normalizeGems(g);
  return save.gems!;
}

// ------------------------------------------------------------------ the wallet (the published API)

/** Gems in hand. */
export function gems(save: GemSave): number {
  return whole(gemsOf(save).balance);
}

function note(g: GemState, n: number, why: string): void {
  g.log = [{ n, why: why.slice(0, 40) }, ...g.log].slice(0, LOG_MAX);
}

/**
 * Gems into the wallet (a damaged or negative amount pays nothing). `source` says where from: anything starting
 * 'iap' counts as bought, the rest as earned by playing.
 */
export function addGems(save: GemSave, n: number, source: string): void {
  const amount = whole(n);
  if (!amount) return;
  const g = gemsOf(save);
  g.balance = Math.min(GEM_MAX, whole(g.balance) + amount);
  if (source.startsWith('iap')) g.bought += amount;
  else g.earned += amount;
  note(g, amount, source);
}

/** The wallet covers `n` gems. */
export function canAfford(save: GemSave, n: number): boolean {
  return Number.isFinite(n) && n >= 0 && gems(save) >= Math.ceil(n);
}

/**
 * Take `n` gems out for `reason`. False, and nothing changes, when the wallet is short (or the amount is damaged):
 * the caller does the thing only on true. Never goes below zero.
 */
export function spendGems(save: GemSave, n: number, reason: string): boolean {
  if (!Number.isFinite(n) || n < 0) return false;
  const cost = Math.ceil(n);
  const g = gemsOf(save);
  const have = whole(g.balance);
  if (have < cost) return false;
  if (!cost) return true;
  g.balance = have - cost;
  g.spent += cost;
  note(g, -cost, reason);
  return true;
}

/** A one-time gem reward ('ach:first_win', 'legacy:3'): paid the first time `key` is seen, never again. */
export function grantGemsOnce(save: GemSave, key: string, n: number, source: string): boolean {
  const g = gemsOf(save);
  if (g.claimed.includes(key)) return false;
  // These are lifetime payout receipts, not recent history. Dropping an old key lets the career's next sync pay
  // the same legacy level, achievement or trophy again. Keep the short receipts across arbitrarily long careers;
  // only the display log is capped. Even a hundred seasons adds just a few kilobytes.
  g.claimed.push(key);
  addGems(save, n, source);
  return true;
}

// ------------------------------------------------------------------ what gems cost (the sinks)

/**
 * Every gem price in the game. 100 gems is the smallest pack ($0.99), so: finishing a one-matchday build now is
 * about 20 cents, a replay about 50, the first Scouting Network about two dollars. A keen free player earns roughly
 * 120 gems a week (GEM_REWARDS below).
 */
export const GEM_PRICES = {
  /** Finish the stadium part or facility being built now: this much per league matchday still to wait. */
  finishBuildPerMatchday: 20,
  /** An injured player back now (flat, whatever the injury). */
  healPlayer: 30,
  /** Play a lost decider again (a cup tie, a final, a title or promotion decider): once per match. */
  replayMatch: 50,
  /** The Scouting Network tiers, in order (each bought once, permanent): SCOUT_NETWORKS says what each guarantees. */
  scoutNetwork: [200, 500, 1000],
  /** This month's Club Pass, instead of buying it in the store. */
  clubPass: 600,
  /** A new look as today's deal, instead of watching an ad. */
  dealRefresh: 15,
} as const;

/** What each sink is, and the free way to the same thing: gems are a shortcut, never a gate (tests pin this). */
export const GEM_SINKS: { readonly [k in keyof typeof GEM_PRICES]: { what: string; free: string } } = {
  finishBuildPerMatchday: { what: 'Finish a build now', free: 'Play the matchdays and it opens by itself; a rewarded ad takes one matchday off' },
  healPlayer: { what: 'Heal a player now', free: 'He is back by himself after his matchdays out' },
  replayMatch: { what: 'Replay a lost decider', free: 'A rewarded ad replays one a day; the season carries on either way' },
  scoutNetwork: { what: 'A Scouting Network tier', free: 'Gems earned by playing buy it; the academy brings prospects every season without it' },
  clubPass: { what: 'The Club Pass', free: 'Gems earned by playing buy it; the free season track pays every tier anyway' },
  dealRefresh: { what: 'A new deal today', free: 'A rewarded ad once a day; the deal changes by itself every day' },
};

/** What finishing a build now costs with `matchdaysLeft` still to wait (at least one matchday's worth). */
export function finishBuildPrice(matchdaysLeft: number): number {
  const left = Number.isFinite(matchdaysLeft) ? Math.max(1, Math.ceil(matchdaysLeft)) : 1;
  return GEM_PRICES.finishBuildPerMatchday * left;
}

// ------------------------------------------------------------------ the Scouting Network (permanent tiers, guaranteed outcomes)

export interface ScoutNetwork {
  tier: number;
  name: string;
  /** Gems (GEM_PRICES.scoutNetwork). */
  price: number;
  /** Every intake includes at least one prospect with this many potential stars (1..5). Guaranteed, never a chance. */
  minStars: number;
  /** Extra prospects in every intake. */
  extra: number;
  /** The promise, as the card says it. */
  text: string;
}

/**
 * The tiers, in order. Each is a stated, guaranteed outcome for every academy intake from the next one on (never odds):
 * the career's intake (meta/life.ts) reads `scoutNetworkOf(save)` and lifts its best prospect to `minStars`.
 */
export const SCOUT_NETWORKS: readonly ScoutNetwork[] = [
  { tier: 1, name: 'LOCAL NETWORK', price: GEM_PRICES.scoutNetwork[0], minStars: 4, extra: 0, text: 'EVERY INTAKE HAS A 4 STAR PROSPECT' },
  { tier: 2, name: 'NATIONAL NETWORK', price: GEM_PRICES.scoutNetwork[1], minStars: 5, extra: 0, text: 'EVERY INTAKE HAS A 5 STAR PROSPECT' },
  { tier: 3, name: 'WORLD NETWORK', price: GEM_PRICES.scoutNetwork[2], minStars: 5, extra: 1, text: 'A 5 STAR PROSPECT AND ONE MORE PROSPECT EVERY INTAKE' },
];

/** The Scouting Network tier owned (0 = none). */
export function scoutNetworkTier(save: GemSave): number {
  return Math.max(0, Math.min(SCOUT_NETWORKS.length, whole(gemsOf(save).network)));
}

/** The network owned (null = none): what every intake is guaranteed. */
export function scoutNetworkOf(save: GemSave): ScoutNetwork | null {
  return SCOUT_NETWORKS[scoutNetworkTier(save) - 1] ?? null;
}

/** The next tier to buy (null = the top one is owned). */
export function nextScoutNetwork(save: GemSave): ScoutNetwork | null {
  return SCOUT_NETWORKS[scoutNetworkTier(save)] ?? null;
}

export type GemBuyResult = { ok: true; price: number; gems: number } | { ok: false; reason: 'maxed' | 'no-gems' | 'unknown'; short: number };

/** Buy the next Scouting Network tier with gems. Permanent; false and nothing changes when short. */
export function buyScoutNetwork(save: GemSave): GemBuyResult {
  const next = nextScoutNetwork(save);
  if (!next) return { ok: false, reason: 'maxed', short: 0 };
  if (!spendGems(save, next.price, 'scoutNetwork')) return { ok: false, reason: 'no-gems', short: next.price - gems(save) };
  gemsOf(save).network = next.tier;
  return { ok: true, price: next.price, gems: gems(save) };
}

// ------------------------------------------------------------------ gems into coins (the STORE tab)

export interface CoinOffer {
  id: string;
  gems: number;
  coins: number;
  /** A tag on the card: an editorial call, keep it true if the numbers move. */
  tag?: 'POPULAR' | 'BEST VALUE';
}

/**
 * Coins for gems, at a fixed and shown rate that gets better with size (14, 16, 18.75 and 22 coins a gem). The smallest
 * pack of gems ($0.99, 100 gems) is worth 1,400 to 1,600 coins: an EPIC look, or seven Normal wins.
 */
export const COIN_OFFERS: readonly CoinOffer[] = [
  { id: 'c700', gems: 50, coins: 700 },
  { id: 'c2400', gems: 150, coins: 2400, tag: 'POPULAR' },
  { id: 'c7500', gems: 400, coins: 7500 },
  { id: 'c22000', gems: 1000, coins: 22000, tag: 'BEST VALUE' },
];

/** Swap gems for coins at an offer's rate. */
export function buyCoinsWithGems(save: GemSave & Pick<SaveData, 'coins'>, id: string): GemBuyResult & { coins?: number } {
  const offer = COIN_OFFERS.find((o) => o.id === id);
  if (!offer) return { ok: false, reason: 'unknown', short: 0 };
  if (!spendGems(save, offer.gems, `coins:${offer.id}`)) return { ok: false, reason: 'no-gems', short: offer.gems - gems(save) };
  save.coins = (Number.isFinite(save.coins) ? Math.max(0, Math.floor(save.coins)) : 0) + offer.coins;
  return { ok: true, price: offer.gems, gems: gems(save), coins: offer.coins };
}

/** What a gem is worth in coins when it covers a shortfall (the smallest swap's rate: COIN_OFFERS[0]). */
export const COINS_PER_GEM = 14;

/** Gems that cover `short` missing coins, rounded up (0 when nothing is missing). */
export function topUpGems(short: number): number {
  return Number.isFinite(short) && short > 0 ? Math.ceil(short / COINS_PER_GEM) : 0;
}

/**
 * Short of coins for something that costs `price`: gems cover the difference at COINS_PER_GEM, so the purchase
 * that follows goes through (the wallet then holds exactly `price`). The shop shows the gem price and asks first.
 * False, and nothing changes, when there are not enough gems. True straight away when the coins already cover it.
 */
export function coverShortfall(save: GemSave & Pick<SaveData, 'coins'>, price: number, reason: string): boolean {
  const coins = Number.isFinite(save.coins) ? Math.max(0, Math.floor(save.coins)) : 0;
  const short = Math.ceil(price) - coins;
  if (short <= 0) return true;
  if (!spendGems(save, topUpGems(short), `topup:${reason}`)) return false;
  save.coins = coins + short;
  return true;
}

// ------------------------------------------------------------------ where gems come from in play (the faucets)

/**
 * Gems paid by playing. Small and steady: a keen free player (daily challenges, the calendar, the weekly objectives,
 * a season of the career) earns roughly 120 a week, which is one replay and a couple of finished builds, or the Club
 * Pass in about five weeks, or the first Scouting Network in two.
 */
export const GEM_REWARDS = {
  /** A board objective met (three a season). */
  boardObjective: 5,
  /** A new legacy level. */
  legacyLevel: 20,
  /** A league title, and going up. */
  title: 30,
  promotion: 15,
  /** The Blocky Cup, the Continental Cup, the World Club Cup. */
  cup: 25,
  continental: 60,
  world: 100,
  /** A new player level. */
  levelUp: 2,
  /** All three daily challenges done. */
  dailySweep: 3,
  /** One weekly objective done (three a week). */
  weekly: 10,
  /** The free daily gems for one rewarded ad. */
  dailyAd: 3,
  /** A Game Center achievement, the first time. */
  achievement: 5,
} as const;

export type GemReward = keyof typeof GEM_REWARDS;

/** Pay a play reward (the amount from GEM_REWARDS, times `times`). */
export function rewardGems(save: GemSave, what: GemReward, times = 1): number {
  const n = GEM_REWARDS[what] * Math.max(0, Math.floor(times));
  addGems(save, n, what);
  return n;
}

/** Gems on the free season track (meta/season.ts tiers), and the extra ones on the Club Pass track. */
export const SEASON_GEMS: { readonly [tier: number]: number } = { 10: 5, 20: 10, 30: 15 };
export const PASS_GEMS: { readonly [tier: number]: number } = { 3: 20, 8: 20, 13: 25, 18: 25, 23: 30, 28: 30 };

export const sumGems = (table: { readonly [tier: number]: number }): number => Object.values(table).reduce((a, b) => a + b, 0);
