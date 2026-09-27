/**
 * Club Run: up to RUN_ROUNDS short matches against a ladder of stronger clubs; a loss ends the run, a draw goes
 * to penalties, and each win picks one of three perks for the rest of the run (docs/DESIGN_REVIEW.md).
 * Skeleton: the RETENTION engineer fills it in; the save and the UI wire against these names.
 */
export const RUN_ROUNDS = 7;
export type RunPerkId = 'powerStart' | 'headStart' | 'weakerNext' | 'goldenFirst' | 'xpBoost' | 'keeperBoost';

export interface RunState {
  /** A run in progress (round reached so far, perks held, the club ladder by preset index). */
  active: boolean;
  round: number;
  perks: RunPerkId[];
  ladder: number[];
  /** Best round ever reached, runs started, full clears, milestone rounds already rewarded. */
  best: number;
  runs: number;
  cleared: number;
  milestones: number[];
}

export function defaultRun(): RunState {
  return { active: false, round: 0, perks: [], ladder: [], best: 0, runs: 0, cleared: 0, milestones: [] };
}

export function normalizeRun(raw: unknown): RunState {
  const d = defaultRun();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<RunState>;
  return {
    active: r.active === true,
    round: Number.isFinite(r.round) ? Math.max(0, Math.floor(r.round as number)) : 0,
    perks: Array.isArray(r.perks) ? (r.perks.filter((x) => typeof x === 'string') as RunPerkId[]) : [],
    ladder: Array.isArray(r.ladder) ? r.ladder.filter((x) => Number.isInteger(x)) : [],
    best: Number.isFinite(r.best) ? Math.max(0, Math.floor(r.best as number)) : 0,
    runs: Number.isFinite(r.runs) ? Math.max(0, Math.floor(r.runs as number)) : 0,
    cleared: Number.isFinite(r.cleared) ? Math.max(0, Math.floor(r.cleared as number)) : 0,
    milestones: Array.isArray(r.milestones) ? r.milestones.filter((x) => Number.isInteger(x)) : [],
  };
}
