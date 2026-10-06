import { describe, expect, it } from 'vitest';
import { advanceDaily, dailyChallenges, dailyFor, defaultSave, exportSave, importSave, type MatchSummary } from '../src/core/save';
import { gems } from '../src/meta/gems';
import { AD_PLACES, advanceWeekly, adsLeft, calendarToday, claimCalendar, claimDailyGems, claimSweep, useAd, weeklyFor, weeklyObjectives } from '../src/meta/loops';

const DAY = '2026-10-12';
const BEFORE = '2026-10-11';
const AFTER = '2026-10-13';
const perfect: MatchSummary = {
  won: true, drawn: false, goals: 15, conceded: 0, assists: 8, tacklesWon: 25, passes: 40, skills: 15,
  headers: 2, longGoals: 1, powerups: 3, motm: true, blitz: true, difficulty: 3,
};

describe('reward periods move forward only', () => {
  it('cannot farm the login calendar by alternating two dates, even after reload', () => {
    let save = defaultSave();
    expect(claimCalendar(save, DAY, 1)).toMatchObject({ coins: 100, step: 1 });
    for (let i = 0; i < 10; i++) {
      save = importSave(exportSave(save))!;
      expect(calendarToday(save, BEFORE)).toBeNull();
      expect(claimCalendar(save, BEFORE, 2)).toBeNull();
      expect(claimCalendar(save, DAY, 2)).toBeNull();
    }
    expect(save.coins).toBe(600);
    expect(gems(save)).toBe(50);
    expect(claimCalendar(save, AFTER, 2)).toMatchObject({ coins: 150, step: 2 });
    expect(save.coins).toBe(750);
  });

  it('revalidates a stale gift card and doubles only the coins', () => {
    const save = defaultSave();
    save.gift = { last: BEFORE, streak: 2 };
    const before = exportSave(save);
    expect(claimCalendar(save, DAY, 7, true)).toBeNull();
    expect(exportSave(save)).toBe(before);
    expect(claimCalendar(save, DAY, 3, true)).toEqual({ coins: 400, gems: 5, tokens: 0, step: 3 });
    expect(claimCalendar(save, DAY, 3, true)).toBeNull();
    expect(save.coins).toBe(900);
    expect(gems(save)).toBe(55);
    save.gift = { last: DAY, streak: 4 };
    const tickets = save.shop!.tokens;
    expect(claimCalendar(save, AFTER, 5, true)).toEqual({ coins: 600, gems: 0, tokens: 1, step: 5 });
    expect(save.shop!.tokens).toBe(tickets + 1);
  });

  it('keeps progress after missed days and starts the next round only after day seven', () => {
    const save = defaultSave();
    save.gift = { last: '2026-09-01', streak: 6 };
    expect(claimCalendar(save, DAY, 7)).toEqual({ coins: 400, gems: 20, tokens: 0, step: 7 });
    expect(claimCalendar(save, '2026-12-01', 1)).toEqual({ coins: 100, gems: 0, tokens: 0, step: 1 });
    expect(save.coins).toBe(1000);
    expect(gems(save)).toBe(70);
  });

  it('retains paid daily objectives across rewinds and resets only on a later day', () => {
    let save = defaultSave();
    const daily = dailyFor(save.progress, DAY);
    for (let i = 0; i < 2; i++) advanceDaily(daily, dailyChallenges(daily.day), perfect);
    expect(daily.claimed).toEqual([true, true, true]);
    expect(claimSweep(save, DAY)).toBe(3);
    save = importSave(exportSave(save))!;
    for (const day of [BEFORE, DAY, BEFORE, DAY]) {
      const kept = dailyFor(save.progress, day);
      expect(kept.day).toBe(DAY);
      expect(kept.claimed).toEqual([true, true, true]);
      expect(advanceDaily(kept, dailyChallenges(kept.day), perfect)).toEqual([]);
      expect(claimSweep(save, kept.day)).toBe(0);
    }
    expect(dailyFor(save.progress, AFTER).claimed).toEqual([false, false, false]);
    expect(gems(save)).toBe(53);
  });

  it('does not repay an earlier sweep even if an earlier daily snapshot is presented', () => {
    const save = defaultSave();
    save.loops!.sweep = DAY;
    save.progress.daily = { day: BEFORE, progress: [99, 99, 99], claimed: [true, true, true], fresh: false };
    expect(claimSweep(save, BEFORE)).toBe(0);
    expect(gems(save)).toBe(50);
  });

  it('retains the current weekly objective identities during a clock rewind', () => {
    let save = defaultSave();
    weeklyFor(save, DAY);
    const expected = weeklyObjectives(DAY).map((o) => o.id).sort();
    const paid: string[] = [];
    for (let i = 0; i < 10; i++) paid.push(...advanceWeekly(save, '2026-10-05', perfect, 6).map((r) => r.objective.id));
    expect(paid.sort()).toEqual(expected);
    expect(gems(save)).toBe(80);
    save = importSave(exportSave(save))!;
    for (const day of ['2026-10-05', DAY, '2026-10-05', DAY]) {
      expect(weeklyFor(save, day).week).toBe(DAY);
      expect(advanceWeekly(save, day, perfect, 6)).toEqual([]);
    }
    expect(weeklyFor(save, '2026-11-02')).toMatchObject({ week: '2026-11-02', claimed: [false, false, false] });
  });

  it('cannot reopen any ad cap by rewinding the date, including after a save import', () => {
    let save = defaultSave();
    expect(claimDailyGems(save, DAY)).toBe(3);
    for (const place of AD_PLACES.filter((p) => p !== 'gem')) expect(useAd(save, place, DAY)).toBe(true);
    save = importSave(exportSave(save))!;
    for (const place of AD_PLACES) {
      expect(adsLeft(save, place, BEFORE)).toBe(0);
      expect(useAd(save, place, BEFORE)).toBe(false);
      expect(adsLeft(save, place, DAY)).toBe(0);
      expect(useAd(save, place, DAY)).toBe(false);
      expect(adsLeft(save, place, AFTER)).toBe(1);
    }
    expect(claimDailyGems(save, BEFORE)).toBe(0);
    expect(claimDailyGems(save, AFTER)).toBe(3);
    expect(gems(save)).toBe(56);
  });
});
