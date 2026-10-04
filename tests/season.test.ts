import { describe, expect, it } from 'vitest';
import { defaultSave } from '../src/core/save';
import {
  SEASON_TIERS, addXp, claimAllSeason, claimCarry, claimSeasonTier, defaultSeason, normalizeSeason, rollSeason, seasonAdvance,
  seasonDaysLeft, seasonId, seasonName, seasonPending, seasonProgress, seasonReward, seasonTheme, seasonTier, seasonTitles,
  tierCost, tierXp, unclaimedTiers, selectJourney, journeyList,
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

  it('names the permanent journey without a countdown', () => {
    expect(seasonId(SEP)).toBe('2026-09');
    expect(seasonName('2026-09')).toBe('HARVEST CUP JOURNEY');
    expect(seasonTheme('2026-12').name).toBe('Winter Classic');
    expect(seasonDaysLeft(new Date(2026, 8, 30, 20, 0))).toBe(0);
    expect(seasonDaysLeft(new Date(2026, 8, 1, 0, 0))).toBe(0);
    expect(seasonDaysLeft(new Date(2099, 1, 27, 12, 0))).toBe(0);
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

describe('permanent Club Journeys', () => {
  it('a later month or year never expires XP, reached rewards or the paid pass', () => {
    const s = defaultSeason(SEP);
    seasonAdvance(s, 1000, SEP);
    claimSeasonTier(s, 1);
    claimSeasonTier(s, 5);
    s.pass = true;
    s.passClaimed = [1, 3];
    const before = JSON.stringify(s);
    expect(rollSeason(s, OCT)).toBe(false);
    expect(rollSeason(s, new Date(2099, 11, 31))).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
    expect(unclaimedTiers(s)).toEqual([2, 3, 4, 6, 7, 8, 9, 10]);
    expect(seasonTitles(s)).toEqual(['Harvest Cup Rookie']);
  });

  it('normalizes legacy monthly progress without changing its receipt ID or losing carry balances', () => {
    const stored = { id: '2026-09', xp: 250, claimed: [1, 1, 99, 'x'], pass: true, passClaimed: [1],
      carry: { id: '2026-08', coins: 125 }, carryGems: 20, carryItems: ['decor:kickpass08'], titles: ['Training Camp Star'] };
    const s = normalizeSeason(JSON.parse(JSON.stringify(stored)), OCT);
    expect(s).toMatchObject({ id: '2026-09', xp: 250, claimed: [1], pass: true, passClaimed: [1],
      carry: { id: '2026-08', coins: 125 }, carryGems: 20, carryItems: ['decor:kickpass08'], titles: ['Training Camp Star'] });
    expect(claimCarry(s)).toBe(125);
    expect(claimCarry(s)).toBe(0);
    expect(normalizeSeason(undefined, OCT)).toEqual(defaultSeason(OCT));
    expect(normalizeSeason({ id: 'junk', xp: 900 }, OCT).xp).toBe(0);
  });

  it('switches between twelve shipped journeys while keeping XP, paid claims and titles with their track', () => {
    const s = normalizeSeason({ id: '2026-09', xp: 1000, claimed: [5, 10], pass: true, passClaimed: [1, 3] }, SEP);
    expect(journeyList(s)).toHaveLength(12);
    expect(selectJourney(s, 'pass10')).toBe(true);
    expect(s).toMatchObject({ id: 'journey-10', xp: 0, pass: false, claimed: [], passClaimed: [] });
    expect(seasonAdvance(s, 100, OCT)).toEqual([1]);
    claimSeasonTier(s, 1);
    const loaded = normalizeSeason(JSON.parse(JSON.stringify(s)), new Date(2099, 0, 1));
    expect(selectJourney(loaded, 'pass09')).toBe(true);
    expect(loaded).toMatchObject({ id: '2026-09', xp: 1000, pass: true, claimed: [5, 10], passClaimed: [1, 3] });
    expect(claimSeasonTier(loaded, 5)).toBe(0);
    expect(seasonTitles(loaded)).toEqual(['Harvest Cup Rookie', 'Harvest Cup Regular']);
    expect(selectJourney(loaded, 'pass10')).toBe(true);
    expect(loaded).toMatchObject({ id: 'journey-10', xp: 100, claimed: [1] });
    const before = JSON.stringify(loaded);
    expect(selectJourney(loaded, 'pass10')).toBe(false);
    expect(selectJourney(loaded, 'pass99')).toBe(false);
    expect(JSON.stringify(loaded)).toBe(before);
  });
});
