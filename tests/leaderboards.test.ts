import { describe, expect, it } from 'vitest';
import { defaultSave, type SaveData } from '../src/core/save';
import { LEADERBOARDS, leaderboardMonth, leaderboardScores, scoreKey } from '../src/meta/leaderboards';

/** Game Center leaderboards (meta/leaderboards.ts): what App Store Connect will hold, read straight off the save. */

/** Mid-October 2026, UTC. */
const OCT = new Date(Date.UTC(2026, 9, 15, 12));

const score = (save: SaveData, id: string, now: Date = OCT) => leaderboardScores(save, now).find((s) => s.id === id);

function octoberSave(): SaveData {
  const save = defaultSave();
  save.season = { id: '2026-10', xp: 0, claimed: [], titles: [], carry: null, pass: false, passClaimed: [], carryItems: [] };
  return save;
}

describe('Game Center leaderboards', () => {
  it('fit Apple\'s rules: four unique ids of letters, digits, dots and underscores, 100 characters at most', () => {
    const ids = LEADERBOARDS.map((b) => b.id);
    expect(ids).toEqual(['bl.lb.goals', 'bl.lb.wins', 'bl.lb.streak', 'bl.lb.season']);
    expect(new Set(ids).size).toBe(ids.length);
    for (const b of LEADERBOARDS) {
      expect(b.id).toMatch(/^bl\.lb\.[a-z0-9_]+$/);
      expect(b.id.length).toBeLessThanOrEqual(100);
      expect(b.title.length).toBeGreaterThan(0);
      expect(b.how.length).toBeGreaterThan(0);
      expect(b.unit).toHaveLength(2);
    }
    expect(LEADERBOARDS.filter((b) => b.seasonal).map((b) => b.id)).toEqual(['bl.lb.season']);
  });

  it('a fresh save has nothing to submit', () => {
    expect(leaderboardScores(octoberSave(), OCT)).toEqual([]);
  });

  it('goals, wins and the best streak are read off the save as whole numbers', () => {
    const save = octoberSave();
    save.record.goalsFor = 37;
    save.record.won = 12;
    save.progress.bestStreak = 6;
    save.progress.streak = 2;
    expect(score(save, 'bl.lb.goals')).toEqual({ id: 'bl.lb.goals', value: 37 });
    expect(score(save, 'bl.lb.wins')).toEqual({ id: 'bl.lb.wins', value: 12 });
    expect(score(save, 'bl.lb.streak')).toEqual({ id: 'bl.lb.streak', value: 6 });
    save.record.goalsFor = 40.9;
    expect(score(save, 'bl.lb.goals')?.value).toBe(40);
    save.record.won = Number.NaN;
    save.progress.bestStreak = -3;
    expect(score(save, 'bl.lb.wins')).toBeUndefined();
    expect(score(save, 'bl.lb.streak')).toBeUndefined();
  });

  it('the season board is this season\'s XP, tagged with the season, while the season is the current month', () => {
    const save = octoberSave();
    save.season!.xp = 1234;
    expect(score(save, 'bl.lb.season')).toEqual({ id: 'bl.lb.season', value: 1234, period: '2026-10' });
    // Any time in October (UTC) counts, first second to last.
    expect(score(save, 'bl.lb.season', new Date(Date.UTC(2026, 9, 1, 0, 0, 0)))?.value).toBe(1234);
    expect(score(save, 'bl.lb.season', new Date(Date.UTC(2026, 9, 31, 23, 59, 59)))?.value).toBe(1234);
  });

  it('a season that is not the current month submits nothing (the other boards still do)', () => {
    const save = octoberSave();
    save.season!.xp = 4200;
    save.record.won = 3;
    // November has begun: October's XP must not land on November's board.
    const nov = new Date(Date.UTC(2026, 10, 1, 0, 0, 1));
    expect(score(save, 'bl.lb.season', nov)).toBeUndefined();
    expect(score(save, 'bl.lb.wins', nov)?.value).toBe(3);
    // A stale season from months ago, and a save with no season at all.
    save.season!.id = '2026-07';
    expect(score(save, 'bl.lb.season')).toBeUndefined();
    delete save.season;
    expect(score(save, 'bl.lb.season')).toBeUndefined();
  });

  it('the month is UTC, the leaderboards\' clock, not the phone\'s', () => {
    expect(leaderboardMonth(OCT)).toBe('2026-10');
    expect(leaderboardMonth(new Date(Date.UTC(2026, 11, 31, 23, 59)))).toBe('2026-12');
    expect(leaderboardMonth(new Date(Date.UTC(2027, 0, 1, 0, 0)))).toBe('2027-01');
    // Late on 30 September on a phone behind UTC is already October on the leaderboards: September's XP stays home.
    const save = octoberSave();
    save.season = { id: '2026-09', xp: 3000, claimed: [], titles: [], carry: null, pass: false, passClaimed: [], carryItems: [] };
    expect(score(save, 'bl.lb.season', new Date(Date.UTC(2026, 9, 1, 3)))).toBeUndefined();
  });

  it('each season is remembered under its own key, the all-time boards under their id', () => {
    expect(scoreKey({ id: 'bl.lb.wins' })).toBe('bl.lb.wins');
    expect(scoreKey({ id: 'bl.lb.season', period: '2026-10' })).toBe('bl.lb.season@2026-10');
    expect(scoreKey({ id: 'bl.lb.season', period: '2026-11' })).not.toBe(scoreKey({ id: 'bl.lb.season', period: '2026-10' }));
  });
});
