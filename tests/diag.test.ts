import { it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT } from '../src/sim/constants';
import { EMPTY_PAD, Match } from '../src/sim/match';

it('diag stretches', () => {
  const ends: Record<string, number> = {};
  const durs: Record<string, number[]> = {};
  for (const seed of [11, 23, 37, 41]) {
    const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 150, difficulty: 2, humanSide: -1, seed });
    let steps = 0;
    let cur = -1;
    let t0 = 0;
    while (m.phase !== 'fulltime' && steps < 60 * 60 * 12) {
      m.step(DT, EMPTY_PAD);
      steps++;
      const ev = m.drainEvents();
      const o = m.phase === 'play' && m.ball.owner >= 0 && !m.ball.held && !m.players[m.ball.owner].isKeeper ? m.ball.owner : -1;
      if (o !== cur) {
        if (cur >= 0) {
          let why = 'lost';
          for (const e of ev) {
            if (e.type === 'kick') why = 'kick:' + e.kind;
            else if (e.type === 'tackle' && e.won) why = 'tackled';
          }
          if (o >= 0 && why === 'lost') why = m.players[o].side === m.players[cur].side ? 'mateTook' : 'oppTook';
          if (m.phase !== 'play') why = 'phase';
          ends[why] = (ends[why] ?? 0) + 1;
          (durs[why] ??= []).push((steps - t0) / 60);
        }
        cur = o;
        t0 = steps;
      }
      if (m.phase === 'halftime') m.continueSecondHalf();
      if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
    }
  }
  const avg = (a: number[]) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2);
  const short = (a: number[]) => a.filter((x) => x < 0.5).length;
  console.log(Object.entries(ends).map(([k, v]) => `${k}: ${(v / 4).toFixed(1)}/match avg ${avg(durs[k])}s  <0.5s: ${short(durs[k])}`).join('\n'));
});
