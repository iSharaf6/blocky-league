import { describe, expect, it } from 'vitest';
import { CURLED, EASY, HARD, LEGEND, NORMAL, PLACED, fmtRates, rates, type Rates, type Strike } from './shotBench';

/*
 * The shooting balance from range (2026-10-14): what the human's PLACED strike (SHOOT held 0.2 s, the stick left alone:
 * the shot assist picks the open side) and his CURLER (the stick right across at the strike) score by distance, against
 * a set keeper, on tests/shotBench.ts's bench (the same trials and seeds as tests/knuckleRates.test.ts).
 *
 * Two defects were measured while the knuckleball was built. The placed strike scored MORE the further out it was
 * struck from, then nothing: 35% from 20 m, 54% from 22 m, 60% from 23.5 m, 1% from 24 m. And the curler, a named skill
 * shot, was far worse than leaving the stick alone from 18 to 22 m, and not monotone. Both came from how the keeper
 * handled a human's strike either side of 24 m (keeper.ts HUMAN_EDGE has the story) and from where the assist put it
 * (actions.ts HUMAN_WIDE); the curler's share is Match's CURLER_REACH.
 *
 * Goals, NORMAL, 600 trials a cell (the same seeds before and after):
 *
 *                      12 m  13 m  14 m  16 m  18 m  20 m  22 m  24 m  26 m  28 m  30 m
 *   placed, before      66%   58%   52%   47%   39%   35%   54%    1%    0%    0%    0%
 *   placed, now         66%   58%   52%   34%   26%   20%   11%   10%    6%    2%    0%
 *   (and 46 / 32 / 21% from 15 / 17 / 19 m, where it was 54 / 46 / 34%. From 14 m and nearer it is what it was, trial for
 *   trial: actions.ts HUMAN_WIDE says why it starts there, which makes 14 to 16 m the steepest 2 m on the curve.)
 *
 *                     14.5 m  16 m  18 m  20 m  22 m  25 m
 *   curler, before       56%   33%   13%    3%    7%    0%
 *   curler, now          57%   39%   26%   24%   16%    7%
 *     to the far post    47%   35%   27%   28%   22%   11%    (struck from 5 m to one side, swung across the keeper)
 *     from straight on   68%   45%   24%   26%   13%    4%
 *
 *   (The knuckleball, untouched: 36 / 25 / 19 / 19 / 18 / 13 / 6% from 20.5 / 22 / 24 / 26 / 28 / 30 / 34 m, before
 *   and now, trial for trial.)
 *
 *   By level, from 18 / 22 / 26 m, now (and before):
 *     placed   EASY 39 / 23 / 14% (56 / 54 / 0)   HARD 17 / 6 / 3% (26 / 54 / 0)   LEGEND 12 / 4 / 1% (23 / 54 / 0)
 *     curler   EASY 42 / 32 / 20% (29 / 3 / 0)    HARD 10 / 4 / 2% (2 / 14 / 0)    LEGEND 5 / 1 / 1% (1 / 23 / 0)
 *   (Before, 22 m was a 54% chance on every level, LEGEND included.)
 *
 * The bands below are the design with room for the bench's noise (300 trials a cell here: about 2.5 points).
 */

const N = 300;
const pc = (v: number) => `${(v * 100).toFixed(0)}%`;

