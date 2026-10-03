import { describe, expect, it } from 'vitest';
import { defaultSave, type SaveData } from '../src/core/save';
import { ACHIEVEMENTS, achievementProgress } from '../src/meta/achievements';
import { MASTERY_THRESHOLDS, masteryOf } from '../src/meta/mastery';
import { MOMENTS } from '../src/meta/moments';
import { RUN_ROUNDS } from '../src/meta/run';

/** Game Center achievements (meta/achievements.ts): what App Store Connect will hold, read straight off the save. */

const pct = (save: SaveData, id: string) => achievementProgress(save).find((a) => a.id === id)?.percent ?? 0;

describe('Game Center achievements', () => {
  it('fit Apple\'s rules: unique ids of letters, digits, dots and underscores, 1 to 100 points each, 1000 at most in all', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of ACHIEVEMENTS) {
      expect(a.id).toMatch(/^[A-Za-z0-9._]+$/);
      expect(a.points).toBeGreaterThanOrEqual(1);
      expect(a.points).toBeLessThanOrEqual(100);
      expect(a.title.length).toBeGreaterThan(0);
      expect(a.target).toBeGreaterThan(0);
    }
    const total = ACHIEVEMENTS.reduce((n, a) => n + a.points, 0);
    expect(total).toBe(740);
    expect(ACHIEVEMENTS).toHaveLength(21);
  });

  it('a fresh save has earned nothing', () => {
    expect(achievementProgress(defaultSave()).filter((a) => a.percent >= 100)).toEqual([]);
  });

  it('wins, streaks and levels count up as percentages, and stop at 100', () => {
    const save = defaultSave();
    save.record.won = 1;
    expect(pct(save, 'bl.ach.first_win')).toBe(100);
    expect(pct(save, 'bl.ach.wins_50')).toBe(2);
    save.record.won = 80;
    expect(pct(save, 'bl.ach.wins_50')).toBe(100);
    save.progress.bestStreak = 3;
    expect(pct(save, 'bl.ach.streak_5')).toBe(60);
  });

  it('mastery tiers I, III and V complete at their thresholds', () => {
    const save = defaultSave();
    const m = masteryOf(save);
    m.counts.finisher = MASTERY_THRESHOLDS.finisher[0];
    save.mastery = m;
    expect(pct(save, 'bl.ach.finisher.1')).toBe(100);
    expect(pct(save, 'bl.ach.finisher.3')).toBeLessThan(100);
    m.counts.finisher = MASTERY_THRESHOLDS.finisher[4];
    expect(pct(save, 'bl.ach.finisher.5')).toBe(100);
    expect(pct(save, 'bl.ach.keeper.1')).toBe(0);
  });

  it('a cleared Club Run and three stars on every Moment are earned', () => {
    const save = defaultSave();
    expect(pct(save, 'bl.ach.run_champion')).toBe(0);
    save.run = { ...(save.run ?? ({} as NonNullable<SaveData['run']>)), best: 3, cleared: 0 } as NonNullable<SaveData['run']>;
    expect(pct(save, 'bl.ach.run_champion')).toBe(Math.floor((3 / RUN_ROUNDS) * 100));
    save.run = { ...save.run, cleared: 1 };
    expect(pct(save, 'bl.ach.run_champion')).toBe(100);
    save.moments = Object.fromEntries(MOMENTS.map((mo) => [mo.id, 3]));
    expect(pct(save, 'bl.ach.moments_all')).toBe(100);
  });
});
