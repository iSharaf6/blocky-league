/**
 * Season track: a free 30-tier ladder fed by XP, resetting monthly with a theme (docs/DESIGN_REVIEW.md).
 *
 * Rules (pure; the BADGES screen in ui/badges.ts renders them, tests/season.test.ts pins them):
 * - Every XP point a match earns also counts for the season (main.ts's full time calls `seasonAdvance` with the
 *   match XP; the Club Run's own bonus XP goes through `addXp`). Tier t costs `tierCost(t)` XP: 100 each for
 *   tiers 1 to 10, 140 for 11 to 20, 180 for 21 to 30 (4,200 XP in all, about 30 matches).
 * - Every tier pays coins, claimed with a CLAIM button (each tier pays once). Every 5th tier pays a bigger coin
 *   prize and a season title ("Harvest Cup Star"); titles are kept for good.
 * - A new calendar month starts a new season (its own theme). Nothing reached is lost: at the roll-over the coins
 *   of reached, unclaimed tiers move to `carry` (one CLAIM on the next season's screen) and the reached
 *   5th-tier titles are archived in `titles`.
 * - The Club Pass (meta/pass.ts) adds a second track to the same tiers for the month it is bought in: more coins
 *   and that month's own goal explosion and sprint trail. Buying it late hands over every tier already reached.
 * Nothing on the pitch can be bought: the pass is looks and coins.
 */
export const SEASON_TIERS = 30;

export interface SeasonState {
  /** The season this progress belongs to ("2026-09"). */
  id: string;
  xp: number;
  claimed: number[];
  /** Season titles kept from past seasons (the current season's come from its claimed 5th tiers). */
  titles: string[];
  /** Coins from a past season's reached tiers that were never claimed (claimable once), or null. */
  carry: { id: string; coins: number } | null;
  /** The Club Pass is on for THIS season (bought with the store's 'bl.pass': platform/iap.ts, meta/pass.ts). */
  pass: boolean;
  /** Pass-track tiers already claimed this season. */
  passClaimed: number[];
  /** Club Pass looks a past season's pass reached but never claimed (`cat:id` keys): handed over by meta/pass.ts. */
  carryItems: string[];
}

