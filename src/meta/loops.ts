/**
 * THE REASONS TO COME BACK (docs/ECONOMY.md, economy v3): the 7-day login calendar, the weekly objectives, the daily
 * sweep (all three daily challenges done) and the optional rewarded ads, each capped per day.
 *
 * The rules that keep them kind (tests/economy.test.ts pins them):
 * - Absence is never punished. The calendar counts the days you claim, not days in a row: a missed day costs
 *   nothing and the calendar simply carries on where you left it (then starts again after day 7).
 * - Every ad is the player's own tap, for a stated reward, with a daily cap. Nothing here starts one by itself.
 * - Nothing here is random and nothing is timed against the player: a week's objectives last the whole week.
 *
 * Pure rules and state, no DOM. The state is SaveData.loops (made whole by normalizeLoops); the calendar keeps
 * using SaveData.gift (the daily gift it grew out of).
 */
import { normalizeShop, type MatchSummary, type SaveData } from '../core/save';
import { hashString } from '../core/rng';
import { GEM_REWARDS, addGems } from './gems';

// ------------------------------------------------------------------ state

/** The optional rewarded ads this module caps (FREE COINS has its own cap: meta/shop.ts FREE_AD_DAILY_CAP). */
export type AdPlace = 'gem' | 'replay' | 'build' | 'deal' | 'heal';
export const AD_PLACES: readonly AdPlace[] = ['gem', 'replay', 'build', 'deal', 'heal'];

export type AdCaps = { readonly [k in AdPlace]: number };

/** How many of each a local day allows in the apps and on the web. Small on purpose: a choice at the right moment, never a grind. */
export const APP_AD_CAPS: AdCaps = { gem: 1, replay: 1, build: 1, deal: 1, heal: 1 };

/**
 * FREE GEMS offers a day on a portal build (CrazyGames, Poki). Nothing is sold there, so gems come only from play and
 * from this opt-in offer in the shop: it comes round twice a day instead of once (one ad each, the same gems each).
 * Three is the limit the owner set; two is the model's answer (scripts/economy-model.ts, docs/ECONOMY.md 14 October
 * 2026): a keen portal player's Club Pass comes two days sooner, and the week's ceiling from the loops stays inside
 * the band the rest of the economy is tuned to (144 of 160; three offers would make it 165).
 */
export const PORTAL_GEM_OFFERS = 2;
export const PORTAL_AD_CAPS: AdCaps = { ...APP_AD_CAPS, gem: PORTAL_GEM_OFFERS };

/** This build is a portal's (in dev, ?portal= looks at it). The literal checks let the bundler settle it at build time. */
const PORTAL_BUILD = import.meta.env.VITE_PORTAL === 'crazygames' || import.meta.env.VITE_PORTAL === 'poki'
  || (import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('portal'));

/** This build's caps. */
export const AD_CAPS: AdCaps = PORTAL_BUILD ? PORTAL_AD_CAPS : APP_AD_CAPS;

/** What each ad is for, as the button says it. */
export const AD_TEXT: { readonly [k in AdPlace]: string } = {
  gem: `${GEM_REWARDS.dailyAd} FREE GEMS`,
  replay: 'REPLAY A LOST DECIDER',
  build: 'ONE MATCHDAY OFF YOUR BUILD',
  deal: 'A NEW DEAL TODAY',
  // (2026-10-14: every gem shortcut has its ad now. HEAL A PLAYER NOW was the one that had none.)
  heal: 'HEAL AN INJURED PLAYER',
};

export interface WeeklyState {
  /** The Monday (YYYY-MM-DD) these belong to. */
  week: string;
  progress: [number, number, number];
  claimed: [boolean, boolean, boolean];
}

export interface LoopState {
  /** Rewarded ads used on one local day (YYYY-MM-DD; '' = none yet), by place. */
  ads: { day: string } & { [k in AdPlace]: number };
  weekly: WeeklyState;
  /** The local day the daily sweep's gems were last paid ('' = never). */
  sweep: string;
}

type LoopSave = Pick<SaveData, 'loops'>;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const count = (v: unknown, max = 99): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(max, Math.floor(v)) : 0);

