import { describe, expect, it } from 'vitest';
import { vsHuman } from '../src/sim/dribble';
import { botSeries, fmtBot } from './humanBot';

/**
 * Difficulty against a realistic scripted human (tests/humanBot.ts: taps PASS at open teammates, cuts past
 * defenders who close, shoots from inside ~18 m with a clear lane, taps TACKLE near the carrier, holds PRESS)
 * over whole 2x2-minute matches between equal-rated sides. The menu's levels are MatchConfig.difficulty
 * EASY 0.6 · NORMAL 1.8 · HARD 3 · LEGEND 4; the AI's play against the human scales by dribble.ts vsHuman.
 * (Small samples here, to keep the suite quick: the bands are loose. The full measurement is N=40-60 a level.)
 */
describe('difficulty against a realistic human', () => {
  it('EASY is clearly winnable, LEGEND clearly harder, and the dribble / tackle assists work over whole matches', () => {
    const easy = botSeries(8, 0.6);
    const normal = botSeries(8, 1.8);
    const legend = botSeries(8, 4);
    // eslint-disable-next-line no-console
    console.log([easy, normal, legend].map(fmtBot).join('\n'));
    expect(easy.w).toBeGreaterThan(easy.l);
    expect(easy.gf).toBeGreaterThan(easy.ga);
    expect(easy.gf - easy.ga).toBeGreaterThan(legend.gf - legend.ga);
    expect(easy.dispossessed).toBeLessThan(legend.dispossessed);
    // Skill cuts beat their man about half the time and the ball is kept; TACKLE taps rarely give a foul away.
    expect(normal.beatPct).toBeGreaterThan(30);
    expect(normal.cutKeptPct).toBeGreaterThan(75);
    expect(normal.tackleFoulPct).toBeLessThan(15);
    expect(normal.tackleWonPct).toBeGreaterThan(15);
  }, 900_000);

  it('the levels are ordered: every AI edge against the human grows with difficulty', () => {
    const [e, n, h, l] = [0.6, 1.8, 3, 4].map(vsHuman);
    for (const [a, b] of [[e, n], [n, h], [h, l]]) {
      expect(b.press).toBeGreaterThan(a.press);
      expect(b.tackle).toBeGreaterThan(a.tackle);
      expect(b.takeOn).toBeGreaterThan(a.takeOn);
      expect(b.beaten).toBeGreaterThan(a.beaten);
      expect(b.resist).toBeLessThan(a.resist);
      expect(b.cut).toBeLessThan(a.cut);
      expect(b.auto).toBeLessThan(a.auto);
    }
    // Off the ends of the menu it holds at the nearest level.
    expect(vsHuman(-1)).toEqual(e);
    expect(vsHuman(9)).toEqual(l);
  });
});