export function seasonId(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function defaultSeason(now: Date = new Date()): SeasonState {
  return { id: seasonId(now), xp: 0, claimed: [], titles: [], carry: null, pass: false, passClaimed: [], carryItems: [] };
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** A save's season, rolled over to a fresh one when the month has changed (keeping titles and unclaimed coins). */
export function normalizeSeason(raw: unknown, now: Date = new Date()): SeasonState {
  if (!raw || typeof raw !== 'object') return defaultSeason(now);
  const r = raw as Partial<SeasonState>;
  const claimed = Array.isArray(r.claimed)
    ? [...new Set(r.claimed.filter((x) => Number.isInteger(x) && x >= 1 && x <= SEASON_TIERS))].sort((a, b) => a - b)
    : [];
  const titles = Array.isArray(r.titles)
    ? [...new Set(r.titles.filter((t): t is string => typeof t === 'string' && t.length > 0 && t.length <= 48))]
    : [];
  const c = r.carry;
  const carry = c && typeof c === 'object' && typeof c.id === 'string' && num(c.coins) > 0 ? { id: c.id, coins: num(c.coins) } : null;
  const passClaimed = Array.isArray(r.passClaimed)
    ? [...new Set(r.passClaimed.filter((x) => Number.isInteger(x) && x >= 1 && x <= SEASON_TIERS))].sort((a, b) => a - b)
    : [];
  const carryItems = Array.isArray(r.carryItems)
    ? [...new Set(r.carryItems.filter((k): k is string => typeof k === 'string' && /^(goalfx|trail|kit|look):pass\d{2}$/.test(k)))]
    : [];
  // Progress under an id we can't read belongs to no season we know: start this one afresh (titles and carry stay).
  if (typeof r.id !== 'string' || !/^\d{4}-\d{2}$/.test(r.id)) return { ...defaultSeason(now), titles, carry, carryItems };
  const s: SeasonState = { id: r.id, xp: num(r.xp), claimed, titles, carry, pass: r.pass === true, passClaimed, carryItems };
  rollSeason(s, now);
  return s;
}

// ------------------------------------------------------------------ tiers

/** XP to go from tier t-1 to tier t (t = 1..30). */
export function tierCost(t: number): number {
  return 100 + 40 * Math.floor((Math.max(1, t) - 1) / 10);
}

/** Total season XP needed to reach tier t (0 for t = 0). */
export function tierXp(t: number): number {
  let x = 0;
  for (let i = 1; i <= Math.min(SEASON_TIERS, t); i++) x += tierCost(i);
  return x;
}

/** Tiers reached (0..30) with `xp` season XP. */
export function seasonTier(xp: number): number {
  let t = 0;
  let left = Math.max(0, Math.floor(xp));
  while (t < SEASON_TIERS && left >= tierCost(t + 1)) {
    left -= tierCost(t + 1);
    t++;
  }
  return t;
}

/** Where the bar is: tiers reached, XP into the next tier and what it costs (need 0 at the top). */
export function seasonProgress(s: Pick<SeasonState, 'xp'>): { tier: number; into: number; need: number } {
  const tier = seasonTier(s.xp);
  if (tier >= SEASON_TIERS) return { tier, into: 0, need: 0 };
  return { tier, into: Math.max(0, Math.floor(s.xp) - tierXp(tier)), need: tierCost(tier + 1) };
}

// ------------------------------------------------------------------ theme and rewards

/** A theme per calendar month (January first). */
export const SEASON_THEMES: readonly { name: string; color: string }[] = [
  { name: 'Frost Cup', color: '#5cc8f5' },
  { name: 'Mud and Glory', color: '#8a5a36' },
  { name: 'Spring Derby', color: '#3cc15a' },
  { name: 'April Showers', color: '#2f7be8' },
  { name: 'Title Race', color: '#e0b23a' },
  { name: 'Summer Sevens', color: '#ff8a2b' },
  { name: 'Heatwave Cup', color: '#ec4a3e' },
  { name: 'Training Camp', color: '#1fb3a6' },
  { name: 'Harvest Cup', color: '#c7970f' },
  { name: 'Floodlights', color: '#8a55d8' },
  { name: 'Bonfire Derby', color: '#e8443a' },
  { name: 'Winter Classic', color: '#223a78' },
];

const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

function monthOf(id: string): number {
  const m = Number(id.slice(5, 7));
  return Number.isInteger(m) && m >= 1 && m <= 12 ? m - 1 : 0;
}

export function seasonTheme(id: string): { name: string; color: string } {
  return SEASON_THEMES[monthOf(id)];
}

/** "SEPTEMBER 2026". */
export function seasonName(id: string): string {
  return `${MONTHS[monthOf(id)]} ${id.slice(0, 4)}`;
}

/** Title ranks for tiers 5, 10, 15, 20, 25 and 30. */
export const SEASON_RANKS = ['Rookie', 'Regular', 'Starter', 'Star', 'Hero', 'Legend'] as const;
/** Coins for tiers 5, 10, 15, 20, 25 and 30. */
export const SEASON_BIG_COINS = [150, 250, 350, 450, 550, 1000] as const;

/** What tier t (1..30) of season `id` pays: coins, and on every 5th tier a bigger prize and a title. */
export function seasonReward(t: number, id: string): { coins: number; title?: string } {
  if (t % 5 === 0) {
    const k = Math.min(SEASON_RANKS.length - 1, t / 5 - 1);
    return { coins: SEASON_BIG_COINS[k], title: `${seasonTheme(id).name} ${SEASON_RANKS[k]}` };
  }
  return { coins: Math.round((20 + 3 * t) / 5) * 5 };
}

// ------------------------------------------------------------------ the Club Pass track (meta/pass.ts sells and pays it)

/** Coins on pass tiers 25 and 30 (5, 10, 15 and 20 are the month's own looks). */
export const PASS_BIG_COINS: { readonly [t: number]: number } = { 25: 700, 30: 1800 };

/** The pass tiers that hand over the month's own looks: its player look, sprint trail, premium kit and goal explosion. */
export const PASS_ITEM_TIERS: { readonly [t: number]: 'look' | 'trail' | 'kit' | 'goalfx' } = { 5: 'look', 10: 'trail', 15: 'kit', 20: 'goalfx' };

/** The Club Pass look id of season `id` (core/save.ts PASS_IDS: 'pass10' in October). */
export function passItemId(id: string): string {
  return `pass${String(monthOf(id) + 1).padStart(2, '0')}`;
}

/**
 * What pass tier t (1..30) of season `id` pays, on top of the free track: coins, or one of the month's own looks
 * (PASS_ITEM_TIERS: its player look at 5, sprint trail at 10, premium kit at 15, goal explosion at 20). About 5,500
 * coins and four looks money can't buy any other way over a season (docs/ECONOMY.md).
 */
export function passReward(t: number, id: string): { coins: number; item?: { cat: 'goalfx' | 'trail' | 'kit' | 'look'; id: string } } {
  const cat = PASS_ITEM_TIERS[t];
  if (cat) return { coins: 0, item: { cat, id: passItemId(id) } };
  const big = PASS_BIG_COINS[t];
  if (big) return { coins: big };
  return { coins: Math.round((50 + 5 * t) / 10) * 10 };
}

/** Reached pass tiers not yet claimed (none without the pass), lowest first. */
export function unclaimedPassTiers(s: SeasonState): number[] {
  if (!s.pass) return [];
  const out: number[] = [];
  const reached = seasonTier(s.xp);
  for (let t = 1; t <= reached; t++) if (!s.passClaimed.includes(t)) out.push(t);
  return out;
}

/** Days left in the season, today included (1 on the last day). */
export function seasonDaysLeft(now: Date = new Date()): number {
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return Math.max(1, Math.ceil((end.getTime() - now.getTime()) / 86_400_000));
}

// ------------------------------------------------------------------ progress and claims

/**
 * Roll `s` over to the season of `now` if the month has changed (in place): the old season's reached, unclaimed
 * tiers' coins go to `carry`, its reached titles to `titles`. Returns true if it rolled.
 */
export function rollSeason(s: SeasonState, now: Date = new Date()): boolean {
  const id = seasonId(now);
  if (s.id === id) return false;
  const reached = seasonTier(s.xp);
  let coins = 0;
  for (let t = 1; t <= reached; t++) {
    const rw = seasonReward(t, s.id);
    if (!s.claimed.includes(t)) coins += rw.coins;
    if (rw.title && !s.titles.includes(rw.title)) s.titles.push(rw.title);
  }
  // The pass's reached, unclaimed tiers are kept too: coins into the carry, its looks into carryItems.
  for (const t of unclaimedPassTiers(s)) {
    const rw = passReward(t, s.id);
    coins += rw.coins;
    const key = rw.item ? `${rw.item.cat}:${rw.item.id}` : '';
    if (key && !s.carryItems.includes(key)) s.carryItems.push(key);
  }
  if (coins > 0) s.carry = { id: s.id, coins: (s.carry?.coins ?? 0) + coins };
  s.id = id;
  s.xp = 0;
  s.claimed = [];
  s.pass = false;
  s.passClaimed = [];
  return true;
}

/** Add XP; returns the tiers newly reached (rolling the season over first if the month has changed). */
export function seasonAdvance(state: SeasonState, xp: number, now: Date = new Date()): number[] {
  rollSeason(state, now);
  const before = seasonTier(state.xp);
  state.xp += Math.max(0, Math.floor(Number.isFinite(xp) ? xp : 0));
  const after = seasonTier(state.xp);
  const out: number[] = [];
  for (let t = before + 1; t <= after; t++) out.push(t);
  return out;
}

/** Reached tiers not yet claimed, lowest first. */
export function unclaimedTiers(s: SeasonState): number[] {
  const out: number[] = [];
  const reached = seasonTier(s.xp);
  for (let t = 1; t <= reached; t++) if (!s.claimed.includes(t)) out.push(t);
  return out;
}

/** Claim tier t: its coins (0 if it isn't reached or was already claimed). The caller adds them to save.coins. */
export function claimSeasonTier(s: SeasonState, t: number): number {
  if (!Number.isInteger(t) || t < 1 || t > seasonTier(s.xp) || s.claimed.includes(t)) return 0;
  s.claimed.push(t);
  s.claimed.sort((a, b) => a - b);
  return seasonReward(t, s.id).coins;
}

/** Claim every reached tier and any carried coins at once; returns the coins. */
export function claimAllSeason(s: SeasonState): number {
  let coins = claimCarry(s);
  for (const t of unclaimedTiers(s)) coins += claimSeasonTier(s, t);
  return coins;
}

/** Claim a past season's carried coins (0 if there are none). */
export function claimCarry(s: SeasonState): number {
  const c = s.carry?.coins ?? 0;
  s.carry = null;
  return c;
}

/** Every season title earned: past seasons' and this season's claimed 5th tiers. */
export function seasonTitles(s: SeasonState): string[] {
  const out = [...s.titles];
  for (const t of s.claimed) {
    const title = seasonReward(t, s.id).title;
    if (title && !out.includes(title)) out.push(title);
  }
  return out;
}

/** Things waiting to be claimed (for a dot on the menu button). */
export function seasonPending(s: SeasonState): number {
  return unclaimedTiers(s).length + unclaimedPassTiers(s).length + (s.carry ? 1 : 0) + (s.carryItems.length ? 1 : 0);
}

/** The save's season, created if missing (a brand-new save from defaultSave() has none until it's reloaded). */
export function seasonOf(save: { season?: SeasonState }, now: Date = new Date()): SeasonState {
  if (!save.season) save.season = defaultSeason(now);
  return save.season;
}

/**
 * XP that counts for both the player's level and the season (the Club Run's bonus XP and milestone XP). Match XP
 * is added by main.ts's full time, which feeds the season itself; use this only for XP granted outside it.
 */
export function addXp(save: { progress: { xp: number }; season?: SeasonState }, xp: number, now: Date = new Date()): number[] {
  const n = Math.max(0, Math.floor(Number.isFinite(xp) ? xp : 0));
  if (!n) return [];
  save.progress.xp += n;
  return seasonAdvance(seasonOf(save, now), n, now);
}
