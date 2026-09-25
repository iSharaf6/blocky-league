import { it } from 'vitest';
import { runMatch } from './metrics.test';

it('difficulty scaling', () => {
  for (const [a, b] of [[4, 0], [3, 1], [2, 2], [0, 4]] as const) {
    let gf = 0, ga = 0, w = 0, d = 0, l = 0, sf = 0, sa = 0;
    for (const seed of [11, 23, 37, 41, 53, 67, 79, 97]) {
      // Alternate which club is the stronger AI so team quality doesn't bias it.
      const flip = seed % 2 === 0;
      const r = runMatch({ seed, sideDifficulty: flip ? [b, a] : [a, b] }, 5, 6);
      const us = flip ? 1 : 0;
      const f = r.score[us], g = r.score[1 - us];
      gf += f; ga += g;
      if (f > g) w++; else if (f === g) d++; else l++;
    }
    console.log(`diff ${a} vs ${b}: W${w} D${d} L${l}  goals ${gf}-${ga}`);
    void sf; void sa;
  }
});
