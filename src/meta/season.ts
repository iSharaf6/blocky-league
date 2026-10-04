/** Twelve permanent Club Journeys. XP advances the selected track; switching never expires progress or a pass.
 * The active fields retain legacy monthly receipt IDs, so old gem claims and paid rewards remain paid once.
 * Inactive tracks live in `journeys`; shared legacy carry balances remain claimable exactly once. */

export const SEASON_TIERS = 30;

export interface JourneyProgress {
  /** Stable new `journey-XX` ID, or the original YYYY-MM gem receipt namespace of an imported track. */
  id: string;
  xp: number;
  claimed: number[];
  pass: boolean;
  passClaimed: number[];
}

export interface SeasonState {
  /** The selected Journey's receipt namespace. Legacy monthly IDs are intentionally preserved. */
  id: string;
  xp: number;
  claimed: number[];
  /** Season titles kept from past seasons (the current season's come from its claimed 5th tiers). */
  titles: string[];
  /** Coins from a past season's reached tiers that were never claimed (claimable once), or null. */
  carry: { id: string; coins: number } | null;
  /** Permanent Club Pass for the selected Journey (store product `bl.pass` or earned gems). */
  pass: boolean;
  /** Pass-track tiers already claimed this season. */
  passClaimed: number[];
  /** Club Pass looks a past season's pass reached but never claimed (`cat:id` keys): handed over by meta/pass.ts. */
  carryItems: string[];
  /**
   * Gems a past season's reached tiers never paid (the free track's and the pass's: meta/gems.ts SEASON_GEMS and
   * PASS_GEMS), paid into the wallet by meta/pass.ts syncSeasonGems. Optional: older saves lack it (0).
   */
  carryGems?: number;
  /** Inactive Journeys, keyed by pass01..pass12. The active track remains in the fields above for save compatibility. */
  journeys?: Record<string, JourneyProgress>;
}

