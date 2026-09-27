/**
 * Season track: a free 30-tier ladder fed by XP, resetting monthly with a theme (docs/DESIGN_REVIEW.md).
 * Skeleton: the RETENTION engineer fills it in.
 */
export const SEASON_TIERS = 30;

export interface SeasonState {
  /** The season this progress belongs to ("2026-09"). */
  id: string;
  xp: number;
  claimed: number[];
}

export function seasonId(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function defaultSeason(now: Date = new Date()): SeasonState {
  return { id: seasonId(now), xp: 0, claimed: [] };
}

/** A save's season, rolled over to a fresh one when the month has changed. */
export function normalizeSeason(raw: unknown, now: Date = new Date()): SeasonState {
  const id = seasonId(now);
  if (!raw || typeof raw !== 'object') return defaultSeason(now);
  const r = raw as Partial<SeasonState>;
  if (r.id !== id) return defaultSeason(now);
  return {
    id,
    xp: Number.isFinite(r.xp) ? Math.max(0, Math.floor(r.xp as number)) : 0,
    claimed: Array.isArray(r.claimed) ? r.claimed.filter((x) => Number.isInteger(x)) : [],
  };
}

/** Add XP; returns the tiers newly reached (skeleton: none yet). */
export function seasonAdvance(_state: SeasonState, _xp: number): number[] {
  return [];
}
