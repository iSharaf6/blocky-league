import { describe, expect, it } from 'vitest';
import { createClub, lineupIssues, trainingCost } from '../src/meta/career';
import { BENCH_SIZE, autoLineup, bestStat, suggestSubs, trainBest, type OnPitch } from '../src/meta/squad';
import { FORMATIONS, FORMATION_IDS } from '../src/sim/formations';
import { overall, type PlayerDef, type PlayerStats, type Role } from '../src/sim/types';

const base: PlayerStats = { pace: 50, shooting: 50, passing: 50, dribbling: 50, defending: 50, keeping: 20, stamina: 50 };

let n = 0;
function pl(role: Role, s: Partial<PlayerStats> = {}, name = `P${n}`): PlayerDef {
  n++;
  return { id: `p${n}`, name, number: n, role, stats: { ...base, ...(role === 'GK' ? { keeping: 60 } : {}), ...s }, look: {} as PlayerDef['look'] };
}

const kit = { shirt: 0xff0000, shirt2: 0xffffff, pattern: 'plain' as const, shorts: 0xffffff, socks: 0xff0000, gk: 0x00ff00 };

describe('AUTO PICK (autoLineup)', () => {
  it('fills every formation with matching roles and a keeper in goal, keeping the whole squad', () => {
    const club = createClub({ name: 'Test FC', short: 'TST', kit, formation: '4-4-2' }, 7);
    for (const f of FORMATION_IDS) {
      club.formation = f;
      club.squad = autoLineup(club.squad, f);
      expect(club.squad).toHaveLength(16);
      expect(new Set(club.squad.map((p) => p.id)).size).toBe(16);
      expect(club.squad[0].role).toBe('GK');
      // The starting squad has 5 DF, 6 MF, 4 FW: every shape here fits without anyone out of position.
      expect(lineupIssues(club)).toEqual([]);
    }
  });

  it('starts the best players of each role', () => {
    const weakDf = pl('DF', { defending: 30 });
    const squad = [
      pl('GK'), weakDf, ...[1, 2, 3, 4].map(() => pl('DF', { defending: 70 })),
      ...[1, 2, 3, 4].map(() => pl('MF')), ...[1, 2].map(() => pl('FW')),
    ];
    const out = autoLineup(squad, '4-4-2');
    expect(out.slice(0, 11)).not.toContain(weakDf);
    expect(out.slice(11)).toContain(weakDf);
  });

  it('puts the quick defenders at full back and the best defender in the middle', () => {
    const quick1 = pl('DF', { pace: 90, defending: 55 }, 'Quick One');
    const quick2 = pl('DF', { pace: 88, defending: 55 }, 'Quick Two');
    const wall1 = pl('DF', { pace: 40, defending: 80 }, 'Wall One');
    const wall2 = pl('DF', { pace: 42, defending: 78 }, 'Wall Two');
    const squad = [wall1, quick1, pl('GK'), wall2, quick2, ...[1, 2, 3, 4].map(() => pl('MF')), pl('FW'), pl('FW')];
    const out = autoLineup(squad, '4-4-2');
    const at = (label: string) => FORMATIONS['4-4-2'].map((s, i) => (s.label === label ? out[i] : null)).filter(Boolean);
    expect(at('LB').concat(at('RB'))).toEqual(expect.arrayContaining([quick1, quick2]));
    expect(at('CB')).toEqual(expect.arrayContaining([wall1, wall2]));
  });

  it('fills a role short of men with whoever plays it best, never the spare keeper', () => {
    const spareGk = pl('GK', { keeping: 70 });
    const dfLike = pl('MF', { defending: 85, passing: 40 }, 'Destroyer');
    const squad = [
      pl('GK', { keeping: 80 }), spareGk, pl('DF'), pl('DF'), pl('DF'),
      dfLike, pl('MF'), pl('MF'), pl('MF'), pl('MF', { passing: 70 }), pl('FW'), pl('FW'), pl('MF'), pl('FW'),
    ];
    const out = autoLineup(squad, '4-4-2');
    // Four DF slots, three DFs: the defensive midfielder drops in, the spare keeper sits on the bench.
    const dfSlots = FORMATIONS['4-4-2'].map((s, i) => (s.role === 'DF' ? out[i] : null));
    expect(dfSlots).toContain(dfLike);
    expect(out.slice(1, 11)).not.toContain(spareGk);
    expect(out.slice(11, 11 + BENCH_SIZE)).toContain(spareGk);
  });

  it('puts the best hands in goal when there is no keeper', () => {
    const hands = pl('DF', { keeping: 70 }, 'Hands');
    const squad = [hands, ...[1, 2, 3, 4].map(() => pl('DF')), ...[1, 2, 3, 4, 5].map(() => pl('MF')), pl('FW'), pl('FW'), pl('FW')];
    expect(autoLineup(squad, '4-4-2')[0]).toBe(hands);
  });

  it('benches a spare keeper and cover for every role before the extra quality', () => {
    const squad = [
      pl('GK'), pl('GK', { keeping: 40 }), ...[1, 2, 3, 4, 5].map(() => pl('DF')),
      ...[1, 2, 3, 4, 5, 6, 7, 8].map(() => pl('MF', { passing: 80 })), ...[1, 2, 3].map(() => pl('FW', { shooting: 20 })),
      ...[1, 2, 3, 4].map(() => pl('MF', { passing: 90 })),
    ];
    const out = autoLineup(squad, '4-4-2');
    const bench = out.slice(11, 11 + BENCH_SIZE);
    expect(bench).toHaveLength(BENCH_SIZE);
    for (const r of ['GK', 'DF', 'MF', 'FW'] as Role[]) expect(bench.some((p) => p.role === r)).toBe(true);
    // Bench and reserves read by role, then overall.
    const order = { GK: 0, DF: 1, MF: 2, FW: 3 };
    for (let i = 1; i < bench.length; i++) {
      const a = bench[i - 1];
      const b = bench[i];
      expect(order[a.role] < order[b.role] || (order[a.role] === order[b.role] && overall(a) >= overall(b))).toBe(true);
    }
  });
});

