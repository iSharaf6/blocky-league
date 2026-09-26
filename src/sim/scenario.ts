import type { Match } from './match';
import type { ScenarioSpec } from './types';

/** How a Football Moment ended (stars 0 = failed). */
export interface ScenarioOutcome {
  won: boolean;
  stars: 0 | 1 | 2 | 3;
  /** Seconds of the moment left when it ended (0 when time ran out). */
  secondsLeft: number;
}

/** Set the match up for the moment (score, clock, placements, ball, restart). Skeleton: the Moments engineer fills it in. */
export function applyScenario(_m: Match, _spec: ScenarioSpec): void {}

/**
 * Judge the moment each step: null while it's still on, else the outcome (the session then ends the match and
 * hands the outcome to the full-time screen). Skeleton: the Moments engineer fills it in.
 */
export function judgeScenario(_m: Match, _spec: ScenarioSpec): ScenarioOutcome | null {
  return null;
}
