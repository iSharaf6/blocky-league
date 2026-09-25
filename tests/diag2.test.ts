import { it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT } from '../src/sim/constants';
import { EMPTY_PAD, Match } from '../src/sim/match';

it('diag time budget', () => {
  const t: Record<string, number> = {};
  const blocks: Record<string, number> = {};
  for (const seed of [11, 23, 37, 41]) {
    const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 150, difficulty: 2, humanSide: -1, seed });
    let steps = 0;
    let lastKind = '';
    while (m.phase !== 'fulltime' && steps < 60 * 60 * 12) {
      m.step(DT, EMPTY_PAD);
      steps++;
      for (const e of m.drainEvents()) {
        if (e.type === 'kick') lastKind = e.kind;
        if (e.type === 'block') blocks[(e.shot ? 'shot' : lastKind) + (Math.hypot(e.x - m.kickX, e.z - m.kickZ) < 2 ? '<2m' : '>2m')] = (blocks[(e.shot ? 'shot' : lastKind) + (Math.hypot(e.x - m.kickX, e.z - m.kickZ) < 2 ? '<2m' : '>2m')] ?? 0) + 1;
      }
      const b = m.ball;
      let k: string = m.phase;
      if (m.phase === 'play') {
        if (b.held) k = 'held';
        else if (b.owner >= 0) k = m.players[b.owner].state === 'kick' ? 'windup' : 'carrier';
        else if (m.passTarget >= 0) k = 'passFlight';
        else k = 'loose:' + lastKind;
      }
      t[k] = (t[k] ?? 0) + DT / 4;
      if (m.phase === 'halftime') m.continueSecondHalf();
      if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
    }
  }
  console.log(Object.entries(t).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v.toFixed(1)}`).join('  '));
  console.log('blocks/4', JSON.stringify(blocks));
});
