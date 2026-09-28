/**
 * Dynamic difficulty: a hidden ease (MatchConfig.assist, 0..1) that makes the AI press, tackle and finish a
 * little softer against the human side. Nothing on screen says it is on (the one visible thing is a quick-match
 * "Try EASY?" line after three defeats in a row). Pure rules over the save's `dda` blob; main.ts asks for the
 * ease when a match starts and records the result at full time (tests/onboarding.test.ts covers them).
 *
 *  - The first DDA.firstMatches real matches of a save: DDA.first.
 *  - Career: DDA.streak defeats in a row, then DDA.career on every career match until a win.
 *  - Quick match / PLAY NOW: DDA.streak defeats in a row at one difficulty, then DDA.quick at that difficulty
 *    until a win there (and the full-time screen suggests EASY).
 *  - A draw breaks a run that hasn't reached the streak yet; once the ease is on, only a win turns it off.
 *  - Moments, the basics, the cup and Club Run have no loss-streak ease (a request can still set its own).
 */
import type { MatchKind } from '../app';

export const DDA = { firstMatches: 2, first: 0.5, career: 0.35, quick: 0.25, streak: 3 } as const;

export interface DdaState {
  /** Career defeats in a row (kept past the streak until a win). */
  careerLosses: number;
  /** Quick-match defeats in a row, per difficulty (0 easy .. 3 legend). */
  quickLosses: [number, number, number, number];
}

export function defaultDda(): DdaState {
  return { careerLosses: 0, quickLosses: [0, 0, 0, 0] };
}

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

export function normalizeDda(raw: unknown): DdaState {
  if (!raw || typeof raw !== 'object') return defaultDda();
  const r = raw as Partial<DdaState>;
  const q = Array.isArray(r.quickLosses) ? r.quickLosses : [];
  return { careerLosses: n(r.careerLosses), quickLosses: [n(q[0]), n(q[1]), n(q[2]), n(q[3])] };
}

const quickish = (k: MatchKind | undefined): boolean => k === 'quick' || k === 'playnow';
const diffIdx = (d: number): 0 | 1 | 2 | 3 => Math.max(0, Math.min(3, Math.round(d) || 0)) as 0 | 1 | 2 | 3;

/** The ease for a match about to start. `played` = real matches finished on this save so far. */
export function ddaAssist(d: DdaState, played: number, kind: MatchKind | undefined, difficulty: number): number {
  if (kind === 'moment' || kind === 'basics') return 0;
  if (played < DDA.firstMatches) return DDA.first;
  if (kind === 'career' && d.careerLosses >= DDA.streak) return DDA.career;
  if (quickish(kind) && d.quickLosses[diffIdx(difficulty)] >= DDA.streak) return DDA.quick;
  return 0;
}

export type Outcome = 'win' | 'draw' | 'loss';

function step(run: number, o: Outcome): number {
  if (o === 'win') return 0;
  if (o === 'loss') return run + 1;
  return run >= DDA.streak ? run : 0;
}

/** Count a finished match towards the loss streaks. */
export function ddaRecord(d: DdaState, kind: MatchKind | undefined, difficulty: number, o: Outcome): void {
  if (kind === 'career') d.careerLosses = step(d.careerLosses, o);
  else if (quickish(kind)) {
    const i = diffIdx(difficulty);
    d.quickLosses[i] = step(d.quickLosses[i], o);
  }
}

/** After recording: should the quick-match full-time screen suggest EASY? (Only on a defeat above Easy.) */
export function suggestEasy(d: DdaState, kind: MatchKind | undefined, difficulty: number, o: Outcome): boolean {
  return quickish(kind) && o === 'loss' && diffIdx(difficulty) > 0 && d.quickLosses[diffIdx(difficulty)] >= DDA.streak;
}
