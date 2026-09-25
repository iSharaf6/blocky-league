import { it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT, HALF_L } from '../src/sim/constants';
import { EMPTY_PAD, Match } from '../src/sim/match';

it('diag through balls', () => {
  const res: Record<string, number> = {};
  for (const seed of [11, 23, 37, 41]) {
    const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 150, difficulty: 2, humanSide: -1, seed });
    let steps = 0;
    let tb: { side: number; tgt: number; t: number; x: number } | null = null;
    while (m.phase !== 'fulltime' && steps < 60 * 60 * 12) {
      m.step(DT, EMPTY_PAD);
      steps++;
      for (const e of m.drainEvents()) {
        if (e.type === 'kick') {
          const k = m.players[m.ball.lastTouch];
          if (tb && k.side !== tb.side) { const key = 'firstTimeBy' + (k.isKeeper ? 'K' : 'Opp'); res[key] = (res[key] ?? 0) + 1; tb = null; }
          if (e.kind === 'through') tb = { side: k.side, tgt: m.passTarget, t: steps, x: (e.x * m.attackDir(k.side)) / HALF_L };
        } else if (tb && e.type === 'control') {
          const p = m.players[e.player];
          const key = p.idx === tb.tgt ? 'target' : p.side === tb.side ? 'mate' : (p.isKeeper ? 'keeperFeet' : 'opp' + p.role);
          res[key] = (res[key] ?? 0) + 1;
          const dtT = (steps - tb.t) / 60;
          res['t_' + key] = (res['t_' + key] ?? 0) + dtT;
          tb = null;
        } else if (tb && e.type === 'save') { res.keeperHands = (res.keeperHands ?? 0) + 1; tb = null; }
        else if (tb && e.type === 'restart') { res['out_' + e.kind] = (res['out_' + e.kind] ?? 0) + 1; tb = null; }
        else if (tb && e.type === 'block') { res.blocked = (res.blocked ?? 0) + 1; tb = null; }
      }
      if (m.phase === 'halftime') m.continueSecondHalf();
      if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
    }
  }
  console.log(JSON.stringify(res));
});