describe('the placed strike from range (a set keeper, NORMAL)', () => {
  it('falls away with distance, smoothly: never better from further out, no cliff, and never the 54% from 22 m it was', () => {
    const ds = [14, 16, 18, 20, 22, 24, 26, 28];
    const rs = ds.map((d) => rates(d, PLACED, N));
    // eslint-disable-next-line no-console
    console.log(rs.map((r, i) => fmtRates(`${ds[i]} m placed`, r)).join('\n'));
    // The design: about 45 / 34 / 26 / 19 / 13 / 8 / 4 / 2%. (14 m is the 52% it was: the header says why.)
    const band: [number, number][] = [[0.44, 0.6], [0.27, 0.43], [0.19, 0.34], [0.13, 0.27], [0.06, 0.19], [0.03, 0.15], [0.01, 0.1], [0, 0.06]];
    rs.forEach((r, i) => {
      expect(r.styles.plain, `${ds[i]} m`).toBe(N);
      expect(r.goal, `${ds[i]} m`).toBeGreaterThanOrEqual(band[i][0]);
      expect(r.goal, `${ds[i]} m`).toBeLessThanOrEqual(band[i][1]);
    });
    for (let i = 1; i < rs.length; i++) {
      // Monotone: never better from 2 m further out (3 points is the bench's noise)...
      expect(rs[i].goal, `${ds[i]} m against ${ds[i - 1]} m`).toBeLessThanOrEqual(rs[i - 1].goal + 0.03);
      // ... and no cliff (it was 54% from 22 m, 1% from 24 m): from 16 m on, 2 m further out never costs more than 12
      // points; 14 to 16 m, where the assist's aim begins to widen, is the steepest 2 m on it, and under 22.
      expect(rs[i - 1].goal - rs[i].goal, `${ds[i - 1]} m to ${ds[i]} m`).toBeLessThanOrEqual(i === 1 ? 0.22 : 0.12);
    }
    // It halves, and halves again: 18 m is under two thirds of 14 m, 22 m is under two thirds of 18 m.
    expect(rs[2].goal).toBeLessThanOrEqual(rs[0].goal * 0.67);
    expect(rs[4].goal).toBeLessThanOrEqual(rs[2].goal * 0.67);
    // From range it is a hopeful one, not a dead one: the keeper has it most of the time and it still goes in.
    expect(rs[5].goal + rs[6].goal).toBeGreaterThanOrEqual(0.06);
    for (const i of [4, 5, 6, 7]) expect(rs[i].saved + rs[i].held, `${ds[i]} m`).toBeGreaterThanOrEqual(0.7);
  }, 300_000);

  it('the metres either side of the old cliff are one curve: 21, 23, 23.5, 24 and 25 m', () => {
    const ds = [21, 23, 23.5, 24, 25];
    const rs = ds.map((d) => rates(d, PLACED, N));
    // eslint-disable-next-line no-console
    console.log(rs.map((r, i) => fmtRates(`${ds[i]} m placed`, r)).join('\n'));
    // (Before: 45%, 58%, 60%, then 1% and 0%.)
    for (const r of rs) {
      expect(r.goal).toBeGreaterThanOrEqual(0.03);
      expect(r.goal).toBeLessThanOrEqual(0.22);
    }
    expect(Math.max(...rs.map((r) => r.goal)) - Math.min(...rs.map((r) => r.goal))).toBeLessThanOrEqual(0.13);
    expect(rs[4].goal).toBeLessThanOrEqual(rs[0].goal);
  }, 300_000);

  it('from 14 m and nearer it is the chance it was, and the first metres past 14 m run on from it', () => {
    const ds = [12, 13, 14, 15, 16];
    const rs = ds.map((d) => rates(d, PLACED, N));
    // eslint-disable-next-line no-console
    console.log(rs.map((r, i) => fmtRates(`${ds[i]} m placed`, r)).join('\n'));
    // (The assist's aim is untouched up to HUMAN_WIDE_FROM, and the keeper has no time in hand from there: 12, 13 and
    // 14 m are the trials they were, goal for goal. 600 trials: 66%, 58% and 52%; then 46% from 15 m, 34% from 16 m.)
    const band: [number, number][] = [[0.58, 0.74], [0.5, 0.68], [0.44, 0.6], [0.37, 0.54], [0.27, 0.43]];
    rs.forEach((r, i) => {
      expect(r.goal, `${ds[i]} m`).toBeGreaterThanOrEqual(band[i][0]);
      expect(r.goal, `${ds[i]} m`).toBeLessThanOrEqual(band[i][1]);
    });
    // A metre further out is never better (3 points is the bench's noise) and never costs more than 14 points.
    for (let i = 1; i < rs.length; i++) {
      expect(rs[i].goal, `${ds[i]} m against ${ds[i - 1]} m`).toBeLessThanOrEqual(rs[i - 1].goal + 0.03);
      expect(rs[i - 1].goal - rs[i].goal, `${ds[i - 1]} m to ${ds[i]} m`).toBeLessThanOrEqual(0.14);
    }
  }, 300_000);

  it('EASY is more forgiving and HARD and LEGEND meaner, from 18, 22 and 26 m, and 22 m is no longer the same chance on every level', () => {
    const out: string[] = [];
    for (const d of [18, 22, 26]) {
      const easy = rates(d, PLACED, N, EASY);
      const normal = rates(d, PLACED, N, NORMAL);
      const hard = rates(d, PLACED, N, HARD);
      const legend = rates(d, PLACED, N, LEGEND);
      out.push(`${d} m placed: EASY ${pc(easy.goal)} | NORMAL ${pc(normal.goal)} | HARD ${pc(hard.goal)} | LEGEND ${pc(legend.goal)}`);
      expect(easy.goal, `${d} m`).toBeGreaterThanOrEqual(normal.goal + 0.03);
      expect(normal.goal, `${d} m`).toBeGreaterThanOrEqual(hard.goal);
      expect(hard.goal, `${d} m`).toBeGreaterThanOrEqual(legend.goal - 0.02);
      // More forgiving, not a gift: EASY is within 20 points of NORMAL.
      expect(easy.goal, `${d} m`).toBeLessThanOrEqual(normal.goal + 0.2);
      if (d === 22) expect(easy.goal - legend.goal).toBeGreaterThanOrEqual(0.1);
    }
    // eslint-disable-next-line no-console
    console.log(out.join('\n'));
  }, 300_000);
});

