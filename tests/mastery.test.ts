import { describe, expect, it } from 'vitest';
import { defaultSave } from '../src/core/save';
import {
  MASTERY_COINS, MASTERY_THRESHOLDS, MASTERY_TIERS, MASTERY_TITLES, MASTERY_TRACKS, advanceMastery, badgePending, claimAll,
  claimMastery, defaultMastery, earnedTitles, masteryPending, masteryTier, matchPoints, nextBadgeGoal, normalizeMastery,
  recordMatchMeta, trackProgress, wearTitle, wornTitle, type MasteryMatch,
} from '../src/meta/mastery';
import { defaultRun } from '../src/meta/run';
import { defaultSeason, seasonAdvance } from '../src/meta/season';

const NONE: MasteryMatch = { goals: 0, assists: 0, passes: 0, tackles: 0, cleanSheet: false, skills: 0, saves: 0 };
/** A typical match for one side at Normal (AI v AI measurement: see MASTERY_THRESHOLDS). */
const TYPICAL: MasteryMatch = { goals: 1, assists: 1, passes: 40, tackles: 3, cleanSheet: false, skills: 4, saves: 2 };

describe('mastery thresholds', () => {
  it('five rising tiers per track', () => {
    for (const k of MASTERY_TRACKS) {
      const th = MASTERY_THRESHOLDS[k];
      expect(th).toHaveLength(MASTERY_TIERS);
      for (let i = 1; i < th.length; i++) expect(th[i]).toBeGreaterThan(th[i - 1]);
      expect(MASTERY_TITLES[k]).toHaveLength(MASTERY_TIERS);
    }
    expect(MASTERY_COINS).toHaveLength(MASTERY_TIERS);
  });

  it('tier I comes in one or two typical matches, tier V in about 40', () => {
    const st = defaultMastery();
    const firstAt: Record<string, number> = {};
    const fifthAt: Record<string, number> = {};
    for (let n = 1; n <= 80; n++) {
      // A clean sheet one match in four.
      advanceMastery(st, { ...TYPICAL, cleanSheet: n % 4 === 0 });
      for (const k of MASTERY_TRACKS) {
        const t = masteryTier(k, st.counts[k]);
        if (t >= 1 && !firstAt[k]) firstAt[k] = n;
        if (t >= 5 && !fifthAt[k]) fifthAt[k] = n;
      }
    }
    for (const k of MASTERY_TRACKS) {
      expect(firstAt[k], k).toBeLessThanOrEqual(2);
      expect(fifthAt[k], k).toBeGreaterThanOrEqual(30);
      expect(fifthAt[k], k).toBeLessThanOrEqual(60);
    }
  });

  it('counts goals, assists + passes / 10 (spare passes carry), tackles + 3 a clean sheet, skills and saves', () => {
    const a = matchPoints({ goals: 2, assists: 1, passes: 25, tackles: 4, cleanSheet: true, skills: 3, saves: 5 });
    expect(a.pts).toEqual({ finisher: 2, playmaker: 3, wall: 7, magician: 3, keeper: 5 });
    expect(a.passCarry).toBe(5);
    const st = defaultMastery();
    advanceMastery(st, { ...NONE, passes: 25 });
    expect(st.counts.playmaker).toBe(2);
    expect(st.passCarry).toBe(5);
    advanceMastery(st, { ...NONE, passes: 7 });
    expect(st.counts.playmaker).toBe(3);
    expect(st.passCarry).toBe(2);
    // Junk input counts as nothing.
    advanceMastery(st, { goals: -3, assists: NaN, passes: Infinity, tackles: 1.9, cleanSheet: false, skills: -1, saves: 0 });
    expect(st.counts.finisher).toBe(0);
    expect(st.counts.wall).toBe(1);
  });
});

