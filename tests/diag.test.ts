import { it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT, HALF_W } from '../src/sim/constants';
import { EMPTY_PAD, Match } from '../src/sim/match';

it('pass debug', () => {
  const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 150, difficulty: 2, humanSide: 0, seed: 5 });
  console.log('phase', m.phase, 'restart', m.restart?.kind);
  m.phase = 'play'; m.restart = null;
  m.players.forEach((p, i) => { p.pos.x = -40 + i * 3.6; p.pos.z = -HALF_W + 1.5; p.vel.x = p.vel.z = 0; p.setState('move'); });
  const c = m.players[6], mate = m.players[9];
  c.pos.x = 0; c.pos.z = 0; mate.pos.x = 15 * m.attackDir(0); mate.pos.z = 0;
  m.ball.reset(c.footX(), c.footZ()); m.ball.owner = c.idx; m.active = c.idx;
  for (let i = 0; i < 90; i++) {
    m.step(DT, { ...EMPTY_PAD, mx: m.attackDir(0), mz: 0, pass: i === 0 });
    const ev = m.drainEvents();
    if (i < 5 || ev.length) console.log(i, 'owner', m.ball.owner, 'c.state', c.state, 'order', c.order?.kind, 'ball', m.ball.pos.x.toFixed(2), m.ball.vel.x.toFixed(1), 'active', m.active, 'phase', m.phase, JSON.stringify(ev));
  }
});
