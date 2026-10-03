import { describe, expect, it } from 'vitest';
import { REVIEW_GAP_DAYS, REVIEW_MIN_PLAYED, REVIEW_MIN_WON, reviewDue } from '../src/platform/review';

/** Apple's rating prompt (platform/review.ts): only after a few matches and wins, and rarely. */
describe('the rating prompt', () => {
  const enough = { played: REVIEW_MIN_PLAYED, won: REVIEW_MIN_WON };

  it('waits until the player has played and won enough', () => {
    expect(reviewDue({ played: REVIEW_MIN_PLAYED - 1, won: 9 }, '', '2026-10-03')).toBe(false);
    expect(reviewDue({ played: 20, won: REVIEW_MIN_WON - 1 }, '', '2026-10-03')).toBe(false);
    expect(reviewDue(enough, '', '2026-10-03')).toBe(true);
  });

  it(`asks again only ${REVIEW_GAP_DAYS} days after the last time`, () => {
    expect(reviewDue(enough, '2026-10-01', '2026-10-03')).toBe(false);
    expect(reviewDue(enough, '2026-08-01', '2026-09-29')).toBe(false);
    expect(reviewDue(enough, '2026-08-01', '2026-09-30')).toBe(true);
    expect(reviewDue(enough, 'garbage', '2026-10-03')).toBe(true);
  });
});
