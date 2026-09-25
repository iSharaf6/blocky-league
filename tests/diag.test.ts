import { it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT } from '../src/sim/constants';
import { EMPTY_PAD, Match } from '../src/sim/match';

it('diag shots', () => {
  const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 150, difficulty: 2, humanSide: -1, seed: 7 });
  let steps = 0;
  let tracking: { t: number; x: number; z: number; sp: number; side: number; who: string } | null = null;
  const out: string[] = [];
  while (m.phase !== 'fulltime' && steps < 60 * 60 * 12) {
    m.step(DT, EMPTY_PAD);
    steps++;
    for (const e of m.drainEvents()) {
      if (e.type === 'kick' && (e.kind === 'shot' || e.kind === 'header')) {
        if (tracking) out.push(`  (unresolved)`);
        const p = m.players[m.ball.lastTouch];
        tracking = { t: steps, x: +e.x.toFixed(1), z: +e.z.toFixed(1), sp: +m.ball.speed().toFixed(1), side: p.side, who: p.def.role + p.slot };
        out.push(`${e.kind} ${JSON.stringify(tracking)} vy=${m.ball.vel.y.toFixed(1)} y=${m.ball.pos.y.toFixed(2)} ph=${m.phase}`);
      } else if (tracking && ['goal', 'save', 'control', 'restart'].includes(e.type)) {
        const extra = e.type === 'control' ? ` by ${m.players[(e as any).player].side}:${m.players[(e as any).player].def.role} at ${m.ball.pos.x.toFixed(1)},${m.ball.pos.z.toFixed(1)} y=${m.ball.pos.y.toFixed(2)}` : '';
        out.push(`  -> ${e.type}${extra} after ${((steps - tracking.t) / 60).toFixed(2)}s`);
        tracking = null;
      }
    }
    if (m.phase === 'halftime') m.continueSecondHalf();
    if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
  }
  console.log(out.slice(0, 60).join('\n'));
});
