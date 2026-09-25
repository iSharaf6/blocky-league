import { it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT, HALF_L } from '../src/sim/constants';
import { EMPTY_PAD, Match } from '../src/sim/match';

it('turnovers by zone/cause', () => {
  const res: Record<string, number> = {};
  for (const seed of [11, 23, 37, 41]) {
    const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 150, difficulty: 2, humanSide: -1, seed });
    let steps = 0;
    let lastCause = 'none';
    let lastSide = -1;
    let lastX = 0;
    while (m.phase !== 'fulltime' && steps < 60 * 60 * 12) {
      m.step(DT, EMPTY_PAD);
      steps++;
      for (const e of m.drainEvents()) {
        if (e.type === 'kick') {
          const k = m.players[m.ball.lastTouch];
          lastCause = e.kind; lastSide = k.side; lastX = (e.x * m.attackDir(k.side)) / HALF_L;
        } else if (e.type === 'tackle' && e.won) {
          const p = m.players[e.by];
          const zone = Math.floor(((-m.ball.pos.x * m.attackDir(p.side)) / HALF_L + 1) * 3);
          res[`z${zone}:tackled`] = (res[`z${zone}:tackled`] ?? 0) + 1;
          lastCause = 'tackle'; lastSide = p.side;
        } else if (e.type === 'control') {
          const p = m.players[e.player];
          if (lastSide >= 0 && p.side !== lastSide && lastCause !== 'tackle' && lastCause !== 'shot' && lastCause !== 'header') {
            const zone = Math.floor((lastX + 1) * 3);
            res[`z${zone}:${lastCause}`] = (res[`z${zone}:${lastCause}`] ?? 0) + 1;
          }
          lastSide = p.side; lastCause = 'carry'; lastX = (m.ball.pos.x * m.attackDir(p.side)) / HALF_L;
        }
      }
      if (m.phase === 'halftime') m.continueSecondHalf();
      if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
    }
  }
  const keys = Object.keys(res).sort();
  console.log(keys.map((k) => `${k}=${(res[k] / 4).toFixed(1)}`).join('  '));
});
