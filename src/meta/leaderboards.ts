/**
 * Game Center leaderboards (the iPhone / iPad app: platform/gameCenter.ts submits them). Pure, like
 * meta/achievements.ts: every score is read straight off the save, so a player who played before the app had
 * leaderboards goes straight onto them, and a reinstall submits nothing Game Center doesn't already keep (each
 * board keeps a player's best). Integer scores, higher is better.
 *
 * The ids must match App Store Connect (Features, Game Center, Leaderboards) exactly. Never rename or reuse an id
 * once it is live.
 *
 * The season board is this month's season XP (meta/season.ts). Its score is offered only while the save's season
 * is the current month on the leaderboards' clock (UTC, the clock App Store Connect runs recurring boards on), so
 * a finished season's XP is never sent once the next month has begun, and it is remembered per season, so each
 * new season submits from its first XP. (Game Center can't restart a board on the 1st of every month: a recurring
 * board repeats every 30 days at most. docs/APP_STORE.md says how the board is set up.)
 */
import type { SaveData } from '../core/save';

export interface Leaderboard {
  id: string;
  /** Game Center's name for it (the App Store Connect localization). */
  title: string;
  /** What ranks you (the localization's description). */
  how: string;
  /** Score suffix, singular and plural (" goal", " goals"). */
  unit: readonly [string, string];
  /** True for a score that belongs to one season: it is offered only during that season, cached per season. */
  seasonal?: boolean;
  /** The score, a whole number (0 = nothing to submit). */
  value(save: SaveData, now: Date): number;
}

/** A score to submit. `period` is the season it belongs to (seasonal boards only). */
export interface LeaderboardScore {
  id: string;
  value: number;
  period?: string;
}

/** The month on the leaderboards' clock, as a season id ("2026-10"): UTC, the clock App Store Connect uses. */
export function leaderboardMonth(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

const whole = (v: unknown): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** This season's XP, while the save's season is the current month; 0 otherwise. */
function seasonXp(save: SaveData, now: Date): number {
  const s = save.season;
  return s && s.id === leaderboardMonth(now) ? whole(s.xp) : 0;
}

export const LEADERBOARDS: readonly Leaderboard[] = [
  { id: 'bl.lb.goals', title: 'Goals Scored', how: 'Every goal your team has scored.', unit: [' goal', ' goals'], value: (s) => whole(s.record.goalsFor) },
  { id: 'bl.lb.wins', title: 'Matches Won', how: 'Every match you have won.', unit: [' win', ' wins'], value: (s) => whole(s.record.won) },
  { id: 'bl.lb.streak', title: 'Best Win Streak', how: 'Your most wins in a row.', unit: [' win', ' wins'], value: (s) => whole(s.progress.bestStreak) },
  { id: 'bl.lb.season', title: 'Best Season', how: 'Most XP earned in one monthly season.', unit: [' XP', ' XP'], seasonal: true, value: seasonXp },
];

/** Every board the save has a score on (above 0), with the season for the seasonal one. */
export function leaderboardScores(save: SaveData, now: Date = new Date()): LeaderboardScore[] {
  const out: LeaderboardScore[] = [];
  for (const b of LEADERBOARDS) {
    const value = whole(b.value(save, now));
    if (value <= 0) continue;
    out.push(b.seasonal && save.season ? { id: b.id, value, period: save.season.id } : { id: b.id, value });
  }
  return out;
}

/** Where a submitted score is remembered: the board id, plus the season for a seasonal board ("bl.lb.season@2026-10"). */
export function scoreKey(s: Pick<LeaderboardScore, 'id' | 'period'>): string {
  return s.period ? `${s.id}@${s.period}` : s.id;
}
