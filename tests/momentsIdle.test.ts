import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { MOMENTS } from '../src/meta/moments';
import { DT, HALF_W } from '../src/sim/constants';
import { EMPTY_PAD, HUMAN_RESTART_WINDOW, Match, type Pad } from '../src/sim/match';
import { applyScenario, judgeScenario, type FullScenarioSpec, type ScenarioOutcome } from '../src/sim/scenario';
import type { ScenarioSpec } from '../src/sim/types';

/**
 * A Football Moment is the human's to win. Left alone (no stick, no button), the AI and the automatic restarts
 * used to complete FIRST TOUCH most of the time with three stars: a defender fouled the idle striker in the box
 * and the penalty went on its own after HUMAN_RESTART_WINDOW s.
 */

const LEVEL = [0.6, 1.8, 3, 4];

function setUp(spec: ScenarioSpec, seed: number, difficulty = 1.8, humanSide: 0 | -1 = 0): Match {
  const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 600, difficulty, humanSide, seed, mode: spec.mode ?? 'classic' });
  applyScenario(m, spec);
  return m;
}

/** Steps with `pad` (the session's goal handling) until the judge speaks or `maxS` of sim time pass. */
function run(m: Match, spec: ScenarioSpec, maxS: number, pad: (i: number) => Pad = () => EMPTY_PAD): ScenarioOutcome | null {
  for (let i = 0; i < maxS * 60; i++) {
    m.step(DT, pad(i));
    m.drainEvents();
    const o = judgeScenario(m, spec);
    if (o) return o;
    if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
  }
  return null;
}

/** A bare spec: everyone parked along the touchlines, the ball at the centre spot. */
const parked = (over: Partial<FullScenarioSpec>): FullScenarioSpec => ({
  id: 'parked', title: 'PARKED', brief: '', clock: 0, seconds: 10, score: [0, 0], humanSide: 0, goal: 'score', stars: [0, 4, 7],
  players: Array.from({ length: 22 }, (_, i) => ({ side: (i < 11 ? 0 : 1) as 0 | 1, slot: i % 11, x: -44 + (i % 11) * 8, z: i < 11 ? -HALF_W + 1 : HALF_W - 1 })),
  ball: { x: 0, z: 0 },
  owner: null,
  ...over,
});

describe('a moment needs the human', () => {
  it('every moment, left completely alone, is never won (and never starred) over several seeds', () => {
    const wins: string[] = [];
    for (const mo of MOMENTS) {
      for (const seed of [3, 17, 29, 41]) {
        const m = setUp(mo.spec, seed, LEVEL[mo.difficulty] ?? 1.8);
        const o = run(m, mo.spec, mo.spec.seconds + 25);
        if (o?.won || (o?.stars ?? 0) > 0) wins.push(`${mo.id} seed ${seed}: ${JSON.stringify(o)} ${m.score.join('-')}`);
      }
    }
    expect(wins).toEqual([]);
  }, 600_000);

  it('the judge: a goal for his side, or a hold-out to time-up, with no input from him is not a win', () => {
    const spec = parked({});
    const m = setUp(spec, 1);
    for (let i = 0; i < 60; i++) {
      m.clock += DT;
      expect(judgeScenario(m, spec)).toBeNull();
    }
    m.score[0]++;
    expect(judgeScenario(m, spec)).toEqual({ won: false, stars: 0, secondsLeft: 9 });

    const hold = parked({ goal: 'no-concede', score: [1, 0], stars: [0, 30, 50], seconds: 2 });
    const m2 = setUp(hold, 2);
    let o: ScenarioOutcome | null = null;
    for (let i = 0; i < 200 && !o; i++) {
      m2.clock += DT;
      o = judgeScenario(m2, hold);
    }
    expect(o).toEqual({ won: false, stars: 0, secondsLeft: 0 });
  });

  it('the judge: one stick push or button anywhere in the moment is enough (the same goal then wins)', () => {
    const spec = parked({});
    const m = setUp(spec, 1);
    m.ctl[0].prev = { ...EMPTY_PAD, shoot: true };
    judgeScenario(m, spec);
    m.ctl[0].prev = { ...EMPTY_PAD };
    for (let i = 0; i < 60; i++) {
      m.clock += DT;
      judgeScenario(m, spec);
    }
    m.score[0]++;
    const o = judgeScenario(m, spec)!;
    expect(o.won).toBe(true);
    expect(o.stars).toBe(3);
    // A tiny stick drift is not input.
    const m2 = setUp(spec, 1);
    m2.ctl[0].prev = { ...EMPTY_PAD, mx: 0.1, mz: 0.1 };
    judgeScenario(m2, spec);
    m2.score[0]++;
    expect(judgeScenario(m2, spec)?.won).toBe(false);
  });

  it('a moment with no human side (AI on both) is judged as before', () => {
    const spec = parked({});
    const m = setUp(spec, 1, 1.8, -1);
    judgeScenario(m, spec);
    m.score[0]++;
    expect(judgeScenario(m, spec)?.won).toBe(true);
  });

  it("a moment's penalty waits for the human's kick; in a match it still goes on its own (no stalled restart)", () => {
    const spec = parked({ restart: 'penalty', seconds: 20 });
    const waited = setUp(spec, 5);
    for (let i = 0; i < (HUMAN_RESTART_WINDOW + 4) * 60; i++) {
      waited.step(DT, EMPTY_PAD);
      waited.drainEvents();
    }
    expect(waited.phase).toBe('restart');
    expect(waited.restart?.kind).toBe('penalty');
    expect(waited.restart?.side).toBe(0);
    // His press takes it (PASS rolls it along the aim).
    let live = false;
    for (let i = 0; i < 120 && !live; i++) {
      waited.step(DT, i < 3 ? { ...EMPTY_PAD, pass: true } : EMPTY_PAD);
      waited.drainEvents();
      live = waited.phase !== 'restart';
    }
    expect(live).toBe(true);

    // The match's AFK safety is untouched: the same penalty outside a moment goes on its own.
    const match = setUp(spec, 5);
    match.humanPenaltyWaits = false;
    let taken = false;
    for (let i = 0; i < (HUMAN_RESTART_WINDOW + 4) * 60 && !taken; i++) {
      match.step(DT, EMPTY_PAD);
      match.drainEvents();
      taken = match.phase !== 'restart' && match.phase !== 'out';
    }
    expect(taken).toBe(true);
    expect(new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 60, difficulty: 1.8, humanSide: 0 }).humanPenaltyWaits).toBe(false);
  });
});
