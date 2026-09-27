/**
 * Mastery badges: five skill tracks, five tiers each, earned by doing the thing in any mode (docs/DESIGN_REVIEW.md).
 *
 * Rules (pure; ui/badges.ts renders them, tests/mastery.test.ts pins them):
 * - finisher: goals. playmaker: assists plus one point per 10 completed passes (the spare passes carry over).
 *   wall: tackles won plus 3 a clean sheet. magician: skill moves and men beaten. keeper: saves.
 * - Thresholds (MASTERY_THRESHOLDS): the first tier comes in a match or two, the fifth in about 40.
 * - Every tier pays coins (MASTERY_COINS, claimed on the BADGES screen, once each) and a badge title the player
 *   can wear (MASTERY_TITLES). Those are the only rewards: nothing here is bought, nothing touches the pitch.
 * - Titles from every system (tiers here, Club Run milestones, season tiers) are listed by `earnedTitles`, and the
 *   one the player wears is `state.title` (`wornTitle`).
 */
import type { SaveData } from '../core/save';
import { runTitles } from './run';
import { claimAllSeason, seasonAdvance, seasonOf, seasonPending, seasonTitles, type SeasonState } from './season';

export const MASTERY_TRACKS = ['finisher', 'playmaker', 'wall', 'magician', 'keeper'] as const;
export type MasteryTrack = (typeof MASTERY_TRACKS)[number];
export const MASTERY_TIERS = 5;

export interface MasteryState {
  counts: { [k in MasteryTrack]: number };
  /** Tiers already paid out per track (0..5). */
  claimed: { [k in MasteryTrack]: number };
  /** Completed passes not yet worth a playmaker point (0..9). */
  passCarry: number;
  /** The title the player wears ('' = the level title). */
  title: string;
}

/** What a finished match adds to the tracks. */
export interface MasteryMatch {
  goals: number;
  assists: number;
  passes: number;
  tackles: number;
  cleanSheet: boolean;
  skills: number;
  saves: number;
}

/**
 * Points needed for tiers I to V. Measured AI v AI at Normal (1.5-minute halves are typical): per side and match
 * about 1.3 goals, 43 completed passes and 1 assist, 2.5 tackles won and a clean sheet one match in four, 4 skills
 * and beats, 1.5 saves.
 */
export const MASTERY_THRESHOLDS: { readonly [k in MasteryTrack]: readonly number[] } = {
  finisher: [2, 8, 20, 35, 55],
  playmaker: [5, 25, 60, 110, 180],
  wall: [4, 18, 45, 85, 135],
  magician: [5, 25, 60, 105, 165],
  keeper: [2, 10, 25, 42, 65],
};

/** Coins for tiers I to V (the same on every track). */
export const MASTERY_COINS = [50, 100, 200, 350, 600] as const;

export const MASTERY_TITLES: { readonly [k in MasteryTrack]: readonly string[] } = {
  finisher: ['Poacher', 'Fox in the Box', 'Sharpshooter', 'Hat Trick Hero', 'Goal Machine'],
  playmaker: ['Link Player', 'Metronome', 'Conductor', 'Maestro', 'Master Architect'],
  wall: ['Stopper', 'Brick Wall', 'Enforcer', 'Iron Curtain', 'The Wall'],
  magician: ['Showboat', 'Trickster', 'Nutmeg King', 'Street Wizard', 'The Magician'],
  keeper: ['Safe Hands', 'Shot Stopper', 'Cat Reflexes', 'The Octopus', 'Golden Glove'],
};

/** Display name, what counts (short) and how to earn it. */
export const TRACK_INFO: { readonly [k in MasteryTrack]: { name: string; unit: string; how: string; color: string } } = {
  finisher: { name: 'FINISHER', unit: 'GOALS', how: 'Goals scored in any match.', color: '#ec4a3e' },
  playmaker: { name: 'PLAYMAKER', unit: 'POINTS', how: 'Assists, plus a point for every 10 completed passes.', color: '#2f7be8' },
  wall: { name: 'WALL', unit: 'POINTS', how: 'Tackles won, plus 3 for every clean sheet.', color: '#6f8196' },
  magician: { name: 'MAGICIAN', unit: 'SKILLS', how: 'Skill moves and men beaten on the dribble.', color: '#8a55d8' },
  keeper: { name: 'KEEPER', unit: 'SAVES', how: 'Saves made by your keeper.', color: '#e08a0c' },
};

export const TIER_NAMES = ['I', 'II', 'III', 'IV', 'V'] as const;

function zero(): { [k in MasteryTrack]: number } {
  return { finisher: 0, playmaker: 0, wall: 0, magician: 0, keeper: 0 };
}

