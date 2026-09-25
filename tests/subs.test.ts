import { describe, expect, it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT } from '../src/sim/constants';
import { shapeTarget } from '../src/sim/ai';
import { EMPTY_PAD, Match } from '../src/sim/match';

function match(seed = 3) {
  return new Match({
    home: makeTeam(PRESET_CLUBS[4]),
    away: makeTeam(PRESET_CLUBS[5]),
    halfLength: 120,
    difficulty: 2,
    humanSide: -1,
    seed,
  });
}

describe('substitutions and mentality', () => {
  it('brings a bench player on with fresh legs, at most three times', () => {
    const m = match();
    const p = m.teamPlayers(0)[7];
    p.stamina = 0.3;
    const benchBefore = m.bench[0].length;
    const outfieldIdx = m.bench[0].findIndex((d) => d.role !== 'GK');
    expect(m.substitute(0, 7, outfieldIdx)).toBe(true);
    expect(p.stamina).toBe(1);
    expect(m.bench[0].length).toBe(benchBefore - 1);
    expect(m.subsUsed[0]).toBe(1);
    // Keepers only swap with keepers.
    const gk = m.bench[0].findIndex((d) => d.role === 'GK');
    expect(m.substitute(0, 3, gk)).toBe(false);
    expect(m.substitute(0, 2, m.bench[0].findIndex((d) => d.role !== 'GK'))).toBe(true);
    expect(m.substitute(0, 4, m.bench[0].findIndex((d) => d.role !== 'GK'))).toBe(true);
    expect(m.substitute(0, 5, m.bench[0].findIndex((d) => d.role !== 'GK'))).toBe(false);
  });

  it('attacking mentality raises the shape, defensive drops it', () => {
    const m = match();
    const df = m.teamPlayers(0)[2];
    const mf = m.teamPlayers(0)[6];
    const at = (ment: number, p: typeof df, attacking: boolean) => {
      m.mentality[0] = ment;
      return shapeTarget(m, p, attacking, 0, 0).x * m.attackDir(0);
    };
    expect(at(1, df, true)).toBeGreaterThan(at(-1, df, true));
    expect(at(1, mf, false)).toBeGreaterThanOrEqual(at(-1, mf, false));
  });

  it('mentality changes how often a side creates chances', () => {
    let shots = [0, 0];
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      for (const [k, ment] of [[0, -1], [1, 1]] as const) {
        const m = match(seed);
        m.mentality[0] = ment;
        for (let i = 0; i < 60 * 150; i++) {
          m.step(DT, EMPTY_PAD);
          m.drainEvents();
          if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
          if (m.phase === 'halftime') break;
        }
        shots[k] += m.stats.shots[0];
      }
    }
    // eslint-disable-next-line no-console
    console.log('shots defensive vs attacking', shots);
    expect(shots[1]).toBeGreaterThanOrEqual(shots[0]);
  });
});