export function defaultLoops(): LoopState {
  return { ads: { day: '', gem: 0, replay: 0, build: 0, deal: 0, heal: 0 }, weekly: { week: '', progress: [0, 0, 0], claimed: [false, false, false] }, sweep: '' };
}

/** A loops blob as stored by any build (or none) made whole. */
export function normalizeLoops(raw: unknown): LoopState {
  const base = defaultLoops();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const r = raw as Partial<LoopState>;
  const a = (r.ads && typeof r.ads === 'object' ? r.ads : {}) as Partial<LoopState['ads']>;
  const day = typeof a.day === 'string' && DAY.test(a.day) ? a.day : '';
  const w = (r.weekly && typeof r.weekly === 'object' ? r.weekly : {}) as Partial<WeeklyState>;
  const prog = Array.isArray(w.progress) ? w.progress : [];
  const claimed = Array.isArray(w.claimed) ? w.claimed : [];
  return {
    // (A save from before an ad place existed counts none of it today.)
    ads: { day, gem: day ? count(a.gem) : 0, replay: day ? count(a.replay) : 0, build: day ? count(a.build) : 0, deal: day ? count(a.deal) : 0, heal: day ? count(a.heal) : 0 },
    weekly: {
      week: typeof w.week === 'string' && DAY.test(w.week) ? w.week : '',
      progress: [count(prog[0], 9999), count(prog[1], 9999), count(prog[2], 9999)],
      claimed: [claimed[0] === true, claimed[1] === true, claimed[2] === true],
    },
    sweep: typeof r.sweep === 'string' && DAY.test(r.sweep) ? r.sweep : '',
  };
}

/** The save's loops state, made whole in place first if it isn't. */
export function loopsOf(save: LoopSave): LoopState {
  const l = save.loops;
  if (!l || typeof l !== 'object' || !l.ads || typeof l.ads.day !== 'string' || !l.weekly || !Array.isArray(l.weekly.progress) || !Array.isArray(l.weekly.claimed)) {
    save.loops = normalizeLoops(l);
  }
  return save.loops!;
}

// ------------------------------------------------------------------ the 7-day login calendar

export interface CalendarDay {
  coins: number;
  gems: number;
  /** Scout Tokens (earned only: this is one of the places they come from). */
  tokens: number;
}

/**
 * What each claimed day pays (day 1 first), then round again. Coins as the daily gift always paid (100 up to 400),
 * with gems on days 3 and 7 and a Scout Token on day 5: 1,750 coins, 25 gems and a token a round.
 */
export const CALENDAR: readonly CalendarDay[] = [
  { coins: 100, gems: 0, tokens: 0 },
  { coins: 150, gems: 0, tokens: 0 },
  { coins: 200, gems: 5, tokens: 0 },
  { coins: 250, gems: 0, tokens: 0 },
  { coins: 300, gems: 0, tokens: 1 },
  { coins: 350, gems: 0, tokens: 0 },
  { coins: 400, gems: 20, tokens: 0 },
];

/**
 * Today's calendar day if it isn't claimed yet (`step` 1..7), else null. It counts the days claimed, never days in a
 * row: after a week away the next claim is simply the next day of the calendar.
 */
export function calendarToday(save: Pick<SaveData, 'gift'>, day: string): { step: number; reward: CalendarDay } | null {
  const g = save.gift;
  // A rewind must not turn yesterday into a new claim. The stored date is a local high-water mark.
  if (!DAY.test(day) || (g && DAY.test(g.last) && g.last >= day)) return null;
  const step = g ? (Math.max(1, Math.min(7, Math.floor(g.streak) || 1)) % 7) + 1 : 1;
  return { step, reward: CALENDAR[step - 1] };
}

/** Revalidate after any ad/async UI, then pay all parts together. Re-entry and stale cards pay nothing. */
export function claimCalendar(
  save: Pick<SaveData, 'coins' | 'gems' | 'shop' | 'gift'>,
  day: string,
  expectedStep: number,
  doubleCoins = false,
): (CalendarDay & { step: number }) | null {
  const today = calendarToday(save, day);
  if (!today || today.step !== expectedStep) return null;
  const reward = { ...today.reward, coins: today.reward.coins * (doubleCoins ? 2 : 1), step: today.step };
  save.coins += reward.coins;
  if (reward.gems) addGems(save, reward.gems, 'calendar');
  if (reward.tokens) {
    save.shop = normalizeShop(save.shop);
    save.shop.tokens = Math.min(999, save.shop.tokens + reward.tokens);
  }
  save.gift = { last: day, streak: today.step };
  return reward;
}

