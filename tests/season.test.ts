import { describe, expect, it } from 'vitest';
import { defaultSave } from '../src/core/save';
import {
  SEASON_TIERS, addXp, claimAllSeason, claimCarry, claimSeasonTier, defaultSeason, normalizeSeason, rollSeason, seasonAdvance,
  seasonDaysLeft, seasonId, seasonName, seasonPending, seasonProgress, seasonReward, seasonTheme, seasonTier, seasonTitles,
  tierCost, tierXp, unclaimedTiers,
} from '../src/meta/season';

const SEP = new Date(2026, 8, 12, 15, 0);
const OCT = new Date(2026, 9, 2, 9, 0);

describe('season tiers', () => {
  it('30 tiers: 100 XP each to 10, 140 to 20, 180 to 30', () => {
    expect(tierCost(1)).toBe(100);
    expect(tierCost(10)).toBe(100);
    expect(tierCost(11)).toBe(140);
    expect(tierCost(30)).toBe(180);
    expect(tierXp(SEASON_TIERS)).toBe(4200);
    expect(seasonTier(0)).toBe(0);
    expect(seasonTier(99)).toBe(0);
    expect(seasonTier(100)).toBe(1);
    expect(seasonTier(1000)).toBe(10);
    expect(seasonTier(1139)).toBe(10);
    expect(seasonTier(1140)).toBe(11);
    expect(seasonTier(4200)).toBe(30);
    expect(seasonTier(99_999)).toBe(30);
    expect(seasonProgress({ xp: 1150 })).toEqual({ tier: 11, into: 10, need: 140 });
    expect(seasonProgress({ xp: 5000 })).toEqual({ tier: 30, into: 0, need: 0 });
  });

  it('seasonAdvance returns the tiers newly reached', () => {
    const s = defaultSeason(SEP);
    expect(seasonAdvance(s, 60, SEP)).toEqual([]);
    expect(seasonAdvance(s, 60, SEP)).toEqual([1]);
    expect(seasonAdvance(s, 250, SEP)).toEqual([2, 3]);
    expect(seasonAdvance(s, 0, SEP)).toEqual([]);
    expect(seasonAdvance(s, -50, SEP)).toEqual([]);
    expect(seasonAdvance(s, NaN, SEP)).toEqual([]);
    expect(s.xp).toBe(370);
    expect(seasonAdvance(s, 10_000, SEP)).toHaveLength(SEASON_TIERS - 3);
  });

  it('coins every tier, a bigger prize and a title every 5th', () => {
    let total = 0;
    for (let t = 1; t <= SEASON_TIERS; t++) {
      const r = seasonReward(t, '2026-09');
      expect(r.coins).toBeGreaterThan(0);
      expect(r.coins % 5).toBe(0);
      total += r.coins;
      if (t % 5 === 0) {
        expect(r.title).toMatch(/^Harvest Cup /);
        expect(r.coins).toBeGreaterThan(seasonReward(t - 1, '2026-09').coins);
      } else expect(r.title).toBeUndefined();
    }
    expect(seasonReward(30, '2026-09').title).toBe('Harvest Cup Legend');
    expect(seasonReward(5, '2026-01').title).toBe('Frost Cup Rookie');
    expect(total).toBeGreaterThan(3000);
    expect(total).toBeLessThan(6000);
  });

  it('names, themes and days left', () => {
    expect(seasonId(SEP)).toBe('2026-09');
    expect(seasonName('2026-09')).toBe('SEPTEMBER 2026');
    expect(seasonTheme('2026-12').name).toBe('Winter Classic');
    expect(seasonDaysLeft(new Date(2026, 8, 30, 20, 0))).toBe(1);
    expect(seasonDaysLeft(new Date(2026, 8, 1, 0, 0))).toBe(30);
    expect(seasonDaysLeft(new Date(2026, 1, 27, 12, 0))).toBe(2);
  });
});

describe('season claims', () => {
  it('each reached tier pays once; unreached tiers pay nothing', () => {
    const s = defaultSeason(SEP);
    seasonAdvance(s, 520, SEP); // tiers 1 to 5
    expect(unclaimedTiers(s)).toEqual([1, 2, 3, 4, 5]);
    expect(claimSeasonTier(s, 6)).toBe(0);
    expect(claimSeasonTier(s, 0)).toBe(0);
    expect(claimSeasonTier(s, 2)).toBe(seasonReward(2, s.id).coins);
    expect(claimSeasonTier(s, 2)).toBe(0);
    const rest = claimAllSeason(s);
    expect(rest).toBe([1, 3, 4, 5].reduce((n, t) => n + seasonReward(t, s.id).coins, 0));
    expect(claimAllSeason(s)).toBe(0);
    expect(seasonPending(s)).toBe(0);
    expect(seasonTitles(s)).toEqual(['Harvest Cup Rookie']);
  });

  it('addXp feeds both the level and the season', () => {
    const save = defaultSave();
    delete save.season;
    expect(addXp(save, 150, SEP)).toEqual([1]);
    expect(save.progress.xp).toBe(150);
    expect(save.season!.xp).toBe(150);
    expect(addXp(save, 0, SEP)).toEqual([]);
  });
});

describe('monthly roll-over', () => {
  it('a new month starts a fresh season, keeping titles and unclaimed coins', () => {
    const s = defaultSeason(SEP);
    seasonAdvance(s, 1000, SEP); // tiers 1 to 10
    claimSeasonTier(s, 1);
    claimSeasonTier(s, 5);
    const owed = [2, 3, 4, 6, 7, 8, 9, 10].reduce((n, t) => n + seasonReward(t, '2026-09').coins, 0);
    expect(rollSeason(s, SEP)).toBe(false);
    expect(rollSeason(s, OCT)).toBe(true);
    expect(s.id).toBe('2026-10');
    expect(s.xp).toBe(0);
    expect(s.claimed).toEqual([]);
    expect(s.carry).toEqual({ id: '2026-09', coins: owed });
    expect(s.titles).toEqual(['Harvest Cup Rookie', 'Harvest Cup Regular']);
    expect(seasonPending(s)).toBe(1);
    expect(claimCarry(s)).toBe(owed);
    expect(claimCarry(s)).toBe(0);
    expect(seasonTitles(s)).toEqual(['Harvest Cup Rookie', 'Harvest Cup Regular']);
  });

  it('normalizeSeason rolls a stored season over on load', () => {
    const stored = JSON.parse(JSON.stringify({ id: '2026-09', xp: 250, claimed: [1] }));
    const s = normalizeSeason(stored, OCT);
    expect(s.id).toBe('2026-10');
    expect(s.xp).toBe(0);
    expect(s.carry).toEqual({ id: '2026-09', coins: seasonReward(2, '2026-09').coins });
    const same = normalizeSeason({ id: '2026-10', xp: 250, claimed: [1, 1, 99, 'x'] }, OCT);
    expect(same).toEqual({ id: '2026-10', xp: 250, claimed: [1], titles: [], carry: null, pass: false, passClaimed: [], carryItems: [] });
    expect(normalizeSeason(undefined, OCT)).toEqual(defaultSeason(OCT));
    expect(normalizeSeason({ id: 'junk', xp: 900 }, OCT).xp).toBe(0);
  });

  it('seasonAdvance after the month ends counts the XP for the new season', () => {
    const s = defaultSeason(SEP);
    seasonAdvance(s, 100, SEP);
    expect(seasonAdvance(s, 100, OCT)).toEqual([1]);
    expect(s.id).toBe('2026-10');
    expect(s.carry?.coins).toBe(seasonReward(1, '2026-09').coins);
  });
});