describe('mastery tier-ups and claims', () => {
  it('advanceMastery returns each tier crossed, with its coins and title', () => {
    const st = defaultMastery();
    expect(advanceMastery(st, NONE)).toEqual([]);
    const ups = advanceMastery(st, { ...NONE, goals: 9 });
    expect(ups).toEqual([
      { track: 'finisher', tier: 1, coins: MASTERY_COINS[0], title: MASTERY_TITLES.finisher[0] },
      { track: 'finisher', tier: 2, coins: MASTERY_COINS[1], title: MASTERY_TITLES.finisher[1] },
    ]);
    expect(advanceMastery(st, { ...NONE, goals: 1 })).toEqual([]);
    // Past tier V nothing more.
    advanceMastery(st, { ...NONE, goals: 500 });
    expect(trackProgress(st, 'finisher')).toMatchObject({ tier: 5, next: null, frac: 1 });
    expect(advanceMastery(st, { ...NONE, goals: 5 })).toEqual([]);
  });

  it('each tier pays once', () => {
    const st = defaultMastery();
    advanceMastery(st, { ...NONE, goals: 9, saves: 2 });
    expect(masteryPending(st)).toBe(3);
    const f = claimMastery(st, 'finisher');
    expect(f.coins).toBe(MASTERY_COINS[0] + MASTERY_COINS[1]);
    expect(claimMastery(st, 'finisher').coins).toBe(0);
    const rest = claimMastery(st);
    expect(rest.coins).toBe(MASTERY_COINS[0]);
    expect(rest.tiers).toEqual([{ track: 'keeper', tier: 1 }]);
    expect(claimMastery(st).coins).toBe(0);
    expect(masteryPending(st)).toBe(0);
    // A later tier pays on its own.
    advanceMastery(st, { ...NONE, goals: 11 });
    expect(claimMastery(st).coins).toBe(MASTERY_COINS[2]);
  });

  it('claimAll pays badge and season tiers into the save once', () => {
    const save = defaultSave();
    save.mastery = defaultMastery();
    save.season = defaultSeason(new Date(2026, 8, 10));
    save.run = defaultRun();
    advanceMastery(save.mastery, { ...NONE, goals: 2 });
    seasonAdvance(save.season, 100, new Date(2026, 8, 10));
    expect(badgePending(save)).toBe(2);
    const c0 = save.coins;
    const got = claimAll(save);
    expect(got).toBe(MASTERY_COINS[0] + 25);
    expect(save.coins - c0).toBe(got);
    expect(claimAll(save)).toBe(0);
    expect(badgePending(save)).toBe(0);
  });

  it('the next badge goal is the nearest tier', () => {
    const st = defaultMastery();
    expect(nextBadgeGoal(st)?.tier).toBe(1);
    advanceMastery(st, { ...NONE, goals: 1 });
    expect(nextBadgeGoal(st)).toMatchObject({ track: 'finisher', tier: 1, left: 1, text: '1 MORE GOAL FOR FINISHER I' });
    for (const k of MASTERY_TRACKS) st.counts[k] = 10_000;
    expect(nextBadgeGoal(st)).toBeNull();
  });
});

describe('mastery save and titles', () => {
  it('normalizes old and damaged blobs (never more paid than reached)', () => {
    expect(normalizeMastery(undefined)).toEqual(defaultMastery());
    const old = normalizeMastery({ counts: { finisher: 9, wall: -4, keeper: 'x' } });
    expect(old.counts).toEqual({ finisher: 9, playmaker: 0, wall: 0, magician: 0, keeper: 0 });
    expect(old.claimed.finisher).toBe(0);
    const bad = normalizeMastery({ counts: { finisher: 3 }, claimed: { finisher: 5, keeper: 2 }, passCarry: 40, title: 7 });
    expect(bad.claimed.finisher).toBe(1);
    expect(bad.claimed.keeper).toBe(0);
    expect(bad.passCarry).toBe(9);
    expect(bad.title).toBe('');
    const st = defaultMastery();
    advanceMastery(st, TYPICAL);
    claimMastery(st);
    st.title = MASTERY_TITLES.finisher[0];
    expect(normalizeMastery(JSON.parse(JSON.stringify(st)))).toEqual(st);
  });

  it('lists titles from badges, the Club Run and the season, and wears only earned ones', () => {
    const save = defaultSave();
    save.mastery = defaultMastery();
    save.run = defaultRun();
    save.season = defaultSeason();
    expect(earnedTitles(save)).toEqual([]);
    advanceMastery(save.mastery, { ...NONE, goals: 2 });
    save.run.milestones = [3];
    save.season.titles = ['Frost Cup Rookie'];
    const titles = earnedTitles(save).map((t) => t.title);
    expect(titles).toEqual(['Poacher', 'Run Rookie', 'Frost Cup Rookie']);
    expect(wearTitle(save, 'Goal Machine')).toBe(false);
    expect(wornTitle(save)).toBeNull();
    expect(wearTitle(save, 'Run Rookie')).toBe(true);
    expect(wornTitle(save)).toBe('Run Rookie');
    expect(wearTitle(save, '')).toBe(true);
    expect(wornTitle(save)).toBeNull();
  });
});

describe('the full-time hook', () => {
  it('recordMatchMeta works on a brand-new save (no mastery or season yet)', () => {
    const save = defaultSave();
    delete save.mastery;
    delete save.season;
    const out = recordMatchMeta(save, { ...NONE, goals: 2, saves: 2 }, 150, new Date(2026, 8, 10));
    expect(out.badgeUps.map((u) => u.track)).toEqual(['finisher', 'keeper']);
    expect(out.seasonUps).toEqual([1]);
    expect(save.mastery!.counts.finisher).toBe(2);
    expect(save.season!.xp).toBe(150);
    expect(badgePending(save)).toBe(3);
  });
});