describe('TRAIN BEST', () => {
  it('trains the weakest starter (the cheapest session) in the stat his overall leans on most', () => {
    const club = createClub({ name: 'Test FC', short: 'TST', kit, formation: '4-4-2' }, 3);
    const pick = trainBest(club.squad)!;
    expect(pick.index).toBeLessThan(11);
    const xi = club.squad.slice(0, 11);
    expect(overall(club.squad[pick.index])).toBe(Math.min(...xi.map(overall)));
    expect(pick.cost).toBe(trainingCost(club.squad[pick.index]));
    const p = club.squad[pick.index];
    const gain = (k: keyof PlayerStats) => overall({ ...p, stats: { ...p.stats, [k]: p.stats[k] + 100 } }) - overall(p);
    expect(Math.max(...(Object.keys(p.stats) as (keyof PlayerStats)[]).map(gain))).toBe(gain(pick.stat));
  });

  it('skips maxed stats and maxed players', () => {
    const p = pl('FW', { shooting: 99 });
    expect(bestStat(p)).not.toBe('shooting');
    const maxed = pl('FW', { pace: 99, shooting: 99, passing: 99, dribbling: 99, defending: 99, keeping: 99, stamina: 99 });
    expect(bestStat(maxed)).toBeNull();
    const squad = [maxed, ...Array.from({ length: 10 }, () => pl('MF', { pace: 99, shooting: 99, passing: 99, dribbling: 99, defending: 99, keeping: 99, stamina: 99 })), pl('DF')];
    expect(trainBest(squad)?.index).toBe(11);
  });
});

describe('SUGGESTED SUBS', () => {
  const man = (slot: number, role: Role, stamina: number, extra: Partial<OnPitch> = {}): OnPitch => ({
    slot, role, stamina, booked: false, sentOff: false, keeper: slot === 0, ...extra,
  });

  it('takes off the most tired first for the best fresh player in his role', () => {
    const team = [man(0, 'GK', 0.1), man(1, 'DF', 0.45), man(5, 'MF', 0.3), man(9, 'FW', 0.9)];
    const okMf = pl('MF', { passing: 60 });
    const bestMf = pl('MF', { passing: 90 });
    const df = pl('DF');
    const plan = suggestSubs(team, [pl('GK'), okMf, df, bestMf], 5);
    expect(plan).toEqual([
      { slot: 5, onId: bestMf.id, reason: 'tired' },
      { slot: 1, onId: df.id, reason: 'tired' },
    ]);
  });

  it('then the booked, never the keeper, a man sent off or one who came on, within the subs left', () => {
    const team = [man(0, 'GK', 0.2), man(2, 'DF', 0.9, { booked: true }), man(3, 'DF', 0.2, { sentOff: true }), man(4, 'DF', 0.2, { cameOn: true }), man(6, 'MF', 0.4)];
    const bench = [pl('DF'), pl('MF'), pl('GK')];
    expect(suggestSubs(team, bench, 5).map((s) => [s.slot, s.reason])).toEqual([[6, 'tired'], [2, 'booked']]);
    expect(suggestSubs(team, bench, 1)).toHaveLength(1);
    expect(suggestSubs(team, bench, 0)).toEqual([]);
  });

  it('uses the best outfielder at the role when the bench has no like for like, and no one twice', () => {
    const team = [man(9, 'FW', 0.2), man(10, 'FW', 0.25)];
    const mfA = pl('MF', { shooting: 80, pace: 70 });
    const mfB = pl('MF', { shooting: 40 });
    const plan = suggestSubs(team, [pl('GK'), mfB, mfA], 5);
    expect(plan.map((s) => s.onId)).toEqual([mfA.id, mfB.id]);
  });
});
