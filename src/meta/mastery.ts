/**
 * Mastery badges: five skill tracks, five tiers each, earned by doing the thing in any mode; every tier unlocks
 * something visible (docs/DESIGN_REVIEW.md). Skeleton: the RETENTION engineer fills it in.
 */
export const MASTERY_TRACKS = ['finisher', 'playmaker', 'wall', 'magician', 'keeper'] as const;
export type MasteryTrack = (typeof MASTERY_TRACKS)[number];

export interface MasteryState {
  counts: { [k in MasteryTrack]: number };
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

export function defaultMastery(): MasteryState {
  return { counts: { finisher: 0, playmaker: 0, wall: 0, magician: 0, keeper: 0 } };
}

export function normalizeMastery(raw: unknown): MasteryState {
  const d = defaultMastery();
  const c = raw && typeof raw === 'object' ? (raw as Partial<MasteryState>).counts : undefined;
  if (c && typeof c === 'object') {
    for (const k of MASTERY_TRACKS) {
      const v = (c as Partial<MasteryState['counts']>)[k];
      if (Number.isFinite(v)) d.counts[k] = Math.max(0, Math.floor(v as number));
    }
  }
  return d;
}

/** Add a match; returns the tier-ups it caused (skeleton: none yet). */
export function advanceMastery(_state: MasteryState, _m: MasteryMatch): { track: MasteryTrack; tier: number }[] {
  return [];
}
