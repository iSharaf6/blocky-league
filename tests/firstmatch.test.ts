import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT } from '../src/sim/constants';
import { EMPTY_PAD, FIRST_MATCH_EASE, FIRST_MATCH_PATIENT, HUMAN_RESTART_WINDOW, Match } from '../src/sim/match';

/**
 * The player's very first match (MatchConfig.firstMatch, set by the UI on his first PLAY NOW): his side kicks off and
 * the kick-off waits for his button (no HUMAN_RESTART_WINDOW auto-fire); for the first minute of the first half the AI
 * presses him at ~60% of its usual aggression, and for the first half-minute it never shoots from open play.
 * A given penalty still gets taken after a generous preparation window: the live clock cannot run while it waits.
 */
function match(firstMatch: boolean, seed = 7): Match {
  return new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 120, difficulty: 1.8, humanSide: 0, seed, firstMatch });
}

type BeforeStep = { phase: Match['phase']; restart: Match['restart']; phaseT: number; clock: number; aiShots: number };

function run(m: Match, seconds: number, pad = EMPTY_PAD, afterStep?: (before: BeforeStep) => void): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const before = { phase: m.phase, restart: m.restart, phaseT: m.phaseT, clock: m.clock, aiShots: m.stats.shots[1] };
    m.step(DT, pad);
    m.drainEvents();
    afterStep?.(before);
    if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
  }
}

describe('the first match', () => {
  it('kicks off with the human and waits for his button: no input for 30 s, still the kick-off, 0-0', () => {
    for (const seed of [7, 8, 9]) {
      const m = match(true, seed);
      expect(m.restart?.kind).toBe('kickoff');
      expect(m.restart?.side).toBe(0);
      run(m, 30);
      expect(m.phase).toBe('kickoff');
      expect(m.score).toEqual([0, 0]);
      expect(m.clock).toBe(0);
    }
  });

  it('(any other match: the human kick-off goes on its own after HUMAN_RESTART_WINDOW)', () => {
    let human = 0;
    for (const seed of [7, 8, 9, 10, 11, 12]) {
      const m = match(false, seed);
      if (m.restart?.side !== 0) continue;
      human++;
      run(m, HUMAN_RESTART_WINDOW + 1.5);
      expect(m.phase).toBe('play');
    }
    expect(human).toBeGreaterThan(0);
  });

  it('a button starts it; the AI never shoots from open play during the first 30 live seconds, and does shoot later', () => {
    let aiShotsEarly = 0;
    let aiShotsLater = 0;
    for (const seed of [7, 8, 9, 10]) {
      const m = match(true, seed);
      m.step(DT, { ...EMPTY_PAD, pass: true });
      m.drainEvents();
      const observeShots = (before: BeforeStep) => {
        const shots = m.stats.shots[1] - before.aiShots;
        if (!shots) return;
        if (before.clock >= FIRST_MATCH_PATIENT) { aiShotsLater += shots; return; }
        // Penalties must eventually be taken even though their live clock is paused. Every early
        // shot therefore has to be that exact restart, after the keeper's full preparation window.
        if (before.phase === 'restart' && before.restart?.kind === 'penalty' && before.restart.side === 1) {
          expect(before.phaseT).toBeGreaterThanOrEqual(HUMAN_RESTART_WINDOW);
        } else aiShotsEarly += shots;
      };
      run(m, 1, EMPTY_PAD, observeShots);
      expect(m.phase).toBe('play');
      run(m, FIRST_MATCH_PATIENT - 1, EMPTY_PAD, observeShots);
      expect(m.score[1]).toBe(0);
      run(m, FIRST_MATCH_EASE + 60, EMPTY_PAD, observeShots);
    }
    expect(aiShotsEarly).toBe(0);
    // Four matches with no further human input still produce shots after the patient live-time window.
    expect(aiShotsLater).toBeGreaterThan(0);
  }, 60_000);
});
