import { it } from 'vitest';
import { makeTeam, PRESET_CLUBS } from '../src/meta/data';
import { DT } from '../src/sim/constants';
import { EMPTY_PAD, Match } from '../src/sim/match';
import { aiDebug } from '../src/sim/ai';

it('diag choices attacking half', () => {
  const m = new Match({ home: makeTeam(PRESET_CLUBS[5]), away: makeTeam(PRESET_CLUBS[6]), halfLength: 150, difficulty: 2, humanSide: -1, seed: 11 });
  aiDebug.on = true;
  for (let i = 0; i < 60 * 150; i++) { m.step(DT, EMPTY_PAD); if (m.phase === 'goal' && m.phaseT > 3) m.resumeAfterGoal(); }
  const hist: Record<string, number> = {};
  for (const l of aiDebug.log) {
    const k = (l.split('-> ')[1] ?? '').split('\n')[0].split(' ')[0].replace(/[0-9]+$/, '');
    hist[k] = (hist[k] ?? 0) + 1;
  }
  console.log(JSON.stringify(hist), aiDebug.log.length);
  console.log(aiDebug.log.slice(0, 30).join('\n'));
});