export function defaultMastery(): MasteryState {
  return { counts: zero(), claimed: zero(), passCarry: 0, title: '' };
}

const int = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

export function normalizeMastery(raw: unknown): MasteryState {
  const d = defaultMastery();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<MasteryState>;
  const c = r.counts;
  if (c && typeof c === 'object') {
    for (const k of MASTERY_TRACKS) {
      const v = (c as Partial<MasteryState['counts']>)[k];
      if (Number.isFinite(v)) d.counts[k] = Math.max(0, Math.floor(v as number));
    }
  }
  const p = r.claimed;
  if (p && typeof p === 'object') {
    // Never more paid than reached (a damaged blob can't block or duplicate a payout).
    for (const k of MASTERY_TRACKS) d.claimed[k] = Math.min(masteryTier(k, d.counts[k]), int((p as Partial<MasteryState['claimed']>)[k]));
  }
  d.passCarry = Math.min(9, int(r.passCarry));
  d.title = typeof r.title === 'string' && r.title.length <= 48 ? r.title : '';
  return d;
}

// ------------------------------------------------------------------ tiers

/** Tier reached (0..5) on `track` with `count` points. */
export function masteryTier(track: MasteryTrack, count: number): number {
  let t = 0;
  for (const need of MASTERY_THRESHOLDS[track]) if (count >= need) t++;
  return t;
}

/** A tier's reward. */
export function tierReward(track: MasteryTrack, tier: number): { coins: number; title: string } {
  const i = Math.max(1, Math.min(MASTERY_TIERS, tier)) - 1;
  return { coins: MASTERY_COINS[i], title: MASTERY_TITLES[track][i] };
}

export interface MasteryTierUp {
  track: MasteryTrack;
  tier: number;
  /** Coins waiting on the BADGES screen, and the title it unlocks. */
  coins: number;
  title: string;
}

/** The points one match adds to each track (and the spare passes left over). */
export function matchPoints(m: MasteryMatch, passCarry = 0): { pts: { [k in MasteryTrack]: number }; passCarry: number } {
  const passes = int(m.passes) + Math.min(9, int(passCarry));
  return {
    pts: {
      finisher: int(m.goals),
      playmaker: int(m.assists) + Math.floor(passes / 10),
      wall: int(m.tackles) + (m.cleanSheet ? 3 : 0),
      magician: int(m.skills),
      keeper: int(m.saves),
    },
    passCarry: passes % 10,
  };
}

/** Add a match; returns the tier-ups it caused (lowest first per track). Coins are paid by `claimMastery`. */
export function advanceMastery(state: MasteryState, m: MasteryMatch): MasteryTierUp[] {
  const { pts, passCarry } = matchPoints(m, state.passCarry);
  state.passCarry = passCarry;
  const ups: MasteryTierUp[] = [];
  for (const k of MASTERY_TRACKS) {
    const before = masteryTier(k, state.counts[k]);
    state.counts[k] += pts[k];
    const after = masteryTier(k, state.counts[k]);
    for (let t = before + 1; t <= after; t++) ups.push({ track: k, tier: t, ...tierReward(k, t) });
  }
  return ups;
}

/** A track's bar: tier, points, the previous and next thresholds (next null at tier V) and the share done. */
export function trackProgress(state: MasteryState, track: MasteryTrack): {
  tier: number; count: number; from: number; next: number | null; frac: number; claimable: number;
} {
  const count = state.counts[track];
  const tier = masteryTier(track, count);
  const th = MASTERY_THRESHOLDS[track];
  const from = tier > 0 ? th[tier - 1] : 0;
  const next = tier < MASTERY_TIERS ? th[tier] : null;
  const frac = next === null ? 1 : Math.max(0, Math.min(1, (count - from) / (next - from)));
  return { tier, count, from, next, frac, claimable: Math.max(0, tier - state.claimed[track]) };
}

/** Pay every reached, unpaid tier (of one track, or all). The caller adds `coins` to save.coins. */
export function claimMastery(state: MasteryState, track?: MasteryTrack): { coins: number; tiers: { track: MasteryTrack; tier: number }[] } {
  let coins = 0;
  const tiers: { track: MasteryTrack; tier: number }[] = [];
  for (const k of track ? [track] : MASTERY_TRACKS) {
    const reached = masteryTier(k, state.counts[k]);
    for (let t = state.claimed[k] + 1; t <= reached; t++) {
      coins += tierReward(k, t).coins;
      tiers.push({ track: k, tier: t });
    }
    state.claimed[k] = Math.max(state.claimed[k], reached);
  }
  return { coins, tiers };
}

