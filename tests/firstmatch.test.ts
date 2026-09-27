import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT } from '../src/sim/constants';
import { EMPTY_PAD, FIRST_MATCH_EASE, FIRST_MATCH_PATIENT, HUMAN_RESTART_WINDOW, Match } from '../src/sim/match';

/**
 * The player's very first match (MatchConfig.firstMatch, set by the UI on his first PLAY NOW): his side kicks off and
 * the kick-off waits for his button (no HUMAN_RESTART_WINDOW auto-fire); for the first minute of the first half the AI
 * presses him at ~60% of its usual aggression, and for the first half-minute it never shoots.
 */
function match(firstMatch: boolean, seed = 7): Match {
  return new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 120, difficulty: 1.8, humanSide: 0, seed, firstMatch });
}

function run(m: Match, seconds: number, pad = EMPTY_PAD): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    m.step(DT, pad);
    m.drainEvents();
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

  it('a button starts it; then with no input the AI never shoots in the first 30 s, and does shoot after the first minute', () => {
    let aiShotsEarly = 0;
    let aiShotsLater = 0;
    for (const seed of [7, 8, 9, 10]) {
      const m = match(true, seed);
      m.step(DT, { ...EMPTY_PAD, pass: true });
      m.drainEvents();
      run(m, 1);
      expect(m.phase).toBe('play');
      run(m, FIRST_MATCH_PATIENT - 1);
      aiShotsEarly += m.stats.shots[1];
      expect(m.score[1]).toBe(0);
      run(m, FIRST_MATCH_EASE + 60);
      aiShotsLater += m.stats.shots[1];
    }
    expect(aiShotsEarly).toBe(0);
    // (Four matches, the human doing nothing: the AI is on his goal soon after the minute is up.)
    expect(aiShotsLater).toBeGreaterThan(0);
  }, 60_000);
});
