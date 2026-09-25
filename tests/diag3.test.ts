import { it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { HALF_L } from '../src/sim/constants';
import { Match } from '../src/sim/match';
import { onTarget, resolveKick } from '../src/sim/actions';

it('shot solver accuracy', () => {
  const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 150, difficulty: 2, humanSide: -1, seed: 3 });
  const ad = m.attackDir(0);
  const p = m.players[9];
  // Move everyone else far away.
  for (const q of m.players) if (q !== p) { q.pos.x = -ad * 40; q.pos.z = 25; }
  const k = m.keeperOf(1)!;
  k.pos.x = ad * (HALF_L - 1.5); k.pos.z = 0;
  const out: string[] = [];
  for (const [dist, z, header, power] of [[8, 0, 1, 0.75], [12, 0, 0, 0.8], [12, 8, 0, 0.8], [18, 0, 0, 0.9], [25, 0, 0, 0.97], [30, 5, 0, 0.97]] as const) {
    let on = 0, n = 400, over = 0;
    for (let i = 0; i < n; i++) {
      p.pos.x = ad * (HALF_L - dist); p.pos.z = z;
      m.ball.reset(p.pos.x + ad * 0.6, z);
      if (header) m.ball.pos.y = 1.5;
      const L = resolveKick(m, p, { kind: header ? 'header' : 'shot', dirX: 0, dirZ: 0, power, target: -1, expires: 1, firstTime: false });
      m.ball.vel.x = L.vx; m.ball.vel.y = L.vy; m.ball.vel.z = L.vz;
      m.ball.spin.x = L.spinX; m.ball.spin.y = L.spinY; m.ball.spin.z = L.spinZ;
      if (onTarget(m, 0)) on++;
      if (L.vy > 6) over++;
    }
    out.push(`d${dist} z${z} header${header}: onTarget ${(on / n * 100).toFixed(0)}%  shooting ${p.stat.shooting}`);
  }
  console.log(out.join('\n'));
});