/** Tiers reached but not paid, across all tracks. */
export function masteryPending(state: MasteryState): number {
  return MASTERY_TRACKS.reduce((n, k) => n + Math.max(0, masteryTier(k, state.counts[k]) - state.claimed[k]), 0);
}

/**
 * The nearest badge tier (the smallest share of its step still to go), for the main menu's level badge:
 * "2 MORE GOALS FOR FINISHER II". Null once every track is at tier V.
 */
export function nextBadgeGoal(state: MasteryState): { track: MasteryTrack; tier: number; left: number; text: string } | null {
  let best: { track: MasteryTrack; tier: number; left: number; text: string } | null = null;
  let bestShare = Infinity;
  for (const k of MASTERY_TRACKS) {
    const p = trackProgress(state, k);
    if (p.next === null) continue;
    const left = p.next - p.count;
    const share = left / (p.next - p.from);
    if (share < bestShare) {
      bestShare = share;
      const unit = TRACK_INFO[k].unit;
      const what = left === 1 ? unit.replace(/S$/, '') : unit;
      best = { track: k, tier: p.tier + 1, left, text: `${left} MORE ${what} FOR ${TRACK_INFO[k].name} ${TIER_NAMES[p.tier]}` };
    }
  }
  return best;
}

// ------------------------------------------------------------------ titles (every system's)

export interface EarnedTitle {
  title: string;
  /** Where it came from: "FINISHER III", "CLUB RUN", "SEASON". */
  from: string;
}

/** Every title the player has earned, badge tiers first (by track), then Club Run milestones, then seasons. */
export function earnedTitles(save: Pick<SaveData, 'mastery' | 'run' | 'season'>): EarnedTitle[] {
  const out: EarnedTitle[] = [];
  const m = save.mastery;
  if (m) {
    for (const k of MASTERY_TRACKS) {
      const tier = masteryTier(k, m.counts[k]);
      for (let t = 1; t <= tier; t++) out.push({ title: MASTERY_TITLES[k][t - 1], from: `${TRACK_INFO[k].name} ${TIER_NAMES[t - 1]}` });
    }
  }
  if (save.run) for (const title of runTitles(save.run)) out.push({ title, from: 'CLUB RUN' });
  if (save.season) for (const title of seasonTitles(save.season)) out.push({ title, from: 'SEASON' });
  return out;
}

/** The title the player wears, if it's one they've earned (else null: show the level title). */
export function wornTitle(save: Pick<SaveData, 'mastery' | 'run' | 'season'>): string | null {
  const t = save.mastery?.title;
  if (!t) return null;
  return earnedTitles(save).some((e) => e.title === t) ? t : null;
}

/** Wear an earned title ('' takes it off). Returns false for a title that isn't earned. */
export function wearTitle(save: Pick<SaveData, 'mastery' | 'run' | 'season'>, title: string): boolean {
  if (!save.mastery) return false;
  if (title && !earnedTitles(save).some((e) => e.title === title)) return false;
  save.mastery.title = title;
  return true;
}

// ------------------------------------------------------------------ for the menu and the BADGES screen

/** Everything waiting to be claimed on the BADGES screen (badge tiers, season tiers, carried season coins). */
export function badgePending(save: Pick<SaveData, 'mastery' | 'season'>): number {
  return (save.mastery ? masteryPending(save.mastery) : 0) + (save.season ? seasonPending(save.season) : 0);
}

/** CLAIM ALL: every badge tier and season tier waiting, paid into save.coins. Returns the coins. */
export function claimAll(save: Pick<SaveData, 'coins' | 'mastery' | 'season'>): number {
  let coins = 0;
  if (save.mastery) coins += claimMastery(save.mastery).coins;
  if (save.season) coins += claimAllSeason(save.season);
  save.coins += coins;
  return coins;
}

/** The save's mastery state, created if missing (a brand-new save from defaultSave() has none until it's reloaded). */
export function masteryOf(save: { mastery?: MasteryState }): MasteryState {
  if (!save.mastery) save.mastery = defaultMastery();
  return save.mastery;
}

/**
 * One call for main.ts's full time: the match's XP into the season track and its numbers into the badge tracks.
 * Returns what to show (tier-ups; the coins wait on the BADGES screen). The caller persists.
 */
export function recordMatchMeta(
  save: { mastery?: MasteryState; season?: SeasonState },
  m: MasteryMatch,
  xp: number,
  now: Date = new Date(),
): { badgeUps: MasteryTierUp[]; seasonUps: number[] } {
  return { badgeUps: advanceMastery(masteryOf(save), m), seasonUps: seasonAdvance(seasonOf(save, now), xp, now) };
}