describe('the curler against the placed strike (a set keeper, NORMAL)', () => {
  /** The curler struck from 5 m to one side and swung across the keeper to the far post; and from straight in front. */
  const FAR = [-5];
  const STRAIGHT = [0];

  it('from 16, 18, 20 and 22 m it is a real choice: a little better than the placed strike, most of all swung to the far post', () => {
    const out: string[] = [];
    const curled: Rates[] = [];
    const ds = [16, 18, 20, 22];
    let farLong = 0;
    let placedLong = 0;
    for (const d of ds) {
      const placed = rates(d, PLACED, N);
      const curler = rates(d, CURLED, N);
      const far = rates(d, CURLED, N, NORMAL, FAR);
      const straight = rates(d, CURLED, N, NORMAL, STRAIGHT);
      const placedStraight = rates(d, PLACED, N, NORMAL, STRAIGHT);
      curled.push(curler);
      out.push(`${d} m: placed ${pc(placed.goal)} (straight on ${pc(placedStraight.goal)}) | curler ${pc(curler.goal)}, to the far post ${pc(far.goal)}, straight on ${pc(straight.goal)}` +
        ` | curler parried ${pc(curler.saved)} held ${pc(curler.held)} off ${pc(curler.off + curler.post)}`);
      for (const r of [curler, far, straight]) expect(r.styles.curler, `${d} m`).toBe(N);
      // (Before: 33% against 47% from 16 m, 13% against 39% from 18 m, 3% against 35% from 20 m, 7% against 54% from 22 m.)
      // A real choice: never more than a few points worse than leaving the stick alone, never a formality.
      expect(curler.goal, `${d} m`).toBeGreaterThanOrEqual(placed.goal - 0.05);
      expect(curler.goal, `${d} m`).toBeLessThanOrEqual(placed.goal + 0.14);
      // From straight on it is about the placed strike (within the bench's noise below it).
      expect(straight.goal, `${d} m straight on`).toBeGreaterThanOrEqual(placedStraight.goal - 0.08);
      // Swung across him to the far post, the angle that suits it: as good as the placed strike or better.
      expect(far.goal, `${d} m to the far post`).toBeGreaterThanOrEqual(placed.goal - 0.03);
      // It is on target (it is re-aimed): the keeper is what stops it.
      expect(curler.off + curler.post, `${d} m`).toBeLessThanOrEqual(0.15);
      // From 20 m and beyond nothing is better than about one in three.
      if (d >= 20) {
        for (const r of [curler, far, straight]) expect(r.goal, `${d} m`).toBeLessThanOrEqual(0.36);
        farLong += far.goal;
        placedLong += placed.goal;
      }
    }
    // eslint-disable-next-line no-console
    console.log(out.join('\n'));
    // From 20 and 22 m together the far-post curler is clearly the better shot than the placed strike.
    expect(farLong / 2).toBeGreaterThanOrEqual(placedLong / 2 + 0.04);
    // Monotone with distance (3 points is the bench's noise).
    for (let i = 1; i < curled.length; i++) expect(curled[i].goal, `${ds[i]} m against ${ds[i - 1]} m`).toBeLessThanOrEqual(curled[i - 1].goal + 0.03);
  }, 600_000);

  it('and it fades out with range as the placed strike does: 25 and 28 m', () => {
    const c22 = rates(22, CURLED, N);
    const c25 = rates(25, CURLED, N);
    const c28 = rates(28, CURLED, N);
    const p25 = rates(25, PLACED, N);
    // eslint-disable-next-line no-console
    console.log([fmtRates('22 m curler', c22), fmtRates('25 m curler', c25), fmtRates('28 m curler', c28), fmtRates('25 m placed', p25)].join('\n'));
    // (Before: 7% from 22 m, 9% from 24 m, a quarter of those struck from one side, then 0% from 25 m.)
    expect(c25.goal).toBeLessThanOrEqual(c22.goal + 0.02);
    expect(c28.goal).toBeLessThanOrEqual(c25.goal + 0.02);
    expect(c25.goal).toBeGreaterThanOrEqual(0.03);
    expect(c25.goal).toBeLessThanOrEqual(0.14);
    expect(c28.goal).toBeLessThanOrEqual(0.08);
    expect(c25.goal).toBeGreaterThanOrEqual(p25.goal - 0.04);
  }, 300_000);

  it('whichever way the stick is pushed: the curler to the other post scores what its mirror does', () => {
    const other: Strike = { ...CURLED, lat: -1 };
    for (const d of [18, 22]) {
      const a = rates(d, CURLED, N);
      const b = rates(d, other, N);
      const farA = rates(d, CURLED, N, NORMAL, [-5]);
      const farB = rates(d, other, N, NORMAL, [5]);
      // eslint-disable-next-line no-console
      console.log(`${d} m curler: stick one way ${pc(a.goal)}, the other ${pc(b.goal)}; to the far post ${pc(farA.goal)} and ${pc(farB.goal)}`);
      expect(b.styles.curler).toBe(N);
      expect(Math.abs(a.goal - b.goal)).toBeLessThanOrEqual(0.07);
      expect(Math.abs(farA.goal - farB.goal)).toBeLessThanOrEqual(0.09);
    }
  }, 300_000);
});