/** The day after the last one claimed (what "tomorrow" pays, for the hub's line), 1..7. */
export function calendarNext(save: Pick<SaveData, 'gift'>): { step: number; reward: CalendarDay } {
  const g = save.gift;
  const step = g ? (Math.max(1, Math.min(7, Math.floor(g.streak) || 1)) % 7) + 1 : 1;
  return { step, reward: CALENDAR[step - 1] };
}

// ------------------------------------------------------------------ the daily sweep

/**
 * All three of the day's challenges are done: the sweep's gems, once a day. Returns the gems paid (0 when they
 * aren't all done, or today's were paid).
 */
export function claimSweep(save: LoopSave & Pick<SaveData, 'gems' | 'progress'>, day: string): number {
  const d = save.progress.daily;
  if (d.day !== day || !d.claimed.every(Boolean)) return 0;
  const l = loopsOf(save);
  if (!DAY.test(day) || l.sweep >= day) return 0;
  l.sweep = day;
  addGems(save, GEM_REWARDS.dailySweep, 'dailySweep');
  return GEM_REWARDS.dailySweep;
}

// ------------------------------------------------------------------ weekly objectives

export type WeeklyKind = 'wins' | 'goals' | 'matches' | 'cleanSheets' | 'assists' | 'tackles' | 'skills' | 'motm' | 'dailies';

export interface Weekly {
  id: string;
  text: string;
  kind: WeeklyKind;
  goal: number;
  coins: number;
}

/** Every weekly objective; three are drawn a week. Sized for four or five days of play: a week is plenty. */
export const WEEKLY_POOL: readonly Weekly[] = [
  { id: 'w_wins', text: 'Win 6 matches', kind: 'wins', goal: 6, coins: 400 },
  { id: 'w_goals', text: 'Score 15 goals', kind: 'goals', goal: 15, coins: 400 },
  { id: 'w_play', text: 'Play 10 matches', kind: 'matches', goal: 10, coins: 300 },
  { id: 'w_clean', text: 'Keep 3 clean sheets', kind: 'cleanSheets', goal: 3, coins: 400 },
  { id: 'w_assists', text: 'Set up 8 goals', kind: 'assists', goal: 8, coins: 350 },
  { id: 'w_tackles', text: 'Win 25 tackles', kind: 'tackles', goal: 25, coins: 300 },
  { id: 'w_skills', text: 'Pull off 15 skill moves', kind: 'skills', goal: 15, coins: 350 },
  { id: 'w_motm', text: 'Be Man of the Match 3 times', kind: 'motm', goal: 3, coins: 400 },
  { id: 'w_daily', text: 'Finish 6 daily challenges', kind: 'dailies', goal: 6, coins: 400 },
];

