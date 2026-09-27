/**
 * The first-visit campaign: LEARN THE BASICS (three staged steps, meta/moments.ts BASICS), then the first real
 * match, and the player's first goal unlocks CAREER, MOMENTS, CLUB RUN and BLITZ. Pure rules over the save's
 * `onboarding` blob (main.ts and the main menu read them; tests/onboarding.test.ts covers them).
 *
 * Old saves: a save from before the campaign existed that has played a match gets everything at once (its
 * player is no beginner). A new save keeps the locks until a goal in any real match (quick, PLAY NOW, career,
 * cup, Club Run or a moment); goals in the basics steps don't count, they are the lesson.
 */
import type { MatchKind } from '../app';

/** Steps in LEARN THE BASICS. */
export const BASICS_STEPS = 3;

/** The modes that wait for the first goal. */
export type LockedFeature = 'career' | 'moments' | 'run' | 'blitz';
export const LOCKED_FEATURES: readonly LockedFeature[] = ['career', 'moments', 'run', 'blitz'];

export interface OnboardingState {
  /** Basics steps completed (0..BASICS_STEPS). */
  basics: number;
  /** The first goal in a real match has been scored: the locked modes are open. */
  firstGoal: boolean;
  /** The UNLOCKED card has been shown once. */
  unlockSeen: boolean;
}

export function defaultOnboarding(): OnboardingState {
  return { basics: 0, firstGoal: false, unlockSeen: false };
}

/** Everything done: the state an existing player's save migrates to. */
export function veteranOnboarding(): OnboardingState {
  return { basics: BASICS_STEPS, firstGoal: true, unlockSeen: true };
}

/**
 * A stored blob made whole. No blob (a save from before the campaign): a save that has played a match (or
 * scored) is a veteran with everything open; otherwise the campaign starts.
 */
export function normalizeOnboarding(raw: unknown, record?: { played?: number; goalsFor?: number } | null): OnboardingState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    const played = Number(record?.played) || 0;
    const scored = Number(record?.goalsFor) || 0;
    return played > 0 || scored > 0 ? veteranOnboarding() : defaultOnboarding();
  }
  const r = raw as Partial<OnboardingState>;
  const basics = typeof r.basics === 'number' && Number.isFinite(r.basics) ? Math.max(0, Math.min(BASICS_STEPS, Math.floor(r.basics))) : 0;
  return { basics, firstGoal: r.firstGoal === true, unlockSeen: r.unlockSeen === true };
}

export function basicsDone(o: OnboardingState): boolean {
  return o.basics >= BASICS_STEPS;
}

/** Is a mode open? (CAREER, MOMENTS, CLUB RUN and BLITZ wait for the first goal; everything else is always open.) */
export function featureOpen(o: OnboardingState, _f: LockedFeature): boolean {
  return o.firstGoal;
}

/** What the big first tile of the main menu does: the next basics step, the first real match, or PLAY NOW. */
export type Hero = { kind: 'basics'; step: number } | { kind: 'first' } | { kind: 'play' };

export function heroOf(o: OnboardingState, played: number): Hero {
  if (played > 0 || o.firstGoal) return { kind: 'play' };
  if (!basicsDone(o)) return { kind: 'basics', step: o.basics };
  return { kind: 'first' };
}

/**
 * A portal build's first visit: TAP TO PLAY goes straight into the first basics step (one click to gameplay),
 * never through the menu. Returning players (or anyone past step one) get the menu.
 */
export function straightToBasics(o: OnboardingState, played: number, portal: boolean): boolean {
  return portal && played === 0 && o.basics === 0 && !o.firstGoal;
}

/** A basics step was completed: on to the next (never back). Returns the step to play next, or -1 when all are done. */
export function completeBasics(o: OnboardingState, step: number): number {
  o.basics = Math.max(o.basics, Math.min(BASICS_STEPS, step + 1));
  return basicsDone(o) ? -1 : o.basics;
}

/**
 * A match or moment finished with the human side scoring `goals`: the first real goal opens the locked modes.
 * Returns true when this result is the one that unlocked them (the UNLOCKED card shows). Basics goals don't count.
 */
export function noteGoals(o: OnboardingState, kind: MatchKind | undefined, goals: number): boolean {
  if (o.firstGoal || kind === 'basics' || goals <= 0) return false;
  o.firstGoal = true;
  return true;
}
