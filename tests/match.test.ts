import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT, HALF_L, HALF_W } from '../src/sim/constants';
import { EMPTY_PAD, Match } from '../src/sim/match';

function playFull(seed: number, difficulty = 2, homeIdx = 5, awayIdx = 6) {
  const m = new Match({
    home: makeTeam(PRESET_CLUBS[homeIdx]),
    away: makeTeam(PRESET_CLUBS[awayIdx]),
    halfLength: 150,
    difficulty,
    humanSide: -1,
    seed,
  });
  let steps = 0;
  const kinds: Record<string, number> = {};
  let maxStall = 0;
  let stall = 0;
  let lastX = 0;
  while (m.phase !== 'fulltime' && steps < 60 * 60 * 12) {
    m.step(DT, EMPTY_PAD);
    steps++;
    for (const e of m.drainEvents()) kinds[e.type] = (kinds[e.type] ?? 0) + 1;
    if (m.phase === 'halftime') m.continueSecondHalf();
    if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
    for (const p of m.players) {
      if (!Number.isFinite(p.pos.x) || !Number.isFinite(p.pos.z)) throw new Error('NaN player');
    }
    if (!Number.isFinite(m.ball.pos.x)) throw new Error('NaN ball');
    if (Math.abs(m.ball.pos.x - lastX) < 0.01 && m.phase === 'play') stall++;
    else stall = 0;
    maxStall = Math.max(maxStall, stall);
    lastX = m.ball.pos.x;
  }
  return { m, steps, kinds, maxStall };
}

describe('match simulation', () => {
  it('plays a full AI vs AI match to the final whistle', () => {
    const { m, kinds, maxStall } = playFull(7);
    // eslint-disable-next-line no-console
    console.log('score', m.score, 'stats', JSON.stringify(m.stats), 'events', JSON.stringify(kinds), 'stall', maxStall);
    expect(m.phase).toBe('fulltime');
    expect(m.stats.shots[0] + m.stats.shots[1]).toBeGreaterThanOrEqual(6);
    // Purposeful passing, not midfield ping-pong (the old sim made ~340 a match).
    const passes = m.stats.passes[0] + m.stats.passes[1];
    expect(passes).toBeGreaterThan(60);
    expect(passes).toBeLessThan(300);
    // Pressing that challenges without suffocating (the old sim made ~150 attempts).
    expect(kinds.tackle ?? 0).toBeGreaterThan(10);
    expect(kinds.tackle ?? 0).toBeLessThan(120);
    // The ball never freezes in open play for 5 seconds.
    expect(maxStall).toBeLessThan(60 * 5);
  }, 30_000);

  it('keeps players and ball within the stadium', () => {
    const { m } = playFull(21);
    for (const p of m.players) {
      expect(Math.abs(p.pos.x)).toBeLessThan(HALF_L + 6);
      expect(Math.abs(p.pos.z)).toBeLessThan(HALF_W + 5);
    }
  }, 30_000);

  it('produces goals over several matches', () => {
    let goals = 0;
    const agg: Record<string, number> = {};
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const r = playFull(seed * 97);
      goals += r.m.goals.length;
      for (const [k, v] of Object.entries(r.kinds)) agg[k] = (agg[k] ?? 0) + v;
      agg.shots = (agg.shots ?? 0) + r.m.stats.shots[0] + r.m.stats.shots[1];
      agg.passes = (agg.passes ?? 0) + r.m.stats.passes[0] + r.m.stats.passes[1];
    }
    // eslint-disable-next-line no-console
    console.log('goals over 6 matches', goals, JSON.stringify(agg));
    // ~2.5-4.5 a match is the target band (see tests/metrics.test.ts for the full picture).
    expect(goals).toBeGreaterThanOrEqual(10);
    expect(agg.shots).toBeGreaterThanOrEqual(60);
    expect(agg.passes).toBeLessThan(1500);
  }, 60_000);
});