/** The Monday (YYYY-MM-DD) of the week `day` is in. */
export function weekStart(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(y || 2026, (m || 1) - 1, d || 1, 12);
  t.setDate(t.getDate() - ((t.getDay() + 6) % 7));
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

/** The three objectives of the week `day` is in: the same three for everyone, all week. */
export function weeklyObjectives(day: string): [Weekly, Weekly, Weekly] {
  const pool = [...WEEKLY_POOL];
  let h = hashString(`weekly:${weekStart(day)}`);
  const out: Weekly[] = [];
  while (out.length < 3 && pool.length) {
    out.push(pool.splice(h % pool.length, 1)[0]);
    h = hashString(`weekly:${weekStart(day)}:${out.length}`);
  }
  return out as [Weekly, Weekly, Weekly];
}

/** This week's state: started afresh when the stored one is for another week (nothing is owed for a week missed). */
export function weeklyFor(save: LoopSave, day: string): WeeklyState {
  const l = loopsOf(save);
  const week = weekStart(day);
  if (l.weekly.week < week) l.weekly = { week, progress: [0, 0, 0], claimed: [false, false, false] };
  return l.weekly;
}

/** What a match counts for towards each kind (`dailies`: the daily challenges this match completed). */
export function weeklyCounts(s: MatchSummary, dailiesDone: number): { [k in WeeklyKind]: number } {
  return {
    wins: s.won ? 1 : 0,
    goals: s.goals,
    matches: 1,
    cleanSheets: s.conceded === 0 ? 1 : 0,
    assists: s.assists,
    tackles: s.tacklesWon,
    skills: s.skills,
    motm: s.motm ? 1 : 0,
    dailies: Math.max(0, Math.floor(dailiesDone)),
  };
}

export interface WeeklyDone {
  index: number;
  objective: Weekly;
  gems: number;
}

/**
 * Add a match to this week's objectives. The ones just completed are marked paid and their gems are in the wallet;
 * their coins are returned for the caller to pay with the match (as the daily challenges' are).
 */
export function advanceWeekly(save: LoopSave & Pick<SaveData, 'gems'>, day: string, s: MatchSummary, dailiesDone = 0): WeeklyDone[] {
  const w = weeklyFor(save, day);
  const counts = weeklyCounts(s, dailiesDone);
  const done: WeeklyDone[] = [];
  weeklyObjectives(w.week).forEach((o, i) => {
    w.progress[i] = Math.min(o.goal, w.progress[i] + counts[o.kind]);
    if (w.progress[i] >= o.goal && !w.claimed[i]) {
      w.claimed[i] = true;
      addGems(save, GEM_REWARDS.weekly, 'weekly');
      done.push({ index: i, objective: o, gems: GEM_REWARDS.weekly });
    }
  });
  return done;
}

// ------------------------------------------------------------------ rewarded ads (the player's choice, capped a day)

/** Ads of this kind still open today (`caps`: this build's unless said: the model looks at a portal's). */
export function adsLeft(save: LoopSave, place: AdPlace, day: string, caps: AdCaps = AD_CAPS): number {
  const a = loopsOf(save).ads;
  if (!DAY.test(day) || a.day > day) return 0;
  return a.day === day ? Math.max(0, caps[place] - a[place]) : caps[place];
}

/**
 * Count one watched ad of this kind against today's cap. Call it only once the ad was watched through
 * (platform/ads.ts rewarded() resolved true). False, and nothing is counted, when today's are used up.
 */
export function useAd(save: LoopSave, place: AdPlace, day: string, caps: AdCaps = AD_CAPS): boolean {
  if (adsLeft(save, place, day, caps) <= 0) return false;
  const a = loopsOf(save).ads;
  if (a.day !== day) {
    a.day = day;
    for (const p of AD_PLACES) a[p] = 0;
  }
  a[place]++;
  return true;
}

/**
 * The free daily gems: one watched ad for one reward, as many times a day as this build offers it (once in the apps,
 * PORTAL_GEM_OFFERS on a portal). Returns the gems paid (0 when today's were taken).
 */
export function claimDailyGems(save: LoopSave & Pick<SaveData, 'gems'>, day: string, caps: AdCaps = AD_CAPS): number {
  if (!useAd(save, 'gem', day, caps)) return 0;
  addGems(save, GEM_REWARDS.dailyAd, 'dailyAd');
  return GEM_REWARDS.dailyAd;
}

// ------------------------------------------------------------------ what a week of play pays (docs and tests)

/**
 * Gems a free player can earn in a week from the loops alone (no career, no season): one calendar round, seven
 * sweeps, three weekly objectives, and every FREE GEMS offer of the week. The pacing tables in docs/ECONOMY.md are
 * built on it. (`caps`: this build's unless said. The come-back loops are meta/comeback.ts weeklyComebackGems.)
 */
export function weeklyLoopGems(caps: AdCaps = AD_CAPS): number {
  const calendar = CALENDAR.reduce((n, d) => n + d.gems, 0);
  return calendar + 7 * GEM_REWARDS.dailySweep + 3 * GEM_REWARDS.weekly + 7 * caps.gem * GEM_REWARDS.dailyAd;
}
