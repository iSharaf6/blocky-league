/**
 * GEMS FROM THE CAREER (docs/ECONOMY.md, economy v3): the small steady gem income ROAD TO GLORY pays. Board
 * objectives met, legacy levels reached, league titles, promotions and cups won (meta/gems.ts GEM_REWARDS).
 *
 * It reads the career as it stands and pays what hasn't been paid: each thing pays once, by key, kept in the save
 * (SaveData.gems.claimed), so it can be called any number of times (the hub and the main menu both do) and a save
 * from before gems is paid for the trophies it already holds. Nothing is written to the career: the career's own
 * rules (meta/board.ts, legacy.ts, career.ts) stay untouched and the two can never fall out of step.
 * Pure, no DOM.
 */
import type { SaveData } from '../core/save';
import { ACHIEVEMENTS, achievementProgress } from './achievements';
import type { CareerState } from './career';
import { GEM_REWARDS, grantGemsOnce, type GemReward } from './gems';
import { legacyLevel } from './legacy';

export interface GemPayout {
  /** What it was for, in a few words ("OBJECTIVE DONE", "LEGACY LEVEL 3"). */
  what: string;
  gems: number;
}

/** Pay every career gem reward not yet paid. Returns what was paid now (usually nothing). */
export function syncCareerGems(save: Pick<SaveData, 'gems'>, state: CareerState | null | undefined): GemPayout[] {
  const out: GemPayout[] = [];
  if (!state?.club) return out;
  // (Keys carry the club's generation: a new club started as a legend plays season 1 again.)
  const gen = state.legacy?.gen ?? 0;
  const pay = (key: string, reward: GemReward, what: string): void => {
    const n = GEM_REWARDS[reward];
    if (grantGemsOnce(save, key, n, reward)) out.push({ what, gems: n });
  };
  const season = state.season;
  // The board's objectives this season, each as it is met.
  if (season && state.board?.season === season.number) {
    state.board.objectives.forEach((o, i) => {
      if (o.state === 'done') pay(`board:${gen}:${season.number}:${i}`, 'boardObjective', 'OBJECTIVE DONE');
    });
  }
  // Every legacy level reached (legacy outlives a club, so no generation in the key).
  const level = legacyLevel(state.legacy?.points ?? 0).level;
  for (let l = 1; l <= level; l++) pay(`legacy:${l}`, 'legacyLevel', `LEGACY LEVEL ${l}`);
  // Seasons finished: the title, promotion, the cups.
  for (const h of state.history ?? []) {
    const k = `${gen}:${h.season}`;
    if (h.position === 1) pay(`title:${k}`, 'title', 'LEAGUE CHAMPIONS');
    if (h.outcome === 'promoted') pay(`promo:${k}`, 'promotion', 'PROMOTED');
    if (h.cup === 3) pay(`cup:${k}`, 'cup', 'BLOCKY CUP WINNERS');
    if (h.continental === 3) pay(`cont:${k}`, 'continental', 'CONTINENTAL CUP WINNERS');
    if (h.world === 3) pay(`world:${k}`, 'world', 'WORLD CLUB CHAMPIONS');
  }
  // A cup won this season pays the day it is lifted (the same key the finished season uses: never twice).
  if (season) {
    const k = `${gen}:${season.number}`;
    if (season.cup?.status === 'won') pay(`cup:${k}`, 'cup', 'BLOCKY CUP WINNERS');
    if (season.continental?.status === 'won') pay(`cont:${k}`, 'continental', 'CONTINENTAL CUP WINNERS');
    if (season.world?.status === 'won') pay(`world:${k}`, 'world', 'WORLD CLUB CHAMPIONS');
  }
  return out;
}

/** Gems for an achievement worth `points` Game Center points: 5 for a 10 pointer, 10 for 30, 20 for 60. */
export function achievementGems(points: number): number {
  return Math.max(GEM_REWARDS.achievement, Math.round(points / 15) * 5);
}

/**
 * Gems for every achievement earned (meta/achievements.ts: read straight off the save, in every build, whether or
 * not Game Center is there), each paid once. Returns what was paid now.
 */
export function syncAchievementGems(save: SaveData): GemPayout[] {
  const out: GemPayout[] = [];
  const done = new Set(achievementProgress(save).filter((a) => a.percent >= 100).map((a) => a.id));
  for (const a of ACHIEVEMENTS) {
    if (!done.has(a.id)) continue;
    const n = achievementGems(a.points);
    if (grantGemsOnce(save, `ach:${a.id}`, n, 'achievement')) out.push({ what: a.title.toUpperCase(), gems: n });
  }
  return out;
}

/** The payouts as one line for a toast ("+10 GEMS: OBJECTIVE DONE, LEGACY LEVEL 2"). */
export function payoutText(list: readonly GemPayout[]): string {
  if (!list.length) return '';
  const total = list.reduce((n, p) => n + p.gems, 0);
  const what = [...new Set(list.map((p) => p.what))];
  return `+${total} GEMS: ${what.slice(0, 2).join(', ')}${what.length > 2 ? ` AND ${what.length - 2} MORE` : ''}`;
}

/**
 * What a season of the career pays in gems at most in division `division` (three objectives, the Blocky Cup, the
 * title and promotion): the pacing tables in docs/ECONOMY.md are built on it.
 */
export function seasonGemsMax(division: number): number {
  const top = division <= 1;
  return 3 * GEM_REWARDS.boardObjective + GEM_REWARDS.cup + GEM_REWARDS.title + (top ? GEM_REWARDS.continental : GEM_REWARDS.promotion);
}
