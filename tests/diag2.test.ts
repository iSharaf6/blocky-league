import { it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT, HALF_L } from '../src/sim/constants';
import { EMPTY_PAD, Match } from '../src/sim/match';
import { aiDebug } from '../src/sim/ai';

it('diag zones', () => {
  const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 150, difficulty: 2, humanSide: -1, seed: 11 });
  aiDebug.on = true;
  const zt = [0, 0, 0, 0, 0, 0];
  const ballZ = [0, 0, 0, 0, 0, 0];
  const ph: Record<string, number> = {};
  for (let i = 0; i < 60 * 150; i++) {
    m.step(DT, EMPTY_PAD);
    ph[m.phase] = (ph[m.phase] ?? 0) + DT;
    const b = m.ball;
    if (m.phase === 'play') {
      const bi = Math.min(5, Math.max(0, Math.floor(((b.pos.x / HALF_L) + 1) * 3)));
      ballZ[bi] += DT;
      if (b.owner >= 0 && !b.held) {
        const o = m.players[b.owner];
        const n = (b.pos.x * m.attackDir(o.side)) / HALF_L;
        const zi = Math.min(5, Math.max(0, Math.floor((n + 1) * 3)));
        zt[zi] += DT;
      }
    }
    if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal();
  }
  console.log('carrier time by own-frame sixth (own goal -> opp goal)', zt.map((v) => v.toFixed(1)).join(' '));
  console.log('ball time by world sixth', ballZ.map((v) => v.toFixed(1)).join(' '));
  console.log('phases', JSON.stringify(ph), 'decisions', aiDebug.log.length);
});