export function seasonId(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function defaultSeason(now: Date = new Date()): SeasonState {
  return { id: `journey-${String(now.getMonth() + 1).padStart(2, '0')}`, xp: 0, claimed: [], titles: [], carry: null, pass: false, passClaimed: [], carryItems: [] };
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

const validId = (v: unknown): v is string => typeof v === 'string' && /^(?:\d{4}-(?:0[1-9]|1[0-2])|journey-(?:0[1-9]|1[0-2]))$/.test(v);
const validJourney = (v: string): boolean => /^pass(?:0[1-9]|1[0-2])$/.test(v);
const tiers = (v: unknown): number[] => Array.isArray(v)
  ? [...new Set(v.filter((t): t is number => Number.isInteger(t) && t >= 1 && t <= SEASON_TIERS))].sort((a, b) => a - b) : [];

/** A save's Journey, with legacy paid progress and its original gem receipt namespace retained on load. */
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
    ? [...new Set(r.carryItems.filter((k): k is string => typeof k === 'string' && /^(?:(?:goalfx|trail|kit|look):pass\d{2}|decor:(?:net|kick)pass\d{2})$/.test(k)))]
    : [];
  // Progress under an id we can't read belongs to no season we know: start this one afresh (titles and carry stay).
  // (Kept only when there is something to carry: a season with none reads as it always did.)
  const owed = Math.min(9999, num(r.carryGems));
  const carryGems = owed > 0 ? { carryGems: owed } : {};
  if (!validId(r.id)) return { ...defaultSeason(now), titles, carry, carryItems, ...carryGems };
  const s: SeasonState = { id: r.id, xp: num(r.xp), claimed, titles, carry, pass: r.pass === true, passClaimed, carryItems, ...carryGems };
  if (r.journeys && typeof r.journeys === 'object' && !Array.isArray(r.journeys)) {
    const saved: Record<string, JourneyProgress> = {};
    for (const [key, value] of Object.entries(r.journeys)) {
      if (!validJourney(key) || key === passItemId(s.id) || !value || typeof value !== 'object' || !validId(value.id) || passItemId(value.id) !== key) continue;
      saved[key] = { id: value.id, xp: num(value.xp), claimed: tiers(value.claimed), pass: value.pass === true, passClaimed: tiers(value.passClaimed) };
    }
    if (Object.keys(saved).length) s.journeys = saved;
  }
  return s;
}

/** Read or create a permanent track. Used to apply an asynchronous purchase to the originally selected Journey. */
export function journeyOf(s: SeasonState, key: string): JourneyProgress | null {
  if (!validJourney(key)) return null;
  if (key === passItemId(s.id)) return s;
  const saved = s.journeys ?? (s.journeys = {});
  return saved[key] ?? (saved[key] = { id: `journey-${key.slice(4)}`, xp: 0, claimed: [], pass: false, passClaimed: [] });
}

/** Switch only by player choice. XP and claims stay with their track; shared carry and archived titles stay put. */
export function selectJourney(s: SeasonState, key: string): boolean {
  if (!validJourney(key) || key === passItemId(s.id)) return false;
  const next = journeyOf(s, key)!;
  const old = { id: s.id, xp: s.xp, claimed: [...s.claimed], pass: s.pass, passClaimed: [...s.passClaimed] };
  s.journeys![passItemId(s.id)] = old;
  delete s.journeys![key];
  Object.assign(s, { id: next.id, xp: next.xp, claimed: [...next.claimed], pass: next.pass, passClaimed: [...next.passClaimed] });
  return true;
}

/** All shipped tracks, including untouched ones, without creating save entries while rendering the menu. */
export function journeyList(s: SeasonState): { key: string; name: string; color: string; tier: number; pass: boolean; active: boolean }[] {
  return SEASON_THEMES.map((th, i) => {
    const key = `pass${String(i + 1).padStart(2, '0')}`;
    const active = key === passItemId(s.id);
    const track = active ? s : s.journeys?.[key];
    return { key, ...th, tier: seasonTier(track?.xp ?? 0), pass: track?.pass === true, active };
  });
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

/** Twelve shipped themes; indices retain the original monthly item IDs for save compatibility. */
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

function monthOf(id: string): number {
  const m = Number(id.startsWith('journey-') ? id.slice(8) : id.slice(5, 7));
  return Number.isInteger(m) && m >= 1 && m <= 12 ? m - 1 : 0;
}

export function seasonTheme(id: string): { name: string; color: string } {
  return SEASON_THEMES[monthOf(id)];
}

/** "SEPTEMBER 2026". */
export function seasonName(id: string): string {
  return `${seasonTheme(id).name.toUpperCase()} JOURNEY`;
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

/** Coins on pass tiers 25 and 30 (5, 10, 15 and 20 are the Journey's own looks). */
export const PASS_BIG_COINS: { readonly [t: number]: number } = { 25: 700, 30: 1800 };

/** Six identity pieces: welcome ceremony, player look, trail, kit, goal explosion and tier-25 diamond nets. */
export const PASS_ITEM_TIERS: { readonly [t: number]: 'look' | 'trail' | 'kit' | 'goalfx' | 'decor' } = { 1: 'decor', 5: 'look', 10: 'trail', 15: 'kit', 20: 'goalfx', 25: 'decor' };

/** The Club Pass look id of season `id` (core/save.ts PASS_IDS: 'pass10' in October). */
export function passItemId(id: string): string {
  return `pass${String(monthOf(id) + 1).padStart(2, '0')}`;
}

/**
 * What pass tier t pays: the same 5,560 coins as older builds and six signature pieces. Tier 1's ceremony is also
 * the immediate welcome gift (granting twice is harmless); tiers 1 and 25 retain their old coin reward too.
 */
export function passReward(t: number, id: string): { coins: number; item?: { cat: 'goalfx' | 'trail' | 'kit' | 'look' | 'decor'; id: string } } {
  const cat = PASS_ITEM_TIERS[t];
  if (cat) return { coins: t === 1 ? 60 : t === 25 ? PASS_BIG_COINS[t] : 0,
    item: { cat, id: cat === 'decor' ? `${t === 1 ? 'kick' : 'net'}${passItemId(id)}` : passItemId(id) } };
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

/** Legacy API: zero means the track is permanent and has no expiry. */
export function seasonDaysLeft(_now: Date = new Date()): number {
  return 0; // Compatibility for callers: permanent Journeys have no countdown.
}

// ------------------------------------------------------------------ progress and claims

/** Compatibility entry point: a calendar change never expires a Journey or its paid entitlement. */
export function rollSeason(_s: SeasonState, _now: Date = new Date()): boolean {
  return false;
}

/** Add XP to the selected Journey; returns the tiers newly reached. Dates never reset progress. */
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
  for (const track of [s, ...Object.values(s.journeys ?? {})]) {
    for (const t of track.claimed) {
      const title = seasonReward(t, track.id).title;
      if (title && !out.includes(title)) out.push(title);
    }
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
